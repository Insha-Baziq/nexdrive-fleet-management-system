import { readFile } from "node:fs/promises";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const migrations = await Promise.all([
  readFile(new URL("../migrations/006_vehicle_document.sql", import.meta.url), "utf8"),
  readFile(new URL("../migrations/007_vehicle_document_upload_staging.sql", import.meta.url), "utf8"),
]);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  for (const sql of migrations) await client.query(sql);
  await client.query("COMMIT");
  process.stdout.write("Vehicle document migration applied.\n");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
