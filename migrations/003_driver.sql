CREATE UNIQUE INDEX IF NOT EXISTS user_id_tenant_unique
  ON "user" (id, "tenantId");

CREATE TABLE IF NOT EXISTS driver (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  user_id text UNIQUE,
  full_name text NOT NULL CHECK (length(trim(full_name)) > 0),
  licence_number text,
  licence_expiry_date date,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT driver_user_same_tenant FOREIGN KEY (user_id, tenant_id)
    REFERENCES "user" (id, "tenantId")
);

CREATE INDEX IF NOT EXISTS driver_tenant_name_idx
  ON driver (tenant_id, full_name, id);
