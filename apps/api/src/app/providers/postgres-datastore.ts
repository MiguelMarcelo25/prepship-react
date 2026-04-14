import { createPgPool, type PgPool } from "../../../../../packages/shared/src/postgres/database.ts";
import { openSqliteDatabase } from "../../../../../packages/shared/src/sqlite/database.ts";
import { InMemoryShipFromState } from "../../modules/locations/application/ship-from-state.ts";
import { PgLocationRepository } from "../../modules/locations/data/pg-location-repository.ts";
import { PgSettingsRepository } from "../../modules/settings/data/pg-settings-repository.ts";
import { PgClientRepository } from "../../modules/clients/data/pg-client-repository.ts";
import { PgShipmentRepository } from "../../modules/shipments/data/pg-shipment-repository.ts";
import { PgOrderRepository } from "../../modules/orders/data/pg-order-repository.ts";
import { SqliteAnalysisRepository } from "../../modules/analysis/data/sqlite-analysis-repository.ts";
import { SqliteBillingRepository } from "../../modules/billing/data/sqlite-billing-repository.ts";
import { SqliteClientRepository } from "../../modules/clients/data/sqlite-client-repository.ts";
import { SqliteInitRepository } from "../../modules/init/data/sqlite-init-repository.ts";
import { SqliteInventoryRepository } from "../../modules/inventory/data/sqlite-inventory-repository.ts";
import { SqliteLabelRepository } from "../../modules/labels/data/sqlite-label-repository.ts";
import { SqliteManifestRepository } from "../../modules/manifests/data/sqlite-manifest-repository.ts";
import { SqliteOrderRepository } from "../../modules/orders/data/sqlite-order-repository.ts";
import { SqlitePackageRepository } from "../../modules/packages/data/sqlite-package-repository.ts";
import { SqliteProductRepository } from "../../modules/products/data/sqlite-product-repository.ts";
import { SqliteRateRepository } from "../../modules/rates/data/sqlite-rate-repository.ts";
import { SqliteSettingsRepository } from "../../modules/settings/data/sqlite-settings-repository.ts";
import { SqliteShipmentRepository } from "../../modules/shipments/data/sqlite-shipment-repository.ts";
import { SqliteQueueRepository } from "../../modules/queue/data/sqlite-queue-repository.ts";
import type { ApiDataStore } from "../datastore.ts";

let sharedPgPool: PgPool | null = null;

export function getSharedPgPool(connectionString: string): PgPool {
  if (!sharedPgPool) {
    sharedPgPool = createPgPool(connectionString);
  }
  return sharedPgPool;
}

/**
 * Phase 1 postgres datastore: ported modules use pg, unported modules fall back to sqlite.
 * As more modules get ported, their pg repositories replace the sqlite ones here.
 */
export function createPostgresDataStore(
  postgresUrl: string,
  sqliteFallbackPath: string,
  excludedStoreIds: number[],
  mainApiKeyV2: string | null,
): ApiDataStore {
  const pgPool = getSharedPgPool(postgresUrl);
  const sqlite = openSqliteDatabase(sqliteFallbackPath);

  return {
    // Ported to postgres:
    locationRepository: new PgLocationRepository(pgPool),
    settingsRepository: new PgSettingsRepository(pgPool),
    clientRepository: new PgClientRepository(pgPool),
    shipmentRepository: new PgShipmentRepository(pgPool),
    orderRepository: new PgOrderRepository(pgPool, excludedStoreIds),

    // Not yet ported — still using sqlite fallback:
    queueRepository: new SqliteQueueRepository(sqlite),
    billingRepository: new SqliteBillingRepository(sqlite),
    analysisRepository: new SqliteAnalysisRepository(sqlite),
    initRepository: new SqliteInitRepository(sqlite, excludedStoreIds),
    inventoryRepository: new SqliteInventoryRepository(sqlite),
    labelRepository: new SqliteLabelRepository(sqlite, mainApiKeyV2),
    manifestRepository: new SqliteManifestRepository(sqlite),
    packageRepository: new SqlitePackageRepository(sqlite),
    productRepository: new SqliteProductRepository(sqlite),
    rateRepository: new SqliteRateRepository(sqlite, mainApiKeyV2),

    shipFromState: new InMemoryShipFromState(),
  };
}
