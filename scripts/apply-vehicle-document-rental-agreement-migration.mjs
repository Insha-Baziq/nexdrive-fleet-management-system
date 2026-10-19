import { readFile } from "node:fs/promises";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const migration = await readFile(new URL("../migrations/023_vehicle_document_rental_agreement.sql", import.meta.url), "utf8");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(migration);
  await client.query("COMMIT");
  process.stdout.write("Vehicle rental agreement document category migration applied.\n");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
