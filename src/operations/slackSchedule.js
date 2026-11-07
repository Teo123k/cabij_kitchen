import { clock } from './engine.js';
import { prepRows, groupPrep } from './prepPresentation.js';
import { dateNumber } from './prepDates.js';
import { provenanceText } from './exportSource.js';
const clean = value => String(value ?? '').replace(/[<>]/g, '').replace(/@(everyone|here|channel)/gi, '$1').replace(/[\r\n]+/g, ' ');
export function scheduleOptions(input={}) {
  const groupBy=input.groupBy||'person';
  if(!['role','dish','person','equipment'].includes(groupBy))throw new Error('Choose a valid prep grouping.');
  const startDate=input.startDate||'',endDate=input.endDate||'';
  if((startDate||endDate)&&(!Number.isFinite(dateNumber(startDate))||!Number.isFinite(dateNumber(endDate))||startDate>endDate||dateNumber(endDate)-dateNumber(startDate)>366))throw new Error('Choose a valid date range of up to one year.');
  return {groupBy,selection:String(input.selection||'').slice(0,200),urgentOnly:input.urgentOnly===true,startDate,endDate};
}
export function scheduleMessages(records,{requireApproved=true,...input}={}) {
  const options=scheduleOptions(input);
  if(!records.length)throw new Error('Choose an approved package.');
  for(const {plan} of records)if(requireApproved&&(plan.status!=='approved'||!plan.ready))throw new Error('Approve a complete package before sharing its schedule.');
  const rows=records.flatMap((r,i)=>prepRows(r.plan,r.packageId||String(i))).filter(t=>!options.startDate||(t.date>=options.startDate&&t.date<=options.endDate));
  if(options.selection&&!groupPrep(rows,{groupBy:options.groupBy}).some(g=>g.selection===options.selection))throw new Error('The selected role, dish or person has no tasks in this range.');
  const groups=groupPrep(rows,options);
  if(!groups.length)throw new Error('No prep tasks match this view.');
  const lines=['CABIJ TEAM SCHEDULE',`View: ${options.groupBy}${options.urgentOnly?' | PRIORITY ONLY':''}${options.startDate?` | ${options.startDate} to ${options.endDate}`:''}`];
  if(records.some(r=>r.plan.project.sample))lines.unshift('SYNTHETIC REHEARSAL - PREVIEW ONLY');
  for(const {plan,packageId,revision} of records){lines.push(clean(provenanceText(plan)));lines.push(`${clean(plan.project.name)} | Service: ${clean(plan.project.serviceDate)} ${clean(plan.project.serviceTime)} | ${clean(plan.project.timeZone||'Europe/London')} | ${clean(plan.project.guests)} guests`,`Package approved: ${clean(plan.approvedAt||'draft preview')}`);if(packageId)lines.push(`Package reference: ${clean(packageId)}${revision?` / project revision ${revision}`:''}`);}
  lines.push('Times below use each project’s recorded timezone. Passive task time may continue after active labour ends.');
  for(const g of groups){
    lines.push('',`--- ${g.date} | ${clean(g.label)} ---`);
    for(const task of g.tasks){
      const record=records.find((r,i)=>(r.packageId||String(i))===task.projectId),p=record.plan;
      const roster=p.workDays?.find(d=>d.date===g.date)?.staff||p.project.staff, person=roster.find(s=>s.id===task.chefId);
      lines.push('',`[${task.priority.toUpperCase()}] ${task.time} | ${clean(task.description)}`,`Dish: ${clean(task.recipeName)} | batch ${task.batch} | ${task.quantity} ${clean(task.unit)}`,`Owner: ${clean(task.owner)} (${clean(task.role)}) | ${clean(task.equipmentName)}`,`${clean(task.projectName)} | ${clean(task.timeZone)} | active until ${task.labourEnd} / completes ${task.scheduled?clock(task.end):'UNSCHEDULED'}`);
      if(person)lines.push(`Shift ${person.start}-${person.end}${person.breakStart&&person.breakEnd?` | break ${person.breakStart}-${person.breakEnd}`:''}`);
      if(task.dependencies.length)lines.push(`Before starting: ${clean(task.dependenciesText)}`);
      if(task.blockedReason)lines.push(`BLOCKED: ${clean(task.blockedReason)}`);
      if(task.advance_source)lines.push(`Advance prep: ${clean(task.advance_source)}`);
    }
  }
  lines.push('','Use the approved recipe cards for handling, checkpoints and handovers. Changes require a new reviewed package.');
  const message=lines.join('\n');if(message.length>12000)throw new Error('This schedule is too long for one Slack handoff. Select a role, dish, person or shorter date range.');return message;
}
export function scheduleMessage(plan,options={}) {return scheduleMessages([{plan,packageId:options.packageId,revision:options.revision}],options);}
export function slackArguments(channelId, text) {
  if (!/^[CG][A-Z0-9]+$/.test(channelId)) throw new Error('Select a Slack channel.');
  return { channel: channelId, blocks: [{ type: 'section', text: { type: 'plain_text', text: text.slice(0, 2900), emoji: false } }, ...Array.from({ length: Math.ceil(Math.max(0, text.length - 2900) / 2900) }, (_, i) => ({ type: 'section', text: { type: 'plain_text', text: text.slice((i + 1) * 2900, (i + 2) * 2900), emoji: false } }))], fallback_text: text.slice(0, 3900), unfurl_links: false, unfurl_media: false };
}
