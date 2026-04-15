/**
 * Order Status Sync Worker (V2) — Integrated back into the API for Free Tier compatibility.
 * Reuses repositories from the API DataStore.
 */

import { getShipStationClient, type ShipStationClient } from "../../common/shipstation/client.ts";
import type { OrderRepository } from "../orders/application/order-repository.ts";
import type { ClientRepository } from "../clients/application/client-repository.ts";
import type { ShipmentRepository } from "../shipments/application/shipment-repository.ts";

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

export interface SyncWorkerStatus {
  enabled: boolean;
  running: boolean;
  intervalSeconds: number;
  lastCycleAt: number | null;
  lastCycleElapsedMs: number;
  lastCycleShipped: number;
  lastCycleIngested: number;
  lastCycleAccounts: number;
  totalCyclesRun: number;
  totalShippedAllTime: number;
  totalIngestedAllTime: number;
  lastError: string | null;
  startedAt: number | null;
}

// Module-level registry so HTTP routes (built by bootstrap before main.ts
// creates the worker) can still see the worker's live status without having
// to pass it through the dependency chain.
let currentWorker: OrderStatusSyncWorkerV2 | null = null;

export function getSyncWorkerStatus(): SyncWorkerStatus {
  return currentWorker
    ? currentWorker.getStatus()
    : {
        enabled: false,
        running: false,
        intervalSeconds: 0,
        lastCycleAt: null,
        lastCycleElapsedMs: 0,
        lastCycleShipped: 0,
        lastCycleIngested: 0,
        lastCycleAccounts: 0,
        totalCyclesRun: 0,
        totalShippedAllTime: 0,
        totalIngestedAllTime: 0,
        lastError: null,
        startedAt: null,
      };
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

  // Live status counters — read via getStatus() / getSyncWorkerStatus().
  private startedAt: number | null = null;
  private lastCycleAt: number | null = null;
  private lastCycleElapsedMs = 0;
  private lastCycleShipped = 0;
  private lastCycleIngested = 0;
  private lastCycleAccounts = 0;
  private totalCyclesRun = 0;
  private totalShippedAllTime = 0;
  private totalIngestedAllTime = 0;
  private lastError: string | null = null;

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

  getStatus(): SyncWorkerStatus {
    return {
      enabled: this.timer != null,
      running: this.running,
      intervalSeconds: this.intervalMs / 1000,
      lastCycleAt: this.lastCycleAt,
      lastCycleElapsedMs: this.lastCycleElapsedMs,
      lastCycleShipped: this.lastCycleShipped,
      lastCycleIngested: this.lastCycleIngested,
      lastCycleAccounts: this.lastCycleAccounts,
      totalCyclesRun: this.totalCyclesRun,
      totalShippedAllTime: this.totalShippedAllTime,
      totalIngestedAllTime: this.totalIngestedAllTime,
      lastError: this.lastError,
      startedAt: this.startedAt,
    };
  }

  start(): void {
    if (this.timer) return;
    this.startedAt = Date.now();
    currentWorker = this;
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
    if (currentWorker === this) currentWorker = null;
  }

  async runSync(): Promise<void> {
    if (this.running) {
      console.log("[sync-v2] Previous sync still running, skipping");
      return;
    }
    this.running = true;
    const cycleStart = Date.now();

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

      // ── 1. Run all client accounts in PARALLEL.
      // Each ShipStation account has its own rate-limit bucket so they don't
      // contend with each other. Two clients in parallel ≈ 2× faster.
      const perAccount = await Promise.all(
        accounts.map(async (acc) => {
          const creds = { apiKey: acc.apiKey, apiSecret: acc.apiSecret };

          // Within a single account the three ShipStation paginated calls
          // share a rate budget, so we run them in parallel too — the v1Pages
          // helper handles 429 backoff per request.
          const shipmentStart = new Date(Date.now() - 45 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
          const ingestStart = new Date(Date.now() - this.lookbackMs).toISOString().replace(/\.\d{3}Z$/, "Z");
          const [shipments, shippedOrders, awaitingOrders] = await Promise.all([
            this.client.v1Pages<SSShipmentSummary>(creds, "/shipments", { createDateStart: shipmentStart }, cycleAbort).catch(() => []),
            this.client.v1Pages<SSOrderSummary>(creds, "/orders", { orderStatus: "shipped", modifyDateStart: statusStart }, cycleAbort).catch(() => []),
            this.client.v1Pages<SSOrderSummary>(creds, "/orders", { orderStatus: "awaiting_shipment", modifyDateStart: ingestStart }, cycleAbort).catch(() => []),
          ]);

          return { acc, shipments, shippedOrders, awaitingOrders };
        }),
      );

      // ── 2. Pre-fetch existing local orders in TWO bulk queries instead of
      // one per ShipStation order (was N round-trips to Supabase Tokyo).
      const allShippedOrderNumbers: string[] = [];
      const allAwaitingOrderIds: number[] = [];
      for (const { shippedOrders, awaitingOrders } of perAccount) {
        for (const o of shippedOrders) allShippedOrderNumbers.push(o.orderNumber);
        for (const o of awaitingOrders) allAwaitingOrderIds.push(o.orderId);
      }
      const [existingByNumber, existingIds] = await Promise.all([
        this.orderRepo.findByOrderNumbers(allShippedOrderNumbers),
        this.orderRepo.existingOrderIds(allAwaitingOrderIds),
      ]);

      // ── 3. Build the batches. No DB writes yet.
      const ordersToMarkShipped: number[] = [];
      const externalShippedUpdates: Array<{ orderId: number; externalShipped: boolean; source?: string | null }> = [];
      const shipmentsToUpsert: Parameters<ShipmentRepository["upsertShipmentBatch"]>[0] = [];
      const ordersToUpsert: Array<Partial<import("../orders/domain/order.ts").OrderRecord>> = [];

      const now = Date.now();

      for (const { acc, shipments, shippedOrders, awaitingOrders } of perAccount) {
        const shipMap = new Map<string, SSShipmentSummary>();
        for (const s of shipments) {
          if (!s.voided && !shipMap.has(s.orderNumber)) shipMap.set(s.orderNumber, s);
        }

        // Status sync — flip awaiting → shipped for orders that ShipStation
        // says are now shipped.
        for (const o of shippedOrders) {
          const existing = existingByNumber.get(o.orderNumber);
          if (!existing || existing.orderStatus !== "awaiting_shipment") continue;
          ordersToMarkShipped.push(existing.orderId);

          const s = shipMap.get(o.orderNumber);
          if (s) {
            // Note: nickname/labelUrl/label_created_at aren't on
            // ShipmentSyncRecord — the original sync code passed them
            // anyway and they were silently dropped. Same shape here.
            shipmentsToUpsert.push({
              shipmentId: s.shipmentId,
              orderId: existing.orderId,
              orderNumber: s.orderNumber,
              shipmentCost: s.shipmentCost,
              otherCost: 0,
              carrierCode: s.carrierCode,
              serviceCode: s.serviceCode,
              trackingNumber: s.trackingNumber,
              shipDate: s.shipDate,
              voided: false,
              providerAccountId: null,
              createDate: null,
              weightOz: null,
              dimsLength: null,
              dimsWidth: null,
              dimsHeight: null,
              updatedAt: now,
              clientId: existing.clientId,
              source: "ss_sync",
            });
            externalShippedUpdates.push({ orderId: existing.orderId, externalShipped: false });
          } else {
            externalShippedUpdates.push({ orderId: existing.orderId, externalShipped: true, source: "external_sync" });
          }
        }

        // Order ingest — insert any awaiting orders we don't already have.
        for (const o of awaitingOrders) {
          if (existingIds.has(o.orderId)) continue;
          const storeId = o.advancedOptions?.storeId ?? null;
          // Always resolve the real client by storeId — the ShipStation
          // account (acc.clientId) is just the credential holder, not the
          // end client. A single SS account can host stores for multiple
          // clients, so storeId is the authoritative key. Fall back to the
          // account's own clientId only when there is no storeId at all.
          let clientId: number | null = null;
          if (storeId != null) {
            const matching = clients.find((c) => {
              try { return JSON.parse(c.storeIds ?? "[]").includes(storeId); } catch { return false; }
            });
            if (matching) clientId = matching.clientId;
          }
          if (clientId == null) clientId = acc.clientId;
          // Still no client (main account, no storeId match) — skip.
          if (!clientId) continue;
          ordersToUpsert.push({
            orderId: o.orderId, orderNumber: o.orderNumber, orderStatus: o.orderStatus,
            orderDate: o.orderDate, storeId, customerEmail: o.customerEmail,
            shipToName: o.shipTo?.name, shipToCity: o.shipTo?.city, shipToState: o.shipTo?.state,
            shipToPostalCode: o.shipTo?.postalCode, carrierCode: o.carrierCode,
            serviceCode: o.serviceCode, weightValue: o.weight?.value, orderTotal: o.orderTotal,
            shippingAmount: o.shippingAmount, items: JSON.stringify(o.items ?? []),
            raw: JSON.stringify(o), clientId,
          });
        }
      }

      // ── 4. Flush everything in BULK. 4 queries instead of 4×N round trips.
      await Promise.all([
        ordersToMarkShipped.length > 0 ? this.orderRepo.markStatusBatch(ordersToMarkShipped, "shipped") : Promise.resolve(),
        shipmentsToUpsert.length > 0 ? this.shipmentRepo.upsertShipmentBatch(shipmentsToUpsert) : Promise.resolve(),
        externalShippedUpdates.length > 0 ? this.orderRepo.updateExternalShippedBatch(externalShippedUpdates) : Promise.resolve(),
        ordersToUpsert.length > 0 ? this.orderRepo.upsertOrdersBatch(ordersToUpsert) : Promise.resolve(),
      ]);

      const totalShipped = ordersToMarkShipped.length;
      const totalIngested = ordersToUpsert.length;
      const elapsed = Date.now() - cycleStart;

      // Persist the live status so the UI can poll it.
      this.lastCycleAt = Date.now();
      this.lastCycleElapsedMs = elapsed;
      this.lastCycleShipped = totalShipped;
      this.lastCycleIngested = totalIngested;
      this.lastCycleAccounts = perAccount.length;
      this.totalCyclesRun += 1;
      this.totalShippedAllTime += totalShipped;
      this.totalIngestedAllTime += totalIngested;
      this.lastError = null;

      // Log every cycle, even quiet ones, so there's a reliable heartbeat
      // in Render logs you can grep for. Previously we only logged when
      // orders changed, which made the worker look dead on idle projects.
      console.log(
        `[sync-v2] Cycle complete in ${elapsed}ms: ${totalShipped} shipped, ${totalIngested} ingested across ${perAccount.length} accounts`,
      );
    } catch (err) {
      const message = (err as Error).message;
      this.lastError = message;
      this.lastCycleAt = Date.now();
      this.lastCycleElapsedMs = Date.now() - cycleStart;
      console.error(`[sync-v2] Cycle error: ${message}`);
    } finally {
      this.running = false;
    }
  }
}
