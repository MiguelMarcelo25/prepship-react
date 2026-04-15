import { createPgPool, type PgPool } from "../../../../../packages/shared/src/postgres/database.ts";
import { InMemoryShipFromState } from "../../modules/locations/application/ship-from-state.ts";
import { PgAnalysisRepository } from "../../modules/analysis/data/pg-analysis-repository.ts";
import { PgBillingRepository } from "../../modules/billing/data/pg-billing-repository.ts";
import { PgClientRepository } from "../../modules/clients/data/pg-client-repository.ts";
import { PgInitRepository } from "../../modules/init/data/pg-init-repository.ts";
import { PgInventoryRepository } from "../../modules/inventory/data/pg-inventory-repository.ts";
import { PgLabelRepository } from "../../modules/labels/data/pg-label-repository.ts";
import { PgLocationRepository } from "../../modules/locations/data/pg-location-repository.ts";
import { PgManifestRepository } from "../../modules/manifests/data/pg-manifest-repository.ts";
import { PgOrderRepository } from "../../modules/orders/data/pg-order-repository.ts";
import { PgPackageRepository } from "../../modules/packages/data/pg-package-repository.ts";
import { PgProductRepository } from "../../modules/products/data/pg-product-repository.ts";
import { PgQueueRepository } from "../../modules/queue/data/pg-queue-repository.ts";
import { PgRateRepository } from "../../modules/rates/data/pg-rate-repository.ts";
import { PgSettingsRepository } from "../../modules/settings/data/pg-settings-repository.ts";
import { PgShipmentRepository } from "../../modules/shipments/data/pg-shipment-repository.ts";
import type { ApiDataStore } from "../datastore.ts";

let sharedPgPool: PgPool | null = null;

export function getSharedPgPool(connectionString: string): PgPool {
  if (!sharedPgPool) {
    sharedPgPool = createPgPool(connectionString);
  }
  return sharedPgPool;
}

/**
 * Fully-ported Postgres datastore. Every module in the system now reads and
 * writes through its `Pg*Repository` against Supabase — there is no SQLite
 * fallback path left in this provider.
 *
 * `sqliteFallbackPath` is still accepted to keep the calling signature stable
 * with the other datastore providers, but it is intentionally unused.
 */
export function createPostgresDataStore(
  postgresUrl: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _sqliteFallbackPath: string,
  excludedStoreIds: number[],
  mainApiKeyV2: string | null,
): ApiDataStore {
  const pgPool = getSharedPgPool(postgresUrl);

  return {
    locationRepository: new PgLocationRepository(pgPool),
    settingsRepository: new PgSettingsRepository(pgPool),
    clientRepository: new PgClientRepository(pgPool),
    shipmentRepository: new PgShipmentRepository(pgPool),
    orderRepository: new PgOrderRepository(pgPool, excludedStoreIds),
    initRepository: new PgInitRepository(pgPool, excludedStoreIds),
    queueRepository: new PgQueueRepository(pgPool),
    billingRepository: new PgBillingRepository(pgPool),
    analysisRepository: new PgAnalysisRepository(pgPool),
    inventoryRepository: new PgInventoryRepository(pgPool),
    labelRepository: new PgLabelRepository(pgPool, mainApiKeyV2),
    manifestRepository: new PgManifestRepository(pgPool),
    packageRepository: new PgPackageRepository(pgPool),
    productRepository: new PgProductRepository(pgPool),
    rateRepository: new PgRateRepository(pgPool, mainApiKeyV2),
    shipFromState: new InMemoryShipFromState(),
  };
}
