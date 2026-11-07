import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleEvent } from '../fixtures/sample.js';
import { buildPlan, approvePlan } from '../engine.js';
import { exportSource } from '../exportSource.js';
import { withTaskCompletion } from '../taskCompletion.js';
import { prepRows, prepBoardHtml } from '../prepPresentation.js';
import { excelXml } from '../exports.js';

function approved() {
  const f = sampleEvent(); f.project.sample = false; f.project.reconciliations = [];
  const snapshot = approvePlan(buildPlan(f.project, f.versions, 'demo-kitchen'), { role: 'manager', clientId: 'demo-kitchen', id: 'manager' });
  const project = { id: 'project', revision: 1 };
  return exportSource({ project, clientId:'demo-kitchen', packageRecord: { id:'package', project_id:'project', project_revision:1, client_id:'demo-kitchen', calculation_run_id:'run', snapshot } });
}
test('completion is an overlay on the matching approved package, shown in prep and workbook', () => {
  const original = approved(), id=original.tasks[0].id;
  const row = { package_id:'package',task_id:id,status:'completed',updated_by:'chef-id',updated_at:'2026-11-06T12:00:00Z' };
  const plan = withTaskCompletion(original, [row, {...row, package_id:'foreign',task_id:original.tasks[1]?.id || 'other'}]);
  assert.equal(original.taskCompletions, undefined);
  assert.equal(Object.keys(plan.taskCompletions).length, 1);
  const task = prepRows(plan).find(t=>t.id===id);
  assert.equal(task.completion.status,'completed');
  assert.match(prepBoardHtml([task]), /Completion: Completed/);
  assert.match(prepBoardHtml([task]), /chef-id/);
  assert.match(excelXml(plan), /Task completion \(live state\)/);
  assert.match(excelXml(plan), /completed/);
});
test('missing completion data is not presented as pending and draft and sample plans have no controls', () => {
  const plan = approved();
  assert.equal(withTaskCompletion(plan,null),plan);
  assert.equal(prepRows(plan)[0].completionAvailable,false);
  const draft = {...plan, exportProvenance:{status:'draft'}, status:'draft'};
  assert.equal(withTaskCompletion(draft,[]),draft);
  const sample={...plan,project:{...plan.project,sample:true}};
  assert.equal(withTaskCompletion(sample,[]),sample);
  assert.match(prepBoardHtml(prepRows(withTaskCompletion(plan,[]))), /Completion: Pending/);
});
