CREATE TABLE IF NOT EXISTS vehicle_inspection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES tenant(id),
  vehicle_id uuid NOT NULL,
  technical_due_date date NOT NULL,
  emissions_due_date date,
  source text NOT NULL DEFAULT 'staff' CHECK (source IN ('legacy', 'staff')),
  recorded_by_user_id text,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT vehicle_inspection_staff_recorder_check
    CHECK (source = 'legacy' OR recorded_by_user_id IS NOT NULL),
  CONSTRAINT vehicle_inspection_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT vehicle_inspection_vehicle_tenant_fk
    FOREIGN KEY (vehicle_id, tenant_id) REFERENCES vehicle(id, tenant_id),
  CONSTRAINT vehicle_inspection_recorder_tenant_fk
    FOREIGN KEY (recorded_by_user_id, tenant_id) REFERENCES "user"(id, "tenantId")
);

CREATE INDEX IF NOT EXISTS vehicle_inspection_vehicle_history_idx
  ON vehicle_inspection (tenant_id, vehicle_id, recorded_at DESC, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_inspection_one_legacy_per_vehicle_idx
  ON vehicle_inspection (tenant_id, vehicle_id) WHERE source = 'legacy';

-- Retain each existing technical due date as an identifiable starting point.
-- Legacy rows have no reliable actor and therefore leave recorded_by_user_id null.
INSERT INTO vehicle_inspection
  (tenant_id, vehicle_id, technical_due_date, source, recorded_at)
SELECT tenant_id, id, technical_inspection_date, 'legacy', COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
FROM vehicle
WHERE technical_inspection_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM vehicle_inspection i
    WHERE i.tenant_id = vehicle.tenant_id AND i.vehicle_id = vehicle.id AND i.source = 'legacy'
  );
