CREATE TABLE IF NOT EXISTS vehicle_maintenance (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  vehicle_id uuid NOT NULL,
  intervention_date date NOT NULL,
  location_type text NOT NULL CHECK (location_type IN ('internal', 'external')),
  garage_name text,
  work_performed text NOT NULL CHECK (length(trim(work_performed)) BETWEEN 1 AND 4000),
  parts_used text CHECK (parts_used IS NULL OR length(trim(parts_used)) <= 4000),
  status text NOT NULL CHECK (status IN ('active', 'cancelled')) DEFAULT 'active',
  cancellation_reason text,
  cancelled_by_user_id text,
  cancelled_at timestamptz,
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT vehicle_maintenance_vehicle_tenant_fk
    FOREIGN KEY (vehicle_id, tenant_id) REFERENCES vehicle(id, tenant_id),
  CONSTRAINT vehicle_maintenance_creator_tenant_fk
    FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES "user"(id, "tenantId"),
  CONSTRAINT vehicle_maintenance_canceller_tenant_fk
    FOREIGN KEY (cancelled_by_user_id, tenant_id) REFERENCES "user"(id, "tenantId"),
  CONSTRAINT vehicle_maintenance_location_garage_check CHECK (
    (location_type = 'internal' AND garage_name IS NULL)
    OR (location_type = 'external' AND garage_name IS NOT NULL
      AND length(trim(garage_name)) BETWEEN 1 AND 180)
  ),
  CONSTRAINT vehicle_maintenance_outcome_check CHECK (
    (status = 'active' AND cancellation_reason IS NULL AND cancelled_by_user_id IS NULL AND cancelled_at IS NULL)
    OR (status = 'cancelled' AND cancellation_reason IS NOT NULL
      AND length(trim(cancellation_reason)) BETWEEN 1 AND 1000
      AND cancelled_by_user_id IS NOT NULL AND cancelled_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_maintenance_id_tenant_unique
  ON vehicle_maintenance (id, tenant_id);
CREATE INDEX IF NOT EXISTS vehicle_maintenance_vehicle_history_idx
  ON vehicle_maintenance (tenant_id, vehicle_id, intervention_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS maintenance_invoice (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  maintenance_id uuid NOT NULL,
  storage_key text NOT NULL UNIQUE,
  file_name text NOT NULL CHECK (length(trim(file_name)) BETWEEN 1 AND 180),
  file_extension text NOT NULL CHECK (file_extension IN ('pdf', 'png', 'jpg', 'jpeg', 'docx')),
  content_type text NOT NULL CHECK (content_type IN (
    'application/pdf', 'image/png', 'image/jpeg',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  file_size bigint NOT NULL CHECK (file_size > 0 AND file_size <= 15728640),
  uploaded_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT maintenance_invoice_event_tenant_fk
    FOREIGN KEY (maintenance_id, tenant_id) REFERENCES vehicle_maintenance(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT maintenance_invoice_uploader_tenant_fk
    FOREIGN KEY (uploaded_by_user_id, tenant_id) REFERENCES "user"(id, "tenantId"),
  CONSTRAINT maintenance_invoice_one_per_event UNIQUE (tenant_id, maintenance_id)
);

CREATE INDEX IF NOT EXISTS maintenance_invoice_parent_idx
  ON maintenance_invoice (tenant_id, maintenance_id);
