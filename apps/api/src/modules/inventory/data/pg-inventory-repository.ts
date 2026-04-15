import type {
  AdjustInventoryInput,
  BulkUpdateInventoryDimensionsInput,
  ListInventoryLedgerQuery,
  ListInventoryQuery,
  ParentSkuDetailDto,
  ParentSkuDto,
  ReceiveInventoryInput,
  ReceiveInventoryResultDto,
  SaveParentSkuInput,
  SetInventoryParentInput,
  UpdateInventoryItemInput,
} from "../../../../../../packages/contracts/src/inventory/contracts.ts";
import type { PgClient, PgPool } from "../../../../../../packages/shared/src/postgres/database.ts";
import type { InventoryRepository } from "../application/inventory-repository.ts";
import type { InventoryAlertRecord, InventoryRecord } from "../domain/inventory.ts";

type PgQueryable = PgPool | PgClient;

/**
 * Postgres InventoryRepository.
 *
 * Dialect notes (see pg-order-repository for the original reference):
 *  - SQLite `?` → Postgres `$1, $2, ...`
 *  - SQLite `json_extract(col, '$.foo')` → Postgres `(col::jsonb)->>'foo'`
 *  - SQLite `json_each(col)` → `jsonb_array_elements(col::jsonb) AS j(value)`
 *  - `INTEGER PRIMARY KEY AUTOINCREMENT` → `SERIAL` with `RETURNING id`
 *  - SQLite `active = 1` → Postgres `active = true`
 *  - SQLite `date(col)` on a TEXT ISO date → `substring(col, 1, 10)`
 *  - Rows come back with lowercase column names — mapRow helpers convert to camelCase.
 */
export class PgInventoryRepository implements InventoryRepository {
  private readonly pool: PgPool;

  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async list(query: ListInventoryQuery): Promise<InventoryRecord[]> {
    const where: string[] = ["s.active = true"];
    const params: Array<string | number> = [];
    let idx = 1;
    const next = () => `$${idx++}`;

    if (query.clientId != null) {
      where.push(`s.clientid = ${next()}`);
      params.push(query.clientId);
    }
    if (query.sku) {
      where.push(`s.sku ILIKE ${next()}`);
      params.push(`%${query.sku}%`);
    }

    const sql = `
      SELECT
        s.id, s.clientid, s.sku, s.name, s.minstock, s.active,
        s.weightoz, s.parentskuid, COALESCE(s.baseunitqty, 1) AS baseunitqty,
        COALESCE(s.length, 0) AS packagelength, COALESCE(s.width, 0) AS packagewidth, COALESCE(s.height, 0) AS packageheight,
        COALESCE(s.productlength, 0) AS productlength, COALESCE(s.productwidth, 0) AS productwidth, COALESCE(s.productheight, 0) AS productheight,
        s.packageid, COALESCE(s.units_per_pack, 1) AS unitsperpack, s.cuftoverride,
        c.name AS clientname,
        p.name AS packagename,
        p.length AS packagedimlength, p.width AS packagedimwidth, p.height AS packagedimheight,
        ps.name AS parentname,
        COALESCE((SELECT SUM(qty) FROM inventory_ledger WHERE invskuid = s.id), 0) AS currentstock,
        (SELECT MAX(createdat) FROM inventory_ledger WHERE invskuid = s.id) AS lastmovement,
        (
          SELECT j.value->>'imageUrl'
          FROM orders ord, jsonb_array_elements((ord.items)::jsonb) AS j(value)
          WHERE j.value->>'sku' = s.sku
            AND j.value->>'imageUrl' IS NOT NULL
            AND j.value->>'imageUrl' != ''
          ORDER BY ord.orderdate DESC
          LIMIT 1
        ) AS imageurl
      FROM inventory_skus s
      JOIN clients c ON s.clientid = c.clientid
      LEFT JOIN packages p ON p.packageid = s.packageid
      LEFT JOIN parent_skus ps ON ps.parentskuid = s.parentskuid
      WHERE ${where.join(" AND ")}
      ORDER BY c.name ASC, COALESCE(ps.name, ''), s.sku ASC
    `;

    const { rows } = await this.pool.query<Record<string, unknown>>(sql, params);
    return rows.map((row) => this.mapInventoryRecord(row));
  }

