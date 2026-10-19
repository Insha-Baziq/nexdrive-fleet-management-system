CREATE TABLE IF NOT EXISTS claim_contacts (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  claim_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('insurer', 'expert', 'garage', 'other')),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  phone text CHECK (phone IS NULL OR length(trim(phone)) BETWEEN 1 AND 80),
  email text CHECK (email IS NULL OR length(trim(email)) BETWEEN 1 AND 254),
  note text CHECK (note IS NULL OR length(note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT claim_contact_parent_tenant_fk FOREIGN KEY (claim_id, tenant_id)
    REFERENCES claim(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS claim_contacts_parent_idx
  ON claim_contacts (tenant_id, claim_id, created_at, id);
