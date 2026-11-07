# Client project workflow — local review

## Open the workspace

Run `npm run dev -- --host 127.0.0.1 --port 5174` and open:

- Sample rehearsal: http://127.0.0.1:5174/?workspace=projects&sample=true
- Connected project workspace: http://127.0.0.1:5174/?workspace=projects

The existing authenticated dashboard has a “Client projects” link. Without Supabase configuration, the app offers a sample workspace instead of failing at startup.

Sample records are synthetic. They persist in browser session storage only and are labelled in the workspace and exports. They do not write to Supabase. Close the browser session or remove `cabij-operations-sample-v1` from session storage to reset the rehearsal.

## Review sequence

1. Open the Berlin acceptance rehearsal. In Plan, confirm that 8.8 kg against 160 × 45 g raises a 1.6 kg difference. Approval remains blocked until a source-backed explanation is entered and reviewed. A clarification does not change either source quantity or claim measured waste.
2. In Recipes, change the target to 320 portions. Confirm that planned ingredients, purchasing packs and task batches update together.
3. In Resources, review staff roles, shifts, breaks, equipment slots and supplier price evidence. Remove a price review or use an old date; complete cost and package approval become unavailable.
4. In Plan, switch between master, named chef, dish and equipment views. Reassign a chef; incompatible roles produce an unscheduled task. Use “Task assignments & equipment” to map recipe equipment to another event's available equipment.
5. Set a deadline too close to the start. The planner reports that no feasible plan was found and blocks approval.
6. Restore valid resources and resolve blocking exceptions. Deliver → Approve & archive package. Download the workbook, source record, and open the print package.
7. Change the project after approval. The current output becomes a draft; prior approved packages remain available in history.
8. Create a second project. Enter its intake, use approved recipe versions, add staff/equipment/prices and map equipment where needed. No code or document-layout changes are required.

## Included implementation

- Ordinary manual recipe forms, canonical ingredient selection, source references, allergen/handling review and reviewed production steps.
- Draft → review → manager approval, using the existing immutable `recipe_versions_v1` contract. Corrections create new versions.
- Unit-compatible scaling, pinned nested recipes, shared ingredient consolidation, explicit purchase-yield conversion, pack rounding and surplus.
- Reviewed supplier evidence with currency/date checks; missing evidence blocks complete cost, per-portion and margin claims.
- Same-day rules-based scheduling: sequential recipe steps, child dependencies, full/partial source batches, named staff, skills, shifts, breaks, passive equipment occupancy, capacity and deadlines.
- One calculated plan feeds all schedule views, purchasing, recipe cards and exception outputs.
- Project saves with optimistic revision checks; manager-only immutable package snapshots. Snapshots contain project input, approved recipe records, price evidence, calculated quantities and task allocations.
- A4 landscape print HTML (browser Print / Save PDF), Excel-compatible SpreadsheetML `.xml` workbook with numeric cells and purchasing formulas, and JSON source record. Workbook edits are offline copies; they do not update the saved project or approved schedules.

## Local evidence

- `npm run test:operations`: 64 passing tests covering acceptance scenarios A–H plus missing-data, nesting, margin, conversion, reassignment, export and second-event checks.
- `npm run test:contract`: existing canonical recipe contract.
- `npm run test:legacy`: 118 checks. The former external backup test now uses a synthetic repository-owned fixture with semicolons and escaped quotes.
- `npm run lint`: zero errors; existing style debt remains as warnings rather than triggering unrelated source rewrites.
- `npm run build`: production build. No deployment is performed.
- Browser review: sample intake, reconciliation, approval, workbook download, print package, retained package history, a second event created from blank intake through approval/export and reopening, desktop and 390px mobile layout. Screenshots are under `output/playwright/`.
- Disposable PostgreSQL: existing recipe security test, project/package isolation, revision conflicts, role checks, immutable package permissions, approved child pinning and foreign-child rejection.

