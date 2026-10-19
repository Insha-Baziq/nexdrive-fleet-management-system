ALTER TABLE driver_document
  DROP CONSTRAINT IF EXISTS driver_document_category_check;

ALTER TABLE driver_document
  ADD CONSTRAINT driver_document_category_check
    CHECK (category IN ('driving_licence', 'identity_document', 'carte_vitale', 'contract', 'other'));
