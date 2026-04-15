import type {
  AnalysisDailySalesQuery,
  AnalysisSkuQuery,
} from "../../../../../../packages/contracts/src/analysis/contracts.ts";
import type { PgPool } from "../../../../../../packages/shared/src/postgres/database.ts";
import { EXCLUDED_STORE_IDS } from "../../../common/prepship-config.ts";
import type { AnalysisRepository } from "../application/analysis-repository.ts";
import type { AnalysisDailySalesRow, AnalysisOrderRow } from "../domain/analysis.ts";

export class PgAnalysisRepository implements AnalysisRepository {
  private readonly pool: PgPool;

  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async listOrderRows(query: AnalysisSkuQuery): Promise<AnalysisOrderRow[]> {
    const where = ["o.orderstatus NOT IN ('cancelled')"];
    const params: Array<string | number> = [];
    let idx = 1;
    const next = () => `$${idx++}`;

    if (query.from) {
      where.push(`o.orderdate >= ${next()}`);
      params.push(query.from);
    }
    if (query.to) {
      where.push(`o.orderdate <= ${next()}`);
      params.push(`${query.to}T23:59:59`);
    }

    const storeIds = query.clientId != null ? await this.getClientStoreIds(query.clientId) : [];
    if (query.clientId != null) {
      if (storeIds.length === 0) return [];
      const placeholders = storeIds.map(() => next()).join(",");
      where.push(`o.storeid IN (${placeholders})`);
      params.push(...storeIds);
    }

    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT o.items, o.servicecode, o.storeid, o.orderstatus,
              ls.label_cost AS labelcost,
              CASE WHEN o.orderstatus = 'shipped' AND ls.orderid IS NULL THEN 1 ELSE 0 END AS isexternal
       FROM orders o
       LEFT JOIN (
         SELECT orderid, shipmentcost + COALESCE(othercost, 0) AS label_cost
         FROM shipments
         WHERE voided = false
           AND shipmentid IN (SELECT MAX(shipmentid) FROM shipments WHERE voided = false GROUP BY orderid)
       ) ls ON ls.orderid = o.orderid
       WHERE ${where.join(" AND ")}`,
      params,
    );

    return rows.map((row) => ({
      items: row.items == null ? null : String(row.items),
      serviceCode: row.servicecode == null ? null : String(row.servicecode),
      storeId: row.storeid == null ? null : Number(row.storeid),
      orderStatus: String(row.orderstatus ?? ""),
      labelCost: row.labelcost == null ? null : Number(row.labelcost),
      isExternal: Number(row.isexternal ?? 0),
    }));
  }

  async listDailySalesRows(query: AnalysisDailySalesQuery, since: string, until: string): Promise<AnalysisDailySalesRow[]> {
    const where: string[] = [];
    const params: Array<string | number> = [since, until];
    let idx = 3;
    const next = () => `$${idx++}`;

    if (EXCLUDED_STORE_IDS.length > 0) {
      const placeholders = EXCLUDED_STORE_IDS.map(() => next()).join(",");
      where.push(`o.storeid NOT IN (${placeholders})`);
      params.push(...EXCLUDED_STORE_IDS);
    }

    const storeIds = query.clientId != null ? await this.getClientStoreIds(query.clientId) : [];
    if (query.clientId != null) {
      if (storeIds.length === 0) return [];
      const placeholders = storeIds.map(() => next()).join(",");
      where.push(`o.storeid IN (${placeholders})`);
      params.push(...storeIds);
    }

    const extraWhere = where.length > 0 ? ` AND ${where.join(" AND ")}` : "";

    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT
         substring(o.orderdate, 1, 10) AS day,
         COALESCE(
           NULLIF(j.value->>'sku', ''),
           '_name_:' || lower(trim(COALESCE(j.value->>'name', '')))
         ) AS sku,
         j.value->>'name' AS name,
         SUM(COALESCE((j.value->>'quantity')::int, 1)) AS qty
       FROM orders o, jsonb_array_elements((o.items)::jsonb) AS j(value)
       WHERE o.orderstatus NOT IN ('cancelled')
         AND o.orderdate >= $1
         AND o.orderdate <= $2
         AND COALESCE((j.value->>'adjustment')::boolean, false) = false
         ${extraWhere}
       GROUP BY day, COALESCE(NULLIF(j.value->>'sku', ''), '_name_:' || lower(trim(COALESCE(j.value->>'name', '')))), j.value->>'name'
       ORDER BY day ASC`,
      params,
    );

    return rows.map((row) => ({
      day: String(row.day ?? ""),
      sku: String(row.sku ?? ""),
      name: row.name == null ? null : String(row.name),
      qty: Number(row.qty ?? 0),
    }));
  }

  async getStoreClientNameMap(): Promise<Record<number, string>> {
    const map: Record<number, string> = {};
    const { rows } = await this.pool.query<{ clientid: number; name: string; storeids: string | null }>(
      "SELECT clientid, name, storeids FROM clients WHERE active = true",
    );
    for (const row of rows) {
      try {
        const storeIds = JSON.parse(row.storeids ?? "[]") as unknown[];
        for (const storeId of storeIds) {
          const parsed = Number.parseInt(String(storeId), 10);
          if (Number.isFinite(parsed)) map[parsed] = row.name;
        }
      } catch {}
    }
    return map;
  }

  async getInventorySkuMap(): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    const { rows } = await this.pool.query<{ sku: string | null; id: number }>(
      "SELECT sku, id FROM inventory_skus",
    );
    for (const row of rows) {
      if (row.sku && !map.has(row.sku)) {
        map.set(row.sku, Number(row.id));
      }
    }
    return map;
  }

  async getClientStoreIds(clientId: number): Promise<number[]> {
    const { rows } = await this.pool.query<{ storeids: string | null }>(
      "SELECT storeids FROM clients WHERE clientid = $1",
      [clientId],
    );
    const raw = rows[0]?.storeids;
    if (!raw) return [];
    try {
      return (JSON.parse(raw) as unknown[])
        .map((value) => Number.parseInt(String(value), 10))
        .filter((value) => Number.isFinite(value));
    } catch {
      return [];
    }
  }
}
