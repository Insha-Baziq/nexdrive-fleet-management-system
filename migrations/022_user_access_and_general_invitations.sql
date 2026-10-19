ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "accountDisabledAt" timestamptz;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "lastSeenAt" timestamptz;

ALTER TABLE organization_invitation ALTER COLUMN email DROP NOT NULL;
ALTER TABLE organization_invitation ADD COLUMN IF NOT EXISTS code_ciphertext text;
ALTER TABLE organization_invitation ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE organization_invitation ADD COLUMN IF NOT EXISTS revoked_by_user_id text;
CREATE INDEX IF NOT EXISTS organization_invitation_active_idx
  ON organization_invitation (tenant_id, created_at DESC)
  WHERE used_at IS NULL AND revoked_at IS NULL;
