import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { sampleEvent } from '../fixtures/sample.js';
import { buildPlan, approvePlan } from '../engine.js';
import { exportSource, provenanceText } from '../exportSource.js';
import { printHtml, excelXml } from '../exports.js';
import { scheduleMessage } from '../slackSchedule.js';
import { standardRecipePdf } from '../recipePdf.js';

function setup() {
  const f = sampleEvent(); f.project.sample = false; f.project.reconciliations = [];
  const snapshot = approvePlan(buildPlan(f.project, f.versions, 'demo-kitchen'), { role: 'manager', clientId: 'demo-kitchen', id: 'manager' });
  const project = { id: 'project-1', revision: 2 };
  const packageRecord = { id: 'package-1', project_id: project.id, project_revision: 2, client_id: 'demo-kitchen', calculation_run_id: 'run-1', approved_at: snapshot.approvedAt, snapshot };
  return { draft: buildPlan(f.project, f.versions, 'demo-kitchen'), project, packageRecord, clientId: 'demo-kitchen' };
}
test('all delivery formats use the same approved snapshot and run provenance', () => {
  const input = setup(), output = exportSource(input);
  input.draft.project.name = 'Changed draft';
  assert.notEqual(output.project.name, input.draft.project.name);
  assert.equal(JSON.parse(JSON.stringify(output)).exportProvenance.calculationRunId, 'run-1');
  for (const artifact of [printHtml(output), excelXml(output), scheduleMessage(output, { packageId: 'package-1', revision: 2 })]) {
    assert.match(artifact, /run-1/); assert.match(artifact, /package-1/); assert.match(artifact, /Engine/);
  }
  const pdf = standardRecipePdf(output).output();
  assert.ok(pdf.startsWith('%PDF-'));
  const pageText = [...pdf.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match => { try { return inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'); } catch { return ''; } }).join(' ');
  assert.match(pageText, /run-1/); assert.match(pageText, /package-1/);
  assert.doesNotMatch(excelXml(output), /ss:Formula=/);
});
test('stale, foreign, dirty and legacy packages cannot produce approved exports', () => {
  const a = setup();
  assert.throws(() => exportSource({ ...a, dirty: true }), /stale/);
  assert.throws(() => exportSource({ ...a, project: { ...a.project, revision: 3 } }), /stale/);
  assert.throws(() => exportSource({ ...a, clientId: 'foreign' }), /not accessible/);
  assert.throws(() => exportSource({ ...a, packageRecord: { ...a.packageRecord, calculation_run_id: null } }), /trusted calculation/);
});
test('draft and synthetic exports are labelled and do not mutate their input', () => {
  const a = setup(), draft = exportSource({ draft: a.draft });
  assert.match(provenanceText(draft), /DRAFT/);
  assert.equal(a.draft.status, undefined);
  const demo = exportSource({ ...a, demo: true, packageRecord: { ...a.packageRecord, calculation_run_id: null, snapshot: { ...a.packageRecord.snapshot, project: { ...a.packageRecord.snapshot.project, sample: true } } } });
  assert.match(provenanceText(demo), /SYNTHETIC/);
});