  async receive(input: ReceiveInventoryInput): Promise<ReceiveInventoryResultDto[]> {
    const receivedAt = this.parseTimestamp(input.receivedAt);
    const results: ReceiveInventoryResultDto[] = [];
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const item of input.items) {
        if (!item.sku || !item.qty || item.qty <= 0) continue;
        const invSkuId = await this.ensureInventorySku(client, input.clientId, item.sku, item.name ?? "");
        const { rows: skuRows } = await client.query<{ baseunitqty: number }>(
          "SELECT COALESCE(baseunitqty, 1) AS baseunitqty FROM inventory_skus WHERE id = $1",
          [invSkuId],
        );
        const baseUnitQty = Number(skuRows[0]?.baseunitqty ?? 1);
        const actualQtyToStore = Number(item.qty) * baseUnitQty;
        await client.query(
          `INSERT INTO inventory_ledger (invskuid, type, qty, note, createdby, createdat)
           VALUES ($1, 'receive', $2, $3, 'manual', $4)`,
          [invSkuId, actualQtyToStore, input.note || `Received ${item.qty} units (${actualQtyToStore} base units)`, receivedAt],
        );
        results.push({
          sku: item.sku,
          qty: Number(item.qty),
          baseUnitQty,
          baseUnits: actualQtyToStore,
          invSkuId,
          newStock: await this.getCurrentStockWithClient(client, invSkuId),
        });
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return results;
  }

  async adjust(input: AdjustInventoryInput): Promise<number> {
    const validTypes = new Set(["adjust", "receive", "return", "damage"]);
    const type = validTypes.has(String(input.type ?? "adjust")) ? String(input.type ?? "adjust") : "adjust";
    const note = input.note || (Number(input.qty) > 0 ? `Manual ${type}` : "Manual remove");
    await this.pool.query(
      `INSERT INTO inventory_ledger (invskuid, type, qty, note, createdby, createdat)
       VALUES ($1, $2, $3, $4, 'manual', $5)`,
      [input.invSkuId, type, input.qty, note, this.parseTimestamp(input.adjustedAt)],
    );
    return this.getCurrentStock(input.invSkuId);
  }

  async update(inventoryId: number, input: UpdateInventoryItemInput): Promise<void> {
    await this.pool.query(
      `UPDATE inventory_skus
       SET name = $1, minstock = $2, weightoz = $3,
           length = $4, width = $5, height = $6,
           productlength = $7, productwidth = $8, productheight = $9,
           packageid = $10, units_per_pack = $11, cuftoverride = $12, updatedat = $13
       WHERE id = $14`,
      [
        input.name ?? "",
        input.minStock ?? 0,
        input.weightOz ?? 0,
        input.length ?? 0,
        input.width ?? 0,
        input.height ?? 0,
        input.productLength ?? 0,
        input.productWidth ?? 0,
        input.productHeight ?? 0,
        input.packageId ?? null,
        input.units_per_pack ?? 1,
        input.cuFtOverride ?? null,
        Date.now(),
        inventoryId,
      ],
    );
  }

  async listLedger(query: ListInventoryLedgerQuery): Promise<Record<string, unknown>[]> {
    const where: string[] = [];
    const params: Array<string | number> = [];
    let idx = 1;
    const next = () => `$${idx++}`;

    if (query.clientId != null) {
      where.push(`s.clientid = ${next()}`);
      params.push(query.clientId);
    }
    if (query.type) {
      where.push(`l.type = ${next()}`);
      params.push(query.type);
    }
    if (query.dateStart != null) {
      where.push(`l.createdat >= ${next()}`);
      params.push(query.dateStart);
    }
    if (query.dateEnd != null) {
      where.push(`l.createdat <= ${next()}`);
      params.push(query.dateEnd);
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const limitPlaceholder = next();
    params.push(query.limit);

    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT
         l.id, l.invskuid, l.type, l.qty, l.orderid, l.note, l.createdby, l.createdat,
         s.sku, s.name AS skuname, s.clientid,
         c.name AS clientname
       FROM inventory_ledger l
       JOIN inventory_skus s ON s.id = l.invskuid
       JOIN clients c ON c.clientid = s.clientid
       ${whereClause}
       ORDER BY l.createdat DESC
       LIMIT ${limitPlaceholder}`,
      params,
    );
    return rows.map((row) => this.mapLedgerRow(row));
  }

  async getLedgerByInventoryId(inventoryId: number): Promise<Record<string, unknown>[]> {
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT
         l.id, l.invskuid, l.type, l.qty, l.orderid, l.note, l.createdby, l.createdat,
         s.sku, s.name AS skuname, s.clientid,
         c.name AS clientname
       FROM inventory_ledger l
       JOIN inventory_skus s ON s.id = l.invskuid
       JOIN clients c ON c.clientid = s.clientid
       WHERE l.invskuid = $1
       ORDER BY l.createdat DESC
       LIMIT 500`,
      [inventoryId],
    );
    return rows.map((row) => this.mapLedgerRow(row));
  }

