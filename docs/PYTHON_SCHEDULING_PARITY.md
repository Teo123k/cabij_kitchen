# Python scheduling shadow, stage 5

`worker/scheduling.py` reproduces the scheduling behavior of the existing JavaScript engine v3 in `src/operations/engine.js`, `prepDates.js` and `scheduleEvidence.js`. The source of its rules is that implementation and the recorded project/recipe inputs. It adds no culinary knowledge, AI estimates or new safety policy.

This module is an offline shadow. JavaScript remains authoritative for the dashboard, calculation adapter, approval and exports. No production module imports the Python scheduler or its comparison harness. There is no database write, network request, model call, credential or new dependency. This milestone proves agreement on pinned synthetic cases; it does not make the full system client-ready.

## Run and contract

Run from the repository root with Python 3.10 or newer:

```sh
npm run test:parity:scheduling
npm run test:parity
npm run test:python
python3 -m worker.scheduling < request.json
```

The CLI accepts one UTF-8 JSON request on stdin, up to 4 MiB, with `schemaVersion: 1`, `clientId`, `project` and `versions`. These follow the existing saved operations shapes. The output identifies `engineVersion: python-scheduling-shadow-v1`, `referenceEngineVersion: 3` and `mode: shadow`. Malformed JSON, non-finite JSON constants, unsupported schema versions and oversized input return a JSON error and nonzero exit status. Persisted scalar quantities and durations retain the reference engine's numeric coercions.

The `scheduling` result contains `workDays`, `tasks`, `schedule`, `unscheduled`, scheduling-only `exceptions`, and `evidence`. It intentionally contains no full-plan `ready`, approval role, approval timestamp, costing or delivery state. Scheduling exceptions omit mixed-engine exception IDs and actions; code, problem, evidence, severity and relative scheduling order are exact. Recipe/source/cost/yield exceptions remain in the arithmetic/full-engine contract. An empty task list is not a successful readiness claim.

## Rules reproduced

- Approved versions from the requested tenant only; source menu traversal, shared nested demand, cycle avoidance and existing scale/depth limits determine tasks. Shared sub-recipes are produced once for combined demand; every parent batch waits for all sub-recipe end tasks. Existing duplicate dependency IDs are retained.
- Every source batch expands into its reviewed production steps, including partial batches. Active and passive durations remain full-length for partial batches. Event overrides retain source version, source step index and original equipment ID as provenance.
- Explicit prep days before service use their recorded dated staff/equipment arrays, or inherit service-day arrays when absent. Duplicate dates keep the first row, future/invalid dates are excluded, and dates use fixed 1440-minute offsets from service day. An explicitly empty resource array stays empty.
- Normal/high/urgent priority is stable within source order. Urgent dependents promote their prerequisites. Priority does not remove dependencies or resource constraints.
- Advance tasks require a recorded reviewed storage, holding and handover reference. Invalid or absent working windows, missing upstream allocations, unusable durations and missing/undersized equipment preserve distinct unscheduled reasons.
- Search starts at the maximum of working-day start, dependency finish and optional task earliest time. It ends at the minimum of service deadline, working-day end and optional task latest time. Each task takes the first feasible whole-minute start and first eligible person in the recorded staff order.
- Chef role, explicit assignee, shift, break and existing active allocations are checked. Passive time releases labour. Equipment opening hours and summed capacity reserve active plus passive duration. Zero active time creates no active-labour overlap.
- Every searched task retains earliest/latest, upstream end times and counts of candidate starts rejected for staff, equipment hours or equipment capacity. Tasks rejected before search retain the original explicit reason and do not fabricate a placement trace.
- Evidence independently rechecks task coverage, working windows, durations, recipe sources, dependencies, staff/breaks, active overlap, advance review, equipment capacity and reviewed timings. Task evidence preserves recipe version, source references, scaling, batch, timing provenance, priority and allocation explanation. Evidence wording matches the current JavaScript report exactly.

## Compatibility details

Scheduling uses Python binary64 floats in the same operation order as JavaScript for demand accumulation and the six-decimal task quantity rounding. Batch counts and evidence text are exact decisions: for example, accumulating `0.1 + 0.2` must retain the reference's `0.30000000000000004`. Decimal costing remains owned by `worker/arithmetic.py`; shared unit definitions and scalar parsing are reused. These are distinct temporary parity contracts, not independent production authorities. Combining them requires a later reviewed full-worker contract and an explicit decision about legacy numerical quirks.

The current engine can allocate a blank active component as zero, or fractional components whose sum is an integer, while still recording a blocking `DURATION REVIEW REQUIRED` exception. Source-step review cannot be replaced by an override. This port preserves those behaviors visibly; allocation alone must never be used as approval. Likewise a review flag is not evidence that time was physically measured. Pinned fixtures cover all of these cases.

A named equipment label in task evidence currently comes from the service-day inventory, falling back to the equipment ID for prep-day-only equipment. Allocation validation uses the dated inventory correctly. This existing presentation limitation is preserved rather than changing client output during parity work.

## Pinned evidence and change control

`src/operations/fixtures/scheduling/v1.json` pins synthetic inputs and expected JavaScript results. Node tests first compare the current JS engine and evidence report to those expected results, then run a fresh Python process and compare every result exactly. Times, counts, task identity, nulls, object keys, ordering, exceptions, provenance, checks and explanatory strings have no tolerance. The comparator is separately tested against deliberately wrong timing, identity, order, shape and evidence.

Fixtures cover baseline and partial batches, shared nested recipes, cycles, tenant filtering, empty menus, priority propagation, role restrictions, explicit assignees, breaks, passive release, capacity contention/parallelism, equipment hours and mapping, deadlines, task windows, missing/fractional/negative timing, review overrides, multi-day dependencies, advance references, dated resources, duplicate/future/invalid days, source numeric strings, binary64 accumulation and the 500-task cap. Python tests also tamper with allocations to prove the independent evidence checks detect staff overlap, equipment overload, dependency and working-window violations.

Expectations are only updated deliberately:

```sh
node tools/parity/pinSchedulingFixtures.js
```

Read the input/reference change and review the fixture diff before repinning. Tests never regenerate expectations. For a rule change, first establish the desired JavaScript behavior and source/evidence expectations; then port and verify it. Do not repin only to conceal a mismatch.

## Limits and next gate

This is the current greedy earliest-feasible planner, not a global optimiser. A failed search does not prove a feasible or better schedule cannot exist. Agreement between implementations does not prove recipe accuracy, physically measured durations or kitchen feasibility. A kitchen manager must still validate source recipes and rehearse real work.

The planner does not independently establish food-safety compliance, cooling/holding policy, overnight execution, off-site travel or unrecorded cleanup. Advance reference review records a human decision rather than validating its safety. Each project is planned separately; cross-project resource conflicts still require combined-calendar review. Dates are local wall-clock days with fixed offsets; DST transitions and conversion to timezone-aware UTC intervals are outside this parity contract.

The authority switch, durable worker queue/retries, full-plan readiness reconciliation, authenticated staging acceptance, final exports and Slack delivery remain later integration gates. Replace the JavaScript authority only after those gates are verified; retain a documented rollback path and remove the temporary reference implementation after controlled acceptance.
