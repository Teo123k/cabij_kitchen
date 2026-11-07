import { buildPlan } from '../../src/operations/engine.js';
import { scheduleEvidence } from '../../src/operations/scheduleEvidence.js';

export const schedulingPolicy = Object.freeze({ comparison: 'exact', timeUnit: 'whole-minute', taskLimit: 500, authority: 'javascript-operations-v3' });
const schedulingCodes = new Set(['STAFF REVIEW REQUIRED', 'TASKS REQUIRED', 'DURATION REVIEW REQUIRED', 'NO FEASIBLE PLAN FOUND']);
export function referenceScheduling(request) {
  const plan = buildPlan(request.project, request.versions, request.clientId);
  const { workDays, tasks, schedule, unscheduled } = plan;
  return JSON.parse(JSON.stringify({ engineVersion: 'javascript-operations-v3', referenceEngineVersion: plan.engineVersion, mode: 'shadow',
    scheduling: { workDays, tasks, schedule, unscheduled,
      exceptions: plan.exceptions.filter(e => schedulingCodes.has(e.code) || (e.code === 'PLAN LIMIT' && e.evidence === 'Task library')).map(({ code, problem, evidence, severity }) => ({ code, problem, evidence, severity })),
      evidence: scheduleEvidence(plan) } }));
}

export function compareScheduling(expected, actual, path = '$') {
  const differences = [];
  const visit = (a, b, key) => {
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) differences.push({ path: `${key}.length`, expected: a.length, actual: b.length });
      a.forEach((value, index) => visit(value, b[index], `${key}[${index}]`));
    } else if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (Object.hasOwn(a, field) !== Object.hasOwn(b, field)) differences.push({ path: `${key}.${field}`, expectedPresent: Object.hasOwn(a, field), actualPresent: Object.hasOwn(b, field) });
        else visit(a[field], b[field], `${key}.${field}`);
      }
    } else if (a !== b) differences.push({ path: key, expected: a, actual: b });
  };
  visit(expected, actual, path);
  return differences;
}