  async listAlerts(clientId: number): Promise<InventoryAlertRecord[]> {
    const alerts: InventoryAlertRecord[] = [];
    const { rows: skuAlerts } = await this.pool.query<{
      id: number;
      sku: string;
      name: string;
      minstock: number;
      parentskuid: number | null;
      currentstock: number;
    }>(
      `SELECT
         s.id, s.sku, s.name, s.minstock, s.parentskuid,
         COALESCE((SELECT SUM(qty) FROM inventory_ledger WHERE invskuid = s.id), 0) AS currentstock
       FROM inventory_skus s
       WHERE ($1 = 0 OR s.clientid = $1) AND s.active = true
         AND COALESCE((SELECT SUM(qty) FROM inventory_ledger WHERE invskuid = s.id), 0) <= s.minstock
       ORDER BY currentstock ASC`,
      [clientId],
    );

    for (const sku of skuAlerts) {
      alerts.push({
        type: "sku",
        id: Number(sku.id),
        sku: sku.sku,
        name: sku.name,
        stock: Number(sku.currentstock ?? 0),
        minStock: Number(sku.minstock ?? 0),
        parentSkuId: sku.parentskuid == null ? null : Number(sku.parentskuid),
      });
    }

    const { rows: parentRows } = await this.pool.query<{
      parentskuid: number;
      name: string;
      minstock: number | null;
    }>(
      `SELECT
         p.parentskuid, p.name,
         (
           SELECT MIN(minstock)
           FROM inventory_skus
           WHERE parentskuid = p.parentskuid AND active = true
         ) AS minstock
       FROM parent_skus p
       WHERE ($1 = 0 OR p.clientid = $1)`,
      [clientId],
    );

    for (const parent of parentRows) {
      const aggregate = await this.getParentAggregateStock(Number(parent.parentskuid));
      const minStock = Number(parent.minstock ?? 0);
      if (aggregate <= minStock) {
        alerts.push({
          type: "parent",
          id: Number(parent.parentskuid),
          name: parent.name,
          stock: aggregate,
          minStock,
          parentSkuId: Number(parent.parentskuid),
        });
      }
    }

    return alerts;
  }

  async populate(): Promise<{ ok: true; skusRegistered: number; shippedProcessed: number }> {
    const { rows: orders } = await this.pool.query<{ raw: string | null }>(
      "SELECT raw FROM orders WHERE raw IS NOT NULL",
    );
    const { rows: clients } = await this.pool.query<{ clientid: number; storeids: string | null }>(
      "SELECT clientid, storeids FROM clients WHERE active = true",
    );

    let skusRegistered = 0;
    let shippedProcessed = 0;

    const pgClient = await this.pool.connect();
    try {
      for (const row of orders) {
        if (!row.raw) continue;
        let order: Record<string, unknown>;
        try {
          order = JSON.parse(row.raw);
        } catch {
          continue;
        }
        const advancedOptions = order.advancedOptions as Record<string, unknown> | undefined;
        const storeId = Number(advancedOptions?.storeId ?? order.storeId ?? 0);
        if (!storeId) continue;

        const client = clients.find((entry) => this.parseStoreIds(entry.storeids).includes(storeId));
        if (!client) continue;

        const items = Array.isArray(order.items) ? (order.items as Array<Record<string, unknown>>) : [];
        for (const item of items.filter((entry) => entry.adjustment !== true && entry.sku)) {
          const sku = String(item.sku);
          const { rows: existing } = await pgClient.query<{ id: number }>(
            "SELECT id FROM inventory_skus WHERE clientid = $1 AND sku = $2",
            [client.clientid, sku],
          );
          await this.ensureInventorySku(pgClient, client.clientid, sku, String(item.name ?? ""));
          if (existing.length === 0) skusRegistered += 1;
        }

        if (order.orderStatus === "shipped") {
          shippedProcessed += 1;
        }
      }
    } finally {
      pgClient.release();
    }

    return { ok: true, skusRegistered, shippedProcessed };
  }

