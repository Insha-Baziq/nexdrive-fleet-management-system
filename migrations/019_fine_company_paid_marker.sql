CREATE TABLE IF NOT EXISTS fine_company_paid_markers (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  fine_id uuid NOT NULL,
  context text NOT NULL CHECK (length(trim(context)) BETWEEN 1 AND 2000),
  proof_document_id uuid NOT NULL,
  recorded_by_user_id text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fine_company_paid_marker_fine_tenant_fk
    FOREIGN KEY (fine_id, tenant_id) REFERENCES fine(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fine_company_paid_marker_actor_tenant_fk
    FOREIGN KEY (recorded_by_user_id, tenant_id) REFERENCES "user"(id, "tenantId"),
  CONSTRAINT fine_company_paid_marker_one_per_fine UNIQUE (fine_id),
  CONSTRAINT fine_company_paid_marker_id_tenant_fine_unique UNIQUE (id, tenant_id, fine_id)
);

CREATE TABLE IF NOT EXISTS fine_company_paid_marker_evidence (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  fine_id uuid NOT NULL,
  marker_id uuid NOT NULL,
  storage_key text NOT NULL UNIQUE,
  file_name text NOT NULL CHECK (length(trim(file_name)) BETWEEN 1 AND 180),
  file_extension text NOT NULL CHECK (file_extension IN ('pdf', 'png', 'jpg', 'jpeg', 'docx')),
  content_type text NOT NULL CHECK (content_type IN (
    'application/pdf', 'image/png', 'image/jpeg',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  file_size bigint NOT NULL CHECK (file_size BETWEEN 1 AND 15728640),
  uploaded_by_user_id text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fine_company_paid_marker_evidence_marker_tenant_fk
    FOREIGN KEY (marker_id, tenant_id, fine_id)
    REFERENCES fine_company_paid_markers(id, tenant_id, fine_id) ON DELETE CASCADE,
  CONSTRAINT fine_company_paid_marker_evidence_fine_tenant_fk
    FOREIGN KEY (fine_id, tenant_id) REFERENCES fine(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fine_company_paid_marker_evidence_uploader_tenant_fk
    FOREIGN KEY (uploaded_by_user_id, tenant_id) REFERENCES "user"(id, "tenantId"),
  CONSTRAINT fine_company_paid_marker_evidence_one_per_marker UNIQUE (marker_id),
  CONSTRAINT fine_company_paid_marker_evidence_id_tenant_fine_marker_unique UNIQUE (id, tenant_id, fine_id, marker_id)
);

ALTER TABLE fine_company_paid_markers DROP CONSTRAINT IF EXISTS fine_company_paid_marker_proof_fk;
ALTER TABLE fine_company_paid_markers ADD CONSTRAINT fine_company_paid_marker_proof_fk
  FOREIGN KEY (proof_document_id, tenant_id, fine_id, id)
  REFERENCES fine_company_paid_marker_evidence(id, tenant_id, fine_id, marker_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS fine_company_paid_marker_tenant_fine_idx
  ON fine_company_paid_markers (tenant_id, fine_id);
CREATE INDEX IF NOT EXISTS fine_company_paid_marker_evidence_tenant_fine_idx
  ON fine_company_paid_marker_evidence (tenant_id, fine_id);
