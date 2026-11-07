import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { trustedCalculation, localCalculationPlugin, supabaseCalculationContext } from '../../../server/trustedCalculation.js';
import { sampleEvent } from '../fixtures/sample.js';
import { buildPlan } from '../engine.js';
import { operationsRepository } from '../repository.js';

const request = { token: 'manager', clientId: 'demo-kitchen', projectId: 'project', projectRevision: 1, idempotencyKey: 'reference-v3:project:1' };
function fixture(hooks = {}) {
  const sample = sampleEvent(); sample.project.reconciliations = []; sample.project.sample = false;
  sample.project.priceEvidenceSelections = { 'chicken||g': 'price-evidence' };
  const state = { kitchen_memberships: ['manager', 'owner', 'chef', 'staff'].map(role => ({ user_id: role, role, client_id: request.clientId })), operations_projects_v1: [{ id: 'project', client_id: request.clientId, revision: 1, document: sample.project }], recipe_versions_v1: sample.versions, operations_calculation_jobs_v1: [], operations_calculation_runs_v1: [], operations_packages_v1: [] };
  state.canonical_ingredients_v1 = [{ id: 'canonical-chicken', canonical_id: 'chicken' }];
  state.ingredient_price_evidence_v1 = [{ id: 'price-evidence', client_id: request.clientId, canonical_ingredient_id: 'canonical-chicken', product_form: '', supplier_name: 'Synthetic supplier', source_document_ref: 'Synthetic supplier fixture', source_date: '2026-11-19', pack_quantity: 2, pack_unit: 'kg', pack_price: 12, currency: 'GBP', match_status: 'matched', reviewed_by: 'manager', reviewed_at: '2026-11-19T00:00:00Z' }];
  const calls = [];
  const client = actor => ({ from(table) {
    let action = 'read', payload, filters = [];
    const execute = async single => {
      await hooks.before?.({ table, action, state });
      calls.push({ actor, table, action, payload: structuredClone(payload), filters });
      const rows = state[table];
      if (action === 'insert') {
        if (actor !== 'worker' && table !== 'operations_packages_v1') throw new Error('Unexpected client write');
        if (table === 'operations_calculation_jobs_v1' && rows.some(row => ['client_id', 'project_id', 'project_revision', 'idempotency_key'].every(key => row[key] === payload[key]))) return { error: { code: '23505', message: 'duplicate' } };
        const row = { id: `${table}:${rows.length + 1}`, ...structuredClone(payload) };
        if (table === 'operations_calculation_jobs_v1') row.status = 'running';
        if (table === 'operations_calculation_runs_v1') {
          if (state.operations_projects_v1[0].revision !== row.project_revision) return { error: { message: 'Save and regenerate the current project revision' } };
          row.completed_at = '2026-11-06T00:00:00Z'; state.operations_calculation_jobs_v1.find(j => j.id === row.job_id).status = 'completed';
        }
        if (table === 'operations_packages_v1') {
          const run = state.operations_calculation_runs_v1.find(r => r.id === row.calculation_run_id);
          row.snapshot = { ...run.snapshot, status: 'approved', approvedBy: actor };
        }
        rows.push(row); return { data: structuredClone(row), error: null };
      }
      const selected = rows.filter(row => filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value));
      if (action === 'update') { selected.forEach(row => Object.assign(row, payload)); return { data: selected, error: null }; }
      if (single && selected.length > 1) throw new Error('Ambiguous fixture query');
      return { data: structuredClone(single ? selected[0] || null : selected), error: null };
    };
    return { select() { return this; }, insert(value) { action = 'insert'; payload = value; return this; }, update(value) { action = 'update'; payload = value; return this; }, eq(key, value) { filters.push([key, value]); return this; }, in(key, values) { filters.push([key, values]); return this; }, single() { return execute(true); }, maybeSingle() { return execute(true); }, then(resolve, reject) { return execute(false).then(resolve, reject); } };
  } });
  const authenticate = async token => { if (token === 'invalid') throw new Error('Invalid session'); return { db: client(token), user: { id: token } }; };
  return { state, calls, adapter: trustedCalculation({ authenticate, writer: client('worker') }) };
}

