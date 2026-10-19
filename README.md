# NexDrive web app

This is the Phase One organization app. It uses Next.js, shadcn/ui, Better Auth, and the project Neon PostgreSQL database.

## Local setup

1. Install packages with `npm install`.
2. Copy `.env.example` to `.env.local` and fill in values from your secure environment configuration. Keep real credentials out of Git.
3. Run `npm run dev` and open `http://localhost:3000/login`.

The Better Auth schema is captured in `auth-schema.sql`. On an empty database, apply it with `npx auth@latest migrate --config ./src/lib/auth.ts --yes`, then run the tenant, vehicle, driver, and mileage-nullability migrations in order:

```text
node --env-file=.env.local scripts/apply-tenant-migration.mjs
node --env-file=.env.local scripts/apply-vehicle-migration.mjs
node --env-file=.env.local scripts/apply-driver-migration.mjs
node --env-file=.env.local scripts/apply-vehicle-mileage-migration.mjs
node --env-file=.env.local scripts/apply-assignment-migration.mjs
```

These migrations have been applied to the configured Neon database.

## Transactional email

Password reset and organization invitation email use Gmail SMTP from server-side code. For the dedicated Gmail sender account, enable 2-Step Verification and create a Google app password. Add these variable names to the ignored `.env.local` file for local verification and to the Oussbena Vercel project's server environment for deployment:

```env
GMAIL_SMTP_USER=
GMAIL_SMTP_APP_PASSWORD=
GMAIL_SMTP_FROM=
```

`BETTER_AUTH_URL` must contain the app's public origin; invitation and reset links use that configured origin. Never put SMTP credentials in source files, client variables, or logs. Gmail's app password is required for live delivery; the automated checks use a fake transport.

With the app running, `npm run verify:assignments` checks assignment creation, two-sided reassignment, history, concurrency, database constraints, tenant isolation and role access using disposable records that it cleans up afterward.

With the app running, `npm run verify:auth` creates a random temporary tenant administrator, checks that anonymous workspace access and public sign-up are blocked, signs in through Better Auth, checks the protected workspace, signs out, and deletes the temporary records. It does not provision a lasting organization user.

For the complete local delivery regression, start the app at `http://localhost:3000`, configure the database, authentication, and private Tigris storage values in `.env.local`, then run `npm run verify:final`. It runs the completed Phase One ticket suites and the additional onboarding, account, import, inspection, company-settings, personal-document, and platform-administration verifiers. It checks the local login pages first and refuses non-local app URLs. See [the regression test plan](docs/regression-testing.md) for the feature and upload coverage map and individual commands.

Organization access follows account creation, organization onboarding, and invitation acceptance. An account may hold memberships in several organizations, each with its own role. The login page has no tenant selector; the active organization comes from the authenticated account's enabled, server-validated selected membership. An account without an enabled membership is denied organization workspace access.

## Private vehicle documents

Vehicle document content uses a private Tigris bucket through its S3-compatible endpoint. Create a private bucket and a bucket-scoped access key with read/write access, then add these settings to `.env.local` and the deployment environment:

```env
TIGRIS_BUCKET=your-private-bucket-name
TIGRIS_ACCESS_KEY_ID=your-bucket-access-key-id
TIGRIS_SECRET_ACCESS_KEY=your-bucket-secret-access-key
# Optional; defaults to https://t3.storage.dev
TIGRIS_ENDPOINT=https://t3.storage.dev
```

Keep credentials out of source files and Git. Configure bucket CORS to allow `POST` from the app's exact local and production origins, so the browser can submit and read the private upload response. Keep public access disabled. Run `npm run db:migrate:vehicle-documents` after the tenant, vehicle, and user schema migrations. Files are limited to PDF, PNG, JPG/JPEG, and DOCX, up to 15 MB per file; the server verifies the stored object before exposing its metadata or content.
