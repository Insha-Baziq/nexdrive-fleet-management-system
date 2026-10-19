ALTER TABLE tenant ADD COLUMN IF NOT EXISTS legal_name text;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS siret text;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS vat_number text;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS registered_address text;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS administrative_contact_name text;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS administrative_contact_email text;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS administrative_contact_phone text;

-- Existing organization names are the safest editable starting value for the
-- new legal-name field. New tenants fall back to tenant.name until saved.
UPDATE tenant SET legal_name = name WHERE legal_name IS NULL;