test('trusted worker calculates only saved tenant-scoped inputs with the unchanged reference engine', async () => {
  const { state, calls, adapter } = fixture();
  state.recipe_versions_v1.push({ ...state.recipe_versions_v1[0], id: 'foreign', client_id: 'other' }, { ...state.recipe_versions_v1[0], id: 'draft', status: 'draft' });
  const calculated = await adapter.calculate(request);
  assert.equal(calculated.run.snapshot.ready, true);
  const savedProject = state.operations_projects_v1[0].document;
  assert.deepEqual(calculated.run.snapshot.project, savedProject);
  assert.deepEqual(calculated.run.snapshot.purchasing, buildPlan({ ...savedProject, prices: calculated.run.snapshot.calculationInputs.prices }, state.recipe_versions_v1, request.clientId).purchasing);
  assert.equal(calculated.job.status, 'completed');
  const sources = calls.filter(c => ['operations_projects_v1', 'recipe_versions_v1'].includes(c.table));
  assert.ok(sources.every(c => c.actor === 'manager' && c.filters.some(([key, value]) => key === 'client_id' && value === request.clientId)));
  assert.ok(calls.filter(c => c.action === 'insert').every(c => c.actor === 'worker'));
});

for (const [key, value] of Object.entries({ ready: true, cost: 0, schedule: [], snapshot: { ready: true }, project: {}, versions: [] })) {
  test(`browser supplied ${key} cannot enter a trusted run or approval`, async () => {
    const { adapter, state } = fixture();
    await assert.rejects(adapter.calculate({ ...request, [key]: value }), /browser calculation output/);
    await assert.rejects(adapter.approve({ token: 'manager', clientId: request.clientId, runId: 'fake', [key]: value }), /browser calculation output/);
    assert.equal(state.operations_calculation_jobs_v1.length, 0);
  });
}

test('repeated and concurrent duplicate requests create one job and one run', async () => {
  const { adapter, state } = fixture();
  const results = await Promise.all([adapter.calculate(request), adapter.calculate(request)]);
  const retry = await adapter.calculate(request);
  assert.equal(state.operations_calculation_jobs_v1.length, 1);
  assert.equal(state.operations_calculation_runs_v1.length, 1);
  assert.equal(results.filter(r => r.duplicate).length, 1);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.run.id, results.find(r => r.run)?.run.id);
  assert.equal((await adapter.status({ token: 'staff', clientId: request.clientId, jobId: retry.job.id })).run.id, retry.run.id);
});

test('unpriced saved inputs remain blocked and cannot be approved', async () => {
  const { adapter, state } = fixture(); state.operations_projects_v1[0].document.prices = []; state.operations_projects_v1[0].document.priceEvidenceSelections = {};
  const { run } = await adapter.calculate(request);
  assert.equal(run.snapshot.ready, false); assert.equal(run.snapshot.cost, null);
  await assert.rejects(adapter.approve({ token: 'manager', clientId: request.clientId, runId: run.id }), /blocking exceptions/);
  assert.equal(state.operations_packages_v1.length, 0);
});

test('membership and current project revision are required before job creation', async () => {
  const { adapter, state } = fixture();
  for (const input of [{ ...request, token: '' }, { ...request, token: 'invalid' }, { ...request, token: 'staff' }, { ...request, clientId: 'foreign' }, { ...request, projectRevision: 2 }]) await assert.rejects(adapter.calculate(input));
  assert.equal(state.operations_calculation_jobs_v1.length, 0);
});

test('engine failure retains a failed job and duplicate requests do not rerun it', async () => {
  // A broken source can fail the engine without writing any trusted output.
  const base = fixture(); base.state.operations_projects_v1[0].document.menu = null;
  await assert.rejects(base.adapter.calculate(request));
  assert.equal(base.state.operations_calculation_runs_v1.length, 0);
  assert.equal(base.state.operations_calculation_jobs_v1[0].status, 'failed');
  const retry = await base.adapter.calculate(request);
  assert.equal(retry.duplicate, true); assert.equal(retry.run, null); assert.equal(retry.job.status, 'failed');
});

test('a project changed during calculation cannot complete its stale run', async () => {
  const { adapter, state } = fixture({ before({ table, action, state }) { if (table === 'recipe_versions_v1' && action === 'read') state.operations_projects_v1[0].revision = 2; } });
  await assert.rejects(adapter.calculate(request), /current project revision/);
  assert.equal(state.operations_calculation_runs_v1.length, 0);
  assert.equal(state.operations_calculation_jobs_v1[0].status, 'failed');
});

