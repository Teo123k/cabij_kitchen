const present = value => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value));
const grams = stage => present(stage?.grams) && Number(stage.grams) >= 0 ? Number(stage.grams) : null;
const value = n => n === null ? 'not supplied' : `${Number(n.toFixed(3))} g`;
export const yieldStages = [['purchased', 'As purchased'], ['prepared', 'Prepared / edible raw'], ['cooked', 'Cooked'], ['usable', 'Finished usable']];
export function calculateYield(profile = {}, scale = 1, targetPortions = null, actual = {}) {
  const stages = yieldStages.map(([key, label]) => ({ key, label, grams: grams(profile[key]), basis: profile[key]?.basis || 'assumed', source: profile[key]?.source || '' }));
  const transitions = stages.slice(1).map((to, i) => {
    const from = stages[i];
    const comparable = from.grams !== null && to.grams !== null && from.grams > 0;
    return { from: from.label, to: to.label, input: from.grams, output: to.grams, yieldPercent: comparable ? to.grams / from.grams * 100 : null, changeGrams: comparable ? to.grams - from.grams : null,
      formula: comparable ? `${value(to.grams)} / ${value(from.grams)} × 100 = ${(to.grams / from.grams * 100).toFixed(2)}%` : 'YIELD REQUIRED: both stage weights and a positive input are needed.' };
  });
  const purchased = stages[0].grams, usable = stages[3].grams;
  const portion = present(profile.portion_g) && Number(profile.portion_g) > 0 ? Number(profile.portion_g) : null;
  const portionCount = usable !== null && portion !== null ? Math.floor((usable + 1e-8) / portion) : null;
  const overallPercent = purchased !== null && purchased > 0 && usable !== null ? usable / purchased * 100 : null;
  const actualUsable = present(actual.usable_g) && Number(actual.usable_g) >= 0 ? Number(actual.usable_g) : null;
  const actualPortions = present(actual.portions) && Number.isInteger(Number(actual.portions)) && Number(actual.portions) >= 0 ? Number(actual.portions) : null;
  const projectedUsable = usable === null ? null : usable * scale;
  const targetWeight = targetPortions !== null && portion !== null ? Number(targetPortions) * portion : null;
  const warnings = [];
  if (stages.some(s => s.grams === null)) warnings.push('YIELD REQUIRED: one or more stage weights are missing; no missing stage has been inferred.');
  if (!profile.same_scope) warnings.push('Confirm that all four weights refer to the same batch and ingredient scope. Added liquid or ingredients can create a mass gain.');
  if (!profile.reviewed) warnings.push('Yield information has not been reviewed.');
  if (stages.some(s => s.basis !== 'measured' || !s.source.trim())) warnings.push('Some source-batch weights are assumed or have no measurement evidence. Projections remain provisional.');
  if (transitions.some(t => t.changeGrams > 0)) warnings.push('A stage gains mass. Check additions and measurement scope; the gain is not automatically an error.');
  if (portion === null) warnings.push('PORTION WEIGHT REQUIRED: enter a positive finished portion weight.');
  if (actualUsable === null) warnings.push('Actual event usable weight is unmeasured.');
  if ((actualUsable !== null || actualPortions !== null) && !actual.source?.trim()) warnings.push('Actual event measurement source is required.');
  const measured = !!profile.reviewed && !!profile.same_scope && stages.every(s => s.grams !== null && s.basis === 'measured' && s.source.trim());
  return { stages, transitions, scale, measured, status: measured ? 'Measured source batch; event quantities are projections' : 'Provisional source batch', overallPercent, portionGrams: portion, portionCount,
    remainderGrams: portionCount === null ? null : usable - portionCount * portion,
    projectedStages: stages.map(s => ({ ...s, grams: s.grams === null ? null : s.grams * scale })), projectedUsable,
    projectedPortions: projectedUsable !== null && portion !== null ? Math.floor((projectedUsable + 1e-8) / portion) : null,
    targetPortions, targetWeight, allocationDifference: projectedUsable !== null && targetWeight !== null ? projectedUsable - targetWeight : null,
    actualUsable, actualPortions, actualSource: actual.source || '',
    varianceGrams: actualUsable !== null && projectedUsable !== null ? actualUsable - projectedUsable : null,
    variancePercent: actualUsable !== null && projectedUsable > 0 ? (actualUsable - projectedUsable) / projectedUsable * 100 : null,
    warnings };
}
export function yieldLines(report) {
  const pct = n => n === null ? 'YIELD REQUIRED' : `${n.toFixed(2)}%`;
  return [report.status, ...report.stages.map(s => `${s.label}: ${value(s.grams)} | ${s.basis} | ${s.source || 'evidence required'}`),
    ...report.transitions.map(t => `${t.from} to ${t.to}: ${t.formula}${t.changeGrams === null ? '' : `; net mass change ${value(t.changeGrams)}`}`),
    `Overall usable yield = finished usable / purchased × 100: ${pct(report.overallPercent)}`,
    `Finished portion weight: ${value(report.portionGrams)}`,
    `Source-batch whole portions = floor(usable / portion weight): ${report.portionCount ?? 'PORTION WEIGHT REQUIRED'}; remainder ${value(report.remainderGrams)}`,
    `Event projection: source batch × ${report.scale}; usable ${value(report.projectedUsable)}; whole portions ${report.projectedPortions ?? 'not calculable'}`,
    `Target allocation: ${report.targetPortions ?? 'not defined in portions'} portions; ${value(report.targetWeight)}; usable minus allocation ${value(report.allocationDifference)}`,
    `Actual event usable: ${value(report.actualUsable)}; actual portions ${report.actualPortions ?? 'unmeasured'}; evidence ${report.actualSource || 'not supplied'}`,
    `Actual minus projected usable: ${value(report.varianceGrams)}; variance ${report.variancePercent === null ? 'UNMEASURED' : pct(report.variancePercent)}`,
    'Mass changes are arithmetic differences, not confirmed waste. Purchasing quantities continue to use the reviewed ingredient purchase-yield factors.', ...report.warnings];
}
