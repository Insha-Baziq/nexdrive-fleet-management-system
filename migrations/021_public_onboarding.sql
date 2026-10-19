ALTER TABLE tenant ADD COLUMN IF NOT EXISTS country_code text NOT NULL DEFAULT 'FR';
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Europe/Paris';
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS currency_code text NOT NULL DEFAULT 'EUR';

CREATE TABLE IF NOT EXISTS organization_invitation (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('administrator', 'fleet_manager', 'manager', 'driver')),
  code_hash text NOT NULL UNIQUE,
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  accepted_by_user_id text
);

CREATE INDEX IF NOT EXISTS organization_invitation_tenant_idx
  ON organization_invitation (tenant_id, created_at DESC);