To reproduce database checks, initialize a disposable PostgreSQL cluster and run these files in order against an empty database with `psql -v ON_ERROR_STOP=1`:

1. `supabase/tests/local_bootstrap.sql`
2. `supabase/017_v1_recipe_truth.sql`
3. `supabase/migrations/20261106123633_operations_projects.sql`
4. `supabase/tests/recipe_version_security.sql`
5. `supabase/tests/operations_security.sql`
6. `supabase/tests/operations_subrecipes.sql`
7. `supabase/migrations/20261106142024_owner_onboarding.sql`
8. `supabase/migrations/20261106142249_kitchen_access_indexes.sql`
9. `supabase/tests/owner_onboarding.sql`

The bootstrap creates synthetic auth roles/users and must never run against a live Supabase project.

## Connected Supabase setup

The active Supabase project `cabij_os` (`lyqkmxqiiutcbgivypjx`) is now configured locally in the ignored `.env.local` file using its publishable key. The root URL opens the connected project workspace; `/?workspace=projects&sample=true` remains the separate synthetic rehearsal.

Hosted migrations created the six recipe/membership/price foundation tables, two operations tables, and the private owner-onboarding table. Those nine tables have RLS enabled. The later workflow-import table also has RLS enabled. A follow-up migration added foreign-key indexes and cached `auth.uid()` lookups in the project/package policies. The private onboarding table intentionally has no client policies or grants.

The administrator-authorised owner invitation is for `cabij.co@gmail.com` in kitchen `cabij`. Create an account through the local dashboard and confirm that email, then return to the dashboard and sign in. The private trigger grants owner membership only after email confirmation. Signup metadata cannot select an owner role or claim another kitchen. A claimed invitation cannot be transferred to another auth user.

There is no password in repository configuration or chat. Account registration and confirmation must be completed by the user. If the confirmation link returns to a different configured redirect URL, return manually to http://127.0.0.1:5174/ and sign in after confirming. Hosted email delivery and redirect behaviour have not been exercised during setup.

Hosted recipe/project/package/sub-recipe isolation and owner-onboarding tests passed inside rolled-back transactions, leaving no test users or project records. The public Data API was checked with the publishable key: anonymous project reads are denied. Auth settings confirm that email authentication and signup are available. The latest security adviser check reports that leaked-password protection is disabled in Auth; this setting has not been changed. The deny-by-default private table produces one expected informational no-policy notice. Performance warnings were resolved; unused-index information is expected on the empty database.

Slack authorisation was verified as active for Cabij-OS. The dashboard retains per-schedule channel selection. No live schedule was posted. Real owner sign-in, save/reopen, ingredient-catalog setup, client-account testing and a deliberately approved Slack delivery remain operator acceptance steps. The legacy recipe dashboard is available at `/?workspace=recipes` but its old source tables have not been migrated into this new database.

## Deliberate limits

This is an internal workflow with manual entry and saved WF1 recipe intake. Original document uploads/OCR are handled by the existing n8n workflow; its Google Drive credentials need repair before new uploads can be accepted. Dashboard upload intake, multi-day shifts, resource optimisation, arbitrary task graphs, actual-yield variance tracking and `.xlsx` generation remain later work. Direct recipe PDF downloads and detailed yield reporting are now included. The greedy planner can report “no feasible plan found” without proving global mathematical infeasibility. It supports up to 500 tasks, integer-minute timings, fixed source batch capacity and one equipment resource per step. Food handling and allergen information require operator review; this implementation does not validate food-safety policy automatically.

The browser runs deterministic draft previews. The local trusted-calculation milestone now requires new connected approvals to reference a server-written calculation run; browser snapshots cannot be approved after the additive migration. Its hosted integration is pending, and connected approval fails closed until a local worker is explicitly configured. See [TRUSTED_CALCULATION_BOUNDARY.md](TRUSTED_CALCULATION_BOUNDARY.md) for the adapter, migration, disposable tests and integration limits.

