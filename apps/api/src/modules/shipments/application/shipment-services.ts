import type { TransitionalSecrets } from "../../../../../../../packages/shared/src/config/secrets-adapter.ts";
import type {
  LegacySyncStatusDto,
  LegacySyncTriggerResponseDto,
  ShipmentSyncResponseDto,
  ShipmentSyncStatusDto,
} from "../../../../../../../packages/contracts/src/shipments/contracts.ts";
import type { ShipmentRepository } from "./shipment-repository.ts";
import type { ShipmentSyncAccountRecord } from "../domain/shipment.ts";
import type { ShipstationV1Credentials, ShippingGateway } from "../../labels/application/shipping-gateway.ts";

function credentialsOrThrow(apiKey: string | null | undefined, apiSecret: string | null | undefined, secrets: TransitionalSecrets): ShipstationV1Credentials {
  const key = apiKey ?? secrets.shipstation?.api_key;
  const secret = apiSecret ?? secrets.shipstation?.api_secret;
  if (!key || !secret) {
    throw new Error("No v1 ShipStation credentials configured");
  }
  return { apiKey: key, apiSecret: secret };
}

export class ShipmentServices {
  private readonly repository: ShipmentRepository;
  private readonly gateway: ShippingGateway;
  private readonly secrets: TransitionalSecrets;
  private running = false;
  private legacySyncStatus: LegacySyncStatusDto = {
    status: "idle",
    lastSync: null,
    count: 0,
    total: 0,
    error: null,
    page: 0,
    mode: "idle",
    ratesCached: 0,
    ratePrefetchRunning: false,
  };

  constructor(repository: ShipmentRepository, gateway: ShippingGateway, secrets: TransitionalSecrets) {
    this.repository = repository;
    this.gateway = gateway;
    this.secrets = secrets;
  }

  triggerSync(): ShipmentSyncResponseDto {
    this.startSync("incremental");
    return { queued: true };
  }

  triggerLegacySync(full: boolean): LegacySyncTriggerResponseDto {
    this.startSync(full ? "full" : "incremental");
    return { queued: true, mode: full ? "full" : "incremental" };
  }

  async getLegacyStatus(): Promise<LegacySyncStatusDto> {
    const lastSync = await this.repository.getLastShipmentSync();
    return {
      ...this.legacySyncStatus,
      lastSync: lastSync ?? this.legacySyncStatus.lastSync,
    };
  }

  private startSync(mode: "incremental" | "full"): void {
    if (!this.running) {
      this.running = true;
      this.legacySyncStatus = {
        ...this.legacySyncStatus,
        status: "syncing",
        error: null,
        page: 0,
        total: 0,
        mode,
      };
      void this.runSync(mode).finally(() => {
        this.running = false;
      });
    }
  }

  async getStatus(): Promise<ShipmentSyncStatusDto> {
    const [count, lastSync] = await Promise.all([
      this.repository.countActiveShipments(),
      this.repository.getLastShipmentSync(),
    ]);
    return {
      count,
      lastSync,
      running: this.running,
    };
  }

  async list(searchParams: URLSearchParams) {
    const credentials = credentialsOrThrow(null, null, this.secrets);
    const result = await this.gateway.listShipments(credentials, searchParams);
    return result.raw;
  }

  private async buildSyncAccounts(): Promise<ShipmentSyncAccountRecord[]> {
    const accounts: ShipmentSyncAccountRecord[] = [];
    const mainApiKey = this.secrets.shipstation?.api_key ?? null;
    const mainApiSecret = this.secrets.shipstation?.api_secret ?? null;

    if (mainApiKey && mainApiSecret) {
      accounts.push({
        clientId: 1,
        accountName: "main",
        v1ApiKey: mainApiKey,
        v1ApiSecret: mainApiSecret,
        v2ApiKey: this.secrets.shipstation?.api_key_v2 ?? null,
      });
    }

    const repoAccounts = await this.repository.listSyncAccounts();
    return accounts.concat(
      repoAccounts.filter((account) => Boolean(account.v1ApiKey && account.v1ApiSecret)),
    );
  }

