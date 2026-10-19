import { readFile } from "node:fs/promises";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = await readFile(new URL("../migrations/003_driver.sql", import.meta.url), "utf8");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  process.stdout.write("Driver migration applied.\n");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