Hosted Supabase schema migrations have now been applied to the user-selected active project. The existing local n8n instance was started with its saved watchers enabled at the operator’s request. No workflow graph was changed, website deployed or client delivery performed.

## Calculation authority during migration

New client packages use `src/operations/engine.js` and approved recipe-version inputs. The old dashboard calculator remains available for existing work until its behaviour has equivalent reviewed coverage. Do not mix its heuristic outputs into an approved project package. The operations path does not read demo invoice defaults or category-based serving sizes.


## Slack handoff, direct recipe PDFs and yield detail

Open Deliver to use **Download recipe PDF** or **Team schedule in Slack**. A menu recipe can also be downloaded individually from its expanded recipe review row. PDFs contain source and scaled ingredient quantities, production method/timings, reviewed allergen/handling notes, source/version information and a detailed yield appendix. An embedded SIL OFL Noto Sans KR font preserves Korean and Latin text. The font loads only when exporting; downloaded PDFs subset it.

In Recipes → Create corrected version, enter the source batch's purchased, prepared, cooked and usable weights, finished portion grams, and each measurement's source and measured/assumed basis. Review the batch/ingredient scope. Corrections still create immutable new recipe versions. In Plan → Yield calculations & actual production, record this event's actual usable grams, actual portions and measurement evidence. Event actuals stay in the project, not in the reusable recipe.

Yield math shows each output/input percentage and signed net mass change, overall usable/purchased percentage, whole portions and remainder, scaled event projections, target-allocation differences, and actual-minus-projected grams/percentage. Added ingredients or liquids can legitimately produce a mass gain. Missing values are not zero, and arithmetic mass differences are not automatically waste. Dish-level yield percentages do not automatically apply again to ingredient purchasing factors.

Slack is accessed through the authenticated local Composio CLI. The local Vite middleware exposes connection/channel discovery and a manual sharing endpoint; no Slack secret is placed in browser code. Choose a channel for each schedule, preview its people/timings/equipment, and click Share approved schedule. Supplier prices and invoice data are excluded. The message names the selected event timezone, package ID and project revision.

Sharing requires a real persisted approved package and a verified manager membership from Supabase. The server fetches that package through the caller's scoped session rather than accepting an arbitrary browser message. Sample packages are preview/download-only. For multiple Slack accounts, set the optional server-only `CABIJ_SLACK_ACCOUNT` selector in `.env.local`. This is a local-computer integration, not a deployed webhook or two-way Slack task editor. Slack edits/acknowledgements do not update the approved plan.

The local journal in `.cabij-local/slack-deliveries.json` records package/channel receipts. Repeated sends return the existing receipt; uncertain outcomes block automatic retries. Do not run multiple local delivery-server processes, delete the journal, or manually retry an uncertain send without checking the destination. Deploying later will require moving this journal to transactional server storage.

Verification for this update: connected workspace/channel reads succeeded; browser PDF download succeeded; PDF pages and a 65-row pagination fixture were rendered/inspected with Korean text; calculations and mocked delivery/duplicate/uncertain-outcome guards are tested. No live Slack message was posted. Real owner sign-in and package posting remain pending account registration and confirmation. The existing production dependency audit also reports unrelated transitive advisories; jsPDF has no reported advisory in the checked audit.

## Login stability correction

Repeated Supabase `SIGNED_IN` events previously triggered a full-page reload in the operations entry point. Authentication now updates identity in place and fetches memberships/workspace data only when the user ID or kitchen changes. Duplicate sign-in and token-refresh events preserve the active project and unsaved edits. Startup responses are ignored after newer auth events or unmount, and a different account cannot render the prior account workspace.

Five auth regression tests cover recovery, repeated events, login after anonymous startup, stale responses after sign-out, account switching and unmount cleanup. An isolated browser test with mocked Auth/REST endpoints confirmed one initial page navigation and preservation of an unsaved project name after repeated sign-in and token-refresh events. No real account credentials were used or changed.