test('manager and owner approve by run ID with no browser snapshot; chefs cannot approve', async () => {
  for (const token of ['manager', 'owner']) {
    const { adapter, calls } = fixture(); const { run } = await adapter.calculate({ ...request, token: 'chef' });
    await assert.rejects(adapter.approve({ token: 'chef', clientId: request.clientId, runId: run.id }), /required role/);
    const approved = await adapter.approve({ token, clientId: request.clientId, runId: run.id });
    assert.equal(approved.calculation_run_id, run.id); assert.equal(approved.snapshot.approvedBy, token);
    const payload = calls.find(c => c.table === 'operations_packages_v1' && c.action === 'insert').payload;
    assert.deepEqual(Object.keys(payload).sort(), ['calculation_run_id', 'client_id', 'project_id', 'project_revision']);
  }
});

async function middlewareRequest(env, adapter, overrides = {}) {
  let handler; localCalculationPlugin(env, adapter).configureServer({ middlewares: { use(_path, next) { handler = next; } } });
  const req = Readable.from([JSON.stringify(overrides.body || { clientId: request.clientId, projectId: 'project', projectRevision: 1, idempotencyKey: 'test' })]);
  Object.assign(req, { url: '/calculate', method: 'POST', socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:5174', origin: 'http://127.0.0.1:5174', 'content-type': 'application/json', authorization: 'Bearer manager' } }, overrides);
  let response; await handler(req, { setHeader() {}, end(body) { response = { status: this.statusCode, body: JSON.parse(body) }; } }); return response;
}

test('Vite seam accepts authenticated local source IDs and blocks remote, missing token and cross-origin requests', async () => {
  const { adapter } = fixture();
  assert.equal((await middlewareRequest({}, adapter)).status, 200);
  assert.equal((await middlewareRequest({}, adapter, { socket: { remoteAddress: '10.0.0.1' } })).status, 403);
  assert.equal((await middlewareRequest({}, adapter, { headers: { host: '127.0.0.1:5174', origin: 'https://evil.invalid', 'content-type': 'application/json' } })).status, 403);
  assert.equal((await middlewareRequest({}, adapter, { headers: { host: '127.0.0.1:5174', origin: 'http://127.0.0.1:5174', 'content-type': 'application/json' } })).status, 401);
  assert.equal((await middlewareRequest({}, adapter, { body: { ...request, ready: true } })).status, 400);
});

test('development worker stays disabled with missing or hosted database configuration', async () => {
  assert.equal((await middlewareRequest({}, undefined)).status, 503);
  assert.equal((await middlewareRequest({ CABIJ_CALCULATION_SUPABASE_URL: 'https://hosted.supabase.co', CABIJ_CALCULATION_PUBLISHABLE_KEY: 'fake', CABIJ_CALCULATION_WORKER_KEY: 'fake' }, undefined)).status, 503);
});

test('Supabase context verifies the token with Auth and preserves caller authorization for source queries', async () => {
  const previous = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), authorization: new Headers(init.headers).get('authorization') }); return new Response(JSON.stringify(String(url).includes('/auth/v1/user') ? { id: 'verified' } : []), { headers: { 'Content-Type': 'application/json' } }); };
  try {
    const context = await supabaseCalculationContext('http://127.0.0.1:54321', 'test-only-key')('verified-token');
    assert.equal(context.user.id, 'verified'); await context.db.from('operations_projects_v1').select('*');
    assert.ok(calls.some(c => c.url.includes('/auth/v1/user'))); assert.ok(calls.every(c => c.authorization === 'Bearer verified-token'));
  } finally { globalThis.fetch = previous; }
});

test('browser repository sends only saved project identifiers and run IDs', async () => {
  const previous = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, input: JSON.parse(init.body) }); return new Response('{}', { headers: { 'Content-Type': 'application/json' } }); };
  try {
    const repo = operationsRepository({ auth: { getSession: async () => ({ data: { session: { access_token: 'fixture' } } }) } }, request.clientId, 'manager');
    await repo.calculate({ id: 'project', revision: 1, document: { ready: true, cost: 0 } });
    await repo.approve({ id: 'project', revision: 1 }, 'run');
    await assert.rejects(repo.approve({ id: 'project' }, { ready: true }), /trusted calculation run/);
    assert.deepEqual(calls[0].input, { clientId: request.clientId, projectId: 'project', projectRevision: 1, idempotencyKey: 'reviewed-evidence-v1:reference-v3:project:1' });
    assert.deepEqual(calls[1].input, { runId: 'run', clientId: request.clientId });
  } finally { globalThis.fetch = previous; }
});
