CREATE TABLE IF NOT EXISTS fine_steps (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  fine_id uuid NOT NULL,
  step_type text NOT NULL CHECK (step_type IN ('designation', 'contestation', 'response', 'payment')),
  step_date date NOT NULL,
  note text CHECK (note IS NULL OR length(note) <= 2000),
  response_positive boolean,
  designated_driver_id uuid,
  proof_document_id uuid NOT NULL,
  actor_user_id text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fine_steps_parent_tenant_fk
    FOREIGN KEY (fine_id, tenant_id) REFERENCES fine(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fine_steps_driver_tenant_fk
    FOREIGN KEY (designated_driver_id, tenant_id) REFERENCES driver(id, tenant_id),
  CONSTRAINT fine_steps_actor_tenant_fk
    FOREIGN KEY (actor_user_id, tenant_id) REFERENCES "user"(id, "tenantId"),
  CONSTRAINT fine_steps_response_value_check
    CHECK ((step_type = 'response' AND response_positive IS NOT NULL)
      OR (step_type <> 'response' AND response_positive IS NULL)),
  CONSTRAINT fine_steps_designated_driver_check
    CHECK ((step_type = 'designation' AND designated_driver_id IS NOT NULL)
      OR (step_type <> 'designation' AND designated_driver_id IS NULL)),
  CONSTRAINT fine_steps_id_tenant_fine_unique UNIQUE (id, tenant_id, fine_id)
);

CREATE TABLE IF NOT EXISTS fine_step_evidence (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  fine_id uuid NOT NULL,
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
  CONSTRAINT fine_step_evidence_step_tenant_fk
    FOREIGN KEY (step_id, tenant_id, fine_id)
    REFERENCES fine_steps(id, tenant_id, fine_id) ON DELETE CASCADE,
  CONSTRAINT fine_step_evidence_fine_tenant_fk
    FOREIGN KEY (fine_id, tenant_id) REFERENCES fine(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fine_step_evidence_uploader_tenant_fk
    FOREIGN KEY (uploaded_by_user_id, tenant_id) REFERENCES "user"(id, "tenantId"),
  CONSTRAINT fine_step_evidence_one_per_step UNIQUE (step_id),
  CONSTRAINT fine_step_evidence_id_tenant_fine_step_unique UNIQUE (id, tenant_id, fine_id, step_id)
);

ALTER TABLE fine_steps DROP CONSTRAINT IF EXISTS fine_steps_proof_fk;
ALTER TABLE fine_steps ADD CONSTRAINT fine_steps_proof_fk
  FOREIGN KEY (proof_document_id, tenant_id, fine_id, id)
  REFERENCES fine_step_evidence(id, tenant_id, fine_id, step_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS fine_steps_tenant_parent_order_idx
  ON fine_steps (tenant_id, fine_id, step_date, created_at, id);
CREATE INDEX IF NOT EXISTS fine_step_evidence_tenant_parent_idx
  ON fine_step_evidence (tenant_id, fine_id, step_id);
