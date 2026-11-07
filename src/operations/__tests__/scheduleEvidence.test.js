import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleEvent } from '../fixtures/sample.js';
import { buildPlan, approvePlan } from '../engine.js';
import { scheduleEvidence } from '../scheduleEvidence.js';
import { scheduleEvidenceHtml, printHtml, excelXml } from '../exports.js';
const fixture=()=>{const f=sampleEvent();f.project.reconciliations=[];return f;};
const build=f=>buildPlan(f.project,f.versions,'demo-kitchen');
test('evidence traces actual delayed starts and source timing independently of review',()=>{
 const f=fixture();f.project.staff.forEach(s=>{s.breakStart='09:00';s.breakEnd='09:30';});
 const p=build(f), e=scheduleEvidence(p), task=p.schedule[0];
 assert.equal(task.start,570);assert.equal(task.placement.earliest,540);assert.equal(task.placement.rejectedCandidates.staff,30);
 assert.ok(e.checks.every(c=>c.passed));assert.equal(e.missingTimingEvidence,p.tasks.length);
 assert.match(e.tasks[0].reason,/staff 30/);assert.match(e.tasks[0].batch,/160.*160.*1×/);
 f.versions[0].recipe_json.production_steps[0].timing_source='Kitchen trial 2026-11-06, full batch';
 f.versions[0].recipe_json.production_steps[0].timing_basis='kitchen_trial';
 assert.equal(scheduleEvidence(build(f)).tasks[0].timingEvidencePresent,true);
});
test('evidence independently detects an overlapping chef allocation and equipment overload',()=>{
 const f=fixture();f.project.menu[0].quantity=320;const p=build(f);
 const cooks=p.schedule.filter(t=>t.equipmentId);assert.equal(cooks.length,2);
 cooks[1].start=cooks[0].start;cooks[1].activeEnd=cooks[0].activeEnd;cooks[1].end=cooks[0].end;cooks[1].chefId=cooks[0].chefId;
 const checks=scheduleEvidence(p).checks;
 assert.equal(checks.find(c=>c.name==='No overlapping active work').passed,false);
 assert.equal(checks.find(c=>c.name==='Equipment availability & capacity').passed,false);
});
test('dependency and deadline violations are visible instead of an unsupported pass',()=>{
 const p=build(fixture()),t=p.schedule.find(t=>t.dependencies.length);
 t.start=0;t.end=2000;
 const checks=scheduleEvidence(p).checks;
 assert.equal(checks.find(c=>c.name==='Service window').passed,false);
 assert.equal(checks.find(c=>c.name==='Recipe order & dependencies').passed,false);
});
test('empty plan has no positive verification claim; failed plans retain unscheduled tasks',()=>{
 const f=fixture();f.project.menu=[];const e=scheduleEvidence(build(f));assert.ok(e.checks.every(c=>c.passed===null));
 f.project=fixture().project;f.project.serviceTime='09:01';const p=build(f);
 assert.ok(p.unscheduled.length);assert.equal(scheduleEvidence(p).tasks[0].allocation,'Unscheduled');
});
test('schedule evidence is retained in approved snapshots and escaped in all reports',()=>{
 const f=fixture();f.versions[0].recipe_json.production_steps[0].timing_source='<script>fixture</script>';
 const p=build(f), snapshot=approvePlan(p,{id:'owner',role:'owner',clientId:'demo-kitchen'},'2026-11-06T12:00:00Z');
 const original=snapshot.schedule[0].placement.earliest;f.project.startTime='11:00';assert.equal(snapshot.schedule[0].placement.earliest,original);
 for(const report of [scheduleEvidenceHtml(snapshot),printHtml(snapshot),excelXml(snapshot)]){assert.match(report,/Task evidence/);assert.match(report,/&lt;script&gt;fixture/);assert.ok(!report.includes('<script>fixture'));}
});
