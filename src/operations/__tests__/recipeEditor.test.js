import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRecipeEditorState } from '../recipeEditorState.js';

test('recipe editor opens incomplete document drafts without missing nested fields', () => {
  const recipe = normalizeRecipeEditorState({ title: 'Sauce', ingredients: [{ clean_name: 'Soy sauce', quantity: null, unit: '' }] });
  assert.deepEqual(recipe.yield, { quantity: '', unit: 'portion', basis: 'finished' });
  assert.equal(recipe.ingredients[0].clean_name, 'Soy sauce');
  assert.deepEqual(recipe.production_steps, []);
  assert.equal(recipe.allergen_notes, '');
  assert.equal(recipe.handling_reviewed, false);
});

test('recipe editor preserves extracted yield and production steps', () => {
  const recipe = normalizeRecipeEditorState({ yield: { quantity: 10, unit: 'portion' }, production_steps: [{ description: 'Stir' }] });
  assert.equal(recipe.yield.quantity, 10);
  assert.equal(recipe.yield.basis, 'finished');
  assert.equal(recipe.production_steps[0].description, 'Stir');
});
