CREATE TABLE IF NOT EXISTS vehicle_document (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  vehicle_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  category text NOT NULL CHECK (category IN ('registration', 'inspection', 'insurance', 'other')),
  expiry_date date,
  visible_to_driver boolean NOT NULL,
  storage_key text NOT NULL UNIQUE,
  pending_storage_key text,
  file_name text NOT NULL,
  file_extension text NOT NULL CHECK (file_extension IN ('pdf', 'png', 'jpg', 'jpeg', 'docx')),
  content_type text NOT NULL CHECK (content_type IN ('application/pdf', 'image/png', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  file_size bigint NOT NULL CHECK (file_size > 0 AND file_size <= 15728640),
  status text NOT NULL CONSTRAINT vehicle_document_status_check
    CHECK (status IN ('pending', 'processing', 'ready')) DEFAULT 'pending',
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  uploaded_at timestamptz,
  upload_expires_at timestamptz NOT NULL,
  CONSTRAINT vehicle_document_vehicle_tenant_fk
    FOREIGN KEY (vehicle_id, tenant_id) REFERENCES vehicle(id, tenant_id),
  CONSTRAINT vehicle_document_creator_tenant_fk
    FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES "user"(id, "tenantId"),
  CONSTRAINT vehicle_document_ready_uploaded_check
    CHECK (status <> 'ready' OR (uploaded_at IS NOT NULL AND pending_storage_key IS NULL)),
  CONSTRAINT vehicle_document_pending_key_check
    CHECK (status <> 'ready' OR pending_storage_key IS NULL)
);

CREATE INDEX IF NOT EXISTS vehicle_document_vehicle_list_idx
  ON vehicle_document (tenant_id, vehicle_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS vehicle_document_expired_pending_idx
  ON vehicle_document (upload_expires_at) WHERE status = 'pending';
