import type {
  GetOrderIdsQuery,
  GetOrderPicklistQuery,
  ListOrdersQuery,
  OrderBestRateDto,
  OrderExportQuery,
  OrderExportRow,
  OrderFullDto,
  OrdersDailyStatsDto,
  OrderPicklistItemDto,
} from "../../../../../../packages/contracts/src/orders/contracts.ts";
import type { PgPool } from "../../../../../../packages/shared/src/postgres/database.ts";
import type { OrderRepository, OrderListResult } from "../application/order-repository.ts";
import type { OrderRecord } from "../domain/order.ts";

/**
 * Postgres OrderRepository.
 *
 * Notes on dialect translation:
 *  - SQLite `?` placeholders → Postgres `$1, $2, ...`
 *  - SQLite `json_extract(col, '$.foo')` → Postgres `(col::jsonb)->>'foo'` (text) or `((col::jsonb)->>'foo')::int`
 *  - SQLite `json_each(col)` → Postgres `jsonb_array_elements(col::jsonb) AS j(value)`
 *  - SQLite `INSERT OR REPLACE` and `ON CONFLICT(...) DO UPDATE SET` → ON CONFLICT works in pg too
 *  - SQLite stores text as TEXT in raw/items; we keep them as TEXT in pg too and cast inline.
 *  - boolean columns in pg are TRUE/FALSE; sqlite-style 0/1 maps via cast.
 */
export class PgOrderRepository implements OrderRepository {
  private readonly pool: PgPool;
  private readonly excludedStoreIds: number[];

  constructor(pool: PgPool, excludedStoreIds: number[] = []) {
    this.pool = pool;
    this.excludedStoreIds = excludedStoreIds;
  }

