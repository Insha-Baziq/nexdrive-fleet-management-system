ALTER TABLE driver
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS street_number text,
  ADD COLUMN IF NOT EXISTS street_name text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS city text;

ALTER TABLE driver
  DROP CONSTRAINT IF EXISTS driver_street_number_length_check,
  DROP CONSTRAINT IF EXISTS driver_street_name_length_check,
  DROP CONSTRAINT IF EXISTS driver_postal_code_length_check,
  DROP CONSTRAINT IF EXISTS driver_city_length_check;

ALTER TABLE driver
  ADD CONSTRAINT driver_street_number_length_check
    CHECK (street_number IS NULL OR length(trim(street_number)) BETWEEN 1 AND 24),
  ADD CONSTRAINT driver_street_name_length_check
    CHECK (street_name IS NULL OR length(trim(street_name)) BETWEEN 1 AND 160),
  ADD CONSTRAINT driver_postal_code_length_check
    CHECK (postal_code IS NULL OR length(trim(postal_code)) BETWEEN 1 AND 24),
  ADD CONSTRAINT driver_city_length_check
    CHECK (city IS NULL OR length(trim(city)) BETWEEN 1 AND 120);
