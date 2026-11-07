const REQUIRED_IDENTITY_FIELDS = ['client_id', 'recipe_ref_id', 'canonical_id'];
const MASS_UNITS = new Set(['g', 'kg']);
const VOLUME_UNITS = new Set(['ml', 'l']);
const COUNT_UNITS = new Set(['each', 'pcs', 'portion']);

const cleanText = (value) => String(value ?? '').trim();
const asArray = (value) => Array.isArray(value) ? value : [];

export const normalizeKitchenUnit = (value) => cleanText(value).toLowerCase()
  .replace('litre', 'l')
  .replace('liter', 'l')
  .replace('kilogram', 'kg')
  .replace('gram', 'g')
  .replace('pieces', 'pcs')
  .replace('piece', 'pcs');

export const getUnitDomain = (unit) => {
  const normalized = normalizeKitchenUnit(unit);
  if (MASS_UNITS.has(normalized)) return 'mass';
  if (VOLUME_UNITS.has(normalized)) return 'volume';
  if (COUNT_UNITS.has(normalized)) return 'count';
  return 'unknown';
};

export const canonicalizeIngredient = (ingredient = {}) => ({
  ...ingredient,
  clean_name: cleanText(ingredient.clean_name || ingredient.name || ingredient.ingredient_name),
  canonical_name: cleanText(ingredient.canonical_name || ingredient.canonicalName),
  canonical_id: cleanText(ingredient.canonical_id || ingredient.canonicalId),
  quantity: Number(ingredient.quantity ?? ingredient.qty ?? 0),
  unit: normalizeKitchenUnit(ingredient.unit),
  source_ingredient_name: cleanText(ingredient.source_ingredient_name || ingredient.name || ingredient.ingredient_name),
  product_form: cleanText(ingredient.product_form || ingredient.form),
  prep_state: cleanText(ingredient.prep_state || ingredient.prepState || 'as_purchased'),
  supplier_sku: cleanText(ingredient.supplier_sku || ingredient.sku),
  needs_review: Boolean(ingredient.needs_review || ingredient.needsReview)
});

export const canonicalizeRecipe = (recipe = {}) => ({
  ...recipe,
  client_id: cleanText(recipe.client_id || recipe.clientId),
  recipe_ref_id: cleanText(recipe.recipe_ref_id || recipe.recipeRefId || recipe.id),
  canonical_id: cleanText(recipe.canonical_id || recipe.canonicalId || recipe.recipe_code || recipe.recipeCode),
  title: cleanText(recipe.title || recipe.name),
  recipe_version: Number(recipe.recipe_version || recipe.version || 1),
  ingredients: asArray(recipe.ingredients).map(canonicalizeIngredient),
  yield: {
    quantity: Number(recipe.yield?.quantity ?? recipe.batchYield ?? recipe.baseYield ?? 0),
    unit: normalizeKitchenUnit(recipe.yield?.unit || recipe.yield_unit || recipe.unit),
    basis: cleanText(recipe.yield?.basis || recipe.yield_basis || 'finished')
  },
  source_evidence_ids: asArray(recipe.source_evidence_ids || recipe.sourceEvidenceIds).map(cleanText).filter(Boolean),
  manager_review_required: Boolean(recipe.manager_review_required || recipe.managerReviewRequired)
});

export const validateCanonicalRecipe = (value = {}) => {
  const recipe = canonicalizeRecipe(value);
  const errors = [];

  REQUIRED_IDENTITY_FIELDS.forEach((field) => {
    if (!recipe[field]) errors.push(`${field} is required`);
  });
  if (!recipe.title) errors.push('title is required');
  if (!Number.isSafeInteger(recipe.recipe_version) || recipe.recipe_version < 1) errors.push('recipe_version must be a positive whole number');
  if (!Number.isFinite(recipe.yield.quantity) || recipe.yield.quantity <= 0) errors.push('yield.quantity must be greater than zero');
  if (getUnitDomain(recipe.yield.unit) === 'unknown') errors.push('yield.unit must be a supported mass, volume, or count unit');
  if (!['finished', 'raw', 'purchased'].includes(recipe.yield.basis)) errors.push('yield.basis must be finished, raw, or purchased');
  if (recipe.ingredients.length === 0) errors.push('at least one ingredient is required');

  recipe.ingredients.forEach((ingredient, index) => {
    const label = `ingredients[${index}]`;
    if (!ingredient.clean_name) errors.push(`${label}.clean_name is required`);
    if (!ingredient.canonical_id) errors.push(`${label}.canonical_id is required`);
    if (!ingredient.canonical_name) errors.push(`${label}.canonical_name is required`);
    if (!Number.isFinite(ingredient.quantity) || ingredient.quantity <= 0) errors.push(`${label}.quantity must be greater than zero`);
    if (getUnitDomain(ingredient.unit) === 'unknown') errors.push(`${label}.unit must be a supported mass, volume, or count unit`);
  });

  return { ok: errors.length === 0, errors, recipe };
};

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => ({ ...result, [key]: stableValue(value[key]) }), {});
  }
  return value;
};

export const recipeRevisionFingerprint = (value = {}) => JSON.stringify(stableValue(canonicalizeRecipe(value)));
