import { workingDays, normalPriority, priorityTaskOrder } from './prepDates.js';
import { calculateYield } from './yield.js';
// This path accepts reviewed quantities only; legacy portion heuristics never enter a client plan.
const units = { g: ['mass', 1], kg: ['mass', 1000], ml: ['volume', 1], l: ['volume', 1000], each: ['count', 1], pcs: ['count', 1], portion: ['portion', 1] };
const positive = n => Number.isFinite(Number(n)) && Number(n) > 0;
const round = n => Math.round((n + Number.EPSILON) * 1e6) / 1e6;
export function convert(quantity, from, to) {
  if (!units[from] || !units[to] || units[from][0] !== units[to][0] || !Number.isFinite(Number(quantity))) throw new Error(`UNIT CONVERSION REQUIRED: ${from} → ${to}`);
  return Number(quantity) * units[from][1] / units[to][1];
}
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
export const fingerprint = value => JSON.stringify(stable(value));
export const blankProject = () => ({ name: '', serviceDate: '', timeZone: 'Europe/London', serviceTime: '18:00', startTime: '09:00', currency: 'GBP', guests: '', scope: 'Recipe, purchasing and production package', priceMaxAgeDays: 30, menu: [], staff: [], equipment: [], prices: [], reconciliations: [], overrides: {}, notes: '', yieldActuals: {} });
export const minutes = time => /^\d{2}:\d{2}$/.test(time || '') && Number(time.slice(0, 2)) < 24 && Number(time.slice(3)) < 60 ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : NaN;
export const clock = value => {const local=((value%1440)+1440)%1440;return `${String(Math.floor(local/60)).padStart(2,'0')}:${String(local%60).padStart(2,'0')}`;};

