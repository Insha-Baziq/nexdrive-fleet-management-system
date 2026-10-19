ALTER TABLE vehicle_document
  DROP CONSTRAINT IF EXISTS vehicle_document_category_check;

ALTER TABLE vehicle_document
  ADD CONSTRAINT vehicle_document_category_check
  CHECK (category IN ('registration', 'inspection', 'insurance', 'rental_agreement', 'other'));
