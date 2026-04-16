import pg from "pg";

const { Pool } = pg;

export type PgPool = pg.Pool;
export type PgClient = pg.PoolClient;

/**
 * Create a Postgres pool for the API.
 *
 * Pool sizing notes
 * -----------------
 * Supabase's session-mode pooler (port 5432) caps concurrent sessions at 15 on
 * the free tier. With the sync worker plus ad-hoc queries from the API plus
 * the occasional transaction in billing/packages/labels, a `max` of 10 was
 * enough to exhaust that budget and crash the Render process with
 * `EMAXCONNSESSION`. Keeping `max = 3` leaves headroom for parallel
 * connections from other processes (local dev API, init scripts, migrations).
 *
 * If you need more concurrency, switch `DATABASE_URL` to the transaction-mode
 * pooler on port 6543 instead — it lifts the 15-session ceiling entirely.
 */
export function createPgPool(connectionString: string): PgPool {
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  // Prevent unhandled pool errors from crashing the process
  pool.on("error", (err) => {
    console.error("[pg-pool] Idle client error:", err.message);
  });
  return pool;
}
