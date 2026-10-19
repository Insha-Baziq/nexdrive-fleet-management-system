import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getOrganizationSession } from "@/lib/organization-session";
import { jsonBody, sameOrigin } from "@/lib/onboarding-http";

const editableRoles = ["administrator", "fleet_manager", "manager", "driver"] as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role !== "administrator") return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const body = await jsonBody(request).catch(() => null) as { disabled?: unknown; name?: unknown; role?: unknown } | null;
  const statusUpdate = typeof body?.disabled === "boolean";
  const editUpdate = typeof body?.name === "string" && typeof body.role === "string";
  const bodyFields = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : [];
  if ((statusUpdate && (bodyFields.length !== 1 || bodyFields[0] !== "disabled"))
    || (editUpdate && (bodyFields.length !== 2 || !bodyFields.includes("name") || !bodyFields.includes("role")))) {
    return NextResponse.json({ error: "Choose valid account details." }, { status: 400 });
  }
  if (!statusUpdate && !editUpdate) return NextResponse.json({ error: "Choose valid account details." }, { status: 400 });
  const name = editUpdate ? (body!.name as string).trim() : "";
  const role = editUpdate ? body!.role as string : "";
  if (editUpdate && (!name || name.length > 160 || !editableRoles.includes(role as (typeof editableRoles)[number]))) {
    return NextResponse.json({ error: "Enter a valid name and role." }, { status: 400 });
  }
  const { id } = await params;
  if (statusUpdate && body!.disabled && id === session.user.id) return NextResponse.json({ error: "You cannot suspend your own account." }, { status: 400 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM tenant WHERE id=$1 FOR UPDATE", [session.tenantId]);
    const actor = await client.query<{ accountDisabledAt: Date | null; role: string }>(
      'SELECT disabled_at AS "accountDisabledAt", role FROM organization_membership WHERE user_id=$1 AND tenant_id=$2 FOR UPDATE', [session.user.id, session.tenantId],
    );
    if (!actor.rows[0] || actor.rows[0].accountDisabledAt || actor.rows[0].role !== "administrator") {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    }
    const target = await client.query<{ role: string; accountDisabledAt: Date | null }>(
      'SELECT role, disabled_at AS "accountDisabledAt" FROM organization_membership WHERE user_id=$1 AND tenant_id=$2 FOR UPDATE',
      [id, session.tenantId],
    );
    if (!target.rows[0]) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }
    const currentTarget = target.rows[0];
    if (editUpdate && id === session.user.id && role !== currentTarget.role) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "You cannot change your own role." }, { status: 400 });
    }
    const removingAdministrator = (statusUpdate && body!.disabled)
      || (editUpdate && role !== "administrator");
    if (removingAdministrator && currentTarget.role === "administrator" && !currentTarget.accountDisabledAt) {
      const active = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM organization_membership
         WHERE tenant_id=$1 AND role='administrator' AND disabled_at IS NULL`,
        [session.tenantId],
      );
      if (Number(active.rows[0]?.count) <= 1) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "The organization needs an active administrator." }, { status: 409 });
      }
    }
    if (editUpdate) {
      if (currentTarget.role === "driver" && role !== "driver") {
        const linkedDriver = await client.query(
          "SELECT id FROM driver WHERE tenant_id=$1 AND user_id=$2 LIMIT 1",
          [session.tenantId, id],
        );
        if (linkedDriver.rows[0]) {
          await client.query("ROLLBACK");
          return NextResponse.json({ error: "Unlink this driver record before changing the account role." }, { status: 409 });
        }
      }
      await client.query('UPDATE organization_membership SET display_name=$1, role=$2 WHERE user_id=$3 AND tenant_id=$4', [name, role, id, session.tenantId]);
    } else {
      await client.query(
        'UPDATE organization_membership SET disabled_at=CASE WHEN $1 THEN COALESCE(disabled_at, CURRENT_TIMESTAMP) ELSE NULL END WHERE user_id=$2 AND tenant_id=$3',
        [body!.disabled, id, session.tenantId],
      );
    }
    await client.query("COMMIT");
    return NextResponse.json(statusUpdate ? { disabled: body!.disabled } : { name, role }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