  private async runSync(mode: "incremental" | "full"): Promise<void> {
    const accounts = await this.buildSyncAccounts();
    const lastSync = await this.repository.getLastShipmentSync();
    
    // Accuracy fix: use a larger overlap (5 minutes) for incremental syncs 
    // to catch any edge cases where ShipStation hasn't updated the modify date yet.
    const createdAtStart = lastSync ? new Date(lastSync - 300_000).toISOString() : undefined;
    const updatedAt = Date.now();
    let totalProcessed = 0;
    let totalRecords = 0;

    try {
      // Process accounts in parallel for faster cross-account sync
      await Promise.all(accounts.map(async (account) => {
        const credentials = {
          apiKey: account.v1ApiKey as string,
          apiSecret: account.v1ApiSecret as string,
        };

        const carrierLookup = new Map<string, number>();

        // Start carrier lookup and shipment fetch in parallel tasks
        const carrierTask = (async () => {
          if (!account.v2ApiKey) return;
          let page = 1;
          while (true) {
            const rows = await this.gateway.listShipmentsV2(account.v2ApiKey, page, createdAtStart);
            if (rows.length === 0) break;
            for (const row of rows) {
              if (row.orderNumber && row.carrierId) {
                const numeric = Number.parseInt(row.carrierId.replace(/^se-/, ""), 10);
                if (Number.isFinite(numeric)) carrierLookup.set(row.orderNumber, numeric);
              }
            }
            if (rows.length < 500) break;
            page += 1;
          }
        })();

        const shipmentTask = (async () => {
          const params = new URLSearchParams({
            pageSize: "500",
            page: "1",
            sortBy: "CreateDate",
            sortDir: "DESC",
          });
          if (createdAtStart) {
            params.set("modifyDateStart", createdAtStart.replace("T", " ").replace(/\.\d{3}Z$/, ""));
          }

          const firstPage = await this.gateway.listShipments(credentials, params);
          if (firstPage.shipments.length === 0) return;

          totalRecords += firstPage.total;
          this.legacySyncStatus = {
            ...this.legacySyncStatus,
            total: totalRecords,
          };

          // Process first page
          await this.processShipmentBatch(firstPage.shipments, account, carrierLookup, updatedAt, mode);
          totalProcessed += firstPage.shipments.length;

          // Fetch remaining pages in parallel batches. ShipStation v1 allows
          // 40 req/sec per account and the pages helper handles 429 backoff,
          // so 8 concurrent page fetches is safe and ~3× faster than 3.
          const remainingPages = Array.from({ length: firstPage.pages - 1 }, (_, i) => i + 2);
          const CONCURRENCY = 8;
          
          for (let i = 0; i < remainingPages.length; i += CONCURRENCY) {
            const batch = remainingPages.slice(i, i + CONCURRENCY);
            await Promise.all(batch.map(async (pageIdx) => {
              const p = new URLSearchParams(params);
              p.set("page", String(pageIdx));
              const res = await this.gateway.listShipments(credentials, p);
              await this.processShipmentBatch(res.shipments, account, carrierLookup, updatedAt, mode);
              totalProcessed += res.shipments.length;
            }));
          }
        })();

        await Promise.all([carrierTask, shipmentTask]);
      }));

      const completedAt = Date.now();
      await this.repository.setLastShipmentSync(completedAt);
      this.legacySyncStatus = {
        ...this.legacySyncStatus,
        status: "done",
        lastSync: completedAt,
        count: totalProcessed,
        error: null,
        page: 0,
        total: 0,
        mode,
      };
    } catch (error) {
      this.legacySyncStatus = {
        ...this.legacySyncStatus,
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
        page: 0,
        mode,
      };
      throw error;
    }
  }

  private async processShipmentBatch(
    shipments: any[],
    account: ShipmentSyncAccountRecord,
    carrierLookup: Map<string, number>,
    updatedAt: number,
    mode: string
  ) {
    // Bulk prefetch: one SQL round trip gets orderId + clientId for every
    // order number on this page. Replaces 3× N sequential lookups that were
    // the dominant cost of a full sync (~100k round trips for 33k shipments).
    const orderNumbers = shipments
      .map((s) => s.orderNumber)
      .filter((n): n is string => typeof n === "string" && n.length > 0);
    const orderLookup = await this.repository.getOrderLookupByNumbers(orderNumbers);

    const normalized: any[] = [];
    for (const shipment of shipments) {
      const matched = shipment.orderNumber ? orderLookup.get(shipment.orderNumber) : undefined;
      // A shipment without a matching local order is skipped — the old path
      // also dropped these via the orderExists() check.
      if (!matched) continue;
      const orderId = matched.orderId;
      const clientId = matched.clientId ?? account.clientId;

      normalized.push({
        shipmentId: shipment.shipmentId,
        orderId,
        orderNumber: shipment.orderNumber,
        shipmentCost: shipment.shipmentCost,
        otherCost: shipment.otherCost,
        carrierCode: shipment.carrierCode,
        serviceCode: shipment.serviceCode,
        trackingNumber: shipment.trackingNumber,
        shipDate: shipment.shipDate,
        voided: shipment.voided,
        providerAccountId: shipment.orderNumber ? carrierLookup.get(shipment.orderNumber) ?? null : null,
        createDate: shipment.createDate,
        weightOz: shipment.weightOz,
        dimsLength: shipment.dimsLength,
        dimsWidth: shipment.dimsWidth,
        dimsHeight: shipment.dimsHeight,
        updatedAt,
        clientId,
        source: "shipstation",
      });
    }

    if (normalized.length > 0) {
      await this.repository.upsertShipmentBatch(normalized);
      await this.repository.backfillOrderLocalFromShipments(normalized);
      this.legacySyncStatus = {
        ...this.legacySyncStatus,
        status: "syncing",
        mode: mode as any,
        page: (this.legacySyncStatus.page || 0) + normalized.length,
      };
    }
  }
}
