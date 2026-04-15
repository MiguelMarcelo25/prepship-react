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

    // Postgres translation of SQLite logic:
    // - status columns in pg are usually lowercase unless quoted
    // - json_extract -> (raw::jsonb)->>'key'
    const statusSql = `
      SELECT o.orderstatus AS "orderStatus", COUNT(*)::int AS cnt
      FROM orders o
      LEFT JOIN order_local ol ON o.orderid = ol.orderid
      WHERE NOT (o.orderstatus = 'awaiting_shipment' AND COALESCE(ol.external_shipped, 0) = 1)
        AND NOT (o.orderstatus = 'awaiting_shipment' AND COALESCE((o.raw::jsonb)->>'externallyFulfilled', '0') = '1')
        AND NOT (
          o.orderstatus = 'awaiting_shipment'
          AND EXISTS (
            SELECT 1 FROM shipments s
            WHERE s.orderid = o.orderid AND s.voided = FALSE
          )
        )
        ${excludeClause}
      GROUP BY o.orderstatus
    `;

    const { rows: byStatus } = await this.pool.query(statusSql, params);

    const storeSql = `
      SELECT o.orderstatus AS "orderStatus", o.storeid AS "storeId", COUNT(*)::int AS cnt
      FROM orders o
      LEFT JOIN order_local ol ON o.orderid = ol.orderid
      WHERE NOT (o.orderstatus = 'awaiting_shipment' AND COALESCE(ol.external_shipped, 0) = 1)
        AND NOT (o.orderstatus = 'awaiting_shipment' AND COALESCE((o.raw::jsonb)->>'externallyFulfilled', '0') = '1')
        AND NOT (
          o.orderstatus = 'awaiting_shipment'
          AND EXISTS (
            SELECT 1 FROM shipments s
            WHERE s.orderid = o.orderid AND s.voided = FALSE
          )
        )
        ${excludeClause}
      GROUP BY o.orderstatus, o.storeid
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
