CREATE TABLE IF NOT EXISTS tenant (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_tenant_fk'
  ) THEN
    ALTER TABLE "user"
      ADD CONSTRAINT user_tenant_fk
      FOREIGN KEY ("tenantId") REFERENCES tenant(id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_app_role_check'
  ) THEN
    ALTER TABLE "user"
      ADD CONSTRAINT user_app_role_check
      CHECK (
        "appRole" IS NULL OR "appRole" IN
          ('administrator', 'fleet_manager', 'manager', 'driver')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS user_tenant_idx ON "user" ("tenantId");
