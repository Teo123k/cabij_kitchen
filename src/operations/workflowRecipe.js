const array = value => Array.isArray(value) ? value : [];
const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && /^\s*\d+(?:\.\d+)?\s*$/.test(value) ? Number(value) : null;
const massInGrams = (quantity, unit) => { const value = numeric(quantity); if (value === null) return null; if (unit === 'g') return value; if (unit === 'kg') return value * 1000; return null; };
const scaleAmount = (quantity, scale) => { const value = numeric(quantity); return value === null ? quantity : Number((value * scale).toFixed(3)); };
const standardiseToKilogram = (source, ingredients) => {
  if (source.source_kind !== 'document_upload') return { ingredients, metadata: { target_batch_g: 1000, source_batch_g: null, scale_factor: null, basis: 'source_preserved', source_yield: source.yield || null, cooked_yield_g: null, usable_yield_g: null, portion_g: numeric(source.yield_profile?.portion_g), portions_per_kg: null, needs_review: true } };
  const sourceYield = source.yield && numeric(source.yield.quantity) > 0 ? source.yield : null;
  const sourceYieldGrams = sourceYield ? massInGrams(sourceYield.quantity, sourceYield.unit) : null;
  const ingredientMass = ingredients.reduce((sum, row) => { const grams = massInGrams(row.quantity, row.unit); return grams === null ? null : (sum === null ? null : sum + grams); }, 0);
  const sourceBatchGrams = sourceYieldGrams || (ingredientMass > 0 ? ingredientMass : null);
  const scale = sourceBatchGrams ? 1000 / sourceBatchGrams : null;
  const standardIngredients = scale ? ingredients.map(row => ({ ...row, quantity: scaleAmount(row.quantity, scale), standardised_from_quantity: row.quantity, standardised_from_unit: row.unit })) : ingredients;
  const profile = source.yield_profile || {};
  const cookedGrams = numeric(profile.cooked?.grams);
  const usableGrams = numeric(profile.usable?.grams);
  const portionGrams = numeric(profile.portion_g);
  const standardCooked = cookedGrams !== null && scale ? Number((cookedGrams * scale).toFixed(3)) : null;
  const standardUsable = usableGrams !== null && scale ? Number((usableGrams * scale).toFixed(3)) : null;
  const finishedGrams = standardUsable ?? standardCooked;
  return { ingredients: standardIngredients, metadata: { target_batch_g: 1000, source_batch_g: sourceBatchGrams, scale_factor: scale, basis: sourceYieldGrams ? 'source_yield' : ingredientMass > 0 ? 'ingredient_input_sum' : 'unresolved', source_yield: sourceYield, cooked_yield_g: standardCooked, usable_yield_g: standardUsable, portion_g: portionGrams, portions_per_kg: finishedGrams !== null && portionGrams > 0 ? Math.floor(finishedGrams / portionGrams) : null, needs_review: !sourceYieldGrams || standardCooked === null || portionGrams === null } };
};
export function workflowRecipe(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('WF1 recipe object required.');
  const warnings = [];
  const ingredients = array(source.ingredients).map((row, index) => {
    const quantity = numeric(row.quantity ?? row.qty);
    if (quantity === null || quantity <= 0) warnings.push(`Ingredient ${index + 1}: quantity requires review.`);
    if (!row.unit) warnings.push(`Ingredient ${index + 1}: unit is missing.`);
    if (!row.canonical_id || !row.canonical_name) warnings.push(`Ingredient ${index + 1}: canonical identity needs review.`);
    if ((row.quantity_confidence && row.quantity_confidence !== 'explicit') || (row.amount_kind && row.amount_kind !== 'explicit')) warnings.push(`Ingredient ${index + 1}: quantity is not labelled explicit by WF1.`);
    return { ...row, clean_name: row.name || row.clean_name || row.canonical_name || '', quantity: quantity ?? '', source_quantity: row.quantity ?? row.qty ?? null, unit: row.unit || '', prep_state: row.prep_state || 'as_purchased', needs_review: !!row.needs_review || quantity === null || !row.canonical_id || !row.canonical_name };
  });
  const rows = array(source.instruction_rows).filter(row => typeof row === 'string');
  const method = typeof source.instructions_raw === 'string' && source.instructions_raw.trim() ? source.instructions_raw : typeof source.instructions === 'string' && source.instructions.trim() ? source.instructions : rows.join('\n');
  const generated = !!source.validation_flags?.instructions_generated;
  if (generated) warnings.push('WF1 marks the instructions as generated. Compare them with the original document before approval.');
  if (!method) warnings.push('Preparation method is missing.');
  if (!source.title) warnings.push('Dish title is missing.');
  if (!ingredients.length) warnings.push('Ingredient rows are missing.');
  const explicitYield = source.yield && typeof source.yield === 'object' ? source.yield : null;
  if (!explicitYield || !numeric(explicitYield.quantity) || !explicitYield.unit) warnings.push(source.source_kind === 'document_upload' ? 'Batch yield was not recognised. Confirm it from the original document before scaling.' : 'Reviewed batch yield is required. expected_portions is retained as a workflow hint and is not assumed to be a verified yield.');
  const standardised = standardiseToKilogram(source, ingredients);
  if (standardised.metadata.basis === 'unresolved') warnings.push('A 1 kg standard batch could not be calculated from a mass yield or ingredient mass total.');
  if (standardised.metadata.cooked_yield_g === null) warnings.push('Cooked yield is not measured. Enter a measured cooked or usable yield after a kitchen trial.');
  if (standardised.metadata.portion_g === null) warnings.push('Portion size is not set. Enter it once to calculate portions from the 1 kg standard batch.');
  warnings.push(...array(source.validation_flags?.errors).map(String), ...array(source.validation_flags?.warnings).map(String));
  return { title: source.title || 'Untitled workflow recipe', ingredients: standardised.ingredients, method, methodGenerated: generated, standardisation: standardised.metadata, warnings: [...new Set(warnings)], sourceRef: source.original_file_url || source.source_meta?.source_document_ref || '',
    draft: { ...source, title: source.title || '', ingredients: standardised.ingredients, method_text: method, source_method: { instructions_raw: source.instructions_raw ?? null, instructions: source.instructions ?? null, instruction_rows: rows, generated }, source_workflow_recipe: source, standardisation: standardised.metadata,
      yield: { quantity: standardised.metadata.scale_factor ? 1000 : '', unit: 'g', basis: 'finished' }, source_yield: explicitYield, source_evidence_ids: array(source.source_evidence_ids).length ? [...source.source_evidence_ids] : [source.original_file_url || source.source_meta?.source_document_ref || ''].filter(Boolean), production_steps: [], allergen_notes: array(source.allergens).join(', '), handling_notes: '', allergen_reviewed: false, handling_reviewed: false, manager_review_required: false } };
}
export function executionRecipes(execution, nodeName = 'WF1 Final Contract Output') {
  const runs = execution?.resultData?.runData?.[nodeName] || execution?.data?.resultData?.runData?.[nodeName] || [];
  const recipes = [];
  for (const run of runs) for (const output of array(run.data?.main)) for (const item of array(output)) if (item?.json && typeof item.json === 'object') recipes.push(item.json);
  return recipes;
}
