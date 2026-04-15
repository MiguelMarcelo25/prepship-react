import type { PgPool } from "../../../../../../packages/shared/src/postgres/database.ts";
import type {
  InitCountsDto,
  InitStoreDto,
  OrdersByStatusDto,
  OrdersByStatusStoreDto,
} from "../../../../../../../packages/contracts/src/init/contracts.ts";
import type { InitRepository } from "../application/init-repository.ts";

export class PgInitRepository implements InitRepository {
  private readonly pool: PgPool;
  private readonly excludedStoreIds: number[];

  constructor(pool: PgPool, excludedStoreIds: number[]) {
    this.pool = pool;
    this.excludedStoreIds = excludedStoreIds;
  }

  async setupPerformanceIndexes(): Promise<void> {
    console.log("[db] verification started: creating performance indexes");
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_orders_ordernumber ON orders (ordernumber);
      CREATE INDEX IF NOT EXISTS idx_shipments_orderid ON shipments (orderid);
      CREATE INDEX IF NOT EXISTS idx_order_local_orderid ON order_local (orderid);
      CREATE INDEX IF NOT EXISTS idx_shipments_shipmentid ON shipments (shipmentid);
      CREATE INDEX IF NOT EXISTS idx_shipments_voided ON shipments (voided);
      CREATE INDEX IF NOT EXISTS idx_shipments_clientid ON shipments (clientid);
    `);
    console.log("[db] verification complete: indexes verified");
  }

  async listLocalClientStores(): Promise<InitStoreDto[]> {
    const { rows } = await this.pool.query(`
      SELECT DISTINCT name, storeids
      FROM clients
    `);

    const stores: InitStoreDto[] = [];
    for (const row of rows) {
      const storeIds = this.parseStoreIds(row.storeids);
      for (const storeId of storeIds) {
        if (this.excludedStoreIds.includes(storeId)) continue;
        stores.push({
          storeId,
          storeName: row.name,
          marketplaceId: null,
          marketplaceName: "Local Client",
          accountName: null,
          email: null,
          integrationUrl: null,
          active: true,
          companyName: "",
          phone: "",
          publicEmail: "",
          website: "",
          refreshDate: null,
          lastRefreshAttempt: null,
          createDate: null,
          modifyDate: null,
          autoRefresh: false,
          statusMappings: null,
          isLocal: true,
        });
      }
    }

    return stores;
  }

  async getCounts(): Promise<InitCountsDto> {
    const params: Array<string | number> = [];
    let idx = 1;
    const next = () => `$${idx++}`;

    const placeholders = this.excludedStoreIds.map(() => next()).join(", ");
    const excludeClause = this.excludedStoreIds.length > 0
      ? `AND o.storeid NOT IN (${placeholders})`
      : "";
    if (this.excludedStoreIds.length > 0) params.push(...this.excludedStoreIds);

    // Use the same logic as the orders list query so counts match:
    // - awaiting_shipment orders with external_shipped, externallyFulfilled,
    //   or a label (non-voided shipment with cost) are moved to "shipped".
    const shipmentJoin = `
      LEFT JOIN (
        WITH latest_ship AS (
          SELECT orderid, MAX(shipmentid) AS shipmentid
          FROM shipments WHERE voided = FALSE GROUP BY orderid
        )
        SELECT ls.orderid, (s.shipmentcost + COALESCE(s.othercost, 0)) AS label_cost
        FROM latest_ship ls
        JOIN shipments s ON s.shipmentid = ls.shipmentid
      ) ship ON ship.orderid = o.orderid
    `;

    // Compute effective status: awaiting_shipment orders that have been
    // externally shipped or have a label are counted as "shipped".
    const effectiveStatus = `
      CASE
        WHEN o.orderstatus = 'awaiting_shipment'
          AND (
            COALESCE(ol.external_shipped, 0) = 1
            OR COALESCE((o.raw::jsonb)->>'externallyFulfilled', 'false') IN ('true', '1')
            OR ship.label_cost IS NOT NULL
          )
        THEN 'shipped'
        ELSE o.orderstatus
      END
    `;

    const statusSql = `
      SELECT ${effectiveStatus} AS "orderStatus", COUNT(*)::int AS cnt
      FROM orders o
      LEFT JOIN order_local ol ON o.orderid = ol.orderid
      ${shipmentJoin}
      WHERE 1=1 ${excludeClause}
      GROUP BY "orderStatus"
    `;

    const { rows: byStatus } = await this.pool.query(statusSql, params);

    const storeSql = `
      SELECT ${effectiveStatus} AS "orderStatus", o.storeid AS "storeId", COUNT(*)::int AS cnt
      FROM orders o
      LEFT JOIN order_local ol ON o.orderid = ol.orderid
      ${shipmentJoin}
      WHERE 1=1 ${excludeClause}
      GROUP BY "orderStatus", o.storeid
      ORDER BY cnt DESC
    `;

    const { rows: byStatusStoreRaw } = await this.pool.query(storeSql, params);

    // node-pg returns BIGINT columns as strings to avoid precision loss.
    // Normalize storeId to a number so client-side Map<number, string> lookups
    // in sidebar-data.ts work regardless of the pg column type.
    const byStatusStore = byStatusStoreRaw.map((row: any) => ({
      orderStatus: row.orderStatus,
      storeId: row.storeId == null ? null : Number(row.storeId),
      cnt: Number(row.cnt),
    }));

    return {
      byStatus: byStatus as any,
      byStatusStore: byStatusStore as any,
    };
  }

  async getRateBrowserMarkups(): Promise<Record<string, unknown>> {
    const { rows } = await this.pool.query(`
      SELECT value
      FROM sync_meta
      WHERE key = 'setting:rbMarkups'
      LIMIT 1
    `);

    if (rows.length === 0 || !rows[0].value) return {};

    try {
      const val = rows[0].value;
      const parsed = typeof val === "string" ? JSON.parse(val) : val;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  private parseStoreIds(raw: any): number[] {
    if (!raw) return [];
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((value) => Number.parseInt(String(value), 10))
        .filter((value) => Number.isFinite(value));
    } catch {
      return [];
    }
  }
}
