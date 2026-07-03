import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createPool } from "./pool.js";

/**
 * Minimal forward-only migration runner: applies migrations/NNNN_*.sql in
 * order, tracking applied files in schema_migrations. Runs as a Cloud Run
 * job (or locally) — never at service startup.
 */
async function main(): Promise<void> {
  const db = createPool();
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  await db.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );

  for (const file of files) {
    const applied = await db.query(`SELECT 1 FROM schema_migrations WHERE filename = $1`, [file]);
    if ((applied.rowCount ?? 0) > 0) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [file]);
      await client.query("COMMIT");
      console.log(`applied ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
