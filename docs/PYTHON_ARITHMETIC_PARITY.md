# Python arithmetic shadow, stage 4

`worker/arithmetic.py` is an offline deterministic shadow implementation of the arithmetic in `src/operations/engine.js` (engine v3) and `src/operations/yield.js`. It is **not enabled in the dashboard, server calculation adapter, approval path or exports**. JavaScript remains authoritative. There is no model call, network access, credential, database write or dependency installation.

Run from the repository root with Python 3.10 or newer:

```sh
npm run test:python
npm run test:parity
python3 -m worker.arithmetic < request.json
```

The CLI reads one JSON request from standard input (maximum 4 MiB) and emits one JSON response. The request contains `schemaVersion: 1`, `clientId`, `project`, approved `versions`, and an optional `conversions` array of `{quantity, from, to}`. Inputs follow the current saved operations-project shape, rather than a new public API. Worker output identifies `engineVersion: python-arithmetic-shadow-v1`, `referenceEngineVersion: 3`, and `mode: shadow`. A malformed/unsupported request returns an error and a nonzero process status. Python tests and the CLI use only the standard library.

## What is compared

- Approved tenant-scoped recipe selection, target scaling, recursive sub-recipes, shared purchasing demand, explicit product form, cycles and current expansion limits.
- Same-domain mass, volume and count conversion. Count and portions remain separate. There is no inferred density, cup weight, mass-to-volume conversion or ingredient yield.
- Prepared versus as-purchased ingredients, reviewed purchase-yield factors, consolidated base units, supplier pack conversion, pack count, purchasing surplus, ingredient consumption cost and purchase cost.
- Allocation of ingredient consumption cost to menu roots, per-portion cost, food-cost percentage and gross margin.
- Source quantity reconciliation, measured versus provisional yield stages, mass gain, projected versus actual event quantities, whole portions, remainders and allocation differences.
- Arithmetic exceptions, their order, code, severity, source evidence and displayed explanation.

Scheduling, task expansion, staff/equipment allocation, calendar timezone handling, plan readiness, authorization and approval are outside this parity contract. Reviewed-price selection/security is upstream: these fixtures use synthetic project prices after selection. Passing these checks does not prove Python can replace the full calculation engine or safely process real supplier evidence.

## Decimal and rounding policy

Decimal arithmetic uses 50 significant digits inside a local context; persisted numeric strings retain their decimal values. JSON numeric values enter through their standard Python representation. The JSON result is converted to finite ordinary numbers for comparison. No currency rounding is added: the existing engine retains unrounded consumption costs and margins, while purchase cost uses the integer pack count.

To preserve current behavior, displayed required quantity, surplus and recipe targets round to six decimal places. Pack counts use `ceil(round6(required / packSize))`; `round6` uses the reference engine's positive epsilon and ties toward positive infinity. This can leave a tiny shortfall for ratios less than half a millionth above a pack boundary. The below/above-boundary fixtures deliberately preserve and expose this rule; changing it requires a separate authority/rounding decision. Whole portions use `floor((usable + 1e-8) / portionWeight)`. Yield formulas display grams to three places and percentages to two, without altering their numeric results.

For numeric arithmetic results the parity bound is `abs(JS - Python) <= max(1e-6, 1e-12 * max(abs(JS), abs(Python)))`. Pack counts and source/projected/actual portion counts are exact. All strings, booleans, nulls, object shape, ordering and exception decisions must match exactly. In particular, `null` cost or unknown yield cannot pass as zero. `PRICE REQUIRED` and `YIELD REQUIRED` remain visible; actual measured zero is valid data. Floating-point artifacts such as `105.60000000000001` versus decimal `105.6` are accepted, without changing decisions.

## Pinned evidence and change control

`src/operations/fixtures/arithmetic/v1.json` contains synthetic inputs and expected results pinned from JS engine v3. The parity test first compares current JavaScript to those stored results exactly, then runs a fresh Python process and compares its results using the bounds above. A reference change therefore fails before Python comparison; it cannot silently update its own expected outputs.

Fixtures cover baseline costing, fractional targets, prepared purchase yields, nested shared demand, distinct forms, cycles, foreign recipes, missing quantities, unsupported units, stale/missing/unreviewed/incompatible pack prices, a free price, the six-decimal pack boundary, missing recipe yield, zero/oversize targets, measured mass gain, absent yield stages, invalid actuals and actual zero. Tests also deliberately inject numeric/type/null/shape mismatches to verify that the comparator detects them.

To deliberately regenerate expectations after reviewing a reference change:

```sh
node tools/parity/pinArithmeticFixtures.js
```

Review the fixture diff and rerun both test commands. Never regenerate fixtures merely to make a mismatch disappear. Results prove agreement for these cases and tolerances, not universal numerical equivalence or readiness for live worker authority. No shadow diagnostics are persisted to production tables; the versioned fixture and test output provide local evidence without creating another state store. Runtime shadow jobs, durable retry leases, production parsing limits and full-engine parity remain later milestones.
