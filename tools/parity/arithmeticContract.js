import { buildPlan, convert } from '../../src/operations/engine.js';

export const parityPolicy = Object.freeze({ absoluteTolerance: 1e-6, relativeTolerance: 1e-12 });
const arithmeticCodes = new Set(['PRICE POLICY REQUIRED', 'MENU REQUIRED', 'RECIPE VERSION REQUIRED', 'RECIPE CYCLE', 'YIELD REQUIRED', 'UNIT CONVERSION REQUIRED', 'PLAN LIMIT', 'QUANTITY REQUIRED', 'SOURCE REQUIRED', 'REVIEW REQUIRED', 'INGREDIENT REVIEW REQUIRED', 'PRICE REQUIRED', 'RECONCILIATION REQUIRED', 'QUANTITY DIFFERENCE', 'ACTUAL YIELD UNMEASURED', 'ACTUAL MEASUREMENT REVIEW REQUIRED', 'ACTUAL MEASUREMENT EVIDENCE REQUIRED', 'YIELD ALLOCATION DIFFERENCE']);

export function referenceArithmetic(request) {
  const plan = buildPlan(request.project, request.versions, request.clientId);
  const { recipeTargets, purchasing, recipeCosts, yields, cost, purchaseCost } = plan;
  return JSON.parse(JSON.stringify({
    engineVersion: 'javascript-operations-v3', referenceEngineVersion: plan.engineVersion, mode: 'shadow',
    arithmetic: { recipeTargets, purchasing: purchasing.map(p => ({ ...p, packSize: p.packSize ?? null })), recipeCosts, yields,
      exceptions: plan.exceptions.filter(e => arithmeticCodes.has(e.code) && !(e.code === 'PLAN LIMIT' && e.evidence === 'Task library')).map(({ code, problem, evidence, severity }) => ({ code, problem, evidence, severity })), cost, purchaseCost },
    conversions: (request.conversions || []).map(c => { try { return { value: convert(c.quantity, c.from, c.to) }; } catch (e) { return { error: e.message }; } }),
  }));
}

export function compareArithmetic(expected, actual, path = '$') {
  const differences = [];
  const visit = (a, b, key) => {
    if (typeof a === 'number' && typeof b === 'number') {
      if (/\.(packs|portionCount|projectedPortions|actualPortions)$/.test(key)) {
        if (a !== b) differences.push({ path: key, expected: a, actual: b, allowed: 0 });
        return;
      }
      const allowed = Math.max(parityPolicy.absoluteTolerance, parityPolicy.relativeTolerance * Math.max(Math.abs(a), Math.abs(b)));
      if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > allowed) differences.push({ path: key, expected: a, actual: b, allowed });
    } else if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) differences.push({ path: `${key}.length`, expected: a.length, actual: b.length });
      a.forEach((v, i) => visit(v, b[i], `${key}[${i}]`));
    } else if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      for (const field of keys) visit(a[field], b[field], `${key}.${field}`);
    } else if (a !== b) differences.push({ path: key, expected: a, actual: b });
  };
  visit(expected, actual, path);
  return differences;
}
