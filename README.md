# CABIJ Kitchen V1

Chef-first operating system for approved recipe versions, scaling, prep execution, reviewed cost evidence, and client-ready exports.

## Start here

- [V1 build sequence](docs/V1_BUILD_SEQUENCE.md)
- [Canonical recipe contract](src/core/canonicalRecipe.js)
- [Staging-only Supabase migration](supabase/017_v1_recipe_truth.sql)

The existing React app is the interface foundation. The new V1 contract is additive: it does not modify the existing `recipes` table or apply a database change automatically.

For a disposable staging project only, copy `.env.example` to `.env.local`, supply its URL and publishable/anon key, and set `VITE_ENABLE_RECIPE_V1=true`. Provision kitchen membership and canonical ingredients through an authorised administrator. The recipe version panel appears under Approvals. Existing app flows still use the legacy recipe source and are not yet connected to approved V1 versions.

The original app repository tracked an `.env` file and this checkout inherited it in Git history. The working copy was removed here; do not publish this repository or its inherited history until that history and its configuration have been reviewed.

## Client project workspace

The next milestone is available for local review: [workflow and verification guide](docs/OPERATIONS_MILESTONE.md).

Run `npm run dev` and open `/?workspace=projects&sample=true` for the synthetic rehearsal. The connected route is `/?workspace=projects`; it requires staging configuration, kitchen membership, the recipe foundation and the operations migration. `npm test` runs the local contract, operations and legacy checks.

The local app is now connected to the active `cabij_os` Supabase project. Open `/` to create your account, confirm your invited email and sign in. See the workflow guide for owner provisioning and the remaining acceptance checks. Configuration stays in ignored `.env.local`.

Existing n8n recipe intake is available in **Recipes → Existing n8n recipes**. See the [WF1 connection and remaining Google Drive credential blocker](docs/OPERATIONS_MILESTONE.md#existing-wf1-recipe-connection).

For direct PDF or Word intake, open **Recipes → Upload a recipe → Generate standardised recipe**. Review the preview and download its draft PDF, or continue to the recipe editor. See [supported document layouts and limits](docs/OPERATIONS_MILESTONE.md#direct-recipe-upload).