## Existing WF1 recipe connection

Open http://127.0.0.1:5174/ and sign in. In **Recipes → Existing n8n recipes**, click **Load WF1 recipe results**, choose a run and expand a recipe. **Save this output for review** stores the source in Supabase; **Create recipe draft from this output** opens the normal review form. Confirm canonical ingredient identities, quantities, source batch yield, allergens, handling and production steps before approval. The full method is retained in the draft and recipe PDF.

This connection reads the named `WF1 Final Contract Output` node from the latest 20 saved executions of existing workflow `18dB9W0oWRpTG8Bn`. It keeps ingredient rows, display precision and the full method; short prep summaries are never substituted for the method. WF1's `expected_portions` is an unverified hint, not a measured batch yield. Generated instructions and missing evidence are explicitly flagged. Runs with final output but downstream failures are labelled separately. Source output is evidence of what WF1 produced; accuracy against the original document still requires chef review.

The server-only `.env.local` settings are `CABIJ_N8N_DB_PATH` and `CABIJ_N8N_WORKFLOW_ID`. The local adapter uses read-only SQLite queries against the existing n8n store, without querying credentials or modifying workflows. The old n8n management API key returns 401; this adapter does not use it. Access requires a verified Supabase kitchen membership and is restricted to the loopback dashboard. This local integration is not a hosted n8n webhook.

Migration `20261106154312_workflow_recipe_imports.sql` creates `recipe_workflow_imports_v1`: tenant-scoped, append-only source records with creator attribution and a unique workflow/run/recipe identity. Repeat imports return the same record; changed source cannot overwrite saved evidence. New corrected recipe versions retain an import reference. Apply this migration after the foundation migrations; run `supabase/tests/workflow_recipe_imports.sql` against the disposable bootstrap or within its rolled-back hosted test transaction. The bootstrap itself must never run on hosted Supabase.

Verified: six real saved recipes were read from the existing WF1 final output; local and hosted import-table isolation/immutability tests passed; a mocked browser flow loaded an output, preserved `0.500 kg` and the full method, saved it for review, and opened a draft without inventing a batch yield. The full local suite passes. No real recipe import was inserted during verification, and no new source-file processing was triggered by the test.

Remaining operational blocker: the enabled Google Drive watchers report **“The OAuth client was deleted.”** Reconnect their Google Drive credential in http://127.0.0.1:5678/ before testing a new upload end to end. Existing saved results remain available. Watchers were deliberately left enabled per the operator's instruction. A successful fresh upload → WF1 output → real owner import/save/reopen still needs operator acceptance; neither original-document accuracy nor that full live path has been claimed as verified.


## Direct recipe upload

In the connected dashboard, open **Recipes → Upload a recipe**. Select a text PDF, Word `.docx`, `.txt` or `.md` file (up to 8 MB), then click **Generate standardised recipe**. The preview shows ingredient amounts, the full recognised method and review notes. Expand **Compare extracted source text** to check the original extraction. **Download draft recipe PDF** works directly from the preview; **Review & save recipe** opens the version editor. The preview is temporary until a valid reviewed draft is saved. Canonical identities and required recipe fields still need completion before saving through the existing version contract.

This direct local route does not require n8n or Google Drive. It uses Python 3 and Poppler's `pdftotext` (both available on this computer); Word extraction uses Python's standard library. Temporary originals are removed after extraction. The extracted source text and filename travel with the recipe draft and are retained in its recipe JSON after saving. Original document bytes are not archived by this route.

Standardisation is rules-based: one recipe per document, explicit amounts such as `500 g Chicken` or `Chicken 500 g`, decimal/simple/mixed/Unicode fractions, common yield forms and numbered methods. Heading-free simple recipes are supported through an explicitly flagged inferred section. Word tables with ingredient/amount cells are supported. Source yields such as `Yield: 10 portions` remain evidence requiring review, not measured yield records. Ambiguous yields/ranges, household-unit conversion, allergen candidates and handling prompts are retained with source line evidence and require chef confirmation; original text remains available for comparison. Scanned/image-only PDFs, photos, old `.doc` files and arbitrary multi-recipe layouts are not automatically interpreted. No AI generation or inferred missing cooking instructions are claimed for this local path.

