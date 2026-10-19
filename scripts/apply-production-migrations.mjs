import { readFile } from "node:fs/promises";

if (process.env.VERCEL !== "1" || process.env.VERCEL_ENV !== "production") {
  console.log("Skipping production database migrations outside a Vercel production build.");
} else {
  if (!process.env.DATABASE_URL) {
    throw new Error("The Vercel production build did not provide DATABASE_URL.");
  }

  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  let migrationApplied;
  try {
    const result = await pool.query("SELECT to_regclass('organization_membership') IS NOT NULL AS applied");
    migrationApplied = result.rows[0].applied;
  } finally {
    await pool.end();
  }

  if (migrationApplied) {
    console.log("Organization membership migration is already applied.");
  } else {
    await import("./apply-membership-migration.mjs");
  }

  const platformPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const result = await platformPool.query("SELECT to_regclass('public.platform_administrator') IS NOT NULL AS applied");
    if (result.rows[0].applied) {
      console.log("Platform administration migration is already applied.");
    } else {
      await platformPool.query(await readFile(new URL("../migrations/033_platform_administration.sql", import.meta.url), "utf8"));
      console.log("Platform administration migration applied.");
    }
  } finally {
    await platformPool.end();
  }

  const verificationTimestampPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const result = await verificationTimestampPool.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='user' AND column_name='emailVerifiedAt'
       ) AS applied`,
    );
    if (result.rows[0].applied) {
      console.log("Email verification timestamp migration is already applied.");
    } else {
      await verificationTimestampPool.query(await readFile(new URL("../migrations/034_user_email_verified_at.sql", import.meta.url), "utf8"));
      console.log("Email verification timestamp migration applied.");
    }
  } finally {
    await verificationTimestampPool.end();
  }

  const driverDocumentCategoryPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const result = await driverDocumentCategoryPool.query(
      `SELECT to_regclass('public.driver_document') IS NOT NULL AS table_exists,
         EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conrelid=to_regclass('public.driver_document')
             AND conname='driver_document_category_check'
             AND pg_get_constraintdef(oid) ILIKE '%contract%'
         ) AS applied`,
    );
    if (!result.rows[0].table_exists) {
      throw new Error("The driver_document table is missing; the contract category migration cannot be applied.");
    }
    if (result.rows[0].applied) {
      console.log("Driver document contract category migration is already applied.");
    } else {
      await driverDocumentCategoryPool.query(await readFile(new URL("../migrations/035_driver_document_contract.sql", import.meta.url), "utf8"));
      console.log("Driver document contract category migration applied.");
    }
  } finally {
    await driverDocumentCategoryPool.end();
  }

  const cleanupPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const result = await cleanupPool.query(
      "UPDATE organization_invitation SET code_ciphertext=NULL WHERE code_ciphertext IS NOT NULL",
    );
    if (result.rowCount) {
      console.log(`Removed recoverable ciphertext from ${result.rowCount} legacy invitation(s); hashed tokens remain valid.`);
    } else {
      console.log("No legacy invitation ciphertext remains.");
    }
  } finally {
    await cleanupPool.end();
  }
}