export function buildPlan(project, versions, clientId) {
  const exceptions = [];
  const add = (code, problem, evidence, severity = 'blocker') => exceptions.push({ id: `${code}-${exceptions.length}`, code, problem, evidence, severity, action: severity === 'blocker' ? 'Correct the source or record a reviewed clarification, then regenerate.' : 'Retain this qualification in the delivery package.' });
  const recipes = new Map(versions.filter(v => v.client_id === clientId && v.status === 'approved').map(v => [v.id, v]));
  const start = minutes(project.startTime), deadline = minutes(project.serviceTime);
  if (!project.name.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(project.serviceDate) || !positive(project.guests)) add('INTAKE REQUIRED', 'Enter project name, service date and guest count.', 'Project intake');
  if (!Number.isFinite(start) || !Number.isFinite(deadline) || start >= deadline) add('TIME REQUIRED', 'Choose a same-day start before the service deadline.', 'Project intake');
  if (!Number.isFinite(Number(project.priceMaxAgeDays)) || Number(project.priceMaxAgeDays) < 0) add('PRICE POLICY REQUIRED', 'Enter a nonnegative maximum price age.', 'Price policy');
  for (const person of project.staff) {
    if (!person.name || !person.roles || !(minutes(person.start) < minutes(person.end)) || ((person.breakStart || person.breakEnd) && !(minutes(person.breakStart) < minutes(person.breakEnd)))) add('STAFF REVIEW REQUIRED', 'Check staff name, roles, shift and complete break interval.', person.name || person.id);
  }
  if (!project.menu.length) add('MENU REQUIRED', 'Add at least one approved recipe.', 'Menu');
  const demand = new Map(), leaves = new Map(), recipeCosts = [], pinned = new Map();
  function visit(id, quantity, unit, stack = [], root = id) {
    const row = recipes.get(id);
    if (!row) { add('RECIPE VERSION REQUIRED', 'An approved recipe from this kitchen is required.', id); return; }
    if (stack.includes(id)) { add('RECIPE CYCLE', 'Circular sub-recipe reference.', [...stack, id].join(' → ')); return; }
    const r = row.recipe_json;
    if (!positive(r.yield?.quantity)) { add('YIELD REQUIRED', `Missing yield for ${r.title}.`, id); return; }
    let scale;
    try { scale = convert(quantity, unit, r.yield.unit) / r.yield.quantity; } catch (e) { add('UNIT CONVERSION REQUIRED', e.message, r.title); return; }
    if (scale > 500 || stack.length > 20) { add('PLAN LIMIT', 'Split this event or simplify nested recipes.', r.title); return; }
    if (!positive(scale)) { add('QUANTITY REQUIRED', 'Target must be greater than zero.', r.title); return; }
    pinned.set(id, row);
    demand.set(id, (demand.get(id) || 0) + scale);
    if (!r.source_evidence_ids?.length) add('SOURCE REQUIRED', `Source reference missing for ${r.title}.`, id);
    if (!r.allergen_reviewed || !r.handling_reviewed) add('REVIEW REQUIRED', `Review allergens and handling for ${r.title}.`, id);
    if (!r.ingredients?.length) add('INGREDIENT REVIEW REQUIRED', 'Recipe has no ingredients.', r.title);
    for (const ing of r.ingredients || []) {
      if (ing.recipe_version_id) { visit(ing.recipe_version_id, Number(ing.quantity) * scale, ing.unit, [...stack, id], root); continue; }
      if (!ing.canonical_id || ing.needs_review || !positive(ing.quantity)) { add('INGREDIENT REVIEW REQUIRED', `Check ${ing.clean_name || 'ingredient'}.`, r.title); continue; }
      const domain = units[ing.unit];
      if (!domain) { add('UNIT CONVERSION REQUIRED', `Unsupported unit ${ing.unit}.`, r.title); continue; }
      const baseUnit = { mass: 'g', volume: 'ml', count: 'each', portion: 'portion' }[domain[0]];
      const key = `${ing.canonical_id}|${ing.product_form || ''}|${baseUnit}`;
      const factor = ing.prep_state === 'as_purchased' ? 1 : Number(ing.purchase_yield);
      if (!positive(factor) || factor > 1) { add('YIELD REQUIRED', `Approved purchase yield required for ${ing.clean_name}.`, r.title); continue; }
      const required = convert(Number(ing.quantity) * scale, ing.unit, baseUnit) / factor;
      const leaf = leaves.get(key) || { key, canonicalId: ing.canonical_id, name: ing.clean_name, form: ing.product_form || '', unit: baseUnit, required: 0, recipeDemands: {} };
      leaf.required += required;
      leaf.recipeDemands[root] = (leaf.recipeDemands[root] || 0) + required;
      leaves.set(key, leaf);
    }
  }
  for (const item of project.menu) visit(item.versionId, item.quantity, item.unit);
  const purchasing = [...leaves.values()].map(leaf => {
    const price = project.prices.find(p => p.key === leaf.key);
    let packSize, cost = null, packs = null, purchased = null;
    const date = price?.date;
    const age = (Date.parse(project.serviceDate) - Date.parse(date)) / 86400000;
    if (!price || !price.reviewed || !positive(price.packQuantity) || !Number.isFinite(Number(price.packPrice)) || price.packPrice === '' || Number(price.packPrice) < 0 || price.currency !== project.currency || !price.source || !Number.isFinite(age) || age < 0 || age > Number(project.priceMaxAgeDays)) {
      add('PRICE REQUIRED', `Current, reviewed ${project.currency} pack price required for ${leaf.name}.`, leaf.key);
    } else {
      try { packSize = convert(price.packQuantity, price.unit, leaf.unit); } catch (e) { add('UNIT CONVERSION REQUIRED', e.message, leaf.name); }
      if (positive(packSize)) { packs = Math.ceil(round(leaf.required / packSize)); purchased = packs * packSize; cost = leaf.required / packSize * Number(price.packPrice); }
    }
    return { ...leaf, required: round(leaf.required), packSize, packs, purchased, surplus: purchased === null ? null : round(purchased - leaf.required), cost, purchaseCost: packs === null ? null : packs * Number(price.packPrice), price: price || null };
  });
  for (const item of project.menu) {
    const relevant = purchasing.filter(p => p.recipeDemands[item.versionId]);
    const total = relevant.length && relevant.every(p => p.cost !== null) ? relevant.reduce((sum, p) => sum + p.cost * p.recipeDemands[item.versionId] / p.required, 0) : null;
    const perPortion = total !== null && item.unit === 'portion' && positive(item.quantity) ? total / Number(item.quantity) : null;
    const selling = positive(item.sellingPrice) ? Number(item.sellingPrice) : null;
    recipeCosts.push({ versionId: item.versionId, total, perPortion, selling, foodCostPercent: perPortion !== null && selling ? perPortion / selling * 100 : null, grossMarginPercent: perPortion !== null && selling ? (selling - perPortion) / selling * 100 : null });
  }
  for (const rec of project.reconciliations) {
    const delta = Number(rec.sourceKg) - Number(rec.portions) * Number(rec.portionG) / 1000;
    if (!Number.isFinite(delta) || !positive(rec.sourceKg) || !positive(rec.portions) || !positive(rec.portionG)) add('RECONCILIATION REQUIRED', 'Complete both sides of the quantity comparison.', rec.source || 'Reconciliation');
    else if (Math.abs(delta) > 0.000001) add('QUANTITY DIFFERENCE', `${round(delta)} kg difference: ${rec.sourceKg} kg versus ${rec.portions} × ${rec.portionG} g. ${rec.resolution || 'Clarify processing stage and allocation; this is not confirmed waste.'}`, rec.source || 'Source required', rec.reviewed && rec.resolution?.trim() && rec.source?.trim() ? 'warning' : 'blocker');
  }
  const workDays=workingDays(project);
  const tasks = [], recipeEnds = new Map();
  const makeTasks = (id, stack = []) => {
    if (recipeEnds.has(id) || stack.includes(id)) return;
    const row = pinned.get(id); if (!row) return;
    const r = row.recipe_json, scale = demand.get(id);
    const children = (r.ingredients || []).filter(i => i.recipe_version_id).map(i => i.recipe_version_id);
    children.forEach(child => makeTasks(child, [...stack, id]));
    const steps = r.production_steps || [];
    if (!steps.length) add('TASKS REQUIRED', `Enter production steps for ${r.title}.`, id);
    const endIds = [];
    for (let b = 0; b < Math.min(500, Math.ceil(scale)); b++) {
      let previous = children.flatMap(child => recipeEnds.get(child) || []);
      steps.forEach((step, index) => {
        const taskId = `${id}:${b}:${index}`;
        const task = { ...step, id: taskId, versionId: id, recipeName: r.title, batch: b + 1, quantity: round(Math.min(1, scale - b) * r.yield.quantity), unit: r.yield.unit, dependencies: previous, ...project.overrides[taskId], sourceStepIndex: index, sourceEquipmentId: step.equipmentId || null, prepDate: project.overrides[taskId]?.prepDate || project.serviceDate, priority: normalPriority(project.overrides[taskId]?.priority || step.priority) };
        if (!step.reviewed || task.active === '' || task.passive === '' || task.active == null || task.passive == null || !Number.isInteger(Number(task.active)) || !Number.isInteger(Number(task.passive)) || Number(task.active) < 0 || Number(task.passive) < 0 || Number(task.active) + Number(task.passive) <= 0 || !task.description || !task.role) add('DURATION REVIEW REQUIRED', `Review timing, role and description for ${r.title}, step ${index + 1}.`, taskId);
        tasks.push(task); previous = [taskId];
      });
      endIds.push(...previous);
    }
    recipeEnds.set(id, endIds);
  };
  [...demand.keys()].forEach(id => makeTasks(id));
  if (tasks.length > 500) add('PLAN LIMIT', 'Split this event: the first planner supports up to 500 tasks.', 'Task library');
  const schedule = [], unscheduled = [];
  const overlap = (a, b, c, d) => a < b && c < d && a < d && c < b;
  for (const task of priorityTaskOrder(tasks.slice(0, 500))) {
    const day=workDays.find(d=>d.date===task.prepDate);
    if(!day||!(minutes(day.startTime)<minutes(day.endTime))) {unscheduled.push({...task,reason:'Choose a configured prep day with a valid working window.'});continue;}
    const offset=day.offset;
    if(task.prepDate<project.serviceDate && (!task.advance_reviewed||!task.advance_source?.trim())) {unscheduled.push({...task,reason:'Advance prep needs a reviewed storage, holding and handover reference before scheduling.'});continue;}
    if(day.staff.some(s=>!s.name||!s.roles||!(minutes(s.start)<minutes(s.end))||((s.breakStart||s.breakEnd)&&!(minutes(s.breakStart)<minutes(s.breakEnd)))))add('STAFF REVIEW REQUIRED',`Check dated staff availability on ${day.date}.`,day.date);

    const deps = task.dependencies.map(id => schedule.find(t => t.id === id));
    if (deps.some(d => !d)) { unscheduled.push({ ...task, reason: 'An upstream task could not be scheduled.' }); continue; }
    const active = Number(task.active), duration = active + Number(task.passive);
    if (!Number.isInteger(duration) || duration <= 0 || active < 0 || Number(task.passive) < 0) { unscheduled.push({ ...task, reason: 'Reviewed duration required.' }); continue; }
    const equipment = task.equipmentId ? day.equipment.find(e => e.id === task.equipmentId) : null;
    if (task.equipmentId && (!equipment || !positive(task.capacity) || !positive(equipment.capacity) || Number(task.capacity) > Number(equipment.capacity))) { unscheduled.push({ ...task, reason: 'Equipment missing or batch capacity exceeds equipment capacity.' }); continue; }
    const dayStart=offset+minutes(day.startTime), dayEnd=offset+minutes(day.endTime);
    const earliest = Math.max(dayStart, ...deps.map(d => d.end), task.earliest ? offset+minutes(task.earliest) : dayStart);
    const latest = Math.min(deadline, dayEnd, task.latest ? offset+minutes(task.latest) : dayEnd);
    let allocation;
    const rejectedCandidates = { staff: 0, equipmentHours: 0, equipmentCapacity: 0 };
    const placement = { earliest, latest, dependencyEnds: deps.map(d => ({ id: d.id, end: d.end })), rejectedCandidates };
    for (let t = earliest; t + duration <= latest && !allocation; t++) {
      const chef = day.staff.find(s => (!task.assignee || task.assignee === s.id) && (s.roles || '').split(',').map(v => v.trim()).includes(task.role)
        && t >= offset+minutes(s.start) && t + active <= offset+minutes(s.end)
        && !(s.breakStart && s.breakEnd && overlap(t, t + active, offset+minutes(s.breakStart), offset+minutes(s.breakEnd)))
        && !schedule.some(a => a.chefId === s.id && overlap(t, t + active, a.start, a.activeEnd)));
      if (!chef) { rejectedCandidates.staff++; continue; }
      if (equipment) {
        if (t < offset+minutes(equipment.start) || t + duration > offset+minutes(equipment.end)) { rejectedCandidates.equipmentHours++; continue; }
        let overloaded = false;
        for (let minute = t; minute < t + duration; minute++) {
          const used = schedule.filter(a => a.equipmentId === equipment.id && a.start <= minute && minute < a.end).reduce((sum, a) => sum + Number(a.capacity), 0);
          if (used + Number(task.capacity) > Number(equipment.capacity)) { overloaded = true; break; }
        }
        if (overloaded) { rejectedCandidates.equipmentCapacity++; continue; }
      }
      allocation = { ...task, chefId: chef.id, chefName: chef.name, start: t, activeEnd: t + active, end: t + duration, placement };
    }
    if (allocation) schedule.push(allocation);
    else unscheduled.push({ ...task, placement, reason: 'No slot found within staff skills, shifts, breaks, equipment and deadline. Reassign, add time/resources or revise reviewed batch steps.' });
  }
  for (const task of unscheduled) add('NO FEASIBLE PLAN FOUND', `${task.recipeName}: ${task.description}. ${task.reason}`, task.id);
  const yields = [...pinned.values()].map(row => {
    const scale = demand.get(row.id);
    const target = row.recipe_json.yield.unit === 'portion' ? row.recipe_json.yield.quantity * scale : null;
    const report = calculateYield(row.recipe_json.yield_profile, scale, target, project.yieldActuals?.[row.id]);
    const actual = project.yieldActuals?.[row.id] || {};
    const supplied = value => value !== undefined && value !== null && value !== '';
    if (report.actualUsable === null) add('ACTUAL YIELD UNMEASURED', `${row.title}: actual event usable weight is unmeasured; the plan uses projected yield.`, row.id, 'warning');
    if ((supplied(actual.usable_g) && report.actualUsable === null) || (supplied(actual.portions) && report.actualPortions === null)) add('ACTUAL MEASUREMENT REVIEW REQUIRED', 'Check actual weights and whole-number portion counts.', row.id);
    if ((report.actualUsable !== null || report.actualPortions !== null) && !report.actualSource.trim()) add('ACTUAL MEASUREMENT EVIDENCE REQUIRED', 'Record the source of the actual event measurement.', row.id);

    if (row.recipe_json.yield_profile && report.allocationDifference !== null && Math.abs(report.allocationDifference) > 0.001) add('YIELD ALLOCATION DIFFERENCE', `${row.title}: projected usable minus portion allocation is ${round(report.allocationDifference)} g; investigate stage and portion definitions.`, row.id);
    return { versionId: row.id, title: row.title, report };
  });
  const completeCost = purchasing.length > 0 && purchasing.every(p => p.cost !== null);
  return { engineVersion: 3, workDays, clientId, project: structuredClone(project), recipes: [...pinned.values()], recipeTargets: [...demand].map(([id, scale]) => ({ id, scale, quantity: round(scale * pinned.get(id).recipe_json.yield.quantity) })), purchasing, recipeCosts, yields, tasks, schedule, unscheduled, exceptions, cost: completeCost ? purchasing.reduce((s, p) => s + p.cost, 0) : null, purchaseCost: completeCost ? purchasing.reduce((s, p) => s + p.purchaseCost, 0) : null, ready: exceptions.every(e => e.severity !== 'blocker') && schedule.length === tasks.length && tasks.length > 0 };
}

export function approvePlan(plan, actor, createdAt = new Date().toISOString()) {
  if (!plan.ready) throw new Error('Resolve blocking exceptions before approval.');
  if (!['manager', 'owner'].includes(actor.role) || actor.clientId !== plan.clientId) throw new Error('Manager membership in this kitchen is required.');
  return structuredClone({ ...plan, approvedBy: actor.id, approvedAt: createdAt, status: 'approved' });
}
