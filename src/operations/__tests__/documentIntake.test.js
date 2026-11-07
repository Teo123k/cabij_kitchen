import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { jsPDF } from 'jspdf';
import { durableDocumentIntake, localDocumentIntakePlugin } from '../../../server/documentIntake.js';
import { workflowRecipe } from '../workflowRecipe.js';

const input = { token: 'chef', clientId: 'kitchen', filename: 'source.txt', content: Buffer.from('Sauce\nIngredients\nSalt to taste\nMethod\nStir thoroughly.').toString('base64') };
function fixture(options = {}) {
  const documents = [], candidates = [], originals = new Map(), calls = [];
  const query = (table, actor) => {
    let filters = [], patch;
    const execute = single => {
      calls.push({ table, actor, filters, patch });
      const source = table === 'kitchen_memberships' ? ['chef', 'manager', 'owner', 'staff'].map(role => ({ user_id: role, client_id: 'kitchen', role })) : table === 'recipe_documents_v1' ? documents : candidates;
      const rows = source.filter(row => filters.every(([key, value]) => row[key] === value));
      if (patch) { options.beforeUpdate?.(); rows.forEach(row => Object.assign(row, structuredClone(patch), { completed_at: '2026-11-06T00:00:00Z' })); }
      return Promise.resolve({ data: structuredClone(single ? rows[0] || null : rows), error: null });
    };
    return { select() { return this; }, eq(key, value) { filters.push([key, value]); return this; }, order() { return this; }, update(value) { assert.equal(actor, 'worker'); patch = value; return this; }, single() { return execute(true); }, maybeSingle() { return execute(true); }, then(resolve, reject) { return execute(false).then(resolve, reject); } };
  };
  const writer = { from: table => query(table, 'worker'), async rpc(name, params) {
    calls.push({ name, params });
    if (name === 'read_recipe_document_original_v1') return { data: originals.get(params.p_document_id), error: null };
    const bytes = Buffer.from(params.p_content, 'base64'), sha256 = createHash('sha256').update(bytes).digest('hex');
    let row = documents.find(d => d.client_id === params.p_client_id && d.sha256 === sha256 && d.extension === params.p_extension);
    const duplicate = !!row;
    if (!row) { row = { id: `document-${documents.length + 1}`, client_id: params.p_client_id, filename: params.p_filename, extension: params.p_extension, sha256, byte_length: bytes.length, created_by: params.p_created_by, created_at: '2026-11-06T00:00:00Z' }; documents.push(row); originals.set(row.id, params.p_content); candidates.push({ id: `candidate-${candidates.length + 1}`, client_id: row.client_id, document_id: row.id, extractor_version: params.p_extractor_version, status: 'pending' }); }
    return { data: { document: structuredClone(row), candidate: structuredClone(candidates.find(c => c.document_id === row.id)), duplicate }, error: null };
  } };
  const authenticate = async token => { if (token === 'invalid') throw new Error('Invalid session'); return { db: { from: table => query(table, token) }, user: { id: token } }; };
  return { documents, candidates, originals, calls, adapter: durableDocumentIntake({ authenticate, writer, ...options }) };
}

test('archive retains exact original bytes, SHA-256, uploader provenance and incomplete extraction evidence', async () => {
  const { adapter, documents, originals, candidates } = fixture();
  const result = await adapter.upload(input);
  assert.equal(result.candidate.status, 'incomplete'); assert.equal(documents.length, 1); assert.equal(candidates.length, 1);
  assert.equal(originals.get(result.document.id), input.content);
  assert.equal(result.document.sha256, createHash('sha256').update(Buffer.from(input.content, 'base64')).digest('hex'));
  assert.equal(result.sourceRecipe.source_document_id, result.document.id); assert.equal(result.sourceRecipe.source_candidate_id, result.candidate.id);
  assert.equal(result.sourceRecipe.source_meta.uploaded_by, 'chef'); assert.equal(result.sourceRecipe.source_meta.extractor_version, 'python-document-v1');
  assert.equal(result.sourceRecipe.ingredients[0].quantity, null); assert.equal(result.sourceRecipe.yield, undefined);
  assert.match(result.sourceRecipe.source_text, /Salt to taste/); assert.ok(result.candidate.warnings.some(w => /incomplete/.test(w)));
  const draft = workflowRecipe(result.sourceRecipe).draft;
  assert.equal(draft.yield.quantity, ''); assert.equal(draft.source_document_id, result.document.id);
  assert.deepEqual(draft.source_evidence_ids, [`document:${result.document.id}#sha256:${result.document.sha256}`, `extraction:${result.candidate.id}`]);
  const downloaded = await adapter.download({ token: 'staff', clientId: 'kitchen', documentId: result.document.id });
  assert.equal(downloaded.content, input.content);
  const status = await adapter.status({ token: 'staff', clientId: 'kitchen', documentId: result.document.id });
  assert.equal(status.candidates[0].status, 'incomplete');
});

