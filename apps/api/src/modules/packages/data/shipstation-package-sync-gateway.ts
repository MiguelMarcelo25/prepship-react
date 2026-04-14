import type { TransitionalSecrets } from "../../../../../../../packages/shared/src/config/secrets-adapter.ts";
import type { ExternalCarrierPackageRecord, PackageSyncGateway } from "../application/package-sync-gateway.ts";
import { getShipStationClient } from "../../../common/shipstation/client.ts";

export class ShipstationPackageSyncGateway implements PackageSyncGateway {
  private readonly apiKey: string | null;
  private readonly apiSecret: string | null;

  constructor(secrets: TransitionalSecrets) {
    // Optional creds — return empty package list when missing so cloud deploys boot.
    this.apiKey = secrets.shipstation?.api_key ?? null;
    this.apiSecret = secrets.shipstation?.api_secret ?? null;
  }

  async listCarrierPackages(carrierCode: string): Promise<ExternalCarrierPackageRecord[]> {
    if (!this.apiKey || !this.apiSecret) return [];
    const client = getShipStationClient();
    const payload = await client.v1<Array<Record<string, unknown>>>(
      { apiKey: this.apiKey, apiSecret: this.apiSecret },
      `/carriers/listpackages?carrierCode=${encodeURIComponent(carrierCode)}`,
    );
    if (!Array.isArray(payload)) return [];
    return payload.map((entry) => ({
      code: String(entry.code ?? ""),
      name: String(entry.name ?? ""),
      domestic: Boolean(entry.domestic),
      international: Boolean(entry.international),
    })).filter((entry) => entry.code && entry.name);
  }
}
