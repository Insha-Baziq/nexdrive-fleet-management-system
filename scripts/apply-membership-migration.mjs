import { readFile } from "node:fs/promises";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  await pool.query(await readFile(new URL("../migrations/032_organization_memberships.sql", import.meta.url), "utf8"));
  console.log("Organization membership migration applied; existing records preserved.");
} finally { await pool.end(); }