  async importProductDimensions(clientId?: number, overwrite = false): Promise<{ ok: true; updated: number; skipped: number; noMatch: number; total: number }> {
    const where: string[] = ["active = true"];
    const params: number[] = [];
    if (clientId != null) {
      where.push(`clientid = $${params.length + 1}`);
      params.push(clientId);
    }

    const { rows } = await this.pool.query<{
      id: number;
      sku: string;
      weightoz: number;
      productlength: number;
      productwidth: number;
      productheight: number;
    }>(
      `SELECT id, sku, weightoz, productlength, productwidth, productheight
       FROM inventory_skus
       WHERE ${where.join(" AND ")}`,
      params,
    );

    let updated = 0;
    let skipped = 0;
    let noMatch = 0;

    for (const row of rows) {
      const { rows: productRows } = await this.pool.query<{
        weightoz: number | null;
        length: number | null;
        width: number | null;
        height: number | null;
      }>(
        "SELECT weightoz, length, width, height FROM products WHERE sku = $1 LIMIT 1",
        [row.sku],
      );
      const product = productRows[0];

      if (!product || !(Number(product.weightoz ?? 0) > 0 || Number(product.length ?? 0) > 0 || Number(product.width ?? 0) > 0 || Number(product.height ?? 0) > 0)) {
        noMatch += 1;
        continue;
      }

      const hasProductDims = Number(row.productlength ?? 0) > 0 && Number(row.productwidth ?? 0) > 0 && Number(row.productheight ?? 0) > 0;
      const hasWeight = Number(row.weightoz ?? 0) > 0;
      if (!overwrite && hasWeight && hasProductDims) {
        skipped += 1;
        continue;
      }

      await this.pool.query(
        `UPDATE inventory_skus
         SET weightoz = $1, productlength = $2, productwidth = $3, productheight = $4, updatedat = $5
         WHERE id = $6`,
        [
          Number(product.weightoz ?? row.weightoz ?? 0),
          Number(product.length ?? row.productlength ?? 0),
          Number(product.width ?? row.productwidth ?? 0),
          Number(product.height ?? row.productheight ?? 0),
          Date.now(),
          row.id,
        ],
      );
      updated += 1;
    }

    return { ok: true, updated, skipped, noMatch, total: rows.length };
  }

  async bulkUpdateDimensions(input: BulkUpdateInventoryDimensionsInput): Promise<{ ok: true; updated: number }> {
    let updated = 0;
    for (const change of input.updates) {
      await this.pool.query(
        `UPDATE inventory_skus
         SET weightoz = COALESCE($1, weightoz),
             productlength = COALESCE($2, productlength),
             productwidth = COALESCE($3, productwidth),
             productheight = COALESCE($4, productheight),
             updatedat = $5
         WHERE id = $6`,
        [
          this.optionalNumber(change.weightOz),
          this.optionalNumber(change.productLength),
          this.optionalNumber(change.productWidth),
          this.optionalNumber(change.productHeight),
          Date.now(),
          change.invSkuId,
        ],
      );
      updated += 1;
    }
    return { ok: true, updated };
  }