test('re-upload returns terminal candidate and original first-upload provenance without rerunning extraction', async () => {
  let extractions = 0; const { adapter, documents, candidates } = fixture({ extract: async () => { extractions++; return 'Sauce\nYield: 10 portions\nIngredients\n20 ml Soy sauce\nMethod\nStir.'; } });
  const first = await adapter.upload(input), second = await adapter.upload({ ...input, filename: 'renamed.txt', token: 'manager' });
  assert.equal(extractions, 1); assert.equal(documents.length, 1); assert.equal(candidates.length, 1);
  assert.equal(first.candidate.status, 'extracted'); assert.equal(second.duplicate, true);
  assert.equal(second.document.filename, input.filename); assert.equal(second.document.created_by, 'chef');
  assert.equal(second.candidate.id, first.candidate.id);
});

test('concurrent duplicate uploads converge on one durable document and candidate', async () => {
  const { adapter, documents, candidates } = fixture({ extract: async () => 'Sauce\nIngredients\nSalt to taste\nMethod\nStir.' });
  const results = await Promise.all([adapter.upload(input), adapter.upload(input)]);
  assert.equal(documents.length, 1); assert.equal(candidates.length, 1);
  assert.equal(results[0].candidate.id, results[1].candidate.id);
  assert.equal(results.filter(r => r.duplicate).length, 1);
  assert.ok(results.every(r => r.candidate.status === 'incomplete'));
});

test('extraction failure persists a failed candidate and downloadable original without creating an approved recipe', async () => {
  const { adapter, candidates } = fixture({ extract: async () => { throw new Error('Manual transcription required.'); } });
  const result = await adapter.upload(input);
  assert.equal(result.candidate.status, 'failed'); assert.match(result.candidate.error, /Manual transcription/);
  assert.equal(candidates[0].source_recipe.ingredients.length, 0); assert.equal(result.sourceRecipe.ready, undefined);
  assert.equal((await adapter.download({ token: 'chef', clientId: 'kitchen', documentId: result.document.id })).content, input.content);
});

test('interrupted extraction leaves a resumable pending candidate backed by archived bytes', async () => {
  let completions = 0;
  const base = fixture({ beforeUpdate() { if (completions++ === 0) throw new Error('interrupted completion'); } });
  await assert.rejects(base.adapter.upload(input), /interrupted completion/);
  assert.equal(base.candidates[0].status, 'pending'); assert.equal(base.originals.get(base.documents[0].id), input.content);
  const resumed = await base.adapter.upload(input);
  assert.equal(resumed.duplicate, true); assert.equal(base.documents.length, 1); assert.equal(resumed.candidate.id, base.candidates[0].id);
  assert.equal(resumed.candidate.status, 'incomplete');
});

test('authenticated membership precedes archive writes and foreign document IDs never reach the private reader', async () => {
  const { adapter, calls } = fixture();
  for (const request of [{ ...input, token: '' }, { ...input, token: 'invalid' }, { ...input, token: 'staff' }, { ...input, clientId: 'foreign' }]) await assert.rejects(adapter.upload(request));
  assert.equal(calls.filter(c => c.name).length, 0);
  await adapter.upload(input); const before = calls.filter(c => c.name === 'read_recipe_document_original_v1').length;
  await assert.rejects(adapter.download({ token: 'manager', clientId: 'kitchen', documentId: 'foreign-document' }), /not accessible/);
  assert.equal(calls.filter(c => c.name === 'read_recipe_document_original_v1').length, before);
});

test('checksum verification rejects a damaged archive before download or extraction', async () => {
  const { adapter, originals } = fixture(); const result = await adapter.upload(input);
  originals.set(result.document.id, Buffer.from('damaged').toString('base64'));
  await assert.rejects(adapter.download({ token: 'chef', clientId: 'kitchen', documentId: result.document.id }), /checksum verification/);
});

