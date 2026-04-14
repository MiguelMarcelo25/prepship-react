import type { AppConfig } from "../../config/app-config.ts";
import { EXCLUDED_STORE_IDS } from "../../common/prepship-config.ts";
import type { ApiDataStore } from "../datastore.ts";
import { createMemoryDataStore, type MemoryDataStoreSeed } from "./memory-datastore.ts";
import { createSqliteDataStore } from "./sqlite-datastore.ts";
import { createPostgresDataStore } from "./postgres-datastore.ts";

export async function buildDataStore(config: AppConfig, memorySeed?: MemoryDataStoreSeed): Promise<ApiDataStore> {
  if (config.dbProvider === "memory") {
    return createMemoryDataStore(memorySeed);
  }

  if (config.dbProvider === "postgres") {
    return createPostgresDataStore(
      config.postgresUrl as string,
      config.sqliteDbPath as string,
      EXCLUDED_STORE_IDS,
      config.secrets.shipstation?.api_key_v2 ?? null,
    );
  }

  return createSqliteDataStore(
    config.sqliteDbPath as string,
    EXCLUDED_STORE_IDS,
    config.secrets.shipstation?.api_key_v2 ?? null,
  );
}
