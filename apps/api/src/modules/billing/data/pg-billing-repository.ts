import type {
  BackfillBillingReferenceRatesInput,
  BillingDetailsQuery,
  GenerateBillingInput,
  GenerateBillingResult,
  SaveBillingPackagePriceInput,
  BillingSummaryQuery,
  SetDefaultBillingPackagePriceResult,
  UpdateBillingConfigInput,
} from "../../../../../../../packages/contracts/src/billing/contracts.ts";
import type { PgClient, PgPool } from "../../../../../../../packages/shared/src/postgres/database.ts";
import { SS_BASELINE_CARRIER_CODES } from "../../../common/prepship-config.ts";
import type { BillingRepository } from "../application/billing-repository.ts";
import type {
  BillingClientRecord,
  BillingConfigRecord,
  BillingBackfillReferenceRateOrderRecord,
  BillingDetailRecord,
  BillingFetchReferenceRateOrderRecord,
  BillingInvoiceDetailRecord,
  BillingInvoiceRecord,
  BillingLedgerEventRecord,
  BillingPackagePriceRecord,
  BillingReferenceRateRecord,
  BillingShipmentRecord,
  BillingStorageSkuRecord,
  BillingSummaryRecord,
} from "../domain/billing.ts";
import type { RateDto } from "../../../../../../../packages/contracts/src/rates/contracts.ts";

const HOUSE_ACCOUNT_IDS = new Set([3, 4]);

export class PgBillingRepository implements BillingRepository {
  private readonly pool: PgPool;

  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async listBillableClients(): Promise<BillingClientRecord[]> {
    const { rows } = await this.pool.query<{ clientid: number; name: string }>(
      `SELECT clientid, name
       FROM clients
       WHERE active = true
         AND name NOT IN ('Manual Orders', 'Rate Browser', 'Api Shipments')
       ORDER BY name`,
    );
    return rows.map((row) => ({ clientId: Number(row.clientid), name: row.name }));
  }

