CREATE TABLE IF NOT EXISTS claim (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  vehicle_id uuid NOT NULL,
  incident_date date NOT NULL,
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 4000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled')),
  created_by_user_id text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT claim_vehicle_tenant_fk FOREIGN KEY (vehicle_id, tenant_id) REFERENCES vehicle(id, tenant_id),
  CONSTRAINT claim_id_tenant_unique UNIQUE (id, tenant_id)
);

CREATE INDEX IF NOT EXISTS claim_tenant_incident_date_idx ON claim (tenant_id, incident_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS claim_tenant_vehicle_idx ON claim (tenant_id, vehicle_id, incident_date DESC);

CREATE TABLE IF NOT EXISTS claim_evidence (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  claim_id uuid NOT NULL,
  storage_key text NOT NULL UNIQUE,
  file_name text NOT NULL CHECK (length(trim(file_name)) BETWEEN 1 AND 180),
  file_extension text NOT NULL CHECK (file_extension IN ('pdf', 'png', 'jpg', 'jpeg', 'docx')),
  content_type text NOT NULL CHECK (content_type IN ('application/pdf', 'image/png', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  file_size bigint NOT NULL CHECK (file_size BETWEEN 1 AND 15728640),
  uploaded_by_user_id text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT claim_evidence_parent_tenant_fk FOREIGN KEY (claim_id, tenant_id) REFERENCES claim(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT claim_evidence_one_initial_per_claim UNIQUE (claim_id)
);

CREATE INDEX IF NOT EXISTS claim_evidence_parent_tenant_idx ON claim_evidence (tenant_id, claim_id);
