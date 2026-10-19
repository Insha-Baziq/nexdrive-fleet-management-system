# NexDrive regression testing

The final local regression command is `npm run verify:final`. It runs each suite sequentially, stops at the first failure, and leaves the failing suite's output visible. It requires a running local app at `http://localhost:3000`, the local database configuration in `.env.local`, and the private Tigris bucket credentials used by the file tests. The runner checks the login and platform-login pages before creating fixtures and refuses non-local app URLs.

The feature verifiers use randomized temporary users, organizations, fleet records, and private objects. Each verifier is responsible for removing its fixtures. The app and database must be available throughout the run. Run the final command only against a local verification environment.

## Coverage in the final run

| Area | Regression coverage |
| --- | --- |
| Login and access | `verify:ticket-01`: anonymous denial, disabled direct signup, all four roles, persisted session identity, tenant/role tampering, fresh sign-in, and sign-out. |
| Account and organization lifecycle | `verify:onboarding`, `verify:ticket-users`, `verify:ticket-30`, and `verify:invitation-delivery`: account/organization creation, invitation confirmation and single use, role-scoped members, organization switching, suspension, and invitation email handling. |
| Profile and credentials | `verify:profile-settings`, `verify:password-recovery`, `verify:driver-password-reset`, and `verify:email`: profile edits, password change/reset, token expiry/reuse, session revocation, neutral failure responses, and email templates using controlled fake delivery. |
| Platform administration | `verify:ticket-platform-administration`: platform-only access, organization and global user directories, creation/deletion safeguards, and organization boundary checks. |
| Vehicles and drivers | `verify:ticket-02`, `verify:ticket-03`, and `verify:ticket-28-archive`: create/read/edit persistence, validation, role and tenant checks, archive/restore behavior, and historical references. |
| CSV/XLSX imports | `verify:vehicle-import` and `verify:driver-import`: template download, preview/commit, French headers, row and field validation, duplicates, atomic rejection, size/row limits, role restrictions, and tenant isolation. |
| Inspections and dashboard | `verify:vehicle-inspections`, `verify:ticket-20`, and `verify:ticket-21`: dated inspection history, staff attribution, alert thresholds, tenant-scoped counts, and in-app deadlines. |
| Assignments | `verify:ticket-04` through `verify:ticket-07` and `verify:ticket-24`: assignment/reassignment, Quick Assignment, closure reasons, journal, historical lookup boundaries, correction history, concurrency, and cardinality. |
| Anomalies | `verify:ticket-12` and `verify:ticket-13`: staff and driver reporting, photo evidence, lifecycle actions, assigned-vehicle scope, and role/tenant access. |
| Fines | `verify:ticket-14`, `verify:ticket-15`, `verify:ticket-25`, and `verify:ticket-26`: fine creation/status, historical driver association, timeline evidence, company-paid marker evidence, persistence, and access rules. |
| Claims | `verify:ticket-16` through `verify:ticket-18`: initial accident evidence, contacts, stage transitions/evidence, close/cancel behavior, and role/tenant boundaries. |
| Maintenance and insurance history | `verify:ticket-22` and `verify:ticket-23`: insurance events and maintenance history, including private invoice upload/content access. |
| Driver workspace and mileage | `verify:ticket-10`, `verify:ticket-11`, `verify:ticket-19`, and `verify:ticket-27`: assigned/unassigned workspace, permitted documents, mileage history and entry, and driver identity boundaries. |
| Company and copy | `verify:company-settings` and `verify:copy`: tenant-scoped organization details, admin-only edits, validation, and dynamic English/French labels and upload feedback. |

## Upload paths covered

| Upload path | Verifier |
| --- | --- |
| Vehicle documents (registration, inspection, insurance, rental agreement, other) | `verify:ticket-08` — private upload preparation, storage, completion, retrieval, expiry/visibility metadata, type/size/content validation, role, parent, and tenant checks. |
| Driver documents | `verify:ticket-09` — private upload, completion, retrieval, validation, record/tenant boundaries, and persistence. |
| Personal account documents | `verify:user-documents` — private upload/finalization, content integrity, owner-only list/open/delete, invalid file rejection, and cross-tenant isolation. |
| Anomaly photos | `verify:ticket-12` and `verify:ticket-13` — staff/driver upload, private content retrieval, invalid input, and record/tenant authorization. |
| Fine supporting evidence | `verify:ticket-14` — initial evidence upload and retrieval with fine authorization. |
| Fine timeline evidence | `verify:ticket-25` — step proof upload and retrieval with fine/step authorization. |
| Company-paid fine evidence | `verify:ticket-26` — marker evidence upload and retrieval with fine authorization. |
| Claim declaration evidence | `verify:ticket-16` — initial claim file upload/retrieval and role/tenant/parent enforcement. |
| Claim stage evidence | `verify:ticket-18` — stage evidence upload/retrieval and stage/claim/tenant enforcement. |
| Maintenance invoice | `verify:ticket-23` — invoice upload and private content access. |
| Vehicle CSV/XLSX import | `verify:vehicle-import` — multipart file parsing, preview/commit, malformed input, size/row limits, and atomicity. |
| Driver CSV/XLSX import | `verify:driver-import` — multipart file parsing, preview/commit, malformed input, size/row limits, and atomicity. |

All file-backed verifiers check authorization for protected content. They use temporary files and remove their private storage objects during cleanup.

## Run an individual feature verifier

Every entry above has a separate npm command. For example, `npm run verify:ticket-08` runs the vehicle-document suite, while `npm run verify:ticket-18` runs the claim-stage suite. The final runner is the full local delivery gate.

## Delivery checks outside the local regression command

The automated suites exercise server-rendered pages, APIs, database state, and private storage. Before delivery, also review the deployed UI at desktop and tablet widths for each role and manually exercise one real browser-to-private-storage upload. The existing browser helper is `scripts/verify-vehicle-document-upload-browser.js`; use it with a controlled QA account and vehicle, then remove the temporary document and private object. The Vercel-specific request-size behavior and production account provisioning must be checked against the deployment environment with its dedicated test identities; the final local runner intentionally refuses a deployment URL.

The final suite includes the platform-administration verifier even while its issue remains marked in progress. A passing final run is therefore a useful release gate for that work as well as the completed Phase One tickets.
