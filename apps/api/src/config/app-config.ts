import { defaultSecretsPath, loadTransitionalSecrets, type TransitionalSecrets } from "../../../../packages/shared/src/config/secrets-adapter.ts";

export type DbProvider = "sqlite" | "postgres" | "memory";

export interface AppConfig {
  port: number;
  dbProvider: DbProvider;
  sqliteDbPath: string | null;
  postgresUrl: string | null;
  secretsPath: string;
  workerSyncEnabled: boolean;
  secrets: TransitionalSecrets;
  sessionToken: string;
}

function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

export function loadAppConfig(env = process.env): AppConfig {
  const dbProvider = (env.DB_PROVIDER ?? "sqlite") as DbProvider;
  const postgresUrl = env.DATABASE_URL;

  if (dbProvider !== "sqlite" && dbProvider !== "postgres" && dbProvider !== "memory") {
    throw new Error(`Unsupported DB_PROVIDER: ${dbProvider}`);
  }

  if (dbProvider === "sqlite" && !env.SQLITE_DB_PATH) {
    throw new Error("SQLITE_DB_PATH is required when DB_PROVIDER=sqlite");
  }

  if (dbProvider === "postgres" && !postgresUrl) {
    throw new Error("DATABASE_URL is required when DB_PROVIDER=postgres");
  }

  // In postgres mode, sqlite is only used as a fallback for unported modules.
  // Default to an in-memory sqlite db so deployments without a writable disk
  // (Render, serverless) still boot. Unported endpoints will return empty data.
  const sqliteDbPath = env.SQLITE_DB_PATH ?? (dbProvider === "postgres" ? ":memory:" : undefined);

  const secretsPath = env.PREPSHIP_SECRETS_PATH ?? defaultSecretsPath(env);

  // SESSION_TOKEN must be set in production. In dev, fall back to a fixed
  // dev-only token so the server can still start without manual config.
  const isProduction = env.NODE_ENV === "production";
  const sessionToken = env.SESSION_TOKEN;
  
  if (isProduction && !sessionToken) {
    throw new Error("SESSION_TOKEN is required in production environment");
  }

  const fallbackToken = sessionToken ?? "dev-only-insecure-token-change-me";

  return {
    // Render/Heroku-style platforms set PORT; fall back to API_PORT for local dev.
    port: Number.parseInt(env.PORT ?? env.API_PORT ?? "4010", 10),
    dbProvider,
    sqliteDbPath: sqliteDbPath ?? null,
    postgresUrl: postgresUrl ?? null,
    secretsPath,
    workerSyncEnabled: parseBooleanFlag(env.WORKER_SYNC_ENABLED, false),
    secrets: loadTransitionalSecrets(secretsPath),
    sessionToken: fallbackToken,
  };
}
