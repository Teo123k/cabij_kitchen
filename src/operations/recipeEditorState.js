const newIngredient = () => ({ canonical_id: '', canonical_name: '', clean_name: '', quantity: '', unit: 'g', prep_state: 'as_purchased', product_form: '' });

export const blankRecipe = () => ({ title: '', yield: { quantity: '', unit: 'portion', basis: 'finished' }, standardisation: { target_batch_g: 1000, portion_g: null, portions_per_kg: null }, yield_profile: {}, ingredients: [newIngredient()], production_steps: [], source_evidence_ids: [], allergen_notes: '', handling_notes: '', allergen_reviewed: false, handling_reviewed: false });

export const normalizeRecipeEditorState = initial => {
  const blank = blankRecipe();
  return {
    ...blank,
    ...(initial || {}),
    yield: { ...blank.yield, ...(initial?.yield || {}) },
    standardisation: { ...blank.standardisation, ...(initial?.standardisation || {}) },
    yield_profile: { ...(initial?.yield_profile || {}) },
    ingredients: Array.isArray(initial?.ingredients) && initial.ingredients.length ? initial.ingredients : blank.ingredients,
    production_steps: Array.isArray(initial?.production_steps) ? initial.production_steps : blank.production_steps,
    source_evidence_ids: Array.isArray(initial?.source_evidence_ids) ? initial.source_evidence_ids : blank.source_evidence_ids,
    allergen_notes: initial?.allergen_notes || '',
    handling_notes: initial?.handling_notes || '',
    allergen_reviewed: !!initial?.allergen_reviewed,
    handling_reviewed: !!initial?.handling_reviewed
  };
};
