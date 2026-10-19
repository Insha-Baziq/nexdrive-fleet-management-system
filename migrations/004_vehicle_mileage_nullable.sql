-- Run the backfill only while the previous not-null schema is still present.
-- Earlier core forms could not enter mileage, so their default zero meant unknown.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'vehicle'
      AND column_name = 'current_mileage'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE vehicle ALTER COLUMN current_mileage DROP NOT NULL;
    UPDATE vehicle SET current_mileage = NULL WHERE current_mileage = 0;
  END IF;
END $$;

ALTER TABLE vehicle ALTER COLUMN current_mileage DROP DEFAULT;
