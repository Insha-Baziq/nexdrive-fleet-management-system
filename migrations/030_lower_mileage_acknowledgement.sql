ALTER TABLE vehicle_mileage_reading
  ADD COLUMN IF NOT EXISTS lower_reading_acknowledged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS compared_with_reading_id uuid;

ALTER TABLE vehicle_mileage_reading DROP CONSTRAINT IF EXISTS lower_mileage_acknowledgement_check;
ALTER TABLE vehicle_mileage_reading ADD CONSTRAINT lower_mileage_acknowledgement_check
  CHECK (NOT lower_reading_acknowledged OR compared_with_reading_id IS NOT NULL);
