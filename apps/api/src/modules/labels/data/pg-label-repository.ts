import type { PgPool } from "../../../../../../../packages/shared/src/postgres/database.ts";
import type { LabelRepository } from "../application/label-repository.ts";
import type { MockLabelData } from "../application/mock-label-generator.ts";
import type {
  ExistingLabelRecord,
  LabelOrderRecord,
  LabelShipmentRecord,
  PersistedShipmentInput,
  ResolvedPackageDimensions,
  ReturnLabelRecord,
  ShipmentEnrichmentInput,
  ShippingAccountContext,
} from "../domain/label.ts";

export class PgLabelRepository implements LabelRepository {
  private readonly pool: PgPool;
  private readonly mainApiKeyV2: string | null;
  private readonly mockLabelStore = new Map<number, MockLabelData>();

  constructor(pool: PgPool, mainApiKeyV2: string | null) {
    this.pool = pool;
    this.mainApiKeyV2 = mainApiKeyV2;
  }

  async getOrder(orderId: number): Promise<LabelOrderRecord | null> {
    const { rows } = await this.pool.query<{
      orderid: number;
      ordernumber: string | null;
      orderstatus: string;
      storeid: number | null;
      clientid: number | null;
      weightvalue: number | null;
      shiptoname: string | null;
      raw: string;
    }>(
      `SELECT orderid, ordernumber, orderstatus, storeid, clientid, weightvalue, shiptoname, raw
       FROM orders WHERE orderid = $1 LIMIT 1`,
      [orderId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      orderId: Number(row.orderid),
      orderNumber: row.ordernumber,
      orderStatus: row.orderstatus,
      storeId: row.storeid == null ? null : Number(row.storeid),
      clientId: row.clientid == null ? null : Number(row.clientid),
      weightValue: row.weightvalue == null ? null : Number(row.weightvalue),
      shipToName: row.shiptoname,
      raw: row.raw ?? "{}",
    };
  }

  async findActiveLabelForOrder(orderId: number): Promise<ExistingLabelRecord | null> {
    const { rows } = await this.pool.query<{
      shipmentid: number;
      trackingnumber: string | null;
      labelurl: string | null;
    }>(
      `SELECT shipmentid, trackingnumber, labelurl
       FROM shipments
       WHERE orderid = $1 AND voided = false
       ORDER BY COALESCE(label_created_at, updatedat, shipmentid) DESC
       LIMIT 1`,
      [orderId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      shipmentId: Number(row.shipmentid),
      trackingNumber: row.trackingnumber,
      labelUrl: row.labelurl,
    };
  }

  async resolvePackageDimensions(orderId: number): Promise<ResolvedPackageDimensions | null> {
    const { rows } = await this.pool.query<{
      packageid: number | null;
      length: number | null;
      width: number | null;
      height: number | null;
    }>(
      `SELECT ol.selected_pid AS packageid, inv.length, inv.width, inv.height
       FROM order_local ol
       LEFT JOIN inventory_skus inv ON inv.packageid = ol.selected_pid
       WHERE ol.orderid = $1
       LIMIT 1`,
      [orderId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      packageId: row.packageid == null ? null : Number(row.packageid),
      length: row.length == null ? null : Number(row.length),
      width: row.width == null ? null : Number(row.width),
      height: row.height == null ? null : Number(row.height),
    };
  }

  async getShippingAccountContext(storeId: number | null): Promise<ShippingAccountContext> {
    if (storeId == null) {
      return { clientId: null, storeId: null, v1ApiKey: null, v1ApiSecret: null, v2ApiKey: this.mainApiKeyV2, rateSourceClientId: null };
    }

    const { rows: clientRows } = await this.pool.query<{
      clientid: number | null;
      ss_api_key: string | null;
      ss_api_secret: string | null;
      ss_api_key_v2: string | null;
      rate_source_client_id: number | null;
    }>(
      `SELECT clientid, ss_api_key, ss_api_secret, ss_api_key_v2, rate_source_client_id
       FROM clients
       WHERE EXISTS (
         SELECT 1
         FROM jsonb_array_elements_text((storeids)::jsonb) AS s(value)
         WHERE (s.value)::bigint = $1
       )
       LIMIT 1`,
      [storeId],
    );
    const client = clientRows[0];

    if (!client) {
      return { clientId: null, storeId, v1ApiKey: null, v1ApiSecret: null, v2ApiKey: this.mainApiKeyV2, rateSourceClientId: null };
    }

    let v2ApiKey = client.ss_api_key_v2 ?? this.mainApiKeyV2;
    if (client.rate_source_client_id != null) {
      const { rows: sourceRows } = await this.pool.query<{ ss_api_key_v2: string | null }>(
        `SELECT ss_api_key_v2 FROM clients WHERE clientid = $1 LIMIT 1`,
        [client.rate_source_client_id],
      );
      if (sourceRows[0]?.ss_api_key_v2) v2ApiKey = sourceRows[0].ss_api_key_v2;
    }

    return {
      clientId: client.clientid == null ? null : Number(client.clientid),
      storeId,
      v1ApiKey: client.ss_api_key,
      v1ApiSecret: client.ss_api_secret,
      v2ApiKey,
      rateSourceClientId: client.rate_source_client_id == null ? null : Number(client.rate_source_client_id),
    };
  }

  async saveShipment(input: PersistedShipmentInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO shipments (
         shipmentid, orderid, ordernumber, carriercode, servicecode,
         trackingnumber, shipdate, labelurl, shipmentcost, othercost, voided, updatedat,
         weight_oz, dims_l, dims_w, dims_h, createdate, clientid, provideraccountid,
         provider_account_nickname, source, label_created_at, label_format, selected_rate_json
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
       ON CONFLICT (shipmentid) DO UPDATE SET
         orderid = EXCLUDED.orderid,
         ordernumber = EXCLUDED.ordernumber,
         carriercode = EXCLUDED.carriercode,
         servicecode = EXCLUDED.servicecode,
         trackingnumber = EXCLUDED.trackingnumber,
         shipdate = EXCLUDED.shipdate,
         labelurl = COALESCE(EXCLUDED.labelurl, shipments.labelurl),
         shipmentcost = EXCLUDED.shipmentcost,
         othercost = EXCLUDED.othercost,
         voided = EXCLUDED.voided,
         updatedat = EXCLUDED.updatedat,
         weight_oz = EXCLUDED.weight_oz,
         dims_l = EXCLUDED.dims_l,
         dims_w = EXCLUDED.dims_w,
         dims_h = EXCLUDED.dims_h,
         createdate = COALESCE(EXCLUDED.createdate, shipments.createdate),
         clientid = EXCLUDED.clientid,
         provideraccountid = COALESCE(EXCLUDED.provideraccountid, shipments.provideraccountid),
         provider_account_nickname = COALESCE(shipments.provider_account_nickname, EXCLUDED.provider_account_nickname),
         source = EXCLUDED.source,
         label_created_at = COALESCE(EXCLUDED.label_created_at, shipments.label_created_at),
         label_format = COALESCE(EXCLUDED.label_format, shipments.label_format),
         selected_rate_json = COALESCE(EXCLUDED.selected_rate_json, shipments.selected_rate_json)`,
      [
        input.shipmentId,
        input.orderId,
        input.orderNumber,
        input.carrierCode,
        input.serviceCode,
        input.trackingNumber,
        input.shipDate,
        input.labelUrl,
        input.shipmentCost,
        input.otherCost,
        input.voided,
        input.updatedAt,
        input.weightOz,
        input.dimsLength,
        input.dimsWidth,
        input.dimsHeight,
        input.createDate,
        input.clientId,
        input.providerAccountId,
        input.providerAccountNickname,
        input.source,
        input.labelCreatedAt,
        input.labelFormat,
        input.selectedRateJson,
      ],
    );
  }

  async markOrderShipped(orderId: number, updatedAt: number): Promise<void> {
    await this.pool.query(
      `UPDATE orders SET orderstatus = 'shipped', updatedat = $1 WHERE orderid = $2`,
      [updatedAt, orderId],
    );
  }

  async markShipmentVoided(shipmentId: number, orderId: number, updatedAt: number): Promise<void> {
    await this.pool.query(
      `UPDATE shipments SET voided = true, updatedat = $1 WHERE shipmentid = $2`,
      [updatedAt, shipmentId],
    );
    await this.pool.query(
      `UPDATE orders SET orderstatus = 'awaiting_shipment', updatedat = $1 WHERE orderid = $2`,
      [updatedAt, orderId],
    );
  }

  async saveReturnLabel(record: ReturnLabelRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO return_labels (shipmentid, returnshipmentid, returntrackingnumber, reason, createdat)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (shipmentid) DO UPDATE SET
         returnshipmentid = EXCLUDED.returnshipmentid,
         returntrackingnumber = EXCLUDED.returntrackingnumber,
         reason = EXCLUDED.reason,
         createdat = EXCLUDED.createdat`,
      [record.shipmentId, record.returnShipmentId, record.returnTrackingNumber, record.reason, record.createdAt],
    );
  }

  async getShipmentForVoidOrReturn(shipmentId: number): Promise<LabelShipmentRecord | null> {
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT s.shipmentid, s.orderid, s.ordernumber, s.trackingnumber, s.labelurl,
              s.carriercode, s.servicecode, s.shipmentcost, s.label_created_at,
              s.voided, s.source, o.storeid
       FROM shipments s
       JOIN orders o ON o.orderid = s.orderid
       WHERE s.shipmentid = $1
       LIMIT 1`,
      [shipmentId],
    );
    return rows[0] ? this.mapShipment(rows[0]) : null;
  }

  async getLatestShipmentForOrderLookup(orderLookup: number | string): Promise<LabelShipmentRecord | null> {
    const { rows } = typeof orderLookup === "number"
      ? await this.pool.query<Record<string, unknown>>(
          `SELECT s.shipmentid, s.orderid, s.ordernumber, s.trackingnumber, s.labelurl,
                  s.carriercode, s.servicecode, s.shipmentcost, s.label_created_at,
                  s.voided, s.source, o.storeid
           FROM shipments s
           JOIN orders o ON o.orderid = s.orderid
           WHERE s.orderid = $1 AND s.voided = false
           ORDER BY COALESCE(s.label_created_at, s.updatedat, s.shipmentid) DESC
           LIMIT 1`,
          [orderLookup],
        )
      : await this.pool.query<Record<string, unknown>>(
          `SELECT s.shipmentid, s.orderid, s.ordernumber, s.trackingnumber, s.labelurl,
                  s.carriercode, s.servicecode, s.shipmentcost, s.label_created_at,
                  s.voided, s.source, o.storeid
           FROM shipments s
           JOIN orders o ON o.orderid = s.orderid
           WHERE s.ordernumber = $1 AND s.voided = false
           ORDER BY COALESCE(s.label_created_at, s.updatedat, s.shipmentid) DESC
           LIMIT 1`,
          [orderLookup],
        );
    return rows[0] ? this.mapShipment(rows[0]) : null;
  }

  async updateShipmentLabelUrl(shipmentId: number, labelUrl: string): Promise<void> {
    await this.pool.query(`UPDATE shipments SET labelurl = $1 WHERE shipmentid = $2`, [labelUrl, shipmentId]);
  }

  async enrichShipment(input: ShipmentEnrichmentInput): Promise<void> {
    await this.pool.query(
      `UPDATE shipments SET
         othercost = $1,
         createdate = COALESCE($2, createdate),
         weight_oz = COALESCE($3, weight_oz),
         dims_l = COALESCE($4, dims_l),
         dims_w = COALESCE($5, dims_w),
         dims_h = COALESCE($6, dims_h),
         updatedat = $7
       WHERE shipmentid = $8`,
      [
        input.otherCost,
        input.createDate,
        input.weightOz,
        input.dimsLength,
        input.dimsWidth,
        input.dimsHeight,
        input.updatedAt,
        input.shipmentId,
      ],
    );
  }

  async backfillOrderLocalTracking(orderId: number, trackingNumber: string, providerAccountId: number | null, updatedAtSeconds: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO order_local (orderid, tracking_number, shipping_account, updatedat)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (orderid) DO UPDATE SET
         tracking_number = CASE WHEN order_local.tracking_number IS NULL THEN EXCLUDED.tracking_number ELSE order_local.tracking_number END,
         shipping_account = CASE WHEN order_local.shipping_account IS NULL THEN EXCLUDED.shipping_account ELSE order_local.shipping_account END,
         updatedat = EXCLUDED.updatedat`,
      [orderId, trackingNumber, providerAccountId, updatedAtSeconds],
    );
  }

  async saveMockLabelData(shipmentId: number, data: MockLabelData): Promise<void> {
    await this.pool.query(
      `INSERT INTO mock_labels
         (shipment_id, order_number, tracking_number, service_label, weight_oz, ship_from, ship_to, ship_date, pdf_base64)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (shipment_id) DO UPDATE SET
         order_number = EXCLUDED.order_number,
         tracking_number = EXCLUDED.tracking_number,
         service_label = EXCLUDED.service_label,
         weight_oz = EXCLUDED.weight_oz,
         ship_from = EXCLUDED.ship_from,
         ship_to = EXCLUDED.ship_to,
         ship_date = EXCLUDED.ship_date,
         pdf_base64 = EXCLUDED.pdf_base64`,
      [
        shipmentId,
        data.orderNumber ?? null,
        data.trackingNumber,
        data.serviceLabel,
        data.weightOz,
        JSON.stringify(data.shipFrom),
        JSON.stringify(data.shipTo),
        data.shipDate,
        data.pdfBase64 ?? null,
      ],
    );
    this.mockLabelStore.set(shipmentId, data);
  }

  async getMockLabelData(shipmentId: number): Promise<MockLabelData | null> {
    const cached = this.mockLabelStore.get(shipmentId);
    if (cached) return cached;
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM mock_labels WHERE shipment_id = $1 LIMIT 1`,
      [shipmentId],
    );
    const row = rows[0];
    if (!row) return null;
    const data: MockLabelData = {
      shipmentId: Number(row.shipment_id),
      orderNumber: row.order_number as string | null,
      trackingNumber: row.tracking_number as string,
      serviceLabel: row.service_label as string,
      weightOz: Number(row.weight_oz),
      shipFrom: JSON.parse(row.ship_from as string),
      shipTo: JSON.parse(row.ship_to as string),
      shipDate: row.ship_date as string,
      pdfBase64: row.pdf_base64 as string | undefined,
    };
    this.mockLabelStore.set(shipmentId, data);
    return data;
  }

  private mapShipment(row: Record<string, unknown>): LabelShipmentRecord {
    return {
      shipmentId: Number(row.shipmentid),
      orderId: Number(row.orderid),
      orderNumber: row.ordernumber == null ? null : String(row.ordernumber),
      trackingNumber: row.trackingnumber == null ? null : String(row.trackingnumber),
      labelUrl: row.labelurl == null ? null : String(row.labelurl),
      carrierCode: row.carriercode == null ? null : String(row.carriercode),
      serviceCode: row.servicecode == null ? null : String(row.servicecode),
      shipmentCost: row.shipmentcost == null ? null : Number(row.shipmentcost),
      labelCreatedAt: row.label_created_at == null ? null : Number(row.label_created_at),
      voided: Boolean(row.voided),
      source: row.source == null ? null : String(row.source),
      storeId: row.storeid == null ? null : Number(row.storeid),
    };
  }
}
