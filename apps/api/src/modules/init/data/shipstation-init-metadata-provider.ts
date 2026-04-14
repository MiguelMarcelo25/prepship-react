import type { TransitionalSecrets } from "../../../../../../../packages/shared/src/config/secrets-adapter.ts";
import type { CarrierAccountDto, InitStoreDto } from "../../../../../../../packages/contracts/src/init/contracts.ts";
import type { InitMetadataProvider } from "../application/init-metadata-provider.ts";
import { getShipStationClient } from "../../../common/shipstation/client.ts";

interface CacheEntry<T> {
  data: T | null;
  fetchedAt: number;
  ttlMs: number;
}

export class ShipstationInitMetadataProvider implements InitMetadataProvider {
  private readonly storesCache: CacheEntry<InitStoreDto[]>;
  private readonly carriersCache: CacheEntry<unknown[]>;
  private readonly apiKey: string | null;
  private readonly apiSecret: string | null;
  private readonly carrierAccounts: CarrierAccountDto[];

  constructor(secrets: TransitionalSecrets, carrierAccounts: CarrierAccountDto[]) {
    // Credentials are optional. Without them, listStores/listCarriers return
    // empty arrays so cloud deploys (Render, Vercel) can boot without real
    // ShipStation access. Endpoints that depend on remote SS metadata will
    // simply show empty results.
    this.apiKey = secrets.shipstation?.api_key ?? null;
    this.apiSecret = secrets.shipstation?.api_secret ?? null;
    this.carrierAccounts = carrierAccounts;
    this.storesCache = { data: null, fetchedAt: 0, ttlMs: 15 * 60 * 1000 };
    this.carriersCache = { data: null, fetchedAt: 0, ttlMs: 24 * 60 * 60 * 1000 };
  }

  async listStores(): Promise<InitStoreDto[]> {
    if (!this.apiKey || !this.apiSecret) return [];
    return this.getCached<InitStoreDto[]>("/stores", this.storesCache);
  }

  async listCarriers(): Promise<unknown[]> {
    if (!this.apiKey || !this.apiSecret) return [];
    return this.getCached<unknown[]>("/carriers", this.carriersCache);
  }

  listCarrierAccounts(): CarrierAccountDto[] {
    return [...this.carrierAccounts];
  }

  async refreshCarriers(): Promise<unknown[]> {
    this.carriersCache.data = null;
    this.carriersCache.fetchedAt = 0;
    return this.listCarriers();
  }

  private async getCached<T>(path: string, cache: CacheEntry<T>): Promise<T> {
    if (cache.data && (Date.now() - cache.fetchedAt) < cache.ttlMs) {
      return cache.data;
    }

    const client = getShipStationClient();
    try {
      const data = await client.v1<T>(
        { apiKey: this.apiKey as string, apiSecret: this.apiSecret as string },
        path,
        { deduplicate: true },
      );
      cache.data = data;
      cache.fetchedAt = Date.now();
      return data;
    } catch (error) {
      if (cache.data) return cache.data;
      throw error;
    }
  }
}
