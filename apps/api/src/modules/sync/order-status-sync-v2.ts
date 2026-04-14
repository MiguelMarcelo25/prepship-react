/**
 * Order Status Sync Worker (V2) — Integrated back into the API for Free Tier compatibility.
 * Reuses repositories from the API DataStore.
 */

import { getShipStationClient, type ShipStationClient } from "../../common/shipstation/client.ts";
import type { OrderRepository } from "../orders/application/order-repository.ts";
import type { ClientRepository } from "../clients/application/client-repository.ts";
import type { ShipmentRepository } from "../shipments/application/shipment-repository.ts";
import { resolveCarrierNickname } from "../orders/application/carrier-resolver.ts";

interface SSOrderSummary {
  orderId: number;
  orderNumber: string;
  orderStatus: string;
  orderDate: string;
  modifyDate: string;
  customerEmail: string | null;
  shipTo: { name: string | null; city: string | null; state: string | null; postalCode: string | null };
  carrierCode: string | null;
  serviceCode: string | null;
  weight: { value: number; units: string } | null;
  orderTotal: number;
  shippingAmount: number;
  items: unknown[];
  advancedOptions: { storeId: number | null } | null;
}

interface SSShipmentSummary {
  shipmentId: number;
  orderNumber: string;
  carrierCode: string | null;
  serviceCode: string | null;
  trackingNumber: string | null;
  shipDate: string | null;
  shipmentCost: number;
  formUrl: string | null;
  voided: boolean;
}

export class OrderStatusSyncWorkerV2 {
  private readonly orderRepo: OrderRepository;
  private readonly clientRepo: ClientRepository;
  private readonly shipmentRepo: ShipmentRepository;
  private readonly mainApiKey: string;
  private readonly mainApiSecret: string;
  private readonly intervalMs: number;
  private readonly lookbackMs: number;
  private readonly client: ShipStationClient;
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    orderRepo: OrderRepository,
    clientRepo: ClientRepository,
    shipmentRepo: ShipmentRepository,
    mainApiKey: string,
    mainApiSecret: string,
    intervalMs = 3 * 60 * 1000,
    lookbackMs = 4 * 60 * 60 * 1000,
  ) {
    this.orderRepo = orderRepo;
    this.clientRepo = clientRepo;
    this.shipmentRepo = shipmentRepo;
    this.mainApiKey = mainApiKey;
    this.mainApiSecret = mainApiSecret;
    this.intervalMs = intervalMs;
    this.lookbackMs = lookbackMs;
    this.client = getShipStationClient();
  }

  start(): void {
    if (this.timer) return;
    console.log(`[sync-v2] Starting integrated sync worker (interval=${this.intervalMs / 1000}s)`);
    void this.runSync();
    this.timer = setInterval(() => void this.runSync(), this.intervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runSync(): Promise<void> {
    if (this.running) {
      console.log("[sync-v2] Previous sync still running, skipping");
      return;
    }
    this.running = true;

    try {
      const clients = await this.clientRepo.listActive();
      const accounts: Array<{ clientId: number; apiKey: string; apiSecret: string; label: string }> = [];

      if (this.mainApiKey && this.mainApiSecret) {
        accounts.push({ clientId: 0, apiKey: this.mainApiKey, apiSecret: this.mainApiSecret, label: "main" });
      }

      for (const c of clients) {
        if (c.ss_api_key && c.ss_api_secret) {
          accounts.push({ clientId: c.clientId, apiKey: c.ss_api_key, apiSecret: c.ss_api_secret, label: c.name });
        }
      }

      const cycleAbort = AbortSignal.timeout(150_000);
      const statusStart = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

      let totalShipped = 0;
      let totalIngested = 0;

      for (const acc of accounts) {
        const creds = { apiKey: acc.apiKey, apiSecret: acc.apiSecret };

        // 1. Shipment backfill
        const shipmentStart = new Date(Date.now() - 45 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
        const shipments = await this.client.v1Pages<SSShipmentSummary>(creds, "/shipments", { createDateStart: shipmentStart }, cycleAbort).catch(() => []);
        const shipMap = new Map<string, SSShipmentSummary>();
        for (const s of shipments) {
          if (!s.voided && !shipMap.has(s.orderNumber)) shipMap.set(s.orderNumber, s);
        }

        // 2. Status Sync
        const orders = await this.client.v1Pages<SSOrderSummary>(creds, "/orders", { orderStatus: "shipped", modifyDateStart: statusStart }, cycleAbort).catch(() => []);
        for (const o of orders) {
          const existing = await this.orderRepo.getByOrderNumber(o.orderNumber);
          if (existing && existing.orderStatus === "awaiting_shipment") {
            await this.orderRepo.markStatus(existing.orderId, "shipped");
            const s = shipMap.get(o.orderNumber);
            if (s) {
              const nickname = resolveCarrierNickname(null, s.carrierCode, s.trackingNumber, existing.clientId);
              await this.shipmentRepo.upsertShipmentBatch([{
                shipmentId: s.shipmentId, orderId: existing.orderId, orderNumber: s.orderNumber,
                carrierCode: s.carrierCode, serviceCode: s.serviceCode, trackingNumber: s.trackingNumber,
                shipDate: s.shipDate, labelUrl: s.formUrl, shipmentCost: s.shipmentCost, otherCost: 0,
                voided: 0, updatedAt: Date.now(), clientId: existing.clientId,
                provider_account_nickname: nickname, source: "ss_sync", label_created_at: Date.now(),
                label_format: "pdf"
              }]);
              await this.orderRepo.updateExternalShipped(existing.orderId, false);
            } else {
              await this.orderRepo.updateExternalShipped(existing.orderId, true, "external_sync");
            }
            totalShipped++;
          }
        }

        // 3. Order Ingest
        const ingestStart = new Date(Date.now() - this.lookbackMs).toISOString().replace(/\.\d{3}Z$/, "Z");
        const awaiting = await this.client.v1Pages<SSOrderSummary>(creds, "/orders", { orderStatus: "awaiting_shipment", modifyDateStart: ingestStart }, cycleAbort).catch(() => []);
        for (const o of awaiting) {
          const exists = await this.orderRepo.getById(o.orderId);
          if (!exists) {
            const storeId = o.advancedOptions?.storeId ?? null;
            let clientId = acc.clientId;
            if (clientId === 0 && storeId) {
              const matching = clients.find(c => {
                try { return JSON.parse(c.storeIds ?? "[]").includes(storeId); } catch { return false; }
              });
              if (matching) clientId = matching.clientId;
            }
            if (acc.clientId !== 0 || clientId !== 0) {
              await this.orderRepo.upsertOrder({
                orderId: o.orderId, orderNumber: o.orderNumber, orderStatus: o.orderStatus,
                orderDate: o.orderDate, storeId, customerEmail: o.customerEmail,
                shipToName: o.shipTo?.name, shipToCity: o.shipTo?.city, shipToState: o.shipTo?.state,
                shipToPostalCode: o.shipTo?.postalCode, carrierCode: o.carrierCode,
                serviceCode: o.serviceCode, weightValue: o.weight?.value, orderTotal: o.orderTotal,
                shippingAmount: o.shippingAmount, items: JSON.stringify(o.items ?? []),
                raw: JSON.stringify(o), clientId
              });
              totalIngested++;
            }
          }
        }
      }
      if (totalShipped > 0 || totalIngested > 0) {
        console.log(`[sync-v2] Cycle complete: ${totalShipped} shipped, ${totalIngested} ingested`);
      }
    } catch (err) {
      console.error(`[sync-v2] Cycle error: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
