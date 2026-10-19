CREATE TABLE IF NOT EXISTS vehicle_mileage_reading (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  vehicle_id uuid NOT NULL,
  recorded_by_user_id text,
  reading_date date NOT NULL,
  mileage integer NOT NULL CHECK (mileage >= 0),
  note text CHECK (note IS NULL OR length(note) <= 500),
  status text NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'cancelled')),
  cancellation_reason text,
  cancelled_by_user_id text,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT vehicle_mileage_vehicle_tenant_fk
    FOREIGN KEY (vehicle_id, tenant_id) REFERENCES vehicle(id, tenant_id),
  CONSTRAINT vehicle_mileage_recorder_tenant_fk
    FOREIGN KEY (recorded_by_user_id, tenant_id) REFERENCES "user"(id, "tenantId"),
  CONSTRAINT vehicle_mileage_canceller_tenant_fk
    FOREIGN KEY (cancelled_by_user_id, tenant_id) REFERENCES "user"(id, "tenantId"),
  CONSTRAINT vehicle_mileage_cancellation_state CHECK (
    (status = 'valid' AND cancellation_reason IS NULL AND cancelled_by_user_id IS NULL AND cancelled_at IS NULL)
    OR
    (status = 'cancelled' AND cancellation_reason IS NOT NULL AND length(trim(cancellation_reason)) BETWEEN 1 AND 1000
      AND cancelled_by_user_id IS NOT NULL AND cancelled_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS vehicle_mileage_history_idx
  ON vehicle_mileage_reading (tenant_id, vehicle_id, reading_date DESC, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS vehicle_mileage_latest_valid_idx
  ON vehicle_mileage_reading (tenant_id, vehicle_id, reading_date DESC, created_at DESC, id DESC)
  WHERE status = 'valid';

-- The old field had no recorded date or author. Use its best available date,
-- preserve every non-null value (including zero), and identify the migrated row.
INSERT INTO vehicle_mileage_reading (
  id, tenant_id, vehicle_id, reading_date, mileage, note, status, created_at
)
SELECT gen_random_uuid(), v.tenant_id, v.id,
       COALESCE(v.updated_at, v.created_at, CURRENT_TIMESTAMP)::date,
       v.current_mileage,
       'Existing vehicle mileage migrated; date reflects the vehicle record update.',
       'valid', COALESCE(v.updated_at, v.created_at, CURRENT_TIMESTAMP)
FROM vehicle v
WHERE v.current_mileage IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM vehicle_mileage_reading existing
    WHERE existing.tenant_id = v.tenant_id
      AND existing.vehicle_id = v.id
      AND existing.recorded_by_user_id IS NULL
      AND existing.note = 'Existing vehicle mileage migrated; date reflects the vehicle record update.'
  );
