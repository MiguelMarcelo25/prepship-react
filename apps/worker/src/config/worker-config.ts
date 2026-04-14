import { defaultSecretsPath, loadTransitionalSecrets, type TransitionalSecrets } from "../../../../packages/shared/src/config/secrets-adapter.ts";

export type DbProvider = "sqlite" | "postgres" | "memory";

export interface WorkerConfig {
  syncEnabled: boolean;
  dbProvider: DbProvider;
  sqliteDbPath: string | null;
  postgresUrl: string | null;
  secretsPath: string;
  secrets: TransitionalSecrets;
}

export function loadWorkerConfig(env = process.env): WorkerConfig {
  const dbProvider = (env.DB_PROVIDER ?? "sqlite") as DbProvider;
  const postgresUrl = env.DATABASE_URL;
  const sqliteDbPath = env.SQLITE_DB_PATH ?? (dbProvider === "postgres" ? ":memory:" : undefined);
  const secretsPath = env.PREPSHIP_SECRETS_PATH ?? defaultSecretsPath(env);

  return {
    syncEnabled: env.WORKER_SYNC_ENABLED === "1" || env.WORKER_SYNC_ENABLED === "true",
    dbProvider,
    sqliteDbPath: sqliteDbPath ?? null,
    postgresUrl: postgresUrl ?? null,
    secretsPath,
    secrets: loadTransitionalSecrets(secretsPath),
  };
}

