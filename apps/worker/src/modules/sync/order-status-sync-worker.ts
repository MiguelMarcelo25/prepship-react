/**
 * Order Status Sync Worker — Refactored to use Repositories for provider-agnosticism.
 */

import { getShipStationClient, type ShipStationClient } from "../../../api/src/common/shipstation/client.ts";
import type { OrderRepository } from "../../../api/src/modules/orders/application/order-repository.ts";
import type { ClientRepository } from "../../../api/src/modules/clients/application/client-repository.ts";
import type { ShipmentRepository } from "../../../api/src/modules/shipments/application/shipment-repository.ts";
import type { ClientRecord } from "../../../api/src/modules/clients/domain/client.ts";
import type { OrderRecord } from "../../../api/src/modules/orders/domain/order.ts";
import { resolveCarrierNickname } from "../../../api/src/modules/orders/application/carrier-resolver.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SyncAccount {
  clientId: number;
  accountName: string;
  apiKey: string;
  apiSecret: string;
  storeIds: number[];
}

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toISOStringUTC(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export class OrderStatusSyncWorker {
  private readonly orderRepo: OrderRepository;
  private readonly clientRepo: ClientRepository;
  private readonly shipmentRepo: ShipmentRepository;
  private readonly mainApiKey: string;
  private readonly mainApiSecret: string;
  private readonly intervalMs: number;
  private readonly lookbackMs: number;
  private readonly client: ShipStationClient;
  private running = false;

  constructor(
    orderRepo: OrderRepository,
    clientRepo: ClientRepository,
    shipmentRepo: ShipmentRepository,
    mainApiKey: string,
    mainApiSecret: string,
    intervalMs = 3 * 60 * 1000,
    lookbackMs = 4 * 60 * 60 * 1000,
    client?: ShipStationClient,
  ) {
    this.orderRepo = orderRepo;
    this.clientRepo = clientRepo;
    this.shipmentRepo = shipmentRepo;
    this.mainApiKey = mainApiKey;
    this.mainApiSecret = mainApiSecret;
    this.intervalMs = intervalMs;
    this.lookbackMs = lookbackMs;
    this.client = client ?? getShipStationClient();
  }

  async runSync(): Promise<void> {
    if (this.running) {
      console.log("[sync] Previous sync still running, skipping");
      return;
    }
    this.running = true;

    const cycleAbort = AbortSignal.timeout(150_000);
    const circuitState = this.client.getCircuitState();
    if (circuitState === "open") {
      console.warn(`[sync] Circuit breaker OPEN — skipping cycle`);
      this.running = false;
      return;
    }

    try {
      const accounts = await this.loadAccounts();
      const statusStart = toISOStringUTC(new Date(Date.now() - 2 * 60 * 60 * 1000));

      let overallUpdated = 0;
      let overallCancelled = 0;
      let overallIngested = 0;

      for (const account of accounts) {
        const credentials = { apiKey: account.apiKey, apiSecret: account.apiSecret };

        // 1. Shipment Sync
        const shipmentStart = toISOStringUTC(new Date(Date.now() - 45 * 60 * 1000));
        const shipments = await this.client.v1Pages<SSShipmentSummary>(
          credentials,
          "/shipments",
          { createDateStart: shipmentStart },
          cycleAbort,
        ).catch((err) => {
          console.warn(`[sync] Shipment fetch failed for ${account.accountName}: ${(err as Error).message}`);
          return [] as SSShipmentSummary[];
        });

        const shipmentMap = new Map<string, SSShipmentSummary>();
        for (const s of shipments) {
          if (!s.voided && s.orderNumber && !shipmentMap.has(s.orderNumber)) {
            shipmentMap.set(s.orderNumber, s);
          }
        }

        // 2. Status Sync (Shipped)
        const shippedOrders = await this.client.v1Pages<SSOrderSummary>(
          credentials,
          "/orders",
          { orderStatus: "shipped", modifyDateStart: statusStart },
          cycleAbort,
        ).catch(() => [] as SSOrderSummary[]);

        for (const order of shippedOrders) {
          if (!order.orderNumber) continue;
          const existing = await this.orderRepo.getByOrderNumber(order.orderNumber);
          if (!existing || existing.orderStatus !== "awaiting_shipment") continue;

          await this.orderRepo.markStatus(existing.orderId, "shipped");
          
          const shipment = shipmentMap.get(order.orderNumber);
          if (shipment) {
            await this.saveShipment(shipment, existing.orderId, existing.clientId);
          } else {
            await this.orderRepo.updateExternalShipped(existing.orderId, true, "ss_sync_external");
          }
          overallUpdated++;
        }

        // 3. Cancellation Sync
        const cancelledOrders = await this.client.v1Pages<SSOrderSummary>(
          credentials,
          "/orders",
          { orderStatus: "cancelled", modifyDateStart: statusStart },
          cycleAbort,
        ).catch(() => [] as SSOrderSummary[]);

        for (const order of cancelledOrders) {
          if (!order.orderNumber) continue;
          const existing = await this.orderRepo.getByOrderNumber(order.orderNumber);
          if (!existing || existing.orderStatus !== "awaiting_shipment") continue;
          await this.orderRepo.markStatus(existing.orderId, "cancelled");
          overallCancelled++;
        }

        // 4. Order Ingest
        const ingestStart = toISOStringUTC(new Date(Date.now() - this.lookbackMs));
        const awaitingOrders = await this.client.v1Pages<SSOrderSummary>(
          credentials,
          "/orders",
          { orderStatus: "awaiting_shipment", modifyDateStart: ingestStart },
          cycleAbort,
        ).catch(() => [] as SSOrderSummary[]);

        for (const order of awaitingOrders) {
          if (!order.orderId || !order.orderNumber) continue;
          const exists = await this.orderRepo.getById(order.orderId);
          if (exists) continue;

          const storeId = order.advancedOptions?.storeId ?? null;
          const clientId = await this.resolveClientId(storeId);
          if (!clientId && account.clientId !== 0) continue; // Skip if not our client (or not main account)

          const weightOz = order.weight?.value != null
            ? (order.weight.units === "ounces" ? order.weight.value : order.weight.value * 16)
            : null;

          await this.orderRepo.upsertOrder({
            orderId: order.orderId,
            orderNumber: order.orderNumber,
            orderStatus: order.orderStatus,
            orderDate: order.orderDate,
            storeId: storeId,
            customerEmail: order.customerEmail,
            shipToName: order.shipTo?.name,
            shipToCity: order.shipTo?.city,
            shipToState: order.shipTo?.state,
            shipToPostalCode: order.shipTo?.postalCode,
            carrierCode: order.carrierCode,
            serviceCode: order.serviceCode,
            weightValue: weightOz,
            orderTotal: order.orderTotal,
            shippingAmount: order.shippingAmount,
            items: JSON.stringify(order.items ?? []),
            raw: JSON.stringify(order),
            clientId: clientId || account.clientId,
          });
          overallIngested++;
        }

        if (accounts.indexOf(account) < accounts.length - 1) await new Promise((r) => setTimeout(r, 1_500));
      }

      if (overallUpdated > 0 || overallCancelled > 0 || overallIngested > 0) {
        console.log(`[sync] Cycle — ${overallUpdated} shipped, ${overallCancelled} cancelled, ${overallIngested} ingested`);
      }
    } catch (err) {
      console.error(`[sync] Cycle error: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async loadAccounts(): Promise<SyncAccount[]> {
    const clients = await this.clientRepo.listActive();
    const accounts: SyncAccount[] = [];

    const mainStoreIds: number[] = [];
    for (const c of clients) {
      try {
        const ids = JSON.parse(c.storeIds ?? "[]") as number[];
        mainStoreIds.push(...ids);
      } catch { /* ignore */ }
    }

    if (this.mainApiKey && this.mainApiSecret) {
      accounts.push({
        clientId: 0,
        accountName: "main",
        apiKey: this.mainApiKey,
        apiSecret: this.mainApiSecret,
        storeIds: mainStoreIds,
      });
    }

    for (const c of clients) {
      if (c.ss_api_key && c.ss_api_secret) {
        let storeIds: number[] = [];
        try { storeIds = JSON.parse(c.storeIds ?? "[]") as number[]; } catch { /* ignore */ }
        accounts.push({
          clientId: c.clientId,
          accountName: c.name,
          apiKey: c.ss_api_key,
          apiSecret: c.ss_api_secret,
          storeIds,
        });
      }
    }

    return accounts;
  }

  private async resolveClientId(storeId: number | null): Promise<number | null> {
    if (!storeId) return null;
    const clients = await this.clientRepo.listActive();
    for (const c of clients) {
      try {
        const ids = JSON.parse(c.storeIds ?? "[]") as number[];
        if (ids.includes(storeId)) return c.clientId;
      } catch { /* ignore */ }
    }
    return null;
  }

  private async saveShipment(s: SSShipmentSummary, orderId: number, clientId: number | null): Promise<void> {
    const nickname = resolveCarrierNickname(null, s.carrierCode, s.trackingNumber, clientId);
    await this.shipmentRepo.upsertShipmentBatch([{
      shipmentId: s.shipmentId,
      orderId,
      orderNumber: s.orderNumber,
      carrierCode: s.carrierCode,
      serviceCode: s.serviceCode,
      trackingNumber: s.trackingNumber,
      shipDate: s.shipDate,
      labelUrl: s.formUrl,
      shipmentCost: s.shipmentCost,
      otherCost: 0,
      voided: s.voided ? 1 : 0,
      updatedAt: Date.now(),
      clientId,
      provider_account_nickname: nickname,
      source: "ss_sync",
      label_created_at: Date.now(),
      label_format: "pdf",
    }]);
    await this.orderRepo.updateExternalShipped(orderId, false);
  }
}
