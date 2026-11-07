import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleEvent } from '../fixtures/sample.js';
import { buildReviewedPlan } from '../../../server/reviewedCalculation.js';
import { ingredientEvidenceRepository, matchDocumentCandidate } from '../ingredientEvidence.js';

function database(tables, rpc) {
  const calls = [];
  return { calls, rpc: async (name, input) => { calls.push({ name, input }); return { data: await rpc?.(name, input), error: null }; }, from(table) {
    let filters = [], patch, action = 'read';
    const execute = single => {
      calls.push({ table, filters, action, patch });
      if (action === 'insert') return Promise.resolve({ data: patch, error: null });
      const rows = (tables[table] || []).filter(row => filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value));
      if (patch) rows.forEach(row => Object.assign(row, patch));
      return Promise.resolve({ data: structuredClone(single ? rows[0] || null : rows), error: null });
    };
    return { select() { return this; }, order() { return this; }, eq(key, value) { filters.push([key, value]); return this; }, in(key, value) { filters.push([key, value]); return this; }, insert(value) { patch = value; action = 'insert'; return this; }, update(value) { patch = value; action = 'update'; return this; }, single() { return execute(true); }, maybeSingle() { return execute(true); }, then(resolve, reject) { return execute(false).then(resolve, reject); } };
  } };
}
function pricing(patch = {}) {
  const { project, versions } = sampleEvent(); project.reconciliations = [];
  project.priceEvidenceSelections = { 'chicken||g': 'reviewed-price' };
  project.prices[0].packPrice = 0;
  const evidence = { id: 'reviewed-price', client_id: 'demo-kitchen', canonical_ingredient_id: 'canonical-chicken', product_form: '', supplier_name: 'Fixture supplier', source_document_ref: 'invoice:fixture', source_date: '2026-11-19', pack_quantity: 2, pack_unit: 'kg', pack_price: 12, currency: 'GBP', match_status: 'matched', reviewed_by: 'manager', reviewed_at: '2026-11-19T00:00:00Z', ...patch };
  const db = database({ ingredient_price_evidence_v1: [evidence], canonical_ingredients_v1: [{ id: 'canonical-chicken', canonical_id: 'chicken' }] });
  return { project, versions, evidence, db, build: () => buildReviewedPlan(project, versions, 'demo-kitchen', db) };
}

test('trusted pricing ignores browser costs and pins exact reviewed evidence without altering source project', async () => {
  const { project, evidence, db, build } = pricing(); const snapshot = await build();
  assert.equal(snapshot.ready, true); assert.ok(Math.abs(snapshot.cost - 52.8) < 1e-9); assert.equal(snapshot.purchaseCost, 60);
  assert.equal(project.prices[0].packPrice, 0); assert.deepEqual(snapshot.project, project);
  assert.deepEqual(snapshot.calculationInputs.prices[0].evidence, evidence);
  assert.equal(snapshot.purchasing[0].price.evidenceId, evidence.id);
  assert.ok(db.calls.find(c => c.table === 'ingredient_price_evidence_v1').filters.some(([key, value]) => key === 'client_id' && value === 'demo-kitchen'));
});

for (const [reason, patch] of Object.entries({ unreviewed: { match_status: 'review' }, rejected: { match_status: 'rejected' }, reviewer_missing: { reviewed_by: null }, review_time_missing: { reviewed_at: null }, foreign_kitchen: { client_id: 'foreign' }, wrong_canonical: { canonical_ingredient_id: 'different' }, wrong_form: { product_form: 'ground' }, mass_volume_conversion: { pack_unit: 'l' }, currency_mismatch: { currency: 'EUR' }, stale: { source_date: '2026-01-01' }, future: { source_date: '2026-11-21' }, unknown_price: { pack_price: null }, blank_price: { pack_price: '' }, unknown_quantity: { pack_quantity: null }, source_missing: { source_document_ref: '' } })) {
  test(`${reason} remains PRICE REQUIRED with null cost`, async () => {
    const result = await pricing(patch).build();
    assert.equal(result.cost, null); assert.equal(result.ready, false); assert.equal(result.purchasing[0].price, null);
    assert.equal(result.calculationInputs.selections[0].state, 'PRICE REQUIRED');
    assert.ok(result.exceptions.some(e => e.code === 'PRICE REQUIRED'));
    if (reason === 'mass_volume_conversion') assert.match(result.calculationInputs.selections[0].reason, /UNIT CONVERSION REQUIRED/);
  });
}

