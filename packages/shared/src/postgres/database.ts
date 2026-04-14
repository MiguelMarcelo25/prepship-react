import pg from "pg";

const { Pool } = pg;

export type PgPool = pg.Pool;

export function createPgPool(connectionString: string): PgPool {
  return new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 10,
  });
}
