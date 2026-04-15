import pg from "pg";

const { Pool } = pg;

export type PgPool = pg.Pool;
export type PgClient = pg.PoolClient;

export function createPgPool(connectionString: string): PgPool {
  return new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 10,
  });
}
