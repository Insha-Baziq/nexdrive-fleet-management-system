import { SignJWT, jwtVerify } from "jose";
import { verifyPassword } from "better-auth/crypto";
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret) throw new Error("BETTER_AUTH_SECRET is required");
const key = new TextEncoder().encode(secret);

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string; password?: string; token?: string };
    if (body.token) {
      const { payload } = await jwtVerify(body.token, key, { algorithms: ["HS256"] });
      if (payload.purpose !== "verification-watch" || !payload.sub) {
        return NextResponse.json({ error: "Invalid status check." }, { status: 401 });
      }
      const status = await pool.query<{ email_verified: boolean }>(
        'SELECT "emailVerified" AS email_verified FROM "user" WHERE id = $1',
        [payload.sub],
      );
      return NextResponse.json({ verified: status.rows[0]?.email_verified === true });
    }

    const email = body.email?.trim().toLowerCase();
    if (!email || !body.password || body.password.length > 256) {
      return NextResponse.json({ error: "Invalid credentials." }, { status: 400 });
    }

    const result = await pool.query<{ id: string; email_verified: boolean; password_hash: string | null }>(
      `SELECT u.id, u."emailVerified" AS email_verified, a.password AS password_hash
       FROM "user" u
       JOIN account a ON a."userId" = u.id AND a."providerId" = 'credential'
       WHERE lower(u.email) = $1
       LIMIT 1`,
      [email],
    );
    const account = result.rows[0];
    if (!account?.password_hash || !(await verifyPassword({ hash: account.password_hash, password: body.password }))) {
      return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
    }

    const token = await new SignJWT({ purpose: "verification-watch" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(account.id)
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(key);

    return NextResponse.json({ token, verified: account.email_verified });
  } catch {
    return NextResponse.json({ error: "Could not start verification status check." }, { status: 500 });
  }
}
