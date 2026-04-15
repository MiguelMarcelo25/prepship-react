import type { ShipmentSyncAccountRecord, ShipmentSyncRecord } from "../domain/shipment.ts";

export interface ShipmentRepository {
  countActiveShipments(): Promise<number>;
  getLastShipmentSync(): Promise<number | null>;
  setLastShipmentSync(timestamp: number): Promise<void>;
  listSyncAccounts(): Promise<ShipmentSyncAccountRecord[]>;
  resolveOrderIdByOrderNumber(orderNumber: string): Promise<number | null>;
  orderExists(orderId: number): Promise<boolean>;
  getOrderClientId(orderId: number): Promise<number | null>;
  // Bulk lookup used by the full-sync hot path. One SQL round trip for an
  // entire page of ShipStation shipments instead of 3× per row.
  getOrderLookupByNumbers(orderNumbers: string[]): Promise<Map<string, { orderId: number; clientId: number | null }>>;
  upsertShipmentBatch(shipments: ShipmentSyncRecord[]): Promise<void>;
  backfillOrderLocalFromShipments(shipments: ShipmentSyncRecord[]): Promise<void>;
}
