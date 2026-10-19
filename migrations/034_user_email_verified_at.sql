ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS "emailVerifiedAt" timestamptz;
