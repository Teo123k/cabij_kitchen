import test from 'node:test';
import assert from 'node:assert/strict';
import { operationsRepository } from '../repository.js';

test('dashboard evidence reads are scoped to the active kitchen', async () => {
  const calls = [];
  const db = { from(table) { const call = { table, filters: [] }; calls.push(call); const query = { select() { return this; }, eq(key, value) { call.filters.push([key, value]); return this; }, order() { return this; }, then(resolve) { resolve({ data: [{ table }], error: null }); } }; return query; } };
  const evidence = await operationsRepository(db, 'kitchen-a', 'user-a').loadEvidence();
  assert.equal(evidence.documents[0].table, 'recipe_documents_v1');
  assert.equal(evidence.candidates[0].table, 'recipe_document_candidates_v1');
  assert.equal(evidence.prices[0].table, 'ingredient_price_evidence_v1');
  for (const call of calls.filter(c => c.table !== 'canonical_ingredients_v1')) assert.deepEqual(call.filters, [['client_id', 'kitchen-a']]);
});

test('document upload and download send authenticated source data to durable local routes', async () => {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ ok: true }) }; };
  try {
    const db = { auth: { getSession: async () => ({ data: { session: { access_token: 'session' } } }) } };
    const repo = operationsRepository(db, 'kitchen-a', 'user-a');
    await repo.uploadDocument('recipe.pdf', 'cGRm');
    await repo.downloadDocument('document-id');
    assert.deepEqual(calls.map(c => c.url), ['/api/local-documents/upload', '/api/local-documents/download']);
    assert.deepEqual(JSON.parse(calls[0].options.body), { filename: 'recipe.pdf', content: 'cGRm', clientId: 'kitchen-a' });
    assert.deepEqual(JSON.parse(calls[1].options.body), { documentId: 'document-id', clientId: 'kitchen-a' });
    assert.equal(calls[0].options.headers.Authorization, 'Bearer session');
  } finally { globalThis.fetch = original; }
});
