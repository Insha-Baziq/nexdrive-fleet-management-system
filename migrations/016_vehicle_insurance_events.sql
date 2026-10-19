CREATE TABLE IF NOT EXISTS vehicle_insurance_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES tenant(id),
  vehicle_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('suspension', 'unpaid')),
  event_date date NOT NULL,
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 4000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancellation_reason text,
  created_by_user_id text NOT NULL,
  cancelled_by_user_id text,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT vehicle_insurance_event_vehicle_tenant_fk
    FOREIGN KEY (vehicle_id, tenant_id) REFERENCES vehicle(id, tenant_id),
  CONSTRAINT vehicle_insurance_event_creator_tenant_fk
    FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES "user"(id, "tenantId"),
  CONSTRAINT vehicle_insurance_event_canceller_tenant_fk
    FOREIGN KEY (cancelled_by_user_id, tenant_id) REFERENCES "user"(id, "tenantId"),
  CONSTRAINT vehicle_insurance_event_cancellation_check CHECK (
    (status = 'active' AND cancellation_reason IS NULL AND cancelled_by_user_id IS NULL AND cancelled_at IS NULL)
    OR
    (status = 'cancelled' AND cancellation_reason IS NOT NULL
      AND length(trim(cancellation_reason)) BETWEEN 1 AND 1000
      AND cancelled_by_user_id IS NOT NULL AND cancelled_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_insurance_event_id_tenant_unique
  ON vehicle_insurance_event (id, tenant_id);
CREATE INDEX IF NOT EXISTS vehicle_insurance_event_vehicle_history_idx
  ON vehicle_insurance_event (tenant_id, vehicle_id, event_date DESC, created_at DESC, id DESC);
