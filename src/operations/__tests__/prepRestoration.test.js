import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleEvent} from '../fixtures/sample.js';
import {buildPlan,approvePlan} from '../engine.js';
import {scheduleEvidence} from '../scheduleEvidence.js';
import {prepRows,groupPrep,prepRange,prepBoardHtml} from '../prepPresentation.js';
import {scheduleMessage,scheduleMessages} from '../slackSchedule.js';
const fixture=()=>{const f=sampleEvent();f.project.reconciliations=[];return f;};
const build=f=>buildPlan(f.project,f.versions,'demo-kitchen');
function advance(f){f.project.prepDays=[{date:'2026-11-19',startTime:'09:00',endTime:'17:00',staff:structuredClone(f.project.staff),equipment:structuredClone(f.project.equipment)}];f.project.overrides['demo-version-1:0:0']={prepDate:'2026-11-19',advance_source:'Synthetic handling review only, not a food-safety policy.',advance_reviewed:true};return f;}
test('explicit multi-day prep respects dated shifts and retains source order across days',()=>{
 const p=build(advance(fixture()));assert.equal(p.ready,true);assert.equal(p.schedule[0].prepDate,'2026-11-19');assert.equal(p.schedule[0].start,-900);assert.ok(p.schedule[1].start>=540);assert.ok(scheduleEvidence(p).checks.every(c=>c.passed));
 assert.equal(prepRows(p)[0].time,'09:00–09:30');assert.match(scheduleEvidence(p).tasks[0].allocation,/2026-11-19/);
});
test('advance prep never becomes scheduled without its handling review and reference',()=>{
 const f=advance(fixture());f.project.overrides['demo-version-1:0:0'].advance_reviewed=false;const p=build(f);assert.equal(p.ready,false);assert.match(p.unscheduled[0].reason,/Advance prep needs/);assert.equal(p.schedule.length,0);
});
test('a task cannot move before a predecessor which remains on service day',()=>{
 const f=advance(fixture());f.project.overrides={'demo-version-1:0:1':{prepDate:'2026-11-19',advance_source:'Synthetic reviewed reference',advance_reviewed:true}};const p=build(f);assert.equal(p.ready,false);assert.ok(p.unscheduled.some(t=>t.description==='Cook batch'));
});
test('dated roster overrides service-day availability without copying changes backwards',()=>{
 const f=advance(fixture());f.project.prepDays[0].staff=f.project.prepDays[0].staff.filter(s=>s.roles!=='chef');const p=build(f);assert.equal(p.ready,false);assert.equal(p.schedule.length,0);assert.equal(f.project.staff.length,3);
});
test('priority pulls prerequisites forward but cannot bypass role or equipment constraints',()=>{
 const f=fixture(),second=structuredClone(f.versions[0]);second.id='second';second.recipe_json.title='Urgent dish';f.versions.push(second);f.project.menu.push({...f.project.menu[0],versionId:'second'});f.project.overrides['second:0:2']={priority:'urgent'};let p=build(f);assert.equal(p.schedule[0].versionId,'second');assert.equal(p.schedule[0].sourceStepIndex,0);assert.equal(p.schedule.find(t=>t.id==='second:0:2').priority,'urgent');
 f.project.overrides['second:0:0']={assignee:'helper',priority:'urgent'};p=build(f);assert.ok(p.unscheduled.some(t=>t.id==='second:0:0'));assert.ok(p.unscheduled.some(t=>t.id==='second:0:2'));
});
test('role and dish PDF/Slack views use identical dated task membership and quantities',()=>{
 const p=build(advance(fixture())),rows=prepRows(p);for(const groupBy of ['role','dish','person']){const groups=groupPrep(rows,{groupBy});assert.equal(groups.flatMap(g=>g.tasks).length,3);const html=prepBoardHtml(rows,{groupBy}),text=scheduleMessage(p,{requireApproved:false,groupBy});assert.match(html,/2026-11-19/);assert.match(text,/2026-11-19/);assert.match(html,/160 portion/);assert.match(text,/160 portion/);}
 const chefText=scheduleMessage(p,{requireApproved:false,groupBy:'role',selection:'chef'});assert.ok(!chefText.includes('Portion and hand over'));assert.match(chefText,/Cook batch/);
});
test('calendar ranges include real month boundaries and never repeat tasks into empty dates',()=>{
 assert.deepEqual(prepRange('2028-02-11','month'),{start:'2028-02-01',end:'2028-02-29'});assert.deepEqual(prepRange('2026-11-20','week'),{start:'2026-11-16',end:'2026-11-22'});assert.throws(()=>prepRange('2026-02-30','month'));
 const rows=prepRows(build(advance(fixture())));assert.equal(rows.filter(r=>r.date==='2026-11-18').length,0);assert.equal(rows.filter(r=>r.date==='2026-11-19').length,1);assert.equal(rows.filter(r=>r.date==='2026-11-20').length,2);
});
test('combined project Slack date filters preserve approval and sample guards',()=>{
 const f=advance(fixture()),a=approvePlan(build(f),{id:'owner',role:'owner',clientId:'demo-kitchen'}),b=structuredClone(a);b.project.name='Second project';const records=[{plan:a,packageId:'first'},{plan:b,packageId:'second'}];const text=scheduleMessages(records,{groupBy:'role',startDate:'2026-11-19',endDate:'2026-11-19'});assert.match(text,/Second project/);assert.ok(!text.includes('Cook batch'));assert.match(text,/SYNTHETIC/);b.status='draft';assert.throws(()=>scheduleMessages(records),/Approve/);
});
test('prep sheets escape client notes and expose unallocated tasks',()=>{
 const f=advance(fixture());f.project.overrides['demo-version-1:0:0'].advance_reviewed=false;f.versions[0].recipe_json.production_steps[0].description='<script>bad</script>';const html=prepBoardHtml(prepRows(build(f)),{groupBy:'role'});assert.match(html,/BLOCKED/);assert.match(html,/&lt;script&gt;/);assert.ok(!html.includes('<script>bad'));
});
