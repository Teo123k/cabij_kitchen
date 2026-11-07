# Durable document intake — local boundary

The existing `/api/local-n8n/upload` endpoint remains a temporary extraction preview: it authenticates kitchen membership, extracts from a private temporary file, returns provisional recipe data, then deletes that file. `RecipeUpload.jsx` continues to use that existing route. It does not claim to archive originals.

The new `server/documentIntake.js` adapter exposes a separate durable boundary under `/api/local-documents`. It verifies the user with Supabase Auth and checks kitchen membership through the caller's scoped client. A server-only writer archives the **original bytes**, metadata and a pending extraction candidate in one PostgreSQL transaction. No Storage bucket, n8n authority or runtime AI is introduced.

Migration `20261106204846_durable_document_intake.sql` adds:

- `cabij_private.recipe_document_originals_v1`: private original bytes. Anonymous and authenticated roles have no schema/table/RPC access. Original bytes cannot be updated or deleted through normal writes.
- `recipe_documents_v1`: immutable tenant-scoped filename, extension, byte count, server-computed SHA-256, uploader and upload time.
- `recipe_document_candidates_v1`: source linkage, extractor version, extracted text, provisional recipe, warnings and error. Pending candidates may finish as `extracted`, `incomplete` or `failed`; terminal evidence is immutable. Missing yield, quantities and method remain missing and persist for manual review.
- Restricted invoker RPCs for transactional archival and private original reads, member-only metadata/candidate RLS, supporting indexes, and optional composite foreign keys from recipe versions to their tenant's document/candidate.

The adapter rereads and verifies archived bytes before deterministic extraction with the existing Python PDF/Word script. It never invents canonical identities, recipe quantities, timings or reviews. PDF extraction uses `pdftotext`; Word extraction uses Python ZIP/XML processing, including tables. Text/Markdown use UTF-8 decoding. Files are limited to **8 MiB**, filenames to 200 characters without paths, extracted text to 150,000 characters and Word document XML to 4 MB. PDF and DOCX signatures are checked before archival. Encrypted, malformed, scanned or unsupported documents retain their originals and a failed extraction candidate when the archive itself succeeded. No OCR is added.

Exact duplicates within a kitchen and extension reuse the same document and extractor-version candidate. The first uploader/filename remain the recorded provenance; repeated submissions do not rewrite it. Interrupted extraction leaves a pending candidate; re-uploading identical bytes resumes against the retained original. Concurrent deterministic extraction can repeat work, but completion converges on one immutable candidate. Failed or incomplete terminal candidates remain review evidence; a future extractor version can create another candidate without replacing the original.

Every candidate carries document/candidate IDs, checksum, uploader, upload time and extractor version. `workflowRecipe` preserves these evidence IDs when creating a review draft; `operationsRepository.saveRecipe` includes typed source foreign keys only for archived drafts, preserving compatibility for existing manual and preview saves. Extraction completeness is separate from recipe approval. Normal canonical validation and manager review still apply.

## Local API seam

All endpoints require a same-origin loopback POST, JSON and `Authorization: Bearer <access token>`:

| Path | Body | Result |
| --- | --- | --- |
| `/api/local-documents/upload` | `clientId`, `filename`, base64 `content` | Document receipt, durable candidate, `sourceRecipe`, duplicate flag |
| `/api/local-documents/status` | `clientId`, `documentId` | Scoped metadata and extraction candidates |
| `/api/local-documents/download` | `clientId`, `documentId` | Scoped metadata and checksum-verified original bytes as base64 |

Chef, manager or owner membership is required for intake; all kitchen members may inspect status and download through the authenticated boundary. Download checks scoped metadata before invoking the private reader. Browser-supplied checksums, extracted recipes, statuses or actor IDs are rejected.

The durable archive route remains disabled until explicitly configured for a **disposable local Supabase** instance using server-only `CABIJ_DOCUMENT_SUPABASE_URL`, `CABIJ_DOCUMENT_PUBLISHABLE_KEY` and `CABIJ_DOCUMENT_WORKER_KEY`. When that worker is unavailable, the dashboard now falls back to authenticated local draft extraction and labels the result as non-retained until it is saved through a configured durable route. Only HTTP loopback database URLs are accepted. Hosted worker provisioning/routing and authenticated staging verification remain pending.

Keeping bounded originals in PostgreSQL makes archive receipts transactional and independently verifiable at this scale. Volume, backup/retention policy and moving large archives behind a private object-store adapter are later operational decisions. This milestone does not establish production throughput or retention-policy readiness.

## Verification

Run `node --test src/operations/__tests__/documentIntake.test.js src/operations/__tests__/documentRecipe.test.js src/operations/__tests__/documentUploadBridge.test.js`, then `npm test`, `npm run build` and `git diff --check`.

After the existing disposable bootstrap/migration sequence and the trusted-calculation migration, apply the new migration and run `supabase/tests/durable_document_intake.sql` using `psql -v ON_ERROR_STOP=1`. Never run the synthetic bootstrap on hosted Supabase. SQL fixtures roll back. Checks cover private bytes/checksum/provenance, duplicate retention, incomplete extraction, immutable evidence, staff metadata access, denied private RPC/table access, cross-kitchen isolation, foreign recipe-source denial and size limits. The trusted-calculation SQL suite also passed again after the new recipe-source columns.

Focused Node checks include real Python PDF/DOCX extraction and byte-for-byte original downloads, pending recovery, concurrent duplicates, failed/incomplete evidence, checksum corruption, membership/type/size rejection and authenticated upload/status/download routes. No hosted services, credentials, n8n workflows or external messages were touched.
