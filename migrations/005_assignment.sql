CREATE UNIQUE INDEX IF NOT EXISTS vehicle_id_tenant_unique ON vehicle (id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS driver_id_tenant_unique ON driver (id, tenant_id);

CREATE TABLE IF NOT EXISTS assignment (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  vehicle_id uuid NOT NULL,
  driver_id uuid NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  start_reason text,
  end_reason text,
  created_by_user_id text NOT NULL,
  ended_by_user_id text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT assignment_valid_interval CHECK (ended_at IS NULL OR ended_at > started_at),
  CONSTRAINT assignment_end_reason CHECK (ended_at IS NULL OR (end_reason IS NOT NULL AND length(trim(end_reason)) > 0)),
  CONSTRAINT assignment_vehicle_tenant_fk FOREIGN KEY (vehicle_id, tenant_id) REFERENCES vehicle(id, tenant_id),
  CONSTRAINT assignment_driver_tenant_fk FOREIGN KEY (driver_id, tenant_id) REFERENCES driver(id, tenant_id),
  CONSTRAINT assignment_creator_tenant_fk FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES "user"(id, "tenantId"),
  CONSTRAINT assignment_ender_tenant_fk FOREIGN KEY (ended_by_user_id, tenant_id) REFERENCES "user"(id, "tenantId")
);

CREATE UNIQUE INDEX IF NOT EXISTS assignment_one_active_vehicle
  ON assignment (tenant_id, vehicle_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS assignment_one_active_driver
  ON assignment (tenant_id, driver_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS assignment_vehicle_history
  ON assignment (tenant_id, vehicle_id, started_at DESC);
CREATE INDEX IF NOT EXISTS assignment_driver_history
  ON assignment (tenant_id, driver_id, started_at DESC);
