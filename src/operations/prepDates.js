export const dateNumber = date => {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return NaN;
  const time=Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===date?time/86400000:NaN;
};
export const shiftDate = (date,days) => new Date((dateNumber(date)+days)*86400000).toISOString().slice(0,10);
export const normalPriority = value => {const priority=String(value||'').toLowerCase();return ['urgent','high','normal'].includes(priority)?priority:'normal';};
export const priorityRank = value => ({urgent:2,high:1,normal:0})[normalPriority(value)];
export function workingDays(project) {
  const service={date:project.serviceDate,startTime:project.startTime,endTime:project.serviceTime,staff:project.staff,equipment:project.equipment};
  return [...(project.prepDays||[]).filter(d=>d.date<project.serviceDate),service].filter((d,i,all)=>Number.isFinite(dateNumber(d.date))&&d.date<=project.serviceDate&&all.findIndex(a=>a.date===d.date)===i).map(d=>({...d,offset:(dateNumber(d.date)-dateNumber(project.serviceDate))*1440,staff:d.staff||project.staff,equipment:d.equipment||project.equipment})).sort((a,b)=>a.date.localeCompare(b.date));
}
// Urgent dependents pull their prerequisites forward without violating source order.
export function priorityTaskOrder(tasks) {
  const ranks=new Map(tasks.map(t=>[t.id,priorityRank(t.priority)])), byId=new Map(tasks.map(t=>[t.id,t]));
  const promote=(id,rank,seen=new Set())=>{if(seen.has(id))return;seen.add(id);const task=byId.get(id);if(!task)return;ranks.set(id,Math.max(ranks.get(id),rank));task.dependencies.forEach(d=>promote(d,rank,seen));};
  tasks.forEach(t=>promote(t.id,priorityRank(t.priority)));
  const pending=[...tasks],done=new Set(),ordered=[];
  while(pending.length){const ready=pending.filter(t=>t.dependencies.every(d=>done.has(d)||!byId.has(d))).sort((a,b)=>ranks.get(b.id)-ranks.get(a.id));const next=ready[0]||pending[0];ordered.push(next);done.add(next.id);pending.splice(pending.indexOf(next),1);}
  return ordered;
}
