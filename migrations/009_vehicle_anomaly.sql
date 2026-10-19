CREATE TABLE IF NOT EXISTS vehicle_anomaly (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  vehicle_id uuid NOT NULL,
  observed_date date NOT NULL,
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 4000),
  status text NOT NULL CHECK (status IN ('open', 'resolved', 'cancelled')) DEFAULT 'open',
  reported_by_user_id text NOT NULL,
  resolution_reason text,
  closed_by_user_id text,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT vehicle_anomaly_vehicle_tenant_fk
    FOREIGN KEY (vehicle_id, tenant_id) REFERENCES vehicle(id, tenant_id),
  CONSTRAINT vehicle_anomaly_reporter_tenant_fk
    FOREIGN KEY (reported_by_user_id, tenant_id) REFERENCES "user"(id, "tenantId"),
  CONSTRAINT vehicle_anomaly_closer_tenant_fk
    FOREIGN KEY (closed_by_user_id, tenant_id) REFERENCES "user"(id, "tenantId"),
  CONSTRAINT vehicle_anomaly_outcome_check CHECK (
    (status = 'open' AND resolution_reason IS NULL AND closed_by_user_id IS NULL AND closed_at IS NULL)
    OR
    (status IN ('resolved', 'cancelled') AND resolution_reason IS NOT NULL
      AND length(trim(resolution_reason)) BETWEEN 1 AND 1000
      AND closed_by_user_id IS NOT NULL AND closed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_anomaly_id_tenant_unique
  ON vehicle_anomaly (id, tenant_id);

CREATE INDEX IF NOT EXISTS vehicle_anomaly_tenant_status_date_idx
  ON vehicle_anomaly (tenant_id, status, observed_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS vehicle_anomaly_vehicle_idx
  ON vehicle_anomaly (tenant_id, vehicle_id, observed_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS anomaly_photo (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  anomaly_id uuid NOT NULL,
  storage_key text NOT NULL UNIQUE,
  file_name text NOT NULL CHECK (length(trim(file_name)) BETWEEN 1 AND 180),
  file_extension text NOT NULL CHECK (file_extension IN ('png', 'jpg', 'jpeg')),
  content_type text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg')),
  file_size bigint NOT NULL CHECK (file_size > 0 AND file_size <= 15728640),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT anomaly_photo_anomaly_tenant_fk
    FOREIGN KEY (anomaly_id, tenant_id) REFERENCES vehicle_anomaly(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS anomaly_photo_parent_idx
  ON anomaly_photo (tenant_id, anomaly_id, created_at);
