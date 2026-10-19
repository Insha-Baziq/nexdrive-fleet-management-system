import { readFile } from "node:fs/promises";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const sql = await readFile(new URL("../migrations/020_vehicle_driver_archive.sql", import.meta.url), "utf8");
  await pool.query(sql);
  process.stdout.write("Vehicle and driver archive migration applied.\n");
} finally {
  await pool.end();
}
