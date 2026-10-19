import { readFile } from "node:fs/promises";
import pg from "pg";

const name = process.argv[2];
if (!/^0(2[3-9]|3[0-9])_[a-z0-9_]+\.sql$/.test(name ?? "")) {
  throw new Error("Provide an explicit feedback migration filename (023–039).");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  process.stdout.write(`${name} applied.\n`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
