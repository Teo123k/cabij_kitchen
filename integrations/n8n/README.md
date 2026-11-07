# n8n integration boundary

The checked-in workflow templates are not copied blindly into V1. Each workflow is rebuilt against the contracts in this repository so that local n8n state, credentials, Drive folders, and webhook URLs do not become product dependencies.

## WF1: recipe intake

Input must validate against `contracts/recipe-intake-v1.schema.json`. The workflow creates a draft recipe version only. It cannot publish an approved version.

## WF2: prep profile

WF2 receives a pinned recipe version and approved knowledge IDs. It may write a reviewed prep-profile candidate, never alter recipe ingredients, yield, or price evidence.

## WF3: extended profile

WF3 is optional enrichment. Its output is review-only and cannot block the basic recipe → scale → prep → export path.

## Required safeguards

- Authenticate the webhook and derive `client_id` from the caller's server-side membership, not request JSON.
- Use the idempotency key on every external retry.
- Store source references and evidence IDs with every generated candidate.
- Keep Drive files private; use a server-side download credential instead of public links.
- Return a visible error packet for every rejected or incomplete input.