  async listConfigRecords(): Promise<BillingConfigRecord[]> {
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT
         clientid,
         pickpackfee,
         additionalunitfee,
         packagecostmarkup,
         shippingmarkuppct,
         shippingmarkupflat,
         billing_mode,
         storagefeepercuft,
         storagefeemode,
         palletpricingpermonth,
         palletcuft
       FROM billing_config`,
    );
    return rows.map((row) => ({
      clientId: Number(row.clientid),
      pickPackFee: row.pickpackfee == null ? null : Number(row.pickpackfee),
      additionalUnitFee: row.additionalunitfee == null ? null : Number(row.additionalunitfee),
      packageCostMarkup: row.packagecostmarkup == null ? null : Number(row.packagecostmarkup),
      shippingMarkupPct: row.shippingmarkuppct == null ? null : Number(row.shippingmarkuppct),
      shippingMarkupFlat: row.shippingmarkupflat == null ? null : Number(row.shippingmarkupflat),
      billing_mode: row.billing_mode == null ? null : String(row.billing_mode),
      storageFeePerCuFt: row.storagefeepercuft == null ? null : Number(row.storagefeepercuft),
      storageFeeMode: row.storagefeemode == null ? null : String(row.storagefeemode),
      palletPricingPerMonth: row.palletpricingpermonth == null ? null : Number(row.palletpricingpermonth),
      palletCuFt: row.palletcuft == null ? null : Number(row.palletcuft),
    })) as BillingConfigRecord[];
  }

  async listReferenceRateStoreIds(): Promise<number[]> {
    const { rows } = await this.pool.query<{ storeids: string | null }>(
      `SELECT c.storeids
       FROM billing_config bc
       JOIN clients c ON c.clientid = bc.clientid
       WHERE bc.billing_mode = 'reference_rate'
         AND c.active = true`,
    );
    const storeIds = new Set<number>();
    for (const row of rows) {
      for (const storeId of this.parseJson<number[]>(row.storeids, [])) {
        if (Number.isFinite(Number(storeId))) storeIds.add(Number(storeId));
      }
    }
    return [...storeIds];
  }

  async upsertConfig(clientId: number, input: UpdateBillingConfigInput): Promise<void> {
    const now = Date.now();
    await this.pool.query(
      `INSERT INTO billing_config (
         clientid, pickpackfee, additionalunitfee, shippingmarkuppct, shippingmarkupflat,
         billing_mode, storagefeepercuft, storagefeemode, palletpricingpermonth, palletcuft,
         active, createdat, updatedat
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11, $12)
       ON CONFLICT (clientid) DO UPDATE SET
         pickpackfee = EXCLUDED.pickpackfee,
         additionalunitfee = EXCLUDED.additionalunitfee,
         shippingmarkuppct = EXCLUDED.shippingmarkuppct,
         shippingmarkupflat = EXCLUDED.shippingmarkupflat,
         billing_mode = EXCLUDED.billing_mode,
         storagefeepercuft = EXCLUDED.storagefeepercuft,
         storagefeemode = EXCLUDED.storagefeemode,
         palletpricingpermonth = EXCLUDED.palletpricingpermonth,
         palletcuft = EXCLUDED.palletcuft,
         updatedat = EXCLUDED.updatedat`,
      [
        clientId,
        input.pickPackFee ?? 3,
        input.additionalUnitFee ?? 0.75,
        input.shippingMarkupPct ?? 0,
        input.shippingMarkupFlat ?? 0,
        input.billing_mode || "label_cost",
        input.storageFeePerCuFt ?? 0,
        input.storageFeeMode || "cubicft",
        input.palletPricingPerMonth ?? 0,
        input.palletCuFt ?? 80,
        now,
        now,
      ],
    );
  }

  async generate(input: Required<Pick<GenerateBillingInput, "from" | "to">> & Pick<GenerateBillingInput, "clientId">): Promise<GenerateBillingResult> {
    const client = await this.pool.connect();
    let generated = 0;
    let total = 0;

    try {
      await client.query("BEGIN");

      const [storeToClient, allConfigsArr, refRatesArr, dimsToPackageId, skuPackageMap, clientPackagePrices, packagesById, shipments] = await Promise.all([
        this.getStoreToClientMap(client),
        this.listConfigRecordsWithClient(client),
        this.listReferenceRates(client, input.from, input.to),
        this.getDimsToPackageIdMap(client),
        this.getSkuPackageMap(client),
        this.getClientPackagePriceMap(client),
        this.getPackageNameMap(client),
        this.listBillingShipments(client, input.from, input.to),
      ]);
      const allConfigs = new Map(allConfigsArr.map((record) => [record.clientId, record]));
      const refRatesMap = new Map(refRatesArr.map((record) => [record.orderId, record]));

      const insertLine = async (
        clientId: number,
        orderId: number,
        orderNumber: string,
        shipDate: string | null,
        lineType: string,
        description: string,
        qty: number,
        unitCost: number,
        totalCost: number,
        createdAt: number,
      ): Promise<number> => {
        const res = await client.query(
          `INSERT INTO billing_line_items
             (clientid, orderid, ordernumber, shipdate, linetype, description, qty, unitcost, totalcost, invoiced, createdat)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10)
           ON CONFLICT (orderid, linetype, description) DO UPDATE SET
             unitcost = EXCLUDED.unitcost,
             totalcost = EXCLUDED.totalcost,
             clientid = EXCLUDED.clientid`,
          [clientId, orderId, orderNumber, shipDate, lineType, description, qty, unitCost, totalCost, createdAt],
        );
        return res.rowCount ?? 0;
      };

      for (const shipment of shipments) {
        const raw = this.parseJson<Record<string, unknown>>(shipment.raw, {});
        const advancedOptions = this.asRecord(raw.advancedOptions);
        const storeId = Number(advancedOptions.storeId ?? raw.storeId ?? 0) || null;
        const clientId = storeId != null ? (storeToClient.get(storeId) ?? null) : null;
        if (!clientId) continue;
        if (input.clientId && clientId !== input.clientId) continue;

        const config = allConfigs.get(clientId) ?? {
          clientId,
          pickPackFee: 3,
          additionalUnitFee: 0.75,
          packageCostMarkup: 0,
          shippingMarkupPct: 0,
          shippingMarkupFlat: 0,
          billing_mode: "label_cost",
          storageFeePerCuFt: 0,
          storageFeeMode: "cubicft",
          palletPricingPerMonth: 0,
          palletCuFt: 80,
        };
        const items = this.parseJson<Array<Record<string, unknown>>>(shipment.items, []).filter((item) => item.adjustment !== true);
        const totalUnits = items.reduce((sum, item) => sum + Number(item.quantity ?? 1), 0);
        const now = Date.now();
        const billDate = shipment.billingDate;
        const isExternal = !shipment.shipDate;

        {
          const changes = await insertLine(clientId, shipment.orderId, shipment.orderNumber, billDate, "pickpack", "Pick & Pack", 1, config.pickPackFee ?? 3, config.pickPackFee ?? 3, now);
          if (changes > 0) {
            generated += 1;
            total += config.pickPackFee ?? 3;
          }
        }

        if (totalUnits > 1) {
          const extraUnits = totalUnits - 1;
          const extraUnitFee = config.additionalUnitFee ?? 0.75;
          const extraCost = extraUnits * extraUnitFee;
          const changes = await insertLine(clientId, shipment.orderId, shipment.orderNumber, billDate, "additional", `Additional units (×${extraUnits})`, extraUnits, extraUnitFee, extraCost, now);
          if (changes > 0) {
            generated += 1;
            total += extraCost;
          }
        }

        if (isExternal) {
          await insertLine(clientId, shipment.orderId, shipment.orderNumber, billDate, "shipping", "Externally Shipped", 1, 0, 0, now);
        } else {
          const labelCost = Number(shipment.shipmentCost ?? 0) + Number(shipment.otherCost ?? 0);
          let billedCost = labelCost;
          if ((config.billing_mode ?? "label_cost") === "reference_rate" && !SS_BASELINE_CARRIER_CODES.has(shipment.carrierCode ?? "")) {
            const ref = refRatesMap.get(shipment.orderId);
            const candidates = [ref?.ref_usps_rate, ref?.ref_ups_rate].filter((value) => value != null && value > 0) as number[];
            if (candidates.length > 0) {
              const bestReference = Math.min(...candidates);
              billedCost = labelCost < bestReference ? bestReference : labelCost;
            }
          }

          const markup = billedCost * (Number(config.shippingMarkupPct ?? 0) / 100) + Number(config.shippingMarkupFlat ?? 0);
          const shippingTotal = billedCost + markup;
          const changes = await insertLine(clientId, shipment.orderId, shipment.orderNumber, billDate, "shipping", "Shipping label", 1, shippingTotal, shippingTotal, now);
          if (changes > 0) {
            generated += 1;
            total += shippingTotal;
          }
        }

        let packageId: number | null = null;
        for (const item of items) {
          const sku = typeof item.sku === "string" ? item.sku : null;
          if (sku && skuPackageMap.has(sku)) {
            packageId = skuPackageMap.get(sku) ?? null;
            break;
          }
        }
        if (!packageId && shipment.dims_l != null && shipment.dims_w != null && shipment.dims_h != null) {
          packageId = dimsToPackageId.get(this.makeDimsKey(shipment.dims_l, shipment.dims_w, shipment.dims_h)) ?? null;
        }
        if (!packageId) {
          const ref = refRatesMap.get(shipment.orderId);
          if (ref?.rate_dims_l != null && ref.rate_dims_w != null && ref.rate_dims_h != null) {
            packageId = dimsToPackageId.get(this.makeDimsKey(ref.rate_dims_l, ref.rate_dims_w, ref.rate_dims_h)) ?? null;
          }
        }

        if (packageId) {
          const packagePrice = clientPackagePrices.get(clientId)?.get(packageId);
          if (packagePrice != null) {
            const packageName = packagesById.get(packageId) ?? `Box #${packageId}`;
            const changes = await insertLine(clientId, shipment.orderId, shipment.orderNumber, billDate, "package", `Box (${packageName})`, 1, packagePrice, packagePrice, now);
            if (changes > 0) {
              generated += 1;
              if (packagePrice > 0) total += packagePrice;
            }
          }
        }
      }

      const fromMs = Date.parse(`${input.from}T00:00:00`);
      const toMs = Date.parse(`${input.to}T23:59:59`);
      if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
        throw new Error("Invalid from/to dates for storage");
      }

      for (const config of allConfigs.values()) {
        const rate = Number(config.storageFeePerCuFt ?? 0);
        if (rate <= 0) continue;
        if (input.clientId && config.clientId !== input.clientId) continue;

        let totalCuFtMs = 0;
        const skus = await this.listStorageSkus(client, config.clientId);
        for (const sku of skus) {
          const cuFt = Number(sku.cuFtOverride ?? 0) > 0
            ? Number(sku.cuFtOverride)
            : (Number(sku.productLength ?? 0) * Number(sku.productWidth ?? 0) * Number(sku.productHeight ?? 0)) / 1728;
          if (cuFt <= 0) continue;

          let currentStock = (await this.getStockBefore(client, sku.id, fromMs)).total;
          let prevTime = fromMs;
          for (const event of await this.listLedgerEvents(client, sku.id, fromMs, toMs)) {
            const sliceMs = Math.max(0, event.createdAt - prevTime);
            if (currentStock > 0) totalCuFtMs += currentStock * cuFt * sliceMs;
            currentStock += event.qty;
            prevTime = event.createdAt;
          }

          const remainingMs = Math.max(0, toMs - prevTime);
          if (currentStock > 0) totalCuFtMs += currentStock * cuFt * remainingMs;
        }

        const totalCuFtDays = totalCuFtMs / (24 * 60 * 60 * 1000);
        const storageCharge = Number((totalCuFtDays * (rate / 30)).toFixed(4));
        if (storageCharge <= 0) continue;

        const res = await client.query(
          `INSERT INTO billing_line_items
             (clientid, orderid, ordernumber, shipdate, linetype, description, qty, unitcost, totalcost, invoiced, createdat)
           VALUES ($1, 0, $2, $3, 'storage', $4, 1, $5, $6, 0, $7)
           ON CONFLICT (orderid, linetype, description) DO UPDATE SET
             unitcost = EXCLUDED.unitcost,
             totalcost = EXCLUDED.totalcost,
             clientid = EXCLUDED.clientid`,
          [
            config.clientId,
            `STORAGE-${input.from}-${input.to}`,
            input.to,
            `Storage ${input.from} to ${input.to}`,
            storageCharge,
            storageCharge,
            Date.now(),
          ],
        );
        if ((res.rowCount ?? 0) > 0) {
          generated += 1;
          total += storageCharge;
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return { ok: true, generated, total: Number(total.toFixed(2)) };
  }

  async listSummary(query: BillingSummaryQuery): Promise<BillingSummaryRecord[]> {
    let sql = `
      SELECT c.clientid,
             c.name AS clientname,
             COALESCE(SUM(CASE WHEN b.linetype = 'pickpack'   THEN b.totalcost ELSE 0 END), 0) AS pickpacktotal,
             COALESCE(SUM(CASE WHEN b.linetype = 'additional' THEN b.totalcost ELSE 0 END), 0) AS additionaltotal,
             COALESCE(SUM(CASE WHEN b.linetype = 'package'    THEN b.totalcost ELSE 0 END), 0) AS packagetotal,
             COALESCE(SUM(CASE WHEN b.linetype = 'shipping'   THEN b.totalcost ELSE 0 END), 0) AS shippingtotal,
             COALESCE(SUM(CASE WHEN b.linetype = 'storage'    THEN b.totalcost ELSE 0 END), 0) AS storagetotal,
             COUNT(DISTINCT CASE WHEN b.linetype = 'pickpack' THEN b.orderid END)              AS ordercount,
             COALESCE(SUM(b.totalcost), 0)                                                     AS grandtotal
      FROM clients c
      LEFT JOIN billing_line_items b
        ON b.clientid = c.clientid
        AND b.shipdate >= $1 AND b.shipdate <= $2
      WHERE c.active = true
        AND c.name NOT IN ('Manual Orders', 'Rate Browser', 'Api Shipments')
    `;
    const params: Array<string | number> = [query.from ?? "", query.to ?? ""];
    if (query.clientId) {
      sql += ` AND c.clientid = $${params.length + 1}`;
      params.push(query.clientId);
    }
    sql += " GROUP BY c.clientid, c.name ORDER BY c.name";

    const { rows } = await this.pool.query<Record<string, unknown>>(sql, params);
    return rows.map((row) => ({
      clientId: Number(row.clientid),
      clientName: String(row.clientname ?? ""),
      pickPackTotal: Number(row.pickpacktotal ?? 0),
      additionalTotal: Number(row.additionaltotal ?? 0),
      packageTotal: Number(row.packagetotal ?? 0),
      shippingTotal: Number(row.shippingtotal ?? 0),
      storageTotal: Number(row.storagetotal ?? 0),
      orderCount: Number(row.ordercount ?? 0),
      grandTotal: Number(row.grandtotal ?? 0),
    })) as BillingSummaryRecord[];
  }

  async listDetails(query: Required<BillingDetailsQuery>): Promise<BillingDetailRecord[]> {
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT
         b.orderid,
         b.ordernumber,
         b.shipdate,
         SUM(CASE WHEN b.linetype = 'pickpack'   THEN b.qty       ELSE 0 END) +
         SUM(CASE WHEN b.linetype = 'additional' THEN b.qty       ELSE 0 END) AS totalqty,
         SUM(CASE WHEN b.linetype = 'pickpack'   THEN b.totalcost ELSE 0 END) AS pickpacktotal,
         SUM(CASE WHEN b.linetype = 'additional' THEN b.totalcost ELSE 0 END) AS additionaltotal,
         SUM(CASE WHEN b.linetype = 'package'    THEN b.totalcost ELSE 0 END) AS packagetotal,
         SUM(CASE WHEN b.linetype = 'shipping'   THEN b.totalcost ELSE 0 END) AS shippingtotal,
         (SELECT ROUND((s2.shipmentcost + COALESCE(s2.othercost, 0))::numeric, 2)
          FROM shipments s2 WHERE s2.orderid = b.orderid AND s2.voided = false LIMIT 1) AS actuallabelcost,
         (SELECT s2.weight_oz FROM shipments s2 WHERE s2.orderid = b.orderid AND s2.voided = false LIMIT 1) AS label_weight_oz,
         (SELECT s2.dims_l    FROM shipments s2 WHERE s2.orderid = b.orderid AND s2.voided = false LIMIT 1) AS label_dims_l,
         (SELECT s2.dims_w    FROM shipments s2 WHERE s2.orderid = b.orderid AND s2.voided = false LIMIT 1) AS label_dims_w,
         (SELECT s2.dims_h    FROM shipments s2 WHERE s2.orderid = b.orderid AND s2.voided = false LIMIT 1) AS label_dims_h,
         ol.ref_usps_rate,
         ol.ref_ups_rate,
         (SELECT string_agg(j.value->>'name', ' | ')
          FROM orders o2, jsonb_array_elements((o2.items)::jsonb) AS j(value)
          WHERE o2.orderid = b.orderid
            AND COALESCE((j.value->>'adjustment')::boolean, false) = false) AS itemnames,
         (SELECT string_agg(COALESCE(j.value->>'sku', ''), ' | ')
          FROM orders o2, jsonb_array_elements((o2.items)::jsonb) AS j(value)
          WHERE o2.orderid = b.orderid
            AND COALESCE((j.value->>'adjustment')::boolean, false) = false) AS itemskus
       FROM billing_line_items b
       LEFT JOIN order_local ol ON ol.orderid = b.orderid
       WHERE b.clientid = $1 AND b.shipdate >= $2 AND b.shipdate <= $3
       GROUP BY b.orderid, b.ordernumber, b.shipdate, ol.ref_usps_rate, ol.ref_ups_rate
       ORDER BY b.shipdate, b.orderid`,
      [query.clientId, query.from, query.to],
    );
    return rows.map((row) => ({
      orderId: Number(row.orderid),
      orderNumber: String(row.ordernumber ?? ""),
      shipDate: row.shipdate == null ? null : String(row.shipdate),
      totalQty: Number(row.totalqty ?? 0),
      pickpackTotal: Number(row.pickpacktotal ?? 0),
      additionalTotal: Number(row.additionaltotal ?? 0),
      packageTotal: Number(row.packagetotal ?? 0),
      shippingTotal: Number(row.shippingtotal ?? 0),
      actualLabelCost: row.actuallabelcost == null ? null : Number(row.actuallabelcost),
      label_weight_oz: row.label_weight_oz == null ? null : Number(row.label_weight_oz),
      label_dims_l: row.label_dims_l == null ? null : Number(row.label_dims_l),
      label_dims_w: row.label_dims_w == null ? null : Number(row.label_dims_w),
      label_dims_h: row.label_dims_h == null ? null : Number(row.label_dims_h),
      ref_usps_rate: row.ref_usps_rate == null ? null : Number(row.ref_usps_rate),
      ref_ups_rate: row.ref_ups_rate == null ? null : Number(row.ref_ups_rate),
      packageName: null,
      itemNames: row.itemnames == null ? null : String(row.itemnames),
      itemSkus: row.itemskus == null ? null : String(row.itemskus),
    })) as BillingDetailRecord[];
  }

  async getInvoice(clientId: number, from: string, to: string): Promise<BillingInvoiceRecord | null> {
    const { rows: clientRows } = await this.pool.query<{ clientid: number; name: string }>(
      `SELECT clientid, name FROM clients WHERE clientid = $1 LIMIT 1`,
      [clientId],
    );
    const client = clientRows[0];
    if (!client) return null;

    const { rows: summaryRows } = await this.pool.query<Record<string, unknown>>(
      `SELECT
         COALESCE(SUM(CASE WHEN linetype = 'pickpack' THEN totalcost ELSE 0 END), 0) AS pickpacktotal,
         COALESCE(SUM(CASE WHEN linetype = 'additional' THEN totalcost ELSE 0 END), 0) AS additionaltotal,
         COALESCE(SUM(CASE WHEN linetype = 'package' THEN totalcost ELSE 0 END), 0) AS packagetotal,
         COALESCE(SUM(CASE WHEN linetype = 'shipping' THEN totalcost ELSE 0 END), 0) AS shippingtotal,
         COALESCE(SUM(CASE WHEN linetype = 'storage' THEN totalcost ELSE 0 END), 0) AS storagetotal,
         COUNT(DISTINCT CASE WHEN linetype = 'pickpack' THEN orderid END) AS ordercount,
         COALESCE(SUM(totalcost), 0) AS grandtotal
       FROM billing_line_items
       WHERE clientid = $1 AND shipdate >= $2 AND shipdate <= $3`,
      [clientId, from, to],
    );
    const summary = summaryRows[0];

    const { rows: detailsRows } = await this.pool.query<Record<string, unknown>>(
      `SELECT
         b.orderid,
         b.ordernumber,
         b.shipdate,
         SUM(CASE WHEN b.linetype = 'pickpack' THEN b.qty ELSE 0 END) AS baseqty,
         SUM(CASE WHEN b.linetype = 'additional' THEN b.qty ELSE 0 END) AS addlqty,
         SUM(CASE WHEN b.linetype = 'pickpack' THEN b.totalcost ELSE 0 END) AS pickpackamt,
         SUM(CASE WHEN b.linetype = 'additional' THEN b.totalcost ELSE 0 END) AS additionalamt,
         SUM(CASE WHEN b.linetype = 'shipping' THEN b.totalcost ELSE 0 END) AS shippingamt,
         SUM(CASE WHEN b.linetype = 'storage' THEN b.totalcost ELSE 0 END) AS storageamt,
         SUM(b.totalcost) AS rowtotal,
         (
           SELECT string_agg(j.value->>'sku', ', ')
           FROM orders o2, jsonb_array_elements((o2.items)::jsonb) AS j(value)
           WHERE o2.orderid = b.orderid
             AND COALESCE((j.value->>'adjustment')::boolean, false) = false
         ) AS skus
       FROM billing_line_items b
       WHERE b.clientid = $1 AND b.shipdate >= $2 AND b.shipdate <= $3
       GROUP BY b.orderid, b.ordernumber, b.shipdate
       ORDER BY b.shipdate, b.orderid`,
      [clientId, from, to],
    );

    return {
      clientId,
      clientName: client.name,
      from,
      to,
      summary: {
        pickPackTotal: Number(summary?.pickpacktotal ?? 0),
        additionalTotal: Number(summary?.additionaltotal ?? 0),
        packageTotal: Number(summary?.packagetotal ?? 0),
        shippingTotal: Number(summary?.shippingtotal ?? 0),
        storageTotal: Number(summary?.storagetotal ?? 0),
        orderCount: Number(summary?.ordercount ?? 0),
        grandTotal: Number(summary?.grandtotal ?? 0),
      },
      details: detailsRows.map((row) => ({
        orderId: Number(row.orderid),
        orderNumber: String(row.ordernumber ?? ""),
        shipDate: row.shipdate == null ? null : String(row.shipdate),
        baseQty: Number(row.baseqty ?? 0),
        addlQty: Number(row.addlqty ?? 0),
        pickpackAmt: Number(row.pickpackamt ?? 0),
        additionalAmt: Number(row.additionalamt ?? 0),
        shippingAmt: Number(row.shippingamt ?? 0),
        storageAmt: Number(row.storageamt ?? 0),
        rowTotal: Number(row.rowtotal ?? 0),
        skus: row.skus == null ? null : String(row.skus),
      })) as BillingInvoiceDetailRecord[],
    };
  }

  async listPackagePrices(clientId: number): Promise<BillingPackagePriceRecord[]> {
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT cpp.packageid, cpp.price, cpp.is_custom, p.name, p.length, p.width, p.height
       FROM client_package_prices cpp
       JOIN packages p ON p.packageid = cpp.packageid
       WHERE cpp.clientid = $1
       ORDER BY p.name`,
      [clientId],
    );
    return rows.map((row) => ({
      packageId: Number(row.packageid),
      price: Number(row.price ?? 0),
      is_custom: Number(row.is_custom ?? 0),
      name: String(row.name ?? ""),
      length: row.length == null ? null : Number(row.length),
      width: row.width == null ? null : Number(row.width),
      height: row.height == null ? null : Number(row.height),
    })) as BillingPackagePriceRecord[];
  }

  async savePackagePrices(input: { clientId: number; prices: SaveBillingPackagePriceInput[] | undefined }): Promise<void> {
    const now = Date.now();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const price of input.prices ?? []) {
        await client.query(
          `INSERT INTO client_package_prices (clientid, packageid, price, is_custom, updatedat)
           VALUES ($1, $2, $3, 1, $4)
           ON CONFLICT (clientid, packageid) DO UPDATE SET price = EXCLUDED.price, is_custom = 1, updatedat = EXCLUDED.updatedat`,
          [input.clientId, price.packageId, Number(price.price) || 0, now],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async setDefaultPackagePrice(packageId: number, price: number): Promise<SetDefaultBillingPackagePriceResult> {
    const { rows: clientRows } = await this.pool.query<{ clientid: number }>(
      `SELECT clientid FROM clients`,
    );
    const clientIds = clientRows
      .map((row) => Number(row.clientid))
      .filter((clientId) => !HOUSE_ACCOUNT_IDS.has(clientId));

    if (clientIds.length === 0) {
      return { ok: true, updated: 0, skipped: 0 };
    }

    const now = Date.now();
    const client = await this.pool.connect();
    let updated = 0;
    try {
      await client.query("BEGIN");
      for (const clientId of clientIds) {
        const res = await client.query(
          `INSERT INTO client_package_prices (clientid, packageid, price, is_custom, updatedat)
           VALUES ($1, $2, $3, 0, $4)
           ON CONFLICT (clientid, packageid) DO UPDATE
             SET price = EXCLUDED.price, updatedat = EXCLUDED.updatedat
             WHERE client_package_prices.is_custom = 0`,
          [clientId, packageId, Number(price) || 0, now],
        );
        if ((res.rowCount ?? 0) > 0) updated += 1;
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return { ok: true, updated, skipped: clientIds.length - updated };
  }

  async listOrdersMissingReferenceRatesForFetch(storeIds: number[]): Promise<BillingFetchReferenceRateOrderRecord[]> {
    if (storeIds.length === 0) return [];

    const placeholders = storeIds.map((_, idx) => `$${idx + 1}`).join(",");
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT
         s.orderid,
         s.weight_oz AS weightoz,
         s.dims_l,
         s.dims_w,
         s.dims_h,
         substring(COALESCE((o.raw::jsonb#>>'{shipTo,postalCode}'), o.shiptopostalcode), 1, 5) AS zip5
       FROM shipments s
       JOIN orders o ON o.orderid = s.orderid
       LEFT JOIN order_local ol ON ol.orderid = s.orderid
       WHERE COALESCE(
               ((o.raw::jsonb#>>'{advancedOptions,storeId}'))::bigint,
               ((o.raw::jsonb->>'storeId'))::bigint,
               o.storeid
             ) IN (${placeholders})
         AND s.voided = false
         AND s.weight_oz IS NOT NULL
         AND s.dims_l IS NOT NULL
         AND s.dims_w IS NOT NULL
         AND s.dims_h IS NOT NULL
         AND (ol.ref_usps_rate IS NULL OR ol.ref_ups_rate IS NULL)`,
      storeIds,
    );
    return rows.map((row) => ({
      orderId: Number(row.orderid),
      weightOz: row.weightoz == null ? null : Number(row.weightoz),
      dims_l: row.dims_l == null ? null : Number(row.dims_l),
      dims_w: row.dims_w == null ? null : Number(row.dims_w),
      dims_h: row.dims_h == null ? null : Number(row.dims_h),
      zip5: row.zip5 == null ? null : String(row.zip5),
    })) as BillingFetchReferenceRateOrderRecord[];
  }

  async listOrdersMissingReferenceRatesForBackfill(input: BackfillBillingReferenceRatesInput): Promise<BillingBackfillReferenceRateOrderRecord[]> {
    const conditions = [
      "s.voided = false",
      "bc.billing_mode = 'reference_rate'",
      "(ol.ref_usps_rate IS NULL AND ol.ref_ups_rate IS NULL)",
    ];
    const params: Array<string> = [];
    if (input.from) {
      conditions.push(`s.shipdate >= $${params.length + 1}`);
      params.push(input.from);
    }
    if (input.to) {
      conditions.push(`s.shipdate <= $${params.length + 1}`);
      params.push(input.to);
    }

    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT
         o.orderid,
         o.ordernumber,
         COALESCE(o.weightvalue, s.weight_oz, 1)::int AS weightoz,
         substring(COALESCE(o.shiptopostalcode, (o.raw::jsonb#>>'{shipTo,postalCode}')), 1, 5) AS zip5
       FROM orders o
       JOIN shipments s ON s.orderid = o.orderid
       JOIN clients c ON EXISTS (
         SELECT 1 FROM jsonb_array_elements_text((c.storeids)::jsonb) AS si(value)
         WHERE (si.value)::bigint = COALESCE(
                 o.storeid,
                 ((o.raw::jsonb#>>'{advancedOptions,storeId}'))::bigint,
                 ((o.raw::jsonb->>'storeId'))::bigint
               )
       )
       JOIN billing_config bc ON bc.clientid = c.clientid
       LEFT JOIN order_local ol ON ol.orderid = o.orderid
       WHERE ${conditions.join("\n         AND ")}`,
      params,
    );
    return rows.map((row) => ({
      orderId: Number(row.orderid),
      orderNumber: String(row.ordernumber ?? ""),
      weightOz: row.weightoz == null ? null : Number(row.weightoz),
      zip5: row.zip5 == null ? null : String(row.zip5),
    })) as BillingBackfillReferenceRateOrderRecord[];
  }

  async findCachedReferenceRateCandidates(weightOz: number, zip5: string): Promise<RateDto[] | null> {
    const { rows } = await this.pool.query<{ rates: string }>(
      `SELECT rates FROM rate_cache WHERE cache_key LIKE $1 LIMIT 1`,
      [`%|${weightOz}|${zip5}|%`],
    );
    if (!rows[0]?.rates) return null;
    try {
      return JSON.parse(rows[0].rates) as RateDto[];
    } catch {
      return null;
    }
  }

  async saveBackfilledReferenceRates(orderId: number, refUspsRate: number | null, refUpsRate: number | null): Promise<void> {
    await this.pool.query(
      `INSERT INTO order_local (orderid, ref_usps_rate, ref_ups_rate, updatedat)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (orderid) DO UPDATE SET
         ref_usps_rate = CASE WHEN EXCLUDED.ref_usps_rate IS NOT NULL THEN EXCLUDED.ref_usps_rate ELSE order_local.ref_usps_rate END,
         ref_ups_rate = CASE WHEN EXCLUDED.ref_ups_rate IS NOT NULL THEN EXCLUDED.ref_ups_rate ELSE order_local.ref_ups_rate END,
         updatedat = EXCLUDED.updatedat`,
      [orderId, refUspsRate, refUpsRate, Date.now()],
    );
  }

  // ─── Private helpers ─────────────────────────────────────────────────
  private async getStoreToClientMap(client: PgClient): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    const { rows } = await client.query<{ clientid: number; storeids: string | null }>(
      `SELECT clientid, storeids FROM clients WHERE active = true`,
    );
    for (const row of rows) {
      for (const storeId of this.parseJson<number[]>(row.storeids, [])) {
        map.set(Number(storeId), Number(row.clientid));
      }
    }
    return map;
  }

  private async listConfigRecordsWithClient(client: PgClient): Promise<BillingConfigRecord[]> {
    const { rows } = await client.query<Record<string, unknown>>(
      `SELECT
         clientid,
         pickpackfee,
         additionalunitfee,
         packagecostmarkup,
         shippingmarkuppct,
         shippingmarkupflat,
         billing_mode,
         storagefeepercuft,
         storagefeemode,
         palletpricingpermonth,
         palletcuft
       FROM billing_config`,
    );
    return rows.map((row) => ({
      clientId: Number(row.clientid),
      pickPackFee: row.pickpackfee == null ? null : Number(row.pickpackfee),
      additionalUnitFee: row.additionalunitfee == null ? null : Number(row.additionalunitfee),
      packageCostMarkup: row.packagecostmarkup == null ? null : Number(row.packagecostmarkup),
      shippingMarkupPct: row.shippingmarkuppct == null ? null : Number(row.shippingmarkuppct),
      shippingMarkupFlat: row.shippingmarkupflat == null ? null : Number(row.shippingmarkupflat),
      billing_mode: row.billing_mode == null ? null : String(row.billing_mode),
      storageFeePerCuFt: row.storagefeepercuft == null ? null : Number(row.storagefeepercuft),
      storageFeeMode: row.storagefeemode == null ? null : String(row.storagefeemode),
      palletPricingPerMonth: row.palletpricingpermonth == null ? null : Number(row.palletpricingpermonth),
      palletCuFt: row.palletcuft == null ? null : Number(row.palletcuft),
    })) as BillingConfigRecord[];
  }

  private async listReferenceRates(client: PgClient, from: string, to: string): Promise<BillingReferenceRateRecord[]> {
    const { rows } = await client.query<Record<string, unknown>>(
      `SELECT ol.orderid, ol.ref_usps_rate, ol.ref_ups_rate, ol.rate_dims_l, ol.rate_dims_w, ol.rate_dims_h
       FROM order_local ol
       JOIN shipments s ON s.orderid = ol.orderid
       WHERE s.voided = false AND s.shipdate >= $1 AND s.shipdate <= $2`,
      [from, to],
    );
    return rows.map((row) => ({
      orderId: Number(row.orderid),
      ref_usps_rate: row.ref_usps_rate == null ? null : Number(row.ref_usps_rate),
      ref_ups_rate: row.ref_ups_rate == null ? null : Number(row.ref_ups_rate),
      rate_dims_l: row.rate_dims_l == null ? null : Number(row.rate_dims_l),
      rate_dims_w: row.rate_dims_w == null ? null : Number(row.rate_dims_w),
      rate_dims_h: row.rate_dims_h == null ? null : Number(row.rate_dims_h),
    })) as BillingReferenceRateRecord[];
  }

  private async getDimsToPackageIdMap(client: PgClient): Promise<Map<string, number>> {
    const { rows } = await client.query<{ packageid: number; length: number | null; width: number | null; height: number | null }>(
      `SELECT packageid, length, width, height FROM packages WHERE source = 'custom'`,
    );
    return new Map(rows.map((row) => [this.makeDimsKey(row.length, row.width, row.height), Number(row.packageid)]));
  }

  private async getSkuPackageMap(client: PgClient): Promise<Map<string, number>> {
    const { rows } = await client.query<{ sku: string | null; packageid: number | null }>(
      `SELECT sku, packageid FROM inventory_skus WHERE packageid IS NOT NULL AND sku IS NOT NULL`,
    );
    return new Map(rows.filter((row) => row.sku && row.packageid != null).map((row) => [row.sku as string, Number(row.packageid)]));
  }

  private async getClientPackagePriceMap(client: PgClient): Promise<Map<number, Map<number, number>>> {
    const result = new Map<number, Map<number, number>>();
    const { rows } = await client.query<{ clientid: number; packageid: number; price: number }>(
      `SELECT clientid, packageid, price FROM client_package_prices`,
    );
    for (const row of rows) {
      const cid = Number(row.clientid);
      if (!result.has(cid)) result.set(cid, new Map());
      result.get(cid)?.set(Number(row.packageid), Number(row.price));
    }
    return result;
  }

  private async getPackageNameMap(client: PgClient): Promise<Map<number, string>> {
    const { rows } = await client.query<{ packageid: number; name: string }>(
      `SELECT packageid, name FROM packages`,
    );
    return new Map(rows.map((row) => [Number(row.packageid), row.name]));
  }

  private async listBillingShipments(client: PgClient, from: string, to: string): Promise<BillingShipmentRecord[]> {
    const { rows } = await client.query<Record<string, unknown>>(
      `WITH ship AS (
         SELECT orderid, shipdate, shipmentcost, othercost, carriercode, dims_l, dims_w, dims_h
         FROM shipments
         WHERE voided = false
       )
       SELECT
         o.orderid, o.ordernumber, o.items, o.raw,
         ship.shipdate,
         COALESCE(ship.shipdate, o.orderdate) AS billingdate,
         COALESCE(ship.shipmentcost, 0) AS shipmentcost,
         COALESCE(ship.othercost, 0) AS othercost,
         ship.carriercode,
         ship.dims_l, ship.dims_w, ship.dims_h,
         COALESCE(ol.external_shipped, 0) AS external_shipped
       FROM orders o
       LEFT JOIN ship ON ship.orderid = o.orderid
       LEFT JOIN order_local ol ON ol.orderid = o.orderid
       WHERE o.orderstatus = 'shipped'
         AND COALESCE(ol.external_shipped, 0) = 0
         AND COALESCE(ship.shipdate, o.orderdate) >= $1
         AND COALESCE(ship.shipdate, o.orderdate) <= $2
       ORDER BY COALESCE(ship.shipdate, o.orderdate)`,
      [from, to],
    );
    return rows.map((row) => ({
      orderId: Number(row.orderid),
      orderNumber: String(row.ordernumber ?? ""),
      items: String(row.items ?? "[]"),
      raw: String(row.raw ?? "{}"),
      shipDate: row.shipdate == null ? null : String(row.shipdate),
      billingDate: row.billingdate == null ? null : String(row.billingdate),
      shipmentCost: Number(row.shipmentcost ?? 0),
      otherCost: Number(row.othercost ?? 0),
      carrierCode: row.carriercode == null ? null : String(row.carriercode),
      dims_l: row.dims_l == null ? null : Number(row.dims_l),
      dims_w: row.dims_w == null ? null : Number(row.dims_w),
      dims_h: row.dims_h == null ? null : Number(row.dims_h),
      external_shipped: Number(row.external_shipped ?? 0),
    })) as BillingShipmentRecord[];
  }

  private async listStorageSkus(client: PgClient, clientId: number): Promise<BillingStorageSkuRecord[]> {
    const { rows } = await client.query<Record<string, unknown>>(
      `SELECT id, productlength, productwidth, productheight, cuftoverride
       FROM inventory_skus
       WHERE clientid = $1 AND active = true`,
      [clientId],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      productLength: row.productlength == null ? null : Number(row.productlength),
      productWidth: row.productwidth == null ? null : Number(row.productwidth),
      productHeight: row.productheight == null ? null : Number(row.productheight),
      cuFtOverride: row.cuftoverride == null ? null : Number(row.cuftoverride),
    })) as BillingStorageSkuRecord[];
  }

  private async getStockBefore(client: PgClient, inventorySkuId: number, beforeMs: number): Promise<{ total: number }> {
    const { rows } = await client.query<{ total: number | string }>(
      `SELECT COALESCE(SUM(qty), 0) AS total
       FROM inventory_ledger
       WHERE invskuid = $1 AND createdat < $2`,
      [inventorySkuId, beforeMs],
    );
    return { total: Number(rows[0]?.total ?? 0) };
  }

  private async listLedgerEvents(client: PgClient, inventorySkuId: number, fromMs: number, toMs: number): Promise<BillingLedgerEventRecord[]> {
    const { rows } = await client.query<{ createdat: number; qty: number }>(
      `SELECT createdat, qty
       FROM inventory_ledger
       WHERE invskuid = $1 AND createdat >= $2 AND createdat <= $3
       ORDER BY createdat ASC`,
      [inventorySkuId, fromMs, toMs],
    );
    return rows.map((row) => ({ createdAt: Number(row.createdat), qty: Number(row.qty ?? 0) }));
  }

  private parseJson<T>(value: string | null, fallback: T): T {
    if (!value) return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  }

  private makeDimsKey(length: number | null, width: number | null, height: number | null): string {
    return `${Math.round(Number(length ?? 0))}x${Math.round(Number(width ?? 0))}x${Math.round(Number(height ?? 0))}`;
  }
}
