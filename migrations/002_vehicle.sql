CREATE TABLE IF NOT EXISTS vehicle (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  registration text NOT NULL,
  make text NOT NULL,
  model text NOT NULL,
  year integer,
  current_mileage integer NOT NULL DEFAULT 0 CHECK (current_mileage >= 0),
  technical_inspection_date date,
  insurance_company text,
  insurance_expiry_date date,
  bonus_malus numeric(5, 2),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_tenant_registration_unique
  ON vehicle (tenant_id, upper(registration));
CREATE INDEX IF NOT EXISTS vehicle_tenant_created_idx
  ON vehicle (tenant_id, created_at DESC);
