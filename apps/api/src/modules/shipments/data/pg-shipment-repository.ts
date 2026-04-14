import type { PgPool } from "../../../../../../packages/shared/src/postgres/database.ts";
import type { ShipmentRepository } from "../application/shipment-repository.ts";
import type { ShipmentSyncAccountRecord, ShipmentSyncRecord } from "../domain/shipment.ts";

export class PgShipmentRepository implements ShipmentRepository {
  private readonly pool: PgPool;

  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async countActiveShipments(): Promise<number> {
    const { rows } = await this.pool.query(
      "SELECT COUNT(*)::int AS count FROM shipments WHERE voided = FALSE",
    );
    return Number(rows[0]?.count ?? 0);
  }

  async getLastShipmentSync(): Promise<number | null> {
    const { rows } = await this.pool.query(
      "SELECT value FROM sync_meta WHERE key = 'lastShipmentSync' LIMIT 1",
    );
    const value = rows[0]?.value ? Number.parseInt(rows[0].value as string, 10) : NaN;
    return Number.isFinite(value) ? value : null;
  }

  async setLastShipmentSync(timestamp: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO sync_meta (key, value) VALUES ('lastShipmentSync', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [String(timestamp)],
    );
  }

  async listSyncAccounts(): Promise<ShipmentSyncAccountRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT clientid, ss_api_key, ss_api_secret, ss_api_key_v2
       FROM clients WHERE active = TRUE ORDER BY clientid`,
    );
    return rows
      .filter((row) => row.ss_api_key || row.ss_api_secret || row.ss_api_key_v2)
      .map((row) => ({
        clientId: Number(row.clientid),
        accountName: Number(row.clientid) === 1 ? "main" : `client-${row.clientid}`,
        v1ApiKey: (row.ss_api_key as string | null) ?? null,
        v1ApiSecret: (row.ss_api_secret as string | null) ?? null,
        v2ApiKey: (row.ss_api_key_v2 as string | null) ?? null,
      }));
  }

  async resolveOrderIdByOrderNumber(orderNumber: string): Promise<number | null> {
    const { rows } = await this.pool.query(
      "SELECT orderid FROM orders WHERE ordernumber = $1 LIMIT 1",
      [orderNumber],
    );
    return rows.length > 0 ? Number(rows[0].orderid) : null;
  }

  async orderExists(orderId: number): Promise<boolean> {
    const { rows } = await this.pool.query(
      "SELECT 1 AS present FROM orders WHERE orderid = $1 LIMIT 1",
      [orderId],
    );
    return rows.length > 0;
  }

  async getOrderClientId(orderId: number): Promise<number | null> {
    const { rows } = await this.pool.query(
      "SELECT clientid FROM orders WHERE orderid = $1 LIMIT 1",
      [orderId],
    );
    return rows.length > 0 ? Number(rows[0].clientid) : null;
  }

  async upsertShipmentBatch(shipments: ShipmentSyncRecord[]): Promise<void> {
    for (const shipment of shipments) {
      await this.pool.query(
        `INSERT INTO shipments (
          shipmentid, orderid, ordernumber, carriercode, servicecode, trackingnumber,
          shipdate, shipmentcost, othercost, voided, updatedat, clientid, source,
          createdate, provideraccountid, weight_oz, dims_l, dims_w, dims_h
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        ON CONFLICT (shipmentid) DO UPDATE SET
          orderid = EXCLUDED.orderid,
          ordernumber = EXCLUDED.ordernumber,
          carriercode = EXCLUDED.carriercode,
          servicecode = EXCLUDED.servicecode,
          trackingnumber = EXCLUDED.trackingnumber,
          shipdate = EXCLUDED.shipdate,
          shipmentcost = EXCLUDED.shipmentcost,
          othercost = EXCLUDED.othercost,
          voided = EXCLUDED.voided,
          updatedat = EXCLUDED.updatedat,
          clientid = EXCLUDED.clientid,
          source = EXCLUDED.source,
          createdate = COALESCE(EXCLUDED.createdate, shipments.createdate),
          provideraccountid = COALESCE(EXCLUDED.provideraccountid, shipments.provideraccountid),
          weight_oz = EXCLUDED.weight_oz,
          dims_l = EXCLUDED.dims_l,
          dims_w = EXCLUDED.dims_w,
          dims_h = EXCLUDED.dims_h`,
        [
          shipment.shipmentId,
          shipment.orderId,
          shipment.orderNumber,
          shipment.carrierCode,
          shipment.serviceCode,
          shipment.trackingNumber,
          shipment.shipDate,
          shipment.shipmentCost,
          shipment.otherCost,
          shipment.voided,
          shipment.updatedAt,
          shipment.clientId,
          shipment.source,
          shipment.createDate,
          shipment.providerAccountId,
          shipment.weightOz,
          shipment.dimsLength,
          shipment.dimsWidth,
          shipment.dimsHeight,
        ],
      );
    }
  }

  async backfillOrderLocalFromShipments(shipments: ShipmentSyncRecord[]): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    for (const shipment of shipments) {
      if (!shipment.voided && shipment.trackingNumber) {
        await this.pool.query(
          `INSERT INTO order_local (orderid, tracking_number, shipping_account, updatedat)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (orderid) DO UPDATE SET
             tracking_number = COALESCE(order_local.tracking_number, EXCLUDED.tracking_number),
             shipping_account = COALESCE(order_local.shipping_account, EXCLUDED.shipping_account),
             updatedat = EXCLUDED.updatedat`,
          [shipment.orderId, shipment.trackingNumber, shipment.providerAccountId, now],
        );
      }
    }
  }
}
