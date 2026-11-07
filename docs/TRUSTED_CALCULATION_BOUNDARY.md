# Trusted calculation boundary — local milestone

Connected approval now sends a saved project revision to a server adapter, receives a calculation run ID, and approves that ID. The browser still runs the same planner for draft previews and exports. Sample rehearsal approval remains in browser session storage with its existing synthetic labels.

`server/trustedCalculation.js` is the adapter. Its authenticated context verifies the caller with Supabase Auth, loads kitchen membership, then reads the project and approved recipes through the caller's scoped client. It invokes the unchanged `buildPlan` reference engine. A separate server-only writer creates a job and inserts one completed run. A database trigger completes the job in the same transaction as the run insert. Status reads and approval use the caller's scoped client, with owner/manager approval enforced again in PostgreSQL.

Migration `20261106203519_trusted_calculation_runs.sql` adds:

- Tenant-scoped jobs, unique by kitchen, project, project revision and idempotency key. Concurrent duplicates return the existing job/run; running and failed duplicates do not restart work.
- Completed runs with immutable output, engine version, source revision and job linkage. Only `service_role` may insert worker records; ordinary authenticated sessions have member-scoped read access only.
- A nullable historical `calculation_run_id` on packages. New package inserts require a completed current-revision run. The trigger rejects any supplied browser snapshot and derives the approved snapshot from the trusted run. Incomplete runs cannot be approved. Existing package history remains readable without backfilling it as trusted evidence.
- Composite tenant/source foreign keys, explicit grants, member RLS and indexes for source and membership predicates.

The worker identity is trusted to execute the engine correctly. SQL checks source identity, approved recipe rows and project revision; SQL does not independently recompute costing or scheduling. Worker credentials remain outside browser code. This milestone introduces no Python calculation implementation.

## Development seam and pending integration

Vite mounts same-origin, loopback-only POST routes under `/api/local-calculation`: `/calculate`, `/status` and `/approve`. All accept the access token only in the Authorization header. Calculation requests accept `clientId`, `projectId`, `projectRevision` and `idempotencyKey`; status accepts `clientId` and `jobId`; approval accepts `clientId` and `runId`. Browser `ready`, costs, schedules, recipe arrays and snapshots are rejected.

The default adapter stays disabled until **a disposable local Supabase instance** is explicitly configured with server-only `CABIJ_CALCULATION_SUPABASE_URL`, `CABIJ_CALCULATION_PUBLISHABLE_KEY` and `CABIJ_CALCULATION_WORKER_KEY`. The URL must use HTTP and a loopback hostname. It does not reuse the configured hosted database or any existing integration credentials. These settings have not been created or changed. Without configuration, connected approval reports that trusted calculation is unavailable; there is no browser-snapshot fallback.

Hosted migration/application, a deployed worker, worker identity provisioning, production request routing and real authenticated Supabase HTTP acceptance remain pending. A production adapter can call `trustedCalculation` with a verified scoped context and a privately provisioned writer. Do not point this development route at a hosted database by weakening its local guard.

The browser repository now uses a stable `reviewed-evidence-v1:reference-v3:<project ID>:<revision>` idempotency key. A failed job or interrupted worker is retained for inspection; retries with the same key return that outcome. Save a new project revision before requesting another calculation. Durable queuing, automatic retries and recovery/leases are intentionally outside this first boundary. The later [ingredient and price evidence milestone](INGREDIENT_MATCHING_PRICE_EVIDENCE.md) replaces browser-entered costing inputs with explicitly selected reviewed evidence and requires that policy for new approvals.

## Local verification

Run `node --test src/operations/__tests__/trustedCalculation.test.js`, then `npm test` and `npm run build`.

For SQL verification, create an empty disposable PostgreSQL cluster. Never run the synthetic bootstrap against hosted Supabase. Run the existing sequence in `OPERATIONS_MILESTONE.md`, including the recipe, operations, subrecipe, owner-onboarding and workflow-import tests, **before** applying the new calculation migration. The older operations test exercises the previous browser-snapshot contract as historical migration evidence. Then run:

```
psql <disposable-local-connection> -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20261106203519_trusted_calculation_runs.sql \
  -f supabase/tests/trusted_calculation_runs.sql
```

The updated disposable bootstrap creates a synthetic `service_role` with `BYPASSRLS` to model the server writer; it creates no login or secret. The new SQL test rolls back fixtures. It checks tenant isolation, staff member reads, denied browser writes, duplicate keys, atomic job completion, immutable completed runs, stale job/completion/approval revisions, manager/owner authority and forged browser readiness/cost/schedule rejection.

The Node contracts check saved-source calculation, scoped Auth/reads, output rejection, concurrent duplicates, failed jobs, stale completion, missing-price blocking, role checks, source-only browser requests and the local Vite handler. These are local contract and database checks; they do not establish deployed or hosted end-to-end readiness.

Verified on 2026-11-06: all existing disposable SQL checks and the new boundary SQL check passed; focused Node contracts passed 17/17; full `npm test` passed canonical 8, operations 91 and legacy 118; `npm run build`, focused ESLint and `git diff --check` passed. The build retains its existing Browserslist-age and chunk-size warnings. No hosted migration, external delivery or credential change was performed.
