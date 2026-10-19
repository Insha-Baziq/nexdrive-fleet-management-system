-- Keep one explicit current status while preserving every insurance event.
ALTER TABLE vehicle_insurance_event
  DROP CONSTRAINT IF EXISTS vehicle_insurance_event_event_type_check;
ALTER TABLE vehicle_insurance_event
  ADD CONSTRAINT vehicle_insurance_event_event_type_check
  CHECK (event_type IN ('insured', 'suspension', 'unpaid'));

ALTER TABLE vehicle
  ADD COLUMN IF NOT EXISTS insurance_status text NOT NULL DEFAULT 'to_complete';

-- A legacy vehicle is marked insured only when the old record has both an
-- insurer and a coverage date that has not expired. Otherwise it remains
-- visibly incomplete until staff records a confirmed status.
UPDATE vehicle v
SET insurance_status = COALESCE(
  (
    SELECT CASE WHEN e.event_type = 'suspension' THEN 'suspended' ELSE e.event_type END
    FROM vehicle_insurance_event e
    WHERE e.tenant_id = v.tenant_id
      AND e.vehicle_id = v.id
      AND e.status = 'active'
    ORDER BY e.event_date DESC, e.created_at DESC, e.id DESC
    LIMIT 1
  ),
  CASE
    WHEN NULLIF(BTRIM(v.insurance_company), '') IS NOT NULL
      AND v.insurance_expiry_date >= CURRENT_DATE THEN 'insured'
    ELSE 'to_complete'
  END
);

ALTER TABLE vehicle
  DROP CONSTRAINT IF EXISTS vehicle_insurance_status_check;
ALTER TABLE vehicle
  ADD CONSTRAINT vehicle_insurance_status_check
  CHECK (insurance_status IN ('to_complete', 'insured', 'suspended', 'unpaid'));

COMMENT ON COLUMN vehicle.insurance_status IS
  'Current insurance state. Legacy rows require insurer plus unexpired coverage evidence to be inferred as insured.';
