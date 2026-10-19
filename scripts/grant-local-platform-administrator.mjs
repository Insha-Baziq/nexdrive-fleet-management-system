import pg from "pg";

const origin = process.env.BETTER_AUTH_URL;
const email = process.env.NEXDRIVE_PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
if (!process.env.DATABASE_URL || !origin || !/^(localhost|127\.0\.0\.1)$/.test(new URL(origin).hostname)) {
  throw new Error("Local development environment required.");
}
if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error("Set NEXDRIVE_PLATFORM_ADMIN_EMAIL to an existing verified local account.");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const result = await pool.query(
    `INSERT INTO platform_administrator (user_id)
     SELECT id FROM "user"
     WHERE lower(email)=lower($1) AND "emailVerified"=true AND "accountDisabledAt" IS NULL
     ON CONFLICT (user_id) DO NOTHING
     RETURNING user_id`,
    [email],
  );
  if (!result.rowCount) {
    const exists = await pool.query(
      `SELECT 1 FROM platform_administrator pa
       JOIN "user" u ON u.id=pa.user_id
       WHERE lower(u.email)=lower($1) AND u."emailVerified"=true AND u."accountDisabledAt" IS NULL`,
      [email],
    );
    if (!exists.rowCount) throw new Error("No eligible verified local account was found; no grant was added.");
  }
  console.log("Local platform administrator grant is ready.");
} finally {
  await pool.end();
}
