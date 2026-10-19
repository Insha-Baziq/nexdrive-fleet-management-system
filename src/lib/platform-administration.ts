import "server-only";
import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { PoolClient } from "pg";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";

export type PlatformAccess =
  | { status: 401 }
  | { status: 403 }
  | { status: 200; session: NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>> };

export async function getPlatformAccess(requestHeaders: Headers): Promise<PlatformAccess> {
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return { status: 401 };

  const administrator = await pool.query(
    `SELECT 1 FROM platform_administrator pa
     JOIN "user" u ON u.id=pa.user_id
     WHERE pa.user_id=$1 AND u."accountDisabledAt" IS NULL AND u."emailVerified"=true`,
    [session.user.id],
  );
  if (!administrator.rowCount) return { status: 403 };
  return { status: 200, session };
}

export type PlatformOrganizationUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  disabledAt: string | null;
  lastSeenAt: string | null;
};

export type PlatformOrganization = {
  id: string;
  name: string;
  createdAt: Date;
  countryCode: string;
  timezone: string;
  currencyCode: string;
  users: PlatformOrganizationUser[];
};

export type PlatformUserMembership = {
  organizationId: string;
  organizationName: string;
  role: string;
  disabledAt: string | null;
};

export type PlatformUser = {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  emailVerified: boolean;
  accountDisabledAt: Date | null;
  lastSeenAt: Date | null;
  platformAdministrator: boolean;
  memberships: PlatformUserMembership[];
};

export async function listPlatformUsers(): Promise<PlatformUser[]> {
  const result = await pool.query<PlatformUser>(
    `SELECT u.id, u.name, u.email, u."createdAt" AS "createdAt",
       u."emailVerified" AS "emailVerified",
       u."accountDisabledAt" AS "accountDisabledAt",
       u."lastSeenAt" AS "lastSeenAt",
       EXISTS (SELECT 1 FROM platform_administrator pa WHERE pa.user_id=u.id) AS "platformAdministrator",
       COALESCE(
         json_agg(
           json_build_object(
             'organizationId', t.id,
             'organizationName', t.name,
             'role', m.role,
             'disabledAt', m.disabled_at
           ) ORDER BY lower(t.name), m.role
         ) FILTER (WHERE m.tenant_id IS NOT NULL),
         '[]'::json
       ) AS memberships
     FROM "user" u
     LEFT JOIN organization_membership m ON m.user_id=u.id
     LEFT JOIN tenant t ON t.id=m.tenant_id
     WHERE u.email NOT ILIKE 'deleted-%@deleted.nexdrive.invalid'
     GROUP BY u.id
     ORDER BY u."createdAt" DESC, lower(u.name), lower(u.email)`,
  );
  return result.rows;
}

export type PlatformUserDetail = {
  id: string;
  name: string;
  email: string;
  createdAtExact: string;
  emailVerified: boolean;
  emailVerifiedAtExact: string | null;
  accountDisabled: boolean;
  platformAdministrator: boolean;
  memberships: PlatformUserMembership[];
};

