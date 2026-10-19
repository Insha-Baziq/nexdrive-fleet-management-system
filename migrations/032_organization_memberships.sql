BEGIN;

CREATE TABLE IF NOT EXISTS organization_membership (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  tenant_id text NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('administrator','fleet_manager','manager','driver')),
  display_name text NOT NULL,
  disabled_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS organization_membership_tenant_idx ON organization_membership(tenant_id, role);

INSERT INTO organization_membership(user_id, tenant_id, role, display_name, disabled_at, last_seen_at)
SELECT id, "tenantId", "appRole", name, "accountDisabledAt", "lastSeenAt" FROM "user"
WHERE "tenantId" IS NOT NULL AND "appRole" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Retain compatibility with existing provisioning scripts while authorization
-- exclusively reads membership rows. Legacy columns are never switched.
CREATE OR REPLACE FUNCTION nexdrive_legacy_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."tenantId" IS NOT NULL AND NEW."appRole" IS NOT NULL THEN
    INSERT INTO organization_membership(user_id, tenant_id, role, display_name, disabled_at, last_seen_at)
    VALUES(NEW.id, NEW."tenantId", NEW."appRole", NEW.name, NEW."accountDisabledAt", NEW."lastSeenAt")
    ON CONFLICT(user_id, tenant_id) DO UPDATE SET role=EXCLUDED.role,
      display_name=EXCLUDED.display_name, disabled_at=EXCLUDED.disabled_at;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS nexdrive_legacy_membership ON "user";
CREATE TRIGGER nexdrive_legacy_membership AFTER INSERT OR UPDATE OF "tenantId", "appRole", "accountDisabledAt"
ON "user" FOR EACH ROW EXECUTE FUNCTION nexdrive_legacy_membership();

-- Retarget every composite user/tenant FK, retaining its delete behavior.
DO $$
DECLARE item record; definition text;
BEGIN
  FOR item IN
    SELECT c.conname, c.conrelid::regclass AS relation, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    WHERE c.contype='f' AND c.confrelid='"user"'::regclass AND cardinality(c.confkey)=2
  LOOP
    definition := regexp_replace(item.definition, 'REFERENCES "user"\(id, "tenantId"\)',
      'REFERENCES organization_membership(user_id, tenant_id)');
    IF definition = item.definition THEN RAISE EXCEPTION 'Unrecognized tenant FK: %', item.conname; END IF;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', item.relation, item.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', item.relation, item.conname, definition);
  END LOOP;
END $$;
ALTER TABLE driver DROP CONSTRAINT IF EXISTS driver_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS driver_user_per_tenant_unique ON driver(tenant_id, user_id) WHERE user_id IS NOT NULL;
COMMIT;
