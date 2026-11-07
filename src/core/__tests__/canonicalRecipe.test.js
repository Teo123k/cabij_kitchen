import assert from 'node:assert/strict';
import { canonicalizeRecipe, getUnitDomain, recipeRevisionFingerprint, validateCanonicalRecipe } from '../canonicalRecipe.js';

const validRecipe = {
  client_id: 'kabile',
  recipe_ref_id: 'RCP-BULGOGI',
  canonical_id: 'bulgogi-beef-v1',
  title: 'Bulgogi Beef',
  recipe_version: 1,
  yield: { quantity: 24, unit: 'kg', basis: 'finished' },
  ingredients: [{
    name: 'Beef short rib, sliced',
    canonical_id: 'ing-beef-short-rib',
    canonical_name: 'beef short rib',
    quantity: 18,
    unit: 'kg',
    product_form: 'bone-in',
    prep_state: 'sliced'
  }]
};

const result = validateCanonicalRecipe(validRecipe);
assert.equal(result.ok, true, result.errors.join('; '));
assert.equal(result.recipe.ingredients[0].clean_name, 'Beef short rib, sliced');
assert.equal(result.recipe.ingredients[0].product_form, 'bone-in');
assert.equal(getUnitDomain('litre'), 'volume');
assert.equal(getUnitDomain('cup'), 'unknown');
assert.equal(recipeRevisionFingerprint(validRecipe), recipeRevisionFingerprint({ ...validRecipe, title: 'Bulgogi Beef' }));

const invalid = validateCanonicalRecipe({ ...validRecipe, ingredients: [{ name: 'Beef', quantity: 1, unit: 'cup' }] });
assert.equal(invalid.ok, false);
assert.ok(invalid.errors.some((error) => error.includes('canonical_id')));
assert.ok(invalid.errors.some((error) => error.includes('supported mass')));

const normalized = canonicalizeRecipe({ ...validRecipe, clientId: 'client-b', client_id: '' });
assert.equal(normalized.client_id, 'client-b');

console.log('canonicalRecipe: 8 assertions passed');