  async list(query: ListOrdersQuery): Promise<OrderListResult> {
    const page = Math.max(1, query.page);
    const pageSize = Math.max(1, Math.min(500, query.pageSize));
    const offset = (page - 1) * pageSize;

    const clauses: string[] = [];
    const params: Array<string | number> = [];
    let idx = 1;
    const next = () => `$${idx++}`;

    if (query.orderStatus) { clauses.push(`o.orderstatus = ${next()}`); params.push(query.orderStatus); }
    if (query.storeId != null) { clauses.push(`o.storeid = ${next()}`); params.push(query.storeId); }
    if (query.clientId != null) { clauses.push(`o.clientid = ${next()}`); params.push(query.clientId); }
    if (query.dateStart) { clauses.push(`o.orderdate >= ${next()}`); params.push(query.dateStart); }
    if (query.dateEnd) { clauses.push(`o.orderdate <= ${next()}`); params.push(query.dateEnd); }
    if (this.excludedStoreIds.length > 0) {
      const placeholders = this.excludedStoreIds.map(() => next()).join(", ");
      clauses.push(`o.storeid NOT IN (${placeholders})`);
      params.push(...this.excludedStoreIds);
    }
    if (query.search) {
      const s1 = next(), s2 = next(), s3 = next();
      clauses.push(`(o.ordernumber ILIKE ${s1} OR o.customeremail ILIKE ${s2} OR o.shiptoname ILIKE ${s3})`);
      const term = `%${query.search}%`;
      params.push(term, term, term);
    }
    if (query.orderStatus === "awaiting_shipment") {
      clauses.push(`COALESCE(ol.external_shipped, 0) = 0`);
      clauses.push(`COALESCE((o.raw::jsonb)->>'externallyFulfilled', 'false') NOT IN ('true', '1')`);
      clauses.push(`ship.label_cost IS NULL`);
    } else if (query.orderStatus === "shipped") {
      clauses.push(`(o.orderstatus = 'shipped' OR (o.orderstatus = 'awaiting_shipment' AND ship.label_cost IS NOT NULL))`);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const shipmentJoin = `
      LEFT JOIN (
        WITH latest_ship AS (
          SELECT orderid, MAX(shipmentid) AS shipmentid
          FROM shipments WHERE voided = FALSE GROUP BY orderid
        )
        SELECT
          s.orderid,
          s.shipmentid AS label_shipmentid,
          (s.shipmentcost + COALESCE(s.othercost, 0)) AS label_cost,
          s.shipmentcost AS label_raw_cost,
          s.carriercode AS label_carrier,
          s.servicecode AS label_service,
          s.trackingnumber AS label_tracking,
          s.shipdate AS label_shipdate,
          s.provideraccountid AS label_provider,
          s.provider_account_nickname AS label_provider_nickname,
          s.label_created_at,
          s.labelurl AS label_url,
          s.selected_rate_json
        FROM latest_ship ls
        JOIN shipments s ON s.shipmentid = ls.shipmentid
      ) ship ON ship.orderid = o.orderid
    `;

    const fromClause = `
      FROM orders o
      LEFT JOIN order_local ol ON ol.orderid = o.orderid
      ${shipmentJoin}
    `;

    const countSql = `SELECT COUNT(*)::int AS total ${fromClause} ${where}`;
    const { rows: countRows } = await this.pool.query(countSql, params);
    const total = Number(countRows[0]?.total ?? 0);

    const dataSql = `
      SELECT
        o.orderid,
        o.clientid,
        c.name AS clientname,
        o.ordernumber,
        o.orderstatus,
        o.orderdate,
        o.storeid,
        o.customeremail,
        o.shiptoname,
        o.shiptocity,
        o.shiptostate,
        o.shiptopostalcode,
        o.carriercode,
        o.servicecode,
        o.weightvalue,
        o.ordertotal,
        o.shippingamount,
        CASE WHEN ol.residential IS NULL THEN NULL WHEN ol.residential = 1 THEN 1 ELSE 0 END AS residential,
        CASE
          WHEN ((o.raw::jsonb)->'shipTo'->>'residential') IS NULL THEN NULL
          WHEN ((o.raw::jsonb)->'shipTo'->>'residential') IN ('true', '1') THEN 1
          ELSE 0
        END AS source_residential,
        COALESCE(ol.external_shipped, 0) AS external_shipped,
        COALESCE(o.externally_fulfilled_verified, 0) AS externally_fulfilled_verified,
        ol.best_rate_json,
        ship.selected_rate_json,
        ship.label_shipmentid,
        ship.label_tracking,
        ship.label_carrier,
        ship.label_service,
        ship.label_provider,
        ship.label_cost,
        ship.label_raw_cost,
        ship.label_shipdate,
        ship.label_created_at,
        ship.label_url,
        o.raw,
        COALESCE(o.items, '[]') AS items
      ${fromClause}
      LEFT JOIN clients c ON c.clientid = o.clientid
      ${where}
      ORDER BY o.orderdate DESC
      LIMIT ${next()} OFFSET ${next()}
    `;
    params.push(pageSize, offset);

    const { rows } = await this.pool.query(dataSql, params);
    return { orders: rows.map((r) => this.mapRow(r)), total };
  }

  async getById(orderId: number): Promise<OrderRecord | null> {
    const { rows } = await this.pool.query(
      `
      SELECT
        o.orderid,
        o.clientid,
        c.name AS clientname,
        o.ordernumber,
        CASE
          WHEN COALESCE((o.raw::jsonb)->>'externallyFulfilled', 'false') IN ('true', '1') THEN 'shipped'
          WHEN ship.label_shipmentid IS NOT NULL THEN 'shipped'
          ELSE o.orderstatus
        END AS orderstatus,
        o.orderdate, o.storeid, o.customeremail, o.shiptoname, o.shiptocity,
        o.shiptostate, o.shiptopostalcode, o.carriercode, o.servicecode,
        o.weightvalue, o.ordertotal, o.shippingamount,
        CASE WHEN ol.residential IS NULL THEN NULL WHEN ol.residential = 1 THEN 1 ELSE 0 END AS residential,
        CASE
          WHEN ((o.raw::jsonb)->'shipTo'->>'residential') IS NULL THEN NULL
          WHEN ((o.raw::jsonb)->'shipTo'->>'residential') IN ('true', '1') THEN 1
          ELSE 0
        END AS source_residential,
        COALESCE(ol.external_shipped, 0) AS external_shipped,
        COALESCE(o.externally_fulfilled_verified, 0) AS externally_fulfilled_verified,
        ol.best_rate_json,
        COALESCE(ship.selected_rate_json::text, CASE
          WHEN ship.label_shipmentid IS NOT NULL THEN
            jsonb_build_object(
              'cost', ship.label_raw_cost,
              'shippingProviderId', ship.label_provider,
              'serviceCode', ship.label_service,
              'serviceName', COALESCE(ship.label_service, ship.label_carrier),
              'carrierCode', ship.label_carrier
            )::text
          ELSE NULL
        END) AS selected_rate_json,
        ship.label_shipmentid, ship.label_tracking, ship.label_carrier,
        ship.label_service, ship.label_provider, ship.label_cost,
        ship.label_raw_cost, ship.label_shipdate, ship.label_created_at,
        o.raw, COALESCE(o.items, '[]') AS items,
        ol.rate_dims_l, ol.rate_dims_w, ol.rate_dims_h
      FROM orders o
      LEFT JOIN order_local ol ON ol.orderid = o.orderid
      LEFT JOIN clients c ON c.clientid = o.clientid
      LEFT JOIN (
        WITH latest_ship AS (
          SELECT orderid, MAX(shipmentid) AS shipmentid
          FROM shipments WHERE voided = FALSE GROUP BY orderid
        )
        SELECT s.orderid, s.shipmentid AS label_shipmentid,
          (s.shipmentcost + COALESCE(s.othercost,0)) AS label_cost,
          s.shipmentcost AS label_raw_cost, s.carriercode AS label_carrier,
          s.servicecode AS label_service, s.trackingnumber AS label_tracking,
          s.shipdate AS label_shipdate, s.provideraccountid AS label_provider,
          s.label_created_at, s.labelurl AS label_url, s.selected_rate_json
        FROM latest_ship ls JOIN shipments s ON s.shipmentid = ls.shipmentid
      ) ship ON ship.orderid = o.orderid
      WHERE o.orderid = $1
      `,
      [orderId],
    );
    return rows.length > 0 ? this.mapRow(rows[0]!) : null;
  }

  async findIdsBySku(query: GetOrderIdsQuery): Promise<number[]> {
    const params: Array<string | number> = [];
    let idx = 1;
    const next = () => `$${idx++}`;
    const clauses: string[] = [];

    if (query.orderStatus) { clauses.push(`o.orderstatus = ${next()}`); params.push(query.orderStatus); }
    if (query.storeId != null) { clauses.push(`o.storeid = ${next()}`); params.push(query.storeId); }
    if (this.excludedStoreIds.length > 0) {
      const ph = this.excludedStoreIds.map(() => next()).join(", ");
      clauses.push(`o.storeid NOT IN (${ph})`);
      params.push(...this.excludedStoreIds);
    }

    const skuParam1 = next();
    const skuParam2 = next();
    clauses.push(`EXISTS (
      SELECT 1 FROM jsonb_array_elements(o.items::jsonb) j(value)
      WHERE COALESCE((j.value->>'adjustment')::int, 0) <> 1
        AND (LOWER(COALESCE(j.value->>'sku', '')) = LOWER(${skuParam1})
          OR LOWER(COALESCE(j.value->>'name', '')) = LOWER(${skuParam2}))
    )`);
    params.push(query.sku, query.sku);

    if (query.qty != null) {
      const qParam = next();
      clauses.push(`(
        SELECT COALESCE(SUM(COALESCE((j.value->>'quantity')::int, 1)), 0)
        FROM jsonb_array_elements(o.items::jsonb) j(value)
        WHERE COALESCE((j.value->>'adjustment')::int, 0) <> 1
      ) = ${qParam}`);
      params.push(query.qty);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const { rows } = await this.pool.query(
      `SELECT o.orderid FROM orders o ${where} ORDER BY o.orderdate DESC`,
      params,
    );
    return rows.map((r) => Number(r.orderid));
  }

  async getPicklist(query: GetOrderPicklistQuery): Promise<OrderPicklistItemDto[]> {
    const params: Array<string | number> = [];
    let idx = 1;
    const next = () => `$${idx++}`;
    const clauses: string[] = [];

    if (query.orderStatus) { clauses.push(`o.orderstatus = ${next()}`); params.push(query.orderStatus); }
    if (query.storeId != null) { clauses.push(`o.storeid = ${next()}`); params.push(query.storeId); }
    if (query.dateStart) { clauses.push(`o.orderdate >= ${next()}`); params.push(query.dateStart); }
    if (query.dateEnd) { clauses.push(`o.orderdate <= ${next()}`); params.push(query.dateEnd); }
    if (this.excludedStoreIds.length > 0) {
      const ph = this.excludedStoreIds.map(() => next()).join(", ");
      clauses.push(`o.storeid NOT IN (${ph})`);
      params.push(...this.excludedStoreIds);
    }
    if (query.orderStatus === "awaiting_shipment") {
      clauses.push(`COALESCE(ol.external_shipped, 0) = 0`);
      clauses.push(`COALESCE((o.raw::jsonb)->>'externallyFulfilled', 'false') NOT IN ('true', '1')`);
    }
    clauses.push(`COALESCE((j.value->>'adjustment')::int, 0) = 0`);
    clauses.push(`(j.value->>'sku') IS NOT NULL AND (j.value->>'sku') <> ''`);

    const { rows } = await this.pool.query(
      `
      SELECT
        o.storeid,
        COALESCE(c.name, 'Unknown') AS clientname,
        j.value->>'sku' AS sku,
        j.value->>'name' AS name,
        j.value->>'imageUrl' AS imageurl,
        SUM(((j.value->>'quantity')::int)) AS totalqty,
        COUNT(DISTINCT o.orderid) AS ordercount
      FROM orders o
      LEFT JOIN order_local ol ON ol.orderid = o.orderid
      LEFT JOIN clients c ON EXISTS (
        SELECT 1 FROM jsonb_array_elements(c.storeids::jsonb) si WHERE (si.value::int) = o.storeid
      )
      , jsonb_array_elements(o.items::jsonb) j(value)
      WHERE ${clauses.join(" AND ")}
      GROUP BY o.storeid, j.value->>'sku', j.value->>'name', j.value->>'imageUrl', c.name
      ORDER BY clientname ASC, totalqty DESC
      `,
      params,
    );
    return rows.map((row) => ({
      storeId: row.storeid == null ? null : Number(row.storeid),
      clientName: String(row.clientname ?? "Unknown"),
      sku: String(row.sku),
      name: row.name == null ? null : String(row.name),
      imageUrl: row.imageurl == null ? null : String(row.imageurl),
      totalQty: Number(row.totalqty ?? 0),
      orderCount: Number(row.ordercount ?? 0),
    }));
  }

  async getFullById(orderId: number): Promise<OrderFullDto | null> {
    const { rows: orderRows } = await this.pool.query(
      "SELECT raw FROM orders WHERE orderid = $1",
      [orderId],
    );
    if (orderRows.length === 0) return null;
    const { rows: shipments } = await this.pool.query(
      "SELECT * FROM shipments WHERE orderid = $1 AND voided = FALSE ORDER BY shipdate DESC",
      [orderId],
    );
    const { rows: localRows } = await this.pool.query(
      "SELECT * FROM order_local WHERE orderid = $1",
      [orderId],
    );
    const raw = JSON.parse(orderRows[0].raw as string) as Record<string, unknown>;
    if (Array.isArray(shipments) && shipments.length > 0) {
      raw.orderStatus = "shipped";
    }
    return { raw, shipments, local: localRows[0] ?? null };
  }

  async updateExternalShipped(orderId: number, externalShipped: boolean, source: string | null = null): Promise<void> {
    const now = Date.now();
    const flag = externalShipped ? 1 : 0;
    await this.pool.query(
      `INSERT INTO order_local (orderid, external_shipped, external_shipped_source, updatedat)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (orderid) DO UPDATE SET external_shipped = $2, external_shipped_source = $3, updatedat = $4`,
      [orderId, flag, source, now],
    );
    if (externalShipped) {
      await this.pool.query("UPDATE shipments SET source = 'external' WHERE orderid = $1 AND voided = FALSE", [orderId]);
    } else {
      await this.pool.query("UPDATE shipments SET source = 'prepship' WHERE orderid = $1 AND voided = FALSE AND source = 'external'", [orderId]);
    }
  }

  async updateResidential(orderId: number, residential: boolean | null): Promise<void> {
    const value = residential == null ? null : residential ? 1 : 0;
    const now = Date.now();
    await this.pool.query(
      `INSERT INTO order_local (orderid, residential, updatedat) VALUES ($1, $2, $3)
       ON CONFLICT (orderid) DO UPDATE SET residential = $2, updatedat = $3`,
      [orderId, value, now],
    );
  }

  async updateSelectedPid(orderId: number, selectedPid: number | null): Promise<void> {
    const now = Date.now();
    await this.pool.query(
      `INSERT INTO order_local (orderid, selected_pid, updatedat) VALUES ($1, $2, $3)
       ON CONFLICT (orderid) DO UPDATE SET selected_pid = $2, updatedat = $3`,
      [orderId, selectedPid, now],
    );
  }

  async updateBestRate(orderId: number, bestRate: OrderBestRateDto, bestRateDims: string | null): Promise<void> {
    const now = Date.now();
    await this.pool.query(
      `INSERT INTO order_local (orderid, best_rate_json, best_rate_at, best_rate_dims, updatedat)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (orderid) DO UPDATE SET
         best_rate_json = EXCLUDED.best_rate_json,
         best_rate_at = EXCLUDED.best_rate_at,
         best_rate_dims = EXCLUDED.best_rate_dims,
         updatedat = EXCLUDED.updatedat`,
      [orderId, JSON.stringify(bestRate), now, bestRateDims, now],
    );
  }

  async updateOrderRateDims(orderId: number, length: number, width: number, height: number): Promise<void> {
    const now = Date.now();
    await this.pool.query(
      `INSERT INTO order_local (orderid, rate_dims_l, rate_dims_w, rate_dims_h, updatedat)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (orderid) DO UPDATE SET
         rate_dims_l = EXCLUDED.rate_dims_l,
         rate_dims_w = EXCLUDED.rate_dims_w,
         rate_dims_h = EXCLUDED.rate_dims_h,
         updatedat = EXCLUDED.updatedat`,
      [orderId, length, width, height, now],
    );
  }

  async getSkuQtyDims(sku: string, qty: number): Promise<{ length: number; width: number; height: number } | null> {
    const { rows } = await this.pool.query(
      "SELECT length, width, height FROM sku_qty_dims WHERE sku = $1 AND qty = $2",
      [sku, qty],
    );
    if (rows.length === 0) return null;
    const r = rows[0]!;
    if (!r.length || !r.width || !r.height) return null;
    return { length: Number(r.length), width: Number(r.width), height: Number(r.height) };
  }

  async saveSkuQtyDims(sku: string, qty: number, length: number, width: number, height: number): Promise<void> {
    const now = Date.now();
    await this.pool.query(
      `INSERT INTO sku_qty_dims (sku, qty, length, width, height, updatedat)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (sku, qty) DO UPDATE SET
         length = EXCLUDED.length,
         width = EXCLUDED.width,
         height = EXCLUDED.height,
         updatedat = EXCLUDED.updatedat`,
      [sku, qty, length, width, height, now],
    );
  }

  async getDailyStats(): Promise<OrdersDailyStatsDto> {
    const now = new Date();
    const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
    const today6pm = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0);
    const dayMs = 24 * 60 * 60 * 1000;
    const isPm = now >= today6pm;
    const dow = now.getDay();

    let windowStart: Date;
    let windowEnd: Date;
    if (dow === 6) { windowStart = new Date(todayNoon.getTime() - dayMs); windowEnd = new Date(todayNoon.getTime() + 2 * dayMs); }
    else if (dow === 0) { windowStart = new Date(todayNoon.getTime() - 2 * dayMs); windowEnd = new Date(todayNoon.getTime() + dayMs); }
    else if (dow === 1) {
      if (isPm) { windowStart = todayNoon; windowEnd = new Date(todayNoon.getTime() + dayMs); }
      else { windowStart = new Date(todayNoon.getTime() - 3 * dayMs); windowEnd = todayNoon; }
    } else if (dow === 5) {
      if (isPm) { windowStart = todayNoon; windowEnd = new Date(todayNoon.getTime() + 3 * dayMs); }
      else { windowStart = new Date(todayNoon.getTime() - dayMs); windowEnd = todayNoon; }
    } else if (isPm) { windowStart = todayNoon; windowEnd = new Date(todayNoon.getTime() + dayMs); }
    else { windowStart = new Date(todayNoon.getTime() - dayMs); windowEnd = todayNoon; }

    const fromStr = this.localIso(windowStart);
    const toStr = this.localIso(windowEnd);
    const excludedClause = this.excludedStoreIds.length > 0
      ? ` AND storeid NOT IN (${this.excludedStoreIds.map((_, i) => `$${i + 3}`).join(", ")})`
      : "";
    const baseParams: Array<string | number> = [fromStr, toStr, ...this.excludedStoreIds];

    const totalQ = await this.pool.query(
      `SELECT COUNT(*)::int AS cnt FROM orders WHERE orderdate >= $1 AND orderdate <= $2 AND orderstatus NOT IN ('cancelled') ${excludedClause}`,
      baseParams,
    );
    const needShipQ = await this.pool.query(
      `SELECT COUNT(*)::int AS cnt FROM orders WHERE orderdate >= $1 AND orderdate <= $2 AND orderstatus = 'awaiting_shipment' ${excludedClause}`,
      baseParams,
    );
    const upcomingClause = this.excludedStoreIds.length > 0
      ? ` AND storeid NOT IN (${this.excludedStoreIds.map((_, i) => `$${i + 2}`).join(", ")})`
      : "";
    const upcomingQ = await this.pool.query(
      `SELECT COUNT(*)::int AS cnt FROM orders WHERE orderdate > $1 AND orderstatus NOT IN ('cancelled') ${upcomingClause}`,
      [toStr, ...this.excludedStoreIds],
    );

    return {
      window: {
        from: fromStr,
        to: toStr,
        fromLabel: this.formatPt(windowStart),
        toLabel: this.formatPt(windowEnd),
      },
      totalOrders: Number(totalQ.rows[0]?.cnt ?? 0),
      needToShip: Number(needShipQ.rows[0]?.cnt ?? 0),
      upcomingOrders: Number(upcomingQ.rows[0]?.cnt ?? 0),
    };
  }

  async exportOrders(query: OrderExportQuery): Promise<OrderExportRow[]> {
    const clauses: string[] = ["o.raw IS NOT NULL"];
    const params: Array<string | number> = [];
    let idx = 1;
    const next = () => `$${idx++}`;

    if (this.excludedStoreIds.length > 0) {
      const ph = this.excludedStoreIds.map(() => next()).join(", ");
      clauses.push(`o.storeid NOT IN (${ph})`);
      params.push(...this.excludedStoreIds);
    }

    if (query.orderStatus === "awaiting_shipment") {
      clauses.push(`COALESCE(ol.external_shipped, 0) = 0`);
      clauses.push(`COALESCE((o.raw::jsonb)->>'externallyFulfilled', 'false') NOT IN ('true', '1')`);
      clauses.push(`ship.label_cost IS NULL`);
    } else {
      clauses.push(`(o.orderstatus = 'shipped' OR (o.orderstatus = 'awaiting_shipment' AND ship.label_cost IS NOT NULL))`);
    }

    const where = `WHERE ${clauses.join(" AND ")}`;
    const sql = `
      SELECT o.orderid, o.clientid, o.storeid, o.raw,
             COALESCE(ol.external_shipped, 0) AS external_shipped,
             ol.best_rate_json,
             ship.label_shipmentid, ship.label_cost, ship.label_raw_cost,
             ship.label_carrier, ship.label_service,
             ship.label_tracking, ship.label_shipdate, ship.label_created_at,
             ship.selected_rate_json
      FROM orders o
      LEFT JOIN order_local ol ON ol.orderid = o.orderid
      LEFT JOIN (
        WITH latest_ship AS (
          SELECT orderid, MAX(shipmentid) AS shipmentid FROM shipments WHERE voided = FALSE GROUP BY orderid
        )
        SELECT s.orderid, s.shipmentid AS label_shipmentid,
               s.shipmentcost + COALESCE(s.othercost,0) AS label_cost,
               s.shipmentcost AS label_raw_cost,
               s.carriercode AS label_carrier, s.servicecode AS label_service,
               s.trackingnumber AS label_tracking, s.shipdate AS label_shipdate,
               s.provideraccountid AS label_provider,
               s.label_created_at, s.selected_rate_json
        FROM latest_ship ls JOIN shipments s ON s.shipmentid = ls.shipmentid
      ) ship ON ship.orderid = o.orderid
      ${where}
      ORDER BY o.orderdate DESC
      LIMIT ${next()}
    `;
    params.push(query.pageSize);
    const { rows } = await this.pool.query(sql, params);
    return rows as OrderExportRow[];
  }

  async getStoreCounts(orderStatus: string, dateStart?: string, dateEnd?: string): Promise<Array<{ storeId: number | null; count: number }>> {
    const params: Array<string | number> = [orderStatus];
    let idx = 2;
    let where = "WHERE o.orderstatus = $1";
    if (dateStart) { where += ` AND o.orderdate >= $${idx++}`; params.push(dateStart); }
    if (dateEnd) { where += ` AND o.orderdate <= $${idx++}`; params.push(dateEnd); }
    if (this.excludedStoreIds.length > 0) {
      const ph = this.excludedStoreIds.map(() => `$${idx++}`).join(", ");
      where += ` AND o.storeid NOT IN (${ph})`;
      params.push(...this.excludedStoreIds);
    }
    const { rows } = await this.pool.query(
      `SELECT o.storeid, COUNT(*)::int AS count FROM orders o ${where} GROUP BY o.storeid`,
      params,
    );
    return rows.map((r) => ({ storeId: r.storeid == null ? null : Number(r.storeid), count: Number(r.count) }));
  }

  async upsertOrder(order: Partial<OrderRecord>): Promise<void> {
    const now = Date.now();
    const sql = `
      INSERT INTO orders (
        orderid, ordernumber, orderstatus, orderdate, storeid, customeremail,
        shiptoname, shiptocity, shiptostate, shiptopostalcode, carriercode, servicecode,
        weightvalue, ordertotal, shippingamount, items, raw, updatedat, clientid
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      ON CONFLICT(orderid) DO UPDATE SET
        orderstatus = EXCLUDED.orderstatus,
        updatedat = EXCLUDED.updatedat
    `;
    await this.pool.query(sql, [
      order.orderId, order.orderNumber, order.orderStatus, order.orderDate, order.storeId,
      order.customerEmail ?? null, order.shipToName ?? null, order.shipToCity ?? null,
      order.shipToState ?? null, order.shipToPostalCode ?? null,
      order.carrierCode ?? null, order.serviceCode ?? null, order.weightValue ?? null,
      order.orderTotal ?? 0, order.shippingAmount ?? 0,
      order.items ?? "[]", order.raw ?? "{}", now, order.clientId,
    ]);
  }

  async markStatus(orderId: number, status: string): Promise<void> {
    const now = Date.now();
    await this.pool.query("UPDATE orders SET orderstatus = $1, updatedat = $2 WHERE orderid = $3", [status, now, orderId]);
  }

  async getByOrderNumber(orderNumber: string): Promise<OrderRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT o.*, c.name AS clientname
       FROM orders o
       LEFT JOIN clients c ON c.clientid = o.clientid
       WHERE o.ordernumber = $1
       LIMIT 1`,
      [orderNumber],
    );
    if (rows.length === 0) return null;
    return this.mapRow(rows[0]!);
  }

  private mapRow(row: Record<string, unknown>): OrderRecord {
    return {
      orderId: Number(row.orderid),
      clientId: row.clientid == null ? null : Number(row.clientid),
      clientName: row.clientname == null ? null : String(row.clientname),
      orderNumber: row.ordernumber == null ? null : String(row.ordernumber),
      orderStatus: String(row.orderstatus),
      orderDate: row.orderdate == null ? null : String(row.orderdate),
      storeId: row.storeid == null ? null : Number(row.storeid),
      customerEmail: row.customeremail == null ? null : String(row.customeremail),
      shipToName: row.shiptoname == null ? null : String(row.shiptoname),
      shipToCity: row.shiptocity == null ? null : String(row.shiptocity),
      shipToState: row.shiptostate == null ? null : String(row.shiptostate),
      shipToPostalCode: row.shiptopostalcode == null ? null : String(row.shiptopostalcode),
      carrierCode: row.carriercode == null ? null : String(row.carriercode),
      serviceCode: row.servicecode == null ? null : String(row.servicecode),
      weightValue: row.weightvalue == null ? null : Number(row.weightvalue),
      orderTotal: row.ordertotal == null ? null : Number(row.ordertotal),
      shippingAmount: row.shippingamount == null ? null : Number(row.shippingamount),
      residential: row.residential == null ? null : Number(row.residential) === 1,
      sourceResidential: row.source_residential == null ? null : Number(row.source_residential) === 1,
      externalShipped: Number(row.external_shipped ?? 0) === 1,
      externallyFulfilledVerified: Number(row.externally_fulfilled_verified ?? 0) === 1,
      bestRateJson: row.best_rate_json == null ? null : (typeof row.best_rate_json === "string" ? row.best_rate_json : JSON.stringify(row.best_rate_json)),
      selectedRateJson: row.selected_rate_json == null ? null : (typeof row.selected_rate_json === "string" ? row.selected_rate_json : JSON.stringify(row.selected_rate_json)),
      labelShipmentId: row.label_shipmentid == null ? null : Number(row.label_shipmentid),
      labelTracking: row.label_tracking == null ? null : String(row.label_tracking),
      labelCarrier: row.label_carrier == null ? null : String(row.label_carrier),
      labelService: row.label_service == null ? null : String(row.label_service),
      labelProvider: row.label_provider == null ? null : Number(row.label_provider),
      labelProviderNickname: row.label_provider_nickname == null ? null : String(row.label_provider_nickname),
      labelCost: row.label_cost == null ? null : Number(row.label_cost),
      labelRawCost: row.label_raw_cost == null ? null : Number(row.label_raw_cost),
      labelShipDate: row.label_shipdate == null ? null : String(row.label_shipdate),
      labelCreatedAt: row.label_created_at == null ? null : Number(row.label_created_at),
      labelUrl: row.label_url == null ? null : String(row.label_url),
      raw: typeof row.raw === "string" ? row.raw : JSON.stringify(row.raw ?? {}),
      items: typeof row.items === "string" ? row.items : JSON.stringify(row.items ?? []),
      rateDimsL: row.rate_dims_l == null ? null : Number(row.rate_dims_l),
      rateDimsW: row.rate_dims_w == null ? null : Number(row.rate_dims_w),
      rateDimsH: row.rate_dims_h == null ? null : Number(row.rate_dims_h),
    };
  }

  private localIso(value: Date): string {
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  }

  private formatPt(value: Date): string {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const hours = value.getHours() % 12 || 12;
    const suffix = value.getHours() >= 12 ? "pm" : "am";
    return `${months[value.getMonth()]} ${value.getDate()}, ${hours}${suffix} PT`;
  }
}
