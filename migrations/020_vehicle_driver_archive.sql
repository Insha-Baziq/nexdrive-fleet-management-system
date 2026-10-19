ALTER TABLE vehicle
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE driver
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS vehicle_active_tenant_created_idx
  ON vehicle (tenant_id, created_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS driver_active_tenant_name_idx
  ON driver (tenant_id, full_name, id)
  WHERE archived_at IS NULL;