export async function getPlatformUserDetail(id: string): Promise<PlatformUserDetail | null> {
  const result = await pool.query<PlatformUserDetail>(
    `SELECT u.id, u.name, u.email,
       to_char(u."createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAtExact",
       u."emailVerified" AS "emailVerified",
       CASE WHEN u."emailVerifiedAt" IS NULL THEN NULL
         ELSE to_char(u."emailVerifiedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
       END AS "emailVerifiedAtExact",
       (u."accountDisabledAt" IS NOT NULL) AS "accountDisabled",
       EXISTS (SELECT 1 FROM platform_administrator pa WHERE pa.user_id=u.id) AS "platformAdministrator",
       COALESCE(
         json_agg(
           json_build_object(
             'organizationId', t.id,
             'organizationName', t.name,
             'role', m.role,
             'disabledAt', m.disabled_at
           ) ORDER BY lower(t.name), m.role
         ) FILTER (WHERE m.tenant_id IS NOT NULL),
         '[]'::json
       ) AS memberships
     FROM "user" u
     LEFT JOIN organization_membership m ON m.user_id=u.id
     LEFT JOIN tenant t ON t.id=m.tenant_id
     WHERE u.id=$1 AND u.email NOT ILIKE 'deleted-%@deleted.nexdrive.invalid'
     GROUP BY u.id`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function listPlatformOrganizations(): Promise<PlatformOrganization[]> {
  const result = await pool.query<PlatformOrganization>(
    `SELECT t.id, t.name, t.created_at AS "createdAt", t.country_code AS "countryCode",
       t.timezone, t.currency_code AS "currencyCode",
       COALESCE(
         json_agg(
           json_build_object(
             'id', u.id,
             'name', m.display_name,
             'email', u.email,
             'role', m.role,
             'disabledAt', m.disabled_at,
             'lastSeenAt', m.last_seen_at
           ) ORDER BY CASE WHEN m.role='administrator' THEN 0 ELSE 1 END,
             lower(m.display_name), lower(u.email)
         ) FILTER (WHERE u.id IS NOT NULL AND u.email NOT ILIKE 'deleted-%@deleted.nexdrive.invalid'),
         '[]'::json
       ) AS users
     FROM tenant t
     LEFT JOIN organization_membership m ON m.tenant_id=t.id
     LEFT JOIN "user" u ON u.id=m.user_id
     GROUP BY t.id, t.name, t.created_at, t.country_code, t.timezone, t.currency_code
     ORDER BY t.created_at DESC, lower(t.name), t.id`,
  );
  return result.rows;
}

export async function getPlatformOrganization(id: string): Promise<PlatformOrganization | null> {
  const result = await pool.query<PlatformOrganization>(
    `SELECT t.id, t.name, t.created_at AS "createdAt", t.country_code AS "countryCode",
       t.timezone, t.currency_code AS "currencyCode",
       COALESCE(
         json_agg(
           json_build_object(
             'id', u.id,
             'name', m.display_name,
             'email', u.email,
             'role', m.role,
             'disabledAt', m.disabled_at,
             'lastSeenAt', m.last_seen_at
           ) ORDER BY CASE WHEN m.role='administrator' THEN 0 ELSE 1 END,
             lower(m.display_name), lower(u.email)
         ) FILTER (WHERE u.id IS NOT NULL AND u.email NOT ILIKE 'deleted-%@deleted.nexdrive.invalid'),
         '[]'::json
       ) AS users
     FROM tenant t
     LEFT JOIN organization_membership m ON m.tenant_id=t.id
     LEFT JOIN "user" u ON u.id=m.user_id
     WHERE t.id=$1
     GROUP BY t.id, t.name, t.created_at, t.country_code, t.timezone, t.currency_code`,
    [id],
  );
  return result.rows[0] ?? null;
}

export class PlatformAdministrationError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function createPlatformOrganization(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PlatformAdministrationError("Enter a valid organization name.", 400);
  }
  const organizationName = (input as Record<string, unknown>).organizationName;
  if (typeof organizationName !== "string" || !organizationName.trim() || organizationName.trim().length > 120) {
    throw new PlatformAdministrationError("Enter an organization name between 1 and 120 characters.", 400);
  }

  const id = randomUUID();
  const name = organizationName.trim();
  try {
    await pool.query(
      "INSERT INTO tenant (id, name, country_code, timezone, currency_code) VALUES ($1,$2,'FR','Europe/Paris','EUR')",
      [id, name],
    );
    return { id, name, countryCode: "FR", timezone: "Europe/Paris", currencyCode: "EUR" };
  } catch {
    throw new PlatformAdministrationError("The organization could not be created.", 500);
  }
}

type TenantTable = { table_name: string; tenant_column: string };
type ForeignKeyEdge = { child: string; parent: string; deferrable: boolean };
type StorageKeyRow = { storage_key: string | null; pending_storage_key: string | null };

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function privateStorage() {
  const bucket = process.env.TIGRIS_STORAGE_BUCKET || process.env.TIGRIS_BUCKET;
  const accessKeyId = process.env.TIGRIS_STORAGE_ACCESS_KEY_ID || process.env.TIGRIS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.TIGRIS_STORAGE_SECRET_ACCESS_KEY || process.env.TIGRIS_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) return null;

  return {
    bucket,
    client: new S3Client({
      endpoint: process.env.TIGRIS_ENDPOINT || "https://t3.storage.dev",
      region: "auto",
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
}

export async function deletePlatformUser(userId: string, confirmation: string, actorId: string) {
  if (!userId || userId.length > 200 || confirmation.length > 254) {
    throw new PlatformAdministrationError("Invalid account confirmation.", 400);
  }

  const client = await pool.connect();
  let storageClient: S3Client | null = null;
  try {
    await client.query("BEGIN");
    const accountResult = await client.query<{ id: string; email: string }>(
      'SELECT id, email FROM "user" WHERE id=$1 FOR UPDATE',
      [userId],
    );
    const account = accountResult.rows[0];
    if (!account) throw new PlatformAdministrationError("User account not found.", 404);
    if (account.email !== confirmation.trim()) {
      throw new PlatformAdministrationError("Enter the exact email address to confirm account deletion.", 400);
    }
    if (actorId === userId) {
      throw new PlatformAdministrationError("You cannot delete the platform account you are using.", 409);
    }

    await client.query("SELECT pg_advisory_xact_lock(hashtext('nexdrive-platform-administrator-deletion'))");
    const isPlatformAdministrator = await client.query(
      "SELECT 1 FROM platform_administrator WHERE user_id=$1",
      [userId],
    );
    if (isPlatformAdministrator.rowCount) {
      const administratorCount = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM platform_administrator",
      );
      if (administratorCount.rows[0].count <= 1) {
        throw new PlatformAdministrationError("The last platform administrator account cannot be deleted.", 409);
      }
    }

    const documentTable = await client.query<{ ready: boolean }>(
      "SELECT to_regclass('public.user_document') IS NOT NULL AS ready",
    );
    const documentKeys = new Set<string>();
    if (documentTable.rows[0]?.ready) {
      const documents = await client.query<StorageKeyRow>(
        "SELECT storage_key, pending_storage_key FROM user_document WHERE user_id=$1 FOR UPDATE",
        [userId],
      );
      for (const row of documents.rows) {
        if (row.storage_key) documentKeys.add(row.storage_key);
        if (row.pending_storage_key) documentKeys.add(row.pending_storage_key);
      }
    }
    if (documentKeys.size) {
      const storage = privateStorage();
      if (!storage) throw new PlatformAdministrationError("Private document storage is not configured; the account was not deleted.", 503);
      storageClient = storage.client;
      const results = await Promise.allSettled([...documentKeys].map((key) => storage.client.send(
        new DeleteObjectCommand({ Bucket: storage.bucket, Key: key }),
      )));
      if (results.some((result) => result.status === "rejected")) {
        throw new PlatformAdministrationError("A private user document could not be removed; the account was not deleted.", 503);
      }
    }

    const driverTable = await client.query<{ ready: boolean }>(
      "SELECT to_regclass('public.driver') IS NOT NULL AS ready",
    );
    if (driverTable.rows[0]?.ready) {
      await client.query("UPDATE driver SET user_id=NULL, updated_at=CURRENT_TIMESTAMP WHERE user_id=$1", [userId]);
    }
    if (documentTable.rows[0]?.ready) await client.query("DELETE FROM user_document WHERE user_id=$1", [userId]);
    await client.query('DELETE FROM "session" WHERE "userId"=$1', [userId]);
    await client.query('DELETE FROM "account" WHERE "userId"=$1', [userId]);
    await client.query('DELETE FROM "verification" WHERE lower(identifier)=lower($1) OR lower(value)=lower($1)', [account.email]);
    // Actor foreign keys now reference the account's membership. Keep those
    // rows as disabled, anonymous principals so business history remains intact.
    await client.query(
      `UPDATE organization_membership
       SET display_name='Deleted account', disabled_at=COALESCE(disabled_at,CURRENT_TIMESTAMP), last_seen_at=NULL
       WHERE user_id=$1`,
      [userId],
    );
    await client.query("DELETE FROM platform_administrator WHERE user_id=$1", [userId]);

    // Keep a non-loginable audit principal because V1 business records require
    // their actor reference. Remove all identity and sign-in data from it.
    const tombstoneEmail = `deleted-${randomUUID()}@deleted.nexdrive.invalid`;
    await client.query(
      `UPDATE "user"
       SET name='Deleted account', email=$2, "emailVerified"=false, image=NULL,
           "updatedAt"=CURRENT_TIMESTAMP, "tenantId"=NULL, "appRole"=NULL,
           "accountDisabledAt"=CURRENT_TIMESTAMP, "lastSeenAt"=NULL
       WHERE id=$1`,
      [userId, tombstoneEmail],
    );
    await client.query("COMMIT");
    return { id: userId, email: account.email };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof PlatformAdministrationError) throw error;
    throw new PlatformAdministrationError("The account could not be deleted. No organization fleet records were removed.", 500);
  } finally {
    storageClient?.destroy();
    client.release();
  }
}

async function tenantTables(client: Pick<PoolClient, "query">) {
  const result = await client.query<TenantTable>(
    `SELECT c.table_name, c.column_name AS tenant_column
     FROM information_schema.columns c
     JOIN information_schema.tables t
       ON t.table_schema=c.table_schema AND t.table_name=c.table_name
     WHERE c.table_schema='public' AND t.table_type='BASE TABLE' AND c.column_name IN ('tenant_id', 'tenantId')
     ORDER BY c.table_name`,
  );
  return result.rows;
}

async function childFirstTableOrder(
  client: Pick<PoolClient, "query">,
  tables: string[],
) {
  const result = await client.query<ForeignKeyEdge>(
    `SELECT child.relname AS child, parent.relname AS parent, constraint_def.condeferrable AS deferrable
     FROM pg_constraint constraint_def
     JOIN pg_class child ON child.oid=constraint_def.conrelid
     JOIN pg_namespace child_schema ON child_schema.oid=child.relnamespace
     JOIN pg_class parent ON parent.oid=constraint_def.confrelid
     JOIN pg_namespace parent_schema ON parent_schema.oid=parent.relnamespace
     WHERE constraint_def.contype='f'
       AND child_schema.nspname='public' AND parent_schema.nspname='public'
       AND child.relname=ANY($1::text[]) AND parent.relname=ANY($1::text[])
       AND NOT EXISTS (
         SELECT 1 FROM unnest(constraint_def.conkey) AS key_column(attnum)
         JOIN pg_attribute child_column
           ON child_column.attrelid=child.oid AND child_column.attnum=key_column.attnum
         WHERE child_column.attname='proof_document_id'
       )`,
    [tables],
  );
  const edges = result.rows;
  const remaining = new Set(tables);
  const ordered: string[] = [];

  while (remaining.size) {
    const ready = [...remaining].filter((table) => !edges.some(
      (edge) => edge.parent === table && remaining.has(edge.child),
    ));
    if (ready.length) {
      ready.sort();
      ordered.push(...ready);
      ready.forEach((table) => remaining.delete(table));
      continue;
    }

    const cycleEdges = edges.filter((edge) => remaining.has(edge.child) && remaining.has(edge.parent));
    if (cycleEdges.some((edge) => !edge.deferrable)) {
      throw new PlatformAdministrationError("Organization data has a non-deferrable relationship cycle.", 409);
    }
    ordered.push(...[...remaining].sort());
    remaining.clear();
  }
  return { ordered, edges };
}

export async function deletePlatformOrganization(tenantId: string, confirmation: string) {
  if (!tenantId || tenantId.length > 100 || confirmation.length > 200) {
    throw new PlatformAdministrationError("Invalid organization confirmation.", 400);
  }

  const client = await pool.connect();
  let storageClient: S3Client | null = null;
  try {
    await client.query("BEGIN");
    const tenantResult = await client.query<{ id: string; name: string }>(
      "SELECT id, name FROM tenant WHERE id=$1 FOR UPDATE",
      [tenantId],
    );
    const tenant = tenantResult.rows[0];
    if (!tenant) throw new PlatformAdministrationError("Organization not found.", 404);
    if (tenant.name !== confirmation) {
      throw new PlatformAdministrationError("Enter the exact organization name to confirm deletion.", 400);
    }

    const allTenantTables = await tenantTables(client);
    const preservedTables = new Set(["organization_membership", "user"]);
    const organizationTables = allTenantTables.filter((table) => !preservedTables.has(table.table_name));
    const tableNames = organizationTables.map((table) => table.table_name);

    // Optional evidence pointers form intentional bidirectional FKs with evidence rows.
    // Clear them before deleting the tenant's evidence and parent records.
    for (const table of organizationTables) {
      const proofPointer = await client.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name=$1 AND column_name='proof_document_id'`,
        [table.table_name],
      );
      if (proofPointer.rowCount) {
        await client.query(
          `UPDATE ${quoteIdentifier("public")}.${quoteIdentifier(table.table_name)}
           SET proof_document_id=NULL
           WHERE ${quoteIdentifier(table.tenant_column)}=$1 AND proof_document_id IS NOT NULL`,
          [tenantId],
        );
      }
    }
    const { ordered } = await childFirstTableOrder(client, tableNames);

    const keys = new Set<string>();
    for (const table of organizationTables) {
      const columnsResult = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema='public' AND table_name=$1
           AND column_name IN ('storage_key', 'pending_storage_key')
         ORDER BY column_name`,
        [table.table_name],
      );
      const columns = new Set(columnsResult.rows.map((row) => row.column_name));
      if (!columns.has("storage_key")) continue;
      const pendingColumn = columns.has("pending_storage_key")
        ? `, ${quoteIdentifier("pending_storage_key")}`
        : ", NULL::text AS pending_storage_key";
      const storageRows = await client.query<StorageKeyRow>(
        `SELECT ${quoteIdentifier("storage_key")}${pendingColumn}
         FROM ${quoteIdentifier("public")}.${quoteIdentifier(table.table_name)}
         WHERE ${quoteIdentifier(table.tenant_column)}=$1`,
        [tenantId],
      );
      for (const row of storageRows.rows) {
        if (row.storage_key) keys.add(row.storage_key);
        if (row.pending_storage_key) keys.add(row.pending_storage_key);
      }
    }

    if (keys.size) {
      const storage = privateStorage();
      if (!storage) throw new PlatformAdministrationError("Private document storage is not configured; organization data was not deleted.", 503);
      storageClient = storage.client;
      const results = await Promise.allSettled([...keys].map((key) => storage.client.send(
        new DeleteObjectCommand({ Bucket: storage.bucket, Key: key }),
      )));
      if (results.some((result) => result.status === "rejected")) {
        throw new PlatformAdministrationError("A private document could not be removed; organization data was not deleted.", 503);
      }
    }

    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await client.query('UPDATE "user" SET "tenantId"=NULL WHERE "tenantId"=$1', [tenantId]);
    for (const tableName of ordered) {
      const table = organizationTables.find((candidate) => candidate.table_name === tableName);
      if (!table) continue;
      await client.query(
        `DELETE FROM ${quoteIdentifier("public")}.${quoteIdentifier(table.table_name)} WHERE ${quoteIdentifier(table.tenant_column)}=$1`,
        [tenantId],
      );
    }
    await client.query("DELETE FROM organization_membership WHERE tenant_id=$1", [tenantId]);
    const deleted = await client.query("DELETE FROM tenant WHERE id=$1", [tenantId]);
    if (!deleted.rowCount) throw new PlatformAdministrationError("Organization not found.", 404);
    await client.query("COMMIT");
    return { id: tenantId, name: tenant.name };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof PlatformAdministrationError) throw error;
    throw new PlatformAdministrationError("The organization could not be deleted. No user accounts were removed.", 500);
  } finally {
    storageClient?.destroy();
    client.release();
  }
}

