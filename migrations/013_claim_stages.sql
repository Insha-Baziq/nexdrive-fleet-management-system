ALTER TABLE claim DROP CONSTRAINT IF EXISTS claim_status_check;
ALTER TABLE claim ADD CONSTRAINT claim_status_check CHECK (status IN ('open', 'closed', 'cancelled', 'archived'));

CREATE TABLE IF NOT EXISTS claim_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES tenant(id),
  claim_id uuid NOT NULL,
  step_type text NOT NULL CHECK (step_type IN (
    'declared', 'garage_designated', 'expert_scheduled', 'expert_completed',
    'quote_received', 'repair_completed', 'closed', 'cancelled', 'archived'
  )),
  step_date date NOT NULL,
  note text CHECK (note IS NULL OR length(note) <= 2000),
  proof_document_id uuid,
  actor_user_id text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT claim_steps_parent_tenant_fk FOREIGN KEY (claim_id, tenant_id)
    REFERENCES claim(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT claim_steps_id_tenant_parent_unique UNIQUE (id, tenant_id, claim_id),
  CONSTRAINT claim_steps_cancel_reason CHECK (
    step_type <> 'cancelled' OR (note IS NOT NULL AND length(trim(note)) BETWEEN 1 AND 1000)
  )
);

CREATE INDEX IF NOT EXISTS claim_steps_timeline_idx
  ON claim_steps (tenant_id, claim_id, step_date, created_at, id);

CREATE TABLE IF NOT EXISTS claim_step_evidence (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  claim_id uuid NOT NULL,
  step_id uuid NOT NULL,
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
  CONSTRAINT claim_step_evidence_step_fk FOREIGN KEY (step_id, tenant_id, claim_id)
    REFERENCES claim_steps(id, tenant_id, claim_id) ON DELETE CASCADE,
  CONSTRAINT claim_step_evidence_one_per_step UNIQUE (step_id),
  CONSTRAINT claim_step_evidence_parent_unique UNIQUE (id, step_id, tenant_id, claim_id)
);

ALTER TABLE claim_steps DROP CONSTRAINT IF EXISTS claim_steps_proof_fk;
ALTER TABLE claim_steps ADD CONSTRAINT claim_steps_proof_fk
  FOREIGN KEY (proof_document_id, id, tenant_id, claim_id)
  REFERENCES claim_step_evidence(id, step_id, tenant_id, claim_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS claim_step_evidence_parent_idx
  ON claim_step_evidence (tenant_id, claim_id, step_id);

INSERT INTO claim_steps (tenant_id, claim_id, step_type, step_date, note, actor_user_id, created_at)
SELECT c.tenant_id, c.id, 'declared', c.incident_date, 'Claim declared.', c.created_by_user_id, c.created_at
FROM claim c
WHERE NOT EXISTS (
  SELECT 1 FROM claim_steps s WHERE s.tenant_id = c.tenant_id AND s.claim_id = c.id AND s.step_type = 'declared'
);
