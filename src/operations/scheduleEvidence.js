import { workingDays } from './prepDates.js';
import { clock, minutes } from './engine.js';
const overlap = (a,b,c,d) => a < b && c < d && a < d && c < b;
export function scheduleEvidence(plan) {
  const rows=plan.schedule, equipment=plan.project.equipment;
  const days=plan.workDays||workingDays(plan.project), dayFor=t=>days.find(d=>d.date===(t.prepDate||plan.project.serviceDate));
  const checks=[];
  const check=(name,passed,detail)=>checks.push({name,passed:rows.length?passed:null,detail});
  check('Every task allocated once', plan.tasks.length>0 && plan.unscheduled.length===0 && rows.length===plan.tasks.length && new Set(rows.map(t=>t.id)).size===rows.length && plan.tasks.every(t=>rows.some(r=>r.id===t.id)),`${rows.length} allocated / ${plan.tasks.length} required; ${plan.unscheduled.length} unscheduled.`);
  check('Service window', rows.every(t=>Number.isFinite(t.start)&&dayFor(t)&&t.start>=dayFor(t).offset+minutes(dayFor(t).startTime)&&t.end<=dayFor(t).offset+minutes(dayFor(t).endTime)&&t.end<=minutes(plan.project.serviceTime)),`Configured dated working windows; service-day deadline ${plan.project.serviceTime} (${plan.project.timeZone||'Europe/London'}).`);
  check('Task durations & time restrictions', rows.every(t=>{const source=plan.tasks.find(s=>s.id===t.id);return source&&t.activeEnd-t.start===Number(source.active)&&t.end-t.start===Number(source.active)+Number(source.passive)&&(!source.earliest||t.start>=(dayFor(t)?.offset||0)+minutes(source.earliest))&&(!source.latest||t.end<=(dayFor(t)?.offset||0)+minutes(source.latest));}), 'Allocated active and total time must match the task inputs and any step-specific window.');
  check('Approved recipe sources', plan.tasks.length>0&&plan.tasks.every(t=>{const r=plan.recipes.find(r=>r.id===t.versionId);return r&&r.status==='approved'&&r.client_id===plan.clientId&&r.recipe_json.source_evidence_ids?.length;}), 'Tasks must point to approved recipe versions from this kitchen, with source references.');
  check('Recipe order & dependencies', rows.every(t=>t.dependencies.every(id=>rows.some(d=>d.id===id&&d.end<=t.start))), 'Each predecessor must finish before its dependent task starts.');
  check('Staff roles, shifts & breaks', rows.every(t=>{const day=dayFor(t),s=day?.staff.find(s=>s.id===t.chefId),offset=day?.offset||0;return s&&(s.roles||'').split(',').map(r=>r.trim()).includes(t.role)&&t.start>=offset+minutes(s.start)&&t.activeEnd<=offset+minutes(s.end)&&!(s.breakStart&&s.breakEnd&&overlap(t.start,t.activeEnd,offset+minutes(s.breakStart),offset+minutes(s.breakEnd)));}), 'The named person must cover the required role and active work interval, outside their recorded break.');
  check('No overlapping active work', rows.every((a,i)=>rows.every((b,j)=>i===j||a.chefId!==b.chefId||!overlap(a.start,a.activeEnd,b.start,b.activeEnd))), 'Passive cooking time releases the chef; active work cannot overlap.');
  const equipmentValid=rows.every(t=>{if(!t.equipmentId)return true;const day=dayFor(t),e=day?.equipment.find(e=>e.id===t.equipmentId);return e&&t.start>=day.offset+minutes(e.start)&&t.end<=day.offset+minutes(e.end)&&Number(t.capacity)>0;}) && days.every(day=>day.equipment.every(e=>{
    const events=rows.filter(t=>t.equipmentId===e.id&&(t.prepDate||plan.project.serviceDate)===day.date).flatMap(t=>[{time:t.start,delta:Number(t.capacity)},{time:t.end,delta:-Number(t.capacity)}]).sort((a,b)=>a.time-b.time||a.delta-b.delta);
    let used=0;return events.every(event=>{used+=event.delta;return used<=Number(e.capacity);});
  }));
  check('Advance prep reviewed',plan.tasks.every(t=>!t.prepDate||t.prepDate===plan.project.serviceDate||(t.advance_reviewed&&t.advance_source?.trim())),'Every advance-prep task needs a chef-reviewed storage, holding and handover reference. This does not independently validate food safety.');
  check('Equipment availability & capacity', equipmentValid, 'Equipment remains occupied for active plus passive time; summed batch slots must fit.');
  check('Reviewed timing inputs', plan.tasks.length>0 && plan.tasks.every(t=>t.reviewed&&t.active!==''&&t.passive!==''&&t.active!=null&&t.passive!=null&&Number.isInteger(Number(t.active))&&Number.isInteger(Number(t.passive))&&Number(t.active)>=0&&Number(t.passive)>=0&&Number(t.active)+Number(t.passive)>0), 'Chef review of duration is recorded separately from evidence of measurement.');
  const tasks=plan.tasks.map(t=>{
    const allocation=rows.find(r=>r.id===t.id), record=plan.recipes.find(r=>r.id===t.versionId);
    const recipe=record?.recipe_json, target=plan.recipeTargets.find(r=>r.id===t.versionId);
    const sourceStep=recipe?.production_steps?.[t.sourceStepIndex];
    const timingSource=sourceStep?.timing_source?.trim()||'';
    const trace=allocation?.placement || plan.unscheduled.find(r=>r.id===t.id)?.placement;
    return {id:t.id,title:`${t.recipeName} · ${t.description} · batch ${t.batch}`,version:t.versionId,versionNumber:record?.version_number,step:t.sourceStepIndex==null?'Not recorded':t.sourceStepIndex+1,sources:recipe?.source_evidence_ids||[],batch:`${target?.quantity} ${recipe?.yield.unit} target ÷ ${recipe?.yield.quantity} ${recipe?.yield.unit} source batch = ${target?.scale}×; ${Math.ceil(target?.scale||0)} batches. This batch: ${t.quantity} ${t.unit}.`,timing:`${t.active} min active + ${t.passive} min passive. Full duration retained for partial batches. Priority: ${t.priority||'normal'}. ${t.prepDate&&t.prepDate<plan.project.serviceDate?`Advance prep reference: ${t.advance_source||'missing'}.`: ''}`,timingSource:timingSource||'No timing source recorded',timingBasis:sourceStep?.timing_basis||'Not recorded',timingEvidencePresent:!!timingSource,dependencies:t.dependencies,allocation:allocation?`${t.prepDate||plan.project.serviceDate} · ${clock(allocation.start)}–${clock(allocation.end)}; ${allocation.chefName}; active work ends ${clock(allocation.activeEnd)}.`:'Unscheduled',equipment:t.equipmentId?`${equipment.find(e=>e.id===t.equipmentId)?.name||t.equipmentId}; ${t.capacity} slots occupied`:'No equipment assigned',reason:trace?`Search window ${clock(trace.earliest)}–${clock(trace.latest)}. Earlier candidate starts rejected: staff ${trace.rejectedCandidates.staff}, equipment hours ${trace.rejectedCandidates.equipmentHours}, equipment capacity ${trace.rejectedCandidates.equipmentCapacity}.`: 'Candidate-start trace was not recorded in this saved plan.',override:plan.project.overrides[t.id]?.assignee?'Person selected by operator; role and availability checks still apply.':'First available eligible person in the recorded staff order.'};
  });
  return {engineVersion:plan.engineVersion,checks,tasks,missingTimingEvidence:tasks.filter(t=>!t.timingEvidencePresent).length,method:plan.engineVersion>=3?'Tasks use explicit prep dates and dated shifts. Urgent and high-priority work pulls its prerequisites forward; dependencies remain mandatory. Each task takes the first feasible whole-minute start and first eligible person in the dated staff order. Priority cannot override handling review, skills, shifts, capacity or deadlines. This is a greedy planner, not a global optimisation.':'Recipe steps retain source order; approved sub-recipes finish before parent work starts. Recipes and batches are considered in menu traversal order. Each task takes the first feasible whole-minute start and first eligible person in staff order. This is a same-day greedy planner, not a global optimisation.',limits:'These checks validate the recorded inputs and allocations. They do not establish food-safety compliance, verify source documents, measure real cooking time, or prove that a better schedule does not exist. Automatic cooling/holding validation, overnight tasks, off-site travel and unrecorded cleanup are outside this planner. Other projects are planned separately; combined-calendar resource alerts need review.'};
}
export function evidenceSections(plan) {
  const e=scheduleEvidence(plan);
  return [
    {name:'Schedule design basis',headers:['Basis','Evidence'],rows:[['Algorithm',e.method],['Planner version',String(e.engineVersion)],['Timing provenance',`${e.missingTimingEvidence} tasks have no recorded timing source. A reviewed duration is not proof of measurement.`],['Limits',e.limits]]},
    {name:'Schedule verification',headers:['Check','Result','Basis'],rows:e.checks.map(c=>[c.name,c.passed===null?'Not evaluated':c.passed?'Pass for recorded inputs':'Needs attention',c.detail])},
    {name:'Task evidence',headers:['Task','Basis','Evidence'],rows:e.tasks.flatMap(t=>[
      [t.title,'Recipe version & source',`${t.version} / v${t.versionNumber} / step ${t.step}. ${t.sources.join('; ')}`],
      [t.title,'Batch calculation',t.batch],
      [t.title,'Timing',`${t.timing} Basis: ${t.timingBasis}. ${t.timingSource}`],
      [t.title,'Allocation & equipment',`${t.allocation} ${t.equipment}`],
      [t.title,'Dependencies',t.dependencies.join('; ')||'None'],
      [t.title,'Placement explanation',`${t.reason} ${t.override}`]
    ])}
  ];
}
