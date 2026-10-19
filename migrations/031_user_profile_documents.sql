CREATE TABLE IF NOT EXISTS user_document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  category text NOT NULL DEFAULT 'general' CHECK (category = 'general'),
  storage_key text NOT NULL UNIQUE,
  pending_storage_key text UNIQUE,
  file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 180),
  file_extension text NOT NULL CHECK (file_extension IN ('pdf', 'png', 'jpg', 'jpeg', 'docx')),
  content_type text NOT NULL,
  file_size bigint NOT NULL CHECK (file_size > 0 AND file_size <= 15728640),
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'ready')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  uploaded_at timestamptz,
  upload_expires_at timestamptz NOT NULL,
  CONSTRAINT user_document_owner_tenant_fk
    FOREIGN KEY (user_id, tenant_id) REFERENCES "user"(id, "tenantId") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS user_document_owner_idx
  ON user_document (tenant_id, user_id, status, created_at DESC);
