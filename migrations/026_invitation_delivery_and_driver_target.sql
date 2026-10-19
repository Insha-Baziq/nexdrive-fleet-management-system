CREATE UNIQUE INDEX IF NOT EXISTS driver_id_tenant_unique
  ON driver (id, tenant_id);

ALTER TABLE organization_invitation
  ADD COLUMN IF NOT EXISTS email_delivery_status text NOT NULL DEFAULT 'not_sent',
  ADD COLUMN IF NOT EXISTS email_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_last_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS target_driver_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organization_invitation_delivery_status_check'
  ) THEN
    ALTER TABLE organization_invitation
      ADD CONSTRAINT organization_invitation_delivery_status_check
      CHECK (email_delivery_status IN ('not_sent', 'sent', 'failed'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organization_invitation_target_driver_same_tenant'
  ) THEN
    ALTER TABLE organization_invitation
      ADD CONSTRAINT organization_invitation_target_driver_same_tenant
      FOREIGN KEY (target_driver_id, tenant_id) REFERENCES driver (id, tenant_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS organization_invitation_target_driver_idx
  ON organization_invitation (tenant_id, target_driver_id)
  WHERE target_driver_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS driver_password_reset_attempt (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL,
  actor_user_id text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivery_status text NOT NULL CHECK (delivery_status IN ('sent', 'failed')),
  CONSTRAINT driver_password_reset_attempt_driver_same_tenant
    FOREIGN KEY (driver_id, tenant_id) REFERENCES driver (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT driver_password_reset_attempt_actor_same_tenant
    FOREIGN KEY (actor_user_id, tenant_id) REFERENCES "user" (id, "tenantId") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS driver_password_reset_attempt_recent_idx
  ON driver_password_reset_attempt (tenant_id, driver_id, attempted_at DESC);
