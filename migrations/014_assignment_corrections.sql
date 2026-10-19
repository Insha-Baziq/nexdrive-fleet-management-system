CREATE UNIQUE INDEX IF NOT EXISTS assignment_id_tenant_unique
  ON assignment (id, tenant_id);

CREATE TABLE IF NOT EXISTS assignment_correction (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  assignment_id uuid NOT NULL,
  corrected_by_user_id text NOT NULL,
  old_started_at timestamptz NOT NULL,
  old_ended_at timestamptz,
  new_started_at timestamptz NOT NULL,
  new_ended_at timestamptz,
  reason text NOT NULL,
  corrected_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT assignment_correction_reason CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  CONSTRAINT assignment_correction_old_interval CHECK (old_ended_at IS NULL OR old_ended_at > old_started_at),
  CONSTRAINT assignment_correction_new_interval CHECK (new_ended_at IS NULL OR new_ended_at > new_started_at),
  CONSTRAINT assignment_correction_assignment_tenant_fk
    FOREIGN KEY (assignment_id, tenant_id) REFERENCES assignment(id, tenant_id),
  CONSTRAINT assignment_correction_actor_tenant_fk
    FOREIGN KEY (corrected_by_user_id, tenant_id) REFERENCES "user"(id, "tenantId")
);

CREATE INDEX IF NOT EXISTS assignment_correction_history
  ON assignment_correction (tenant_id, assignment_id, corrected_at DESC);