  async listParentSkus(clientId: number): Promise<ParentSkuDto[]> {
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT
         p.parentskuid, p.clientid, p.name, p.sku,
         COALESCE(p.baseunitqty, 1) AS baseunitqty,
         p.createdat, p.updatedat,
         COUNT(DISTINCT s.id) AS childcount,
         COALESCE(SUM(COALESCE((SELECT SUM(qty) FROM inventory_ledger WHERE invskuid = s.id), 0)), 0) AS totalbaseunits
       FROM parent_skus p
       LEFT JOIN inventory_skus s ON s.parentskuid = p.parentskuid AND s.active = true
       WHERE p.clientid = $1
       GROUP BY p.parentskuid, p.clientid, p.name, p.sku, p.baseunitqty, p.createdat, p.updatedat
       ORDER BY p.name ASC`,
      [clientId],
    );
    return rows.map((row) => this.mapParentSku(row));
  }

  async getParentSku(parentSkuId: number): Promise<ParentSkuDetailDto | null> {
    const { rows: parentRows } = await this.pool.query<Record<string, unknown>>(
      `SELECT parentskuid, clientid, name, sku, COALESCE(baseunitqty, 1) AS baseunitqty, createdat, updatedat
       FROM parent_skus
       WHERE parentskuid = $1`,
      [parentSkuId],
    );
    const parentRow = parentRows[0];
    if (!parentRow) return null;
    const parent = this.mapParentSku(parentRow);

    const { rows: childRows } = await this.pool.query<Record<string, unknown>>(
      `SELECT
         s.id, s.sku, s.name, s.minstock, s.active,
         COALESCE(s.baseunitqty, 1) AS baseunitqty,
         COALESCE((SELECT SUM(qty) FROM inventory_ledger WHERE invskuid = s.id), 0) AS baseunits
       FROM inventory_skus s
       WHERE s.parentskuid = $1
       ORDER BY s.sku ASC`,
      [parentSkuId],
    );
    const children = childRows.map((row) => ({
      id: Number(row.id),
      sku: String(row.sku),
      name: String(row.name ?? ""),
      minStock: Number(row.minstock ?? 0),
      active: Boolean(row.active),
      baseUnitQty: Number(row.baseunitqty ?? 1),
      baseUnits: Number(row.baseunits ?? 0),
    }));

    const lowStockChildren = children.filter((child) => Number(child.baseUnits ?? 0) <= Number(child.minStock ?? 0));
    const totalBaseUnits = children.reduce((sum, child) => sum + Number(child.baseUnits ?? 0), 0);

    return {
      ...parent,
      children,
      totalBaseUnits,
      lowStockCount: lowStockChildren.length,
      lowStockChildren,
    };
  }

  async createParentSku(input: SaveParentSkuInput): Promise<{ ok: true; parentSkuId: number; sku?: string; baseUnitQty: number }> {
    const baseUnitQty = Math.max(1, Number.parseInt(String(input.baseUnitQty ?? 1), 10) || 1);
    const now = Date.now();
    const { rows } = await this.pool.query<{ parentskuid: number }>(
      `INSERT INTO parent_skus (name, sku, baseunitqty, clientid, createdat, updatedat)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING parentskuid`,
      [input.name, input.sku ?? null, baseUnitQty, input.clientId, now, now],
    );
    return { ok: true, parentSkuId: Number(rows[0].parentskuid), sku: input.sku ?? "", baseUnitQty };
  }

  async setParent(inventoryId: number, input: SetInventoryParentInput): Promise<{ ok: true }> {
    if (input.parentSkuId === null) {
      await this.pool.query(
        `UPDATE inventory_skus
         SET parentskuid = NULL, baseunitqty = 1, updatedat = $1
         WHERE id = $2`,
        [Date.now(), inventoryId],
      );
      return { ok: true };
    }

    const { rows } = await this.pool.query<{ parentskuid: number }>(
      "SELECT parentskuid FROM parent_skus WHERE parentskuid = $1",
      [input.parentSkuId],
    );
    if (rows.length === 0) {
      throw new Error("Parent SKU not found");
    }

    await this.pool.query(
      `UPDATE inventory_skus
       SET parentskuid = $1, baseunitqty = $2, updatedat = $3
       WHERE id = $4`,
      [
        input.parentSkuId,
        Math.max(1, Number.parseInt(String(input.baseUnitQty ?? 1), 10) || 1),
        Date.now(),
        inventoryId,
      ],
    );
    return { ok: true };
  }

  async deleteParent(parentSkuId: number): Promise<{ ok: true }> {
    const { rows } = await this.pool.query<{ cnt: string }>(
      "SELECT COUNT(*)::text AS cnt FROM inventory_skus WHERE parentskuid = $1",
      [parentSkuId],
    );
    const count = Number(rows[0]?.cnt ?? 0);
    if (count > 0) {
      throw new Error(`Cannot delete parent with ${count} child SKU(s). Unlink children first.`);
    }

    await this.pool.query("DELETE FROM parent_skus WHERE parentskuid = $1", [parentSkuId]);
    return { ok: true };
  }

  async getSkuOrders(inventoryId: number, days = 30): Promise<Record<string, unknown> | null> {
    const { rows: skuRows } = await this.pool.query<{ sku: string; name: string; clientid: number }>(
      "SELECT sku, name, clientid FROM inventory_skus WHERE id = $1",
      [inventoryId],
    );
    const skuRow = skuRows[0];
    if (!skuRow) return null;

    const safeDays = Math.max(1, Math.min(365, Number.isFinite(days) ? days : 30));
    const cutoff = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const { rows: dailySales } = await this.pool.query<{ day: string; units: string | number }>(
      `SELECT
         substring(o.orderdate, 1, 10) AS day,
         SUM(((j.value->>'quantity')::int)) AS units
       FROM orders o, jsonb_array_elements((o.items)::jsonb) AS j(value)
       WHERE j.value->>'sku' = $1
         AND substring(o.orderdate, 1, 10) >= $2
         AND COALESCE(o.orderstatus, '') != 'cancelled'
       GROUP BY substring(o.orderdate, 1, 10)
       ORDER BY day ASC`,
      [skuRow.sku, cutoff],
    );

    const salesMap = new Map<string, number>(dailySales.map((row) => [row.day, Number(row.units ?? 0)]));
    const filledSales: Array<{ day: string; units: number }> = [];
    for (let i = safeDays - 1; i >= 0; i -= 1) {
      const current = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}`;
      filledSales.push({ day: key, units: salesMap.get(key) ?? 0 });
    }

