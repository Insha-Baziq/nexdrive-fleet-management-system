import { readFile } from "node:fs/promises";
import pg from "pg";

const origin = process.env.BETTER_AUTH_URL;
if (!process.env.DATABASE_URL || !origin || !/^(localhost|127\.0\.0\.1)$/.test(new URL(origin).hostname)) {
  throw new Error("Local development environment required.");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  await pool.query(await readFile(new URL("../migrations/033_platform_administration.sql", import.meta.url), "utf8"));
  console.log("Platform administrator grant table is ready.");
} finally {
  await pool.end();
}
