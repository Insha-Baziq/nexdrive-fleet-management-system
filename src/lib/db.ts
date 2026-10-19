import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const globalForPool = globalThis as typeof globalThis & {
  nexdrivePool?: Pool;
};

export const pool =
  globalForPool.nexdrivePool ??
  new Pool({
    connectionString,
    max: 5,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPool.nexdrivePool = pool;
}
