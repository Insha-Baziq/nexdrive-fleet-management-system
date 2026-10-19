ALTER TABLE vehicle
  ADD COLUMN IF NOT EXISTS ownership_type text,
  ADD COLUMN IF NOT EXISTS registered_holder text;

ALTER TABLE vehicle DROP CONSTRAINT IF EXISTS vehicle_ownership_type_check;
ALTER TABLE vehicle ADD CONSTRAINT vehicle_ownership_type_check
  CHECK (ownership_type IS NULL OR ownership_type IN ('owned', 'long_term_rental', 'short_term_rental', 'loan'));

ALTER TABLE vehicle DROP CONSTRAINT IF EXISTS vehicle_registered_holder_check;
ALTER TABLE vehicle ADD CONSTRAINT vehicle_registered_holder_check
  CHECK (
    ownership_type IS NULL
    OR ownership_type = 'owned'
    OR (registered_holder IS NOT NULL AND length(btrim(registered_holder)) > 0)
  );
