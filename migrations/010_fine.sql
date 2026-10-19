CREATE TABLE IF NOT EXISTS fine (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  vehicle_id uuid NOT NULL,
  reference text NOT NULL CHECK (length(trim(reference)) BETWEEN 1 AND 100),
  fine_type text NOT NULL CHECK (fine_type IN ('company', 'driver')),
  infraction_at timestamptz NOT NULL,
  payment_deadline date NOT NULL,
  description text CHECK (description IS NULL OR length(description) <= 4000),
  amount numeric(12, 2) CHECK (amount IS NULL OR amount >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled')),
  created_by_user_id text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fine_vehicle_tenant_fk FOREIGN KEY (vehicle_id, tenant_id) REFERENCES vehicle(id, tenant_id),
  CONSTRAINT fine_tenant_reference_unique UNIQUE (tenant_id, reference),
  CONSTRAINT fine_id_tenant_unique UNIQUE (id, tenant_id)
);

CREATE INDEX IF NOT EXISTS fine_tenant_created_idx ON fine (tenant_id, infraction_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS fine_tenant_status_deadline_idx ON fine (tenant_id, status, payment_deadline);

CREATE TABLE IF NOT EXISTS fine_evidence (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  fine_id uuid NOT NULL,
  storage_key text NOT NULL UNIQUE,
  file_name text NOT NULL CHECK (length(trim(file_name)) BETWEEN 1 AND 180),
  file_extension text NOT NULL CHECK (file_extension IN ('pdf', 'png', 'jpg', 'jpeg', 'docx')),
  content_type text NOT NULL CHECK (content_type IN ('application/pdf', 'image/png', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  file_size bigint NOT NULL CHECK (file_size BETWEEN 1 AND 15728640),
  uploaded_by_user_id text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fine_evidence_parent_tenant_fk FOREIGN KEY (fine_id, tenant_id) REFERENCES fine(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fine_evidence_one_per_fine UNIQUE (fine_id)
);

CREATE INDEX IF NOT EXISTS fine_evidence_parent_tenant_idx ON fine_evidence (tenant_id, fine_id);