test('type, size, filename and browser-produced candidate metadata are validated before archiving', async () => {
  const { adapter, documents } = fixture();
  for (const patch of [{ filename: '../private.pdf' }, { filename: 'source.exe' }, { filename: 'source.pdf' }, { filename: 'source.docx' }, { content: 'not base64' }, { content: '' }, { content: Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64') }, { sha256: 'forged' }, { sourceRecipe: { ready: true } }, { status: 'extracted' }]) await assert.rejects(adapter.upload({ ...input, ...patch }));
  assert.equal(documents.length, 0);
});

test('real Python PDF and Word extraction archives and returns exact original files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cabij-durable-test-'));
  try {
    const pdf = new jsPDF(); pdf.text(['Sauce', 'Yield: 10 portions', 'Ingredients', '20 ml Soy sauce', 'Method', 'Stir thoroughly.'], 20, 20);
    const pdfBytes = Buffer.from(pdf.output('arraybuffer'));
    const word = join(dir, 'source.docx');
    execFileSync('python3', ['-c', `import zipfile,sys
with zipfile.ZipFile(sys.argv[1],'w') as z:
 z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Sauce</w:t></w:r></w:p><w:p><w:r><w:t>Ingredients</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Soy sauce</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>20 ml</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>Method</w:t></w:r></w:p><w:p><w:r><w:t>Stir thoroughly.</w:t></w:r></w:p></w:body></w:document>')`, word]);
    for (const [filename, bytes, status] of [['source.pdf', pdfBytes, 'extracted'], ['source.docx', readFileSync(word), 'incomplete']]) {
      const { adapter } = fixture(); const uploaded = await adapter.upload({ ...input, filename, content: bytes.toString('base64') });
      assert.equal(uploaded.candidate.status, status); assert.equal(uploaded.sourceRecipe.ingredients[0].quantity, '20'); assert.equal(uploaded.sourceRecipe.instructions_raw, 'Stir thoroughly.');
      const download = await adapter.download({ token: 'manager', clientId: 'kitchen', documentId: uploaded.document.id });
      assert.deepEqual(Buffer.from(download.content, 'base64'), bytes);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

async function middlewareRequest(env, adapter, overrides = {}) {
  let handler; localDocumentIntakePlugin(env, adapter).configureServer({ middlewares: { use(_path, fn) { handler = fn; } } });
  const req = Readable.from([JSON.stringify(overrides.body || { clientId: 'kitchen', filename: input.filename, content: input.content })]);
  Object.assign(req, { method: 'POST', url: '/upload', headers: { host: '127.0.0.1:5174', origin: 'http://127.0.0.1:5174', 'content-type': 'application/json', authorization: 'Bearer chef' }, socket: { remoteAddress: '127.0.0.1' } }, overrides);
  let result; await handler(req, { setHeader() {}, end(body) { result = { status: this.statusCode, body: JSON.parse(body) }; } }); return result;
}
test('local document API enforces token, origin and loopback and remains disabled for hosted configuration', async () => {
  const { adapter } = fixture();
  const upload = await middlewareRequest({}, adapter); assert.equal(upload.status, 200); assert.equal(upload.body.candidate.status, 'incomplete');
  const status = await middlewareRequest({}, adapter, { url: '/status', body: { clientId: 'kitchen', documentId: upload.body.document.id } });
  assert.equal(status.body.candidates[0].status, 'incomplete');
  const download = await middlewareRequest({}, adapter, { url: '/download', body: { clientId: 'kitchen', documentId: upload.body.document.id } });
  assert.equal(download.body.content, input.content);
  assert.equal((await middlewareRequest({}, adapter, { headers: { host: '127.0.0.1:5174', origin: 'http://127.0.0.1:5174', 'content-type': 'application/json' } })).status, 401);
  assert.equal((await middlewareRequest({}, adapter, { headers: { host: '127.0.0.1:5174', origin: 'https://evil.invalid', 'content-type': 'application/json' } })).status, 403);
  assert.equal((await middlewareRequest({}, adapter, { socket: { remoteAddress: '10.1.1.1' } })).status, 403);
  assert.equal((await middlewareRequest({}, undefined)).status, 503);
  assert.equal((await middlewareRequest({ CABIJ_DOCUMENT_SUPABASE_URL: 'https://hosted.supabase.co', CABIJ_DOCUMENT_WORKER_KEY: 'fake', CABIJ_DOCUMENT_PUBLISHABLE_KEY: 'fake' }, undefined)).status, 503);
});

test('local draft fallback extracts a recipe when durable archive worker is not configured', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async url => new Response(JSON.stringify(String(url).includes('/auth/v1/user') ? { id: 'chef-user' } : { role: 'chef' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    const draft = await middlewareRequest({ VITE_SUPABASE_URL: 'https://draft-test.supabase.co', VITE_SUPABASE_ANON_KEY: 'publishable' }, undefined, { url: '/draft', body: { clientId: 'kitchen', filename: 'recipe.txt', content: Buffer.from('Sauce\nIngredients\n20 ml Soy sauce\nMethod\nStir thoroughly.').toString('base64') } });
    assert.equal(draft.status, 200); assert.equal(draft.body.durable, false); assert.equal(draft.body.candidate.status, 'local_draft');
    assert.equal(draft.body.sourceRecipe.ingredients[0].quantity, '20'); assert.match(draft.body.sourceRecipe.validation_flags.warnings.at(-1), /Local draft only/);
  } finally { globalThis.fetch = previous; }
});
