ALTER TABLE vehicle_document
  ADD COLUMN IF NOT EXISTS pending_storage_key text;

ALTER TABLE vehicle_document
  DROP CONSTRAINT IF EXISTS vehicle_document_status_check;
ALTER TABLE vehicle_document
  ADD CONSTRAINT vehicle_document_status_check
  CHECK (status IN ('pending', 'processing', 'ready'));

ALTER TABLE vehicle_document
  DROP CONSTRAINT IF EXISTS vehicle_document_ready_uploaded_check;
ALTER TABLE vehicle_document
  ADD CONSTRAINT vehicle_document_ready_uploaded_check
  CHECK (status <> 'ready' OR (uploaded_at IS NOT NULL AND pending_storage_key IS NULL));

ALTER TABLE vehicle_document
  DROP CONSTRAINT IF EXISTS vehicle_document_pending_key_check;
ALTER TABLE vehicle_document
  ADD CONSTRAINT vehicle_document_pending_key_check
  CHECK (status <> 'ready' OR pending_storage_key IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_document_pending_storage_key_unique
  ON vehicle_document (pending_storage_key) WHERE pending_storage_key IS NOT NULL;