Security: the upload endpoint reuses the loopback-only server, verifies Supabase identity and chef/manager/owner membership, enforces same-origin JSON requests, limits upload/text/XML sizes, uses fixed argument subprocesses with timeouts, and removes its private temporary directory on success or failure. The upload does not itself write a recipe or create a client delivery.

Verification: 64 operations tests pass, including document parsing, range/unknown protection, real Word-table extraction, real PDF text inspection, and an authenticated upload handler test with mocked membership responses and real text extraction. Browser tests with mocked backend responses verify file selection → preview → PDF download → editor, preserving the full method. The downloaded Korean-text PDF was rendered and both pages visually inspected. Actual owner upload/save/reopen remains an operator acceptance check.


## Larger, simpler kitchen dashboard and schedule evidence

The connected workspace now opens on **Recipes**, with upload first. Three main tabs cover **Recipes → Prep schedule → Review & export**. Service details and People & equipment remain secondary setup actions. Saved recipes, n8n intake and detailed yield measurements use expandable sections. Base text and input controls are 18px; phone schedule rows become task lists with 24px times, without a horizontal table for the core schedule.

After upload, **Review & save recipe** copies the full recognised method into editable prep steps. Numbered/bulleted source steps retain their text and continuation lines. Unstructured method text stays together. Roles and active/passive minutes remain blank until supplied by the chef. Each step can record a timing basis (kitchen trial, source document or chef estimate) and a timing-source reference; changing timing inputs clears that step's review flag. A reference is an operator statement, not independently verified proof.

Save and approve the recipe through its existing lifecycle. Open **Saved recipes & event menu**, then **Use in prep schedule** on an approved recipe. This adds the version to the event and opens the schedule. Portion recipes default to the event guest count; other units default to the source batch quantity. Confirm service details, available staff/skills/breaks, equipment slots and step timing. Inputs continue to regenerate the same plan used by all exports; no second scheduling calculator was introduced.

The **Why this schedule works** panel exposes nine recorded-input checks, batch calculations, source recipe/version/step, timing provenance and per-task placement traces. Missing timing sources remain prominent even if durations were marked reviewed. A pass confirms consistency of recorded allocations; it does not prove source accuracy, measured timing or food-safety compliance. Existing approved packages without placement traces explicitly report that the trace was not recorded.

Planner version 2 retains source step indexes and per-task earliest/latest search bounds, predecessor finish times and counts of candidate starts rejected because of staff availability, equipment hours or equipment capacity. Scheduling still uses the same whole-minute earliest-feasible algorithm and recorded staff order. Partial batches retain full reviewed step durations. This is a conservative planning convention, not a measured partial-batch time or proof of global optimality.

**Print schedule & evidence / save PDF** opens a focused printable report with the schedule, design basis, checks, task evidence, staff shifts/breaks, equipment availability/capacity and exceptions. The full workbook and print package also include evidence sections. Approved package snapshots retain the placement traces and source records; subsequent project changes do not rewrite them.

Verification: 64 operations tests plus the canonical contract and 118 legacy checks pass; lint has zero errors and 37 pre-existing warnings; build passes. Evidence tests deliberately introduce chef overlap, equipment overload, broken dependencies and a missed deadline, and verify that checks fail. A synthetic break delays the first task by 30 minutes and the placement trace records exactly 30 rejected candidate starts. An empty schedule makes no positive verification claim. Reports escape source text. Browser checks cover desktop and 390px phone layouts, upload preview/PDF/editor, three prep steps copied from the full method with blank durations, and the evidence panel. The sample evidence PDF is synthetic and does not establish operational readiness for client work.
