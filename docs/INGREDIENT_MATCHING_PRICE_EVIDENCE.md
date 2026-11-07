# Exact ingredient matching and reviewed prices — local milestone

The existing foundation already stores canonical ingredient IDs, global aliases and tenant price rows. Its recipe approval guard checks canonical IDs/names, but aliases had no browser review lifecycle, price rows could not leave review through scoped writes, product form was absent from price evidence, and the planner consumed browser-entered `price.reviewed` flags. Durable document candidates now provide retained source rows for exact matching.

Migration `20261106205955_ingredient_matching_price_review.sql` adds tenant alias review, exact identity resolution and reviewed price lifecycle. No ingredient, conversion, supplier choice or price is generated. n8n remains an intake/orchestration source; no runtime AI or semantic matcher is introduced.

## Identity and product forms

`resolve_ingredient_identity_v1` runs as the caller and requires current kitchen membership. An explicit canonical ID must exist; an unknown supplied ID cannot fall back to another identity. Without an ID, only exact canonical names or approved global/kitchen aliases qualify. Matching ignores case and outer whitespace; it does not use fuzzy spelling, token similarity or semantic inference. Alias product forms must also match exactly under that normalization. Unknown, ambiguous, unreviewed or incompatible-form matches return `INGREDIENT REVIEW REQUIRED`.

Global catalog/aliases remain curated outside the browser. Approved global aliases cannot be rewritten. Tenant aliases begin in review with source evidence; chefs may propose them, while owners/managers approve or reject them. Reviewed rows are immutable. Conflicting exact mappings remain unresolved. Product form is retained separately: whole sesame is never substituted with ground sesame or another price form.

`operationsRepository.matchDocumentCandidate(candidateId)` loads the saved candidate through scoped access and resolves its retained rows through the SQL resolver. It returns a review draft with pinned `canonical_match` provenance and preserved document/checksum evidence. Unmatched identities remain blank/review-required; missing quantities and yield remain missing. The immutable extraction candidate is not rewritten. Recipe insertion validates any pinned match against the same resolver; existing manual recipes without pinned match metadata retain their normal validation/review path.

Repository methods `createAlias`/`reviewAlias` and `createPrice`/`reviewPrice` use scoped database writes. Database grants, RLS and triggers enforce roles and fix reviewer attribution. These methods do not approve recipe versions automatically. The connected dashboard exposes alias submission and manager review alongside retained document candidates. Operators can rerun exact matching after an alias is approved and open the resulting draft for recipe review.

## Price evidence selection

Price rows now include product form, creator and optional tenant-bound archived-document linkage. Owners/managers enter complete supplier/source/date/pack/currency evidence in `review`, then explicitly mark it `matched` or `rejected`. Reviewed rows cannot be changed or deleted; corrections create new rows. An explicitly reviewed zero price is valid. Missing, blank or unknown prices are never interpreted as zero.

Save explicit reviewed price IDs in the project document:

```json
{"priceEvidenceSelections":{"<canonical ID>|<product form>|<base unit>":"<reviewed price UUID>"}}
```

The key is the existing planner purchasing key, for example `white-sesame-fixture|whole|g`. The project is saved through the existing revision mechanism. No automatic cheapest/newest supplier is selected. Candidate price rows are available through the existing scoped `ingredient_price_evidence_v1` read policy.

`server/reviewedCalculation.js` derives demand with the unchanged reference engine, fetches selected tenant evidence through the caller's scoped client, and checks canonical identity, exact form, manager review, supplier/source, currency, pack values, source date and saved price-age policy. It uses the existing engine's conversion function, which rejects mass/volume/count/portion mismatches. The trusted calculation worker ignores browser-entered prices and review flags.

Unavailable, unreviewed, stale, future, incompatible or unselected prices produce `PRICE REQUIRED`, a reason and null costs. Incompatible units retain `UNIT CONVERSION REQUIRED` in the selection reason. The worker runs the existing planner with eligible reviewed prices, preserves the original saved project as `snapshot.project`, and pins the actual price inputs/full evidence rows into `snapshot.calculationInputs`. Purchasing rows retain their evidence IDs. Database run guards verify those reviewed evidence snapshots belong to the kitchen.

The repository idempotency key now starts `reviewed-evidence-v1:reference-v3:`. New package approvals require the reviewed-evidence policy, so an older unapproved calculation must be regenerated. Historical approved packages remain readable. Save a new project revision after changing selections or resolving a previously retained failed/incomplete calculation.

## Local verification and limits

Run `node --test src/operations/__tests__/ingredientEvidence.test.js src/operations/__tests__/trustedCalculation.test.js`, then `npm test`, `npm run build` and `git diff --check`.

Against the disposable bootstrap/migrations, run earlier boundary SQL tests before this additive migration, then apply it and run `supabase/tests/ingredient_matching_price_review.sql`. The older calculation SQL fixture intentionally represents the preceding pricing contract; it runs before this stricter policy. New SQL fixtures roll back and cover exact IDs/names/aliases/forms, unresolved ambiguity, source provenance, tenant isolation, chef denial, owner/manager review, terminal immutability, explicit zero prices and forged calculation price evidence.

Focused Node contracts cover saved-candidate matching, unknown quantities, evidence preservation, explicit selections, browser-price rejection, tenant/identity/form/date/currency/review failures, unit incompatibility and null-cost states. Existing engine/sample behavior remains unchanged; the trusted worker now uses reviewed evidence exclusively. The connected dashboard exposes price entry, manager review and explicit selection per purchasing key. Its draft preview uses the same deterministic evidence checks as the trusted calculator; the saved trusted run remains authoritative. The sample workspace retains its synthetic pricing flow. Hosted migration, real price imports, catalog curation and live end-to-end verification remain pending. No live Supabase, credentials, external messages or n8n changes were performed.


The document upload and original-download controls require the explicitly configured local document adapter. If it is unavailable, the dashboard reports the error and does not silently use the legacy non-durable upload route. A recipe draft still requires source, quantity, yield, allergen and handling review before approval.