    const { rows: orders } = await this.pool.query<Record<string, unknown>>(
      `SELECT
         o.orderid,
         o.ordernumber,
         o.orderstatus,
         o.orderdate,
         o.shiptoname,
         o.carriercode,
         o.servicecode,
         ((j.value->>'quantity')::int) AS qty,
         ((j.value->>'unitPrice')::real) AS unitprice,
         j.value->>'name' AS itemname
       FROM orders o, jsonb_array_elements((o.items)::jsonb) AS j(value)
       WHERE j.value->>'sku' = $1
         AND COALESCE(o.orderstatus, '') != 'cancelled'
       ORDER BY o.orderdate DESC
       LIMIT 200`,
      [skuRow.sku],
    );

    return {
      sku: skuRow.sku,
      name: skuRow.name,
      clientId: Number(skuRow.clientid),
      totalUnits: filledSales.reduce((sum, row) => sum + row.units, 0),
      dailySales: filledSales,
      orders: orders.map((row) => ({
        orderId: Number(row.orderid),
        orderNumber: row.ordernumber,
        orderStatus: row.orderstatus,
        orderDate: row.orderdate,
        shipToName: row.shiptoname,
        carrierCode: row.carriercode,
        serviceCode: row.servicecode,
        qty: Number(row.qty ?? 0),
        unitPrice: row.unitprice == null ? null : Number(row.unitprice),
        itemName: row.itemname,
      })),
    };
  }

  // ─── private helpers ─────────────────────────────────────────────────
  private async ensureInventorySku(
    client: PgQueryable,
    clientId: number,
    sku: string,
    name: string,
  ): Promise<number> {
    const { rows: existingRows } = await client.query<{ id: number }>(
      "SELECT id FROM inventory_skus WHERE clientid = $1 AND sku = $2",
      [clientId, sku],
    );
    if (existingRows[0]) return Number(existingRows[0].id);

    const { rows: productRows } = await client.query<{
      weightoz: number | null;
      length: number | null;
      width: number | null;
      height: number | null;
      defaultpackagecode: string | null;
    }>(
      "SELECT weightoz, length, width, height, defaultpackagecode FROM products WHERE sku = $1 LIMIT 1",
      [sku],
    );
    const product = productRows[0];

    let packageId: number | null = null;
    if (product?.defaultpackagecode) {
      const { rows: packageRows } = await client.query<{ packageid: number }>(
        "SELECT packageid FROM packages WHERE packagecode = $1",
        [product.defaultpackagecode],
      );
      packageId = packageRows[0] ? Number(packageRows[0].packageid) : null;
    }

    const now = Date.now();
    const { rows: insertedRows } = await client.query<{ id: number }>(
      `INSERT INTO inventory_skus (clientid, sku, name, weightoz, length, width, height, packageid, active, createdat, updatedat)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10)
       RETURNING id`,
      [
        clientId,
        sku,
        name,
        product?.weightoz ?? 0,
        product?.length ?? 0,
        product?.width ?? 0,
        product?.height ?? 0,
        packageId,
        now,
        now,
      ],
    );
    return Number(insertedRows[0].id);
  }

  private async getCurrentStock(inventoryId: number): Promise<number> {
    const { rows } = await this.pool.query<{ stock: number | string }>(
      "SELECT COALESCE(SUM(qty), 0) AS stock FROM inventory_ledger WHERE invskuid = $1",
      [inventoryId],
    );
    return Number(rows[0]?.stock ?? 0);
  }

  private async getCurrentStockWithClient(
    client: PgQueryable,
    inventoryId: number,
  ): Promise<number> {
    const { rows } = await client.query<{ stock: number | string }>(
      "SELECT COALESCE(SUM(qty), 0) AS stock FROM inventory_ledger WHERE invskuid = $1",
      [inventoryId],
    );
    return Number(rows[0]?.stock ?? 0);
  }

  private async getParentAggregateStock(parentSkuId: number): Promise<number> {
    const { rows } = await this.pool.query<{ totalbaseunits: number | string }>(
      `SELECT COALESCE(SUM(COALESCE((SELECT SUM(qty) FROM inventory_ledger WHERE invskuid = s.id), 0)), 0) AS totalbaseunits
       FROM inventory_skus s
       WHERE s.parentskuid = $1 AND s.active = true`,
      [parentSkuId],
    );
    return Number(rows[0]?.totalbaseunits ?? 0);
  }

  private parseTimestamp(value: string | number | undefined): number {
    if (value == null) return Date.now();
    if (typeof value === "number") return Number.isFinite(value) ? value : Date.now();
    const fromDate = new Date(value).getTime();
    return Number.isFinite(fromDate) ? fromDate : Date.now();
  }

  private parseStoreIds(raw: string | null): number[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.map((value) => Number.parseInt(String(value), 10)).filter(Number.isFinite);
    } catch {
      return [];
    }
  }

  private optionalNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private mapInventoryRecord(row: Record<string, unknown>): InventoryRecord {
    return {
      id: Number(row.id),
      clientId: Number(row.clientid),
      sku: String(row.sku),
      name: String(row.name ?? ""),
      minStock: Number(row.minstock ?? 0),
      active: Boolean(row.active),
      weightOz: Number(row.weightoz ?? 0),
      parentSkuId: row.parentskuid == null ? null : Number(row.parentskuid),
      baseUnitQty: Number(row.baseunitqty ?? 1),
      packageLength: Number(row.packagelength ?? 0),
      packageWidth: Number(row.packagewidth ?? 0),
      packageHeight: Number(row.packageheight ?? 0),
      productLength: Number(row.productlength ?? 0),
      productWidth: Number(row.productwidth ?? 0),
      productHeight: Number(row.productheight ?? 0),
      packageId: row.packageid == null ? null : Number(row.packageid),
      unitsPerPack: Number(row.unitsperpack ?? 1),
      cuFtOverride: row.cuftoverride == null ? null : Number(row.cuftoverride),
      clientName: String(row.clientname ?? ""),
      packageName: row.packagename == null ? null : String(row.packagename),
      packageDimLength: row.packagedimlength == null ? null : Number(row.packagedimlength),
      packageDimWidth: row.packagedimwidth == null ? null : Number(row.packagedimwidth),
      packageDimHeight: row.packagedimheight == null ? null : Number(row.packagedimheight),
      parentName: row.parentname == null ? null : String(row.parentname),
      currentStock: Number(row.currentstock ?? 0),
      lastMovement: row.lastmovement == null ? null : Number(row.lastmovement),
      imageUrl: row.imageurl == null ? null : String(row.imageurl),
    };
  }

  private mapLedgerRow(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: Number(row.id),
      invSkuId: Number(row.invskuid),
      type: row.type,
      qty: Number(row.qty ?? 0),
      orderId: row.orderid == null ? null : Number(row.orderid),
      note: row.note,
      createdBy: row.createdby,
      createdAt: Number(row.createdat ?? 0),
      sku: row.sku,
      skuName: row.skuname,
      clientId: Number(row.clientid),
      clientName: row.clientname,
    };
  }

  private mapParentSku(row: Record<string, unknown>): ParentSkuDto {
    return {
      parentSkuId: Number(row.parentskuid),
      clientId: Number(row.clientid),
      name: String(row.name ?? ""),
      sku: row.sku == null ? null : String(row.sku),
      baseUnitQty: Number(row.baseunitqty ?? 1),
      childCount: row.childcount == null ? undefined : Number(row.childcount),
      totalBaseUnits: row.totalbaseunits == null ? undefined : Number(row.totalbaseunits),
      createdAt: row.createdat == null ? null : Number(row.createdat),
      updatedAt: row.updatedat == null ? null : Number(row.updatedat),
    };
  }
}