test('a reviewed zero price remains explicit zero and a missing selection never chooses a supplier', async () => {
  const free = await pricing({ pack_price: 0 }).build(); assert.equal(free.cost, 0); assert.equal(free.ready, true);
  const unselected = pricing(); unselected.project.priceEvidenceSelections = {};
  const missing = await unselected.build(); assert.equal(missing.cost, null); assert.equal(missing.calculationInputs.selections[0].evidenceId, null);
  assert.equal(unselected.db.calls.filter(c => c.table === 'ingredient_price_evidence_v1').length, 0);
});

test('candidate matching uses retained rows, preserves unknown quantities and provenance, and never invents unmatched identities', async () => {
  const source = { title: 'Source', ingredients: [{ name: 'Carrot', quantity: null, unit: 'kg' }, { name: 'Unknown spice', quantity: '2', unit: 'g' }], instructions_raw: 'Mix.', source_document_id: 'document', source_candidate_id: 'candidate', source_evidence_ids: ['document:document#sha256:fixture'] };
  const db = database({ recipe_document_candidates_v1: [{ id: 'candidate', client_id: 'kitchen', status: 'incomplete', source_recipe: source }] }, (_name, input) => input.p_source_name === 'Carrot' ? { status: 'matched', canonical_id: 'carrot', canonical_name: 'Carrot', canonical_match: { kind: 'canonical_name' } } : { status: 'INGREDIENT REVIEW REQUIRED' });
  const result = await matchDocumentCandidate(db, 'kitchen', 'candidate');
  assert.equal(result.draft.ingredients[0].canonical_id, 'carrot'); assert.equal(result.draft.ingredients[0].quantity, ''); assert.equal(result.draft.ingredients[0].needs_review, true);
  assert.equal(result.draft.ingredients[1].canonical_id, undefined); assert.equal(result.draft.ingredients[1].quantity, 2); assert.equal(result.draft.ingredients[1].needs_review, true);
  assert.equal(result.readyForCanonicalReview, false); assert.deepEqual(result.draft.source_evidence_ids, source.source_evidence_ids);
  assert.equal(source.ingredients[0].canonical_id, undefined);
  assert.ok(db.calls.filter(c => c.name).every(c => c.name === 'resolve_ingredient_identity_v1' && c.input.p_client_id === 'kitchen'));
  await assert.rejects(matchDocumentCandidate(db, 'foreign', 'candidate'), /saved extraction/);
});

test('repository writes review candidates and status transitions without accepting browser reviewer attribution', async () => {
  const db = database({ kitchen_ingredient_aliases_v1: [{ id: 'alias', client_id: 'kitchen', status: 'review' }], ingredient_price_evidence_v1: [{ id: 'price', client_id: 'kitchen', match_status: 'review' }] });
  const repo = ingredientEvidenceRepository(db, 'kitchen', 'chef');
  const alias = await repo.createAlias({ canonicalIngredientId: 'canonical', alias: 'Sesame', productForm: 'whole', sourceRef: 'review:source', reviewed_by: 'fake' });
  assert.equal(alias.client_id, 'kitchen'); assert.equal(alias.created_by, 'chef'); assert.equal(alias.reviewed_by, undefined);
  await repo.reviewAlias('alias', 'approved'); await repo.reviewPrice('price', 'matched');
  assert.deepEqual(db.calls.filter(c => c.action === 'update').map(c => c.patch), [{ status: 'approved' }, { match_status: 'matched' }]);
  const before = db.calls.length;
  for (const value of [undefined, null, '']) await assert.rejects(repo.createPrice({ packQuantity: 2, packPrice: value }), /PRICE REQUIRED/);
  assert.equal(db.calls.length, before);
});
