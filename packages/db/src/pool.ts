import pg from "pg";

export type Db = pg.Pool;

/**
 * Creates the shared connection pool. Cloud SQL is reached over a unix
 * socket when PGHOST points at /cloudsql/..., or TCP locally. All settings
 * come from standard PG* environment variables plus DATABASE_URL.
 */
export function createPool(): Db {
  const connectionString = process.env.DATABASE_URL;
  const pool = connectionString
    ? new pg.Pool({ connectionString, max: 10 })
    : new pg.Pool({ max: 10 });
  pool.on("error", (err) => {
    // Idle-client errors must never crash the service; queries get their own.
    console.error(JSON.stringify({ severity: "ERROR", message: "pg pool error", error: err.message }));
  });
  return pool;
}
