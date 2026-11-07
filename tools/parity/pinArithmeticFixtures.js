// Regeneration is explicit: changing these expectations requires reviewing JS behavior.
import { writeFileSync } from 'node:fs';
import { sampleEvent } from '../../src/operations/fixtures/sample.js';
import { referenceArithmetic, parityPolicy } from './arithmeticContract.js';

const fixture = (name, change = () => {}) => {
  const f = sampleEvent();
  f.project.menu[0].sellingPrice = 2;
  change(f);
  const request = { schemaVersion: 1, clientId: 'demo-kitchen', ...f,
    conversions: [{ quantity: 1.5, from: 'kg', to: 'g' }, { quantity: 2, from: 'l', to: 'ml' }, { quantity: 3, from: 'pcs', to: 'each' }, { quantity: 1, from: 'l', to: 'kg' }, { quantity: 1, from: 'each', to: 'portion' }] };
  return { name, request, expected: referenceArithmetic(request) };
};
const cases = [
  fixture('baseline-warning-and-unmeasured-yield'),
  fixture('fractional-prepared-demand-and-zero-actual', f => {
    f.project.menu[0].quantity = 123;
    Object.assign(f.versions[0].recipe_json.ingredients[0], { prep_state: 'prepared', purchase_yield: 0.73, quantity: '8.8' });
    f.project.yieldActuals = { 'demo-version-1': { usable_g: 0, portions: 0, source: 'Synthetic failed batch weighing' } };
  }),
  fixture('nested-shared-ingredient-and-form', f => {
    const child = structuredClone(f.versions[0]);
    child.id = 'base'; child.title = child.recipe_json.title = 'Synthetic base';
    child.recipe_json.yield = { quantity: 1000, unit: 'g' };
    child.recipe_json.ingredients[0].quantity = 0.8;
    const whole = structuredClone(child.recipe_json.ingredients[0]);
    Object.assign(whole, { quantity: 0.2, product_form: 'whole' });
    child.recipe_json.ingredients.push(whole);
    f.versions.push(child);
    f.versions[0].recipe_json.ingredients = [{ recipe_version_id: 'base', quantity: 250, unit: 'g' }, { recipe_version_id: 'base', quantity: 0.75, unit: 'kg' }];
    f.project.menu.push({ versionId: 'base', quantity: 500, unit: 'g' });
    f.project.prices.push({ ...f.project.prices[0], key: 'chicken|whole|g', packPrice: 3 });
  }),
  fixture('cycle-and-foreign-recipe', f => {
    f.versions[0].recipe_json.ingredients.push({ recipe_version_id: 'demo-version-1', quantity: 160, unit: 'portion' });
    const foreign = structuredClone(f.versions[0]); foreign.id = 'foreign'; foreign.client_id = 'another-kitchen'; f.versions.push(foreign);
    f.project.menu.push({ versionId: 'foreign', quantity: 1, unit: 'portion' });
  }),
  fixture('missing-and-rejected-inputs', f => {
    const r = f.versions[0].recipe_json;
    r.source_evidence_ids = []; r.allergen_reviewed = false; r.yield_profile.prepared.grams = '';
    Object.assign(r.ingredients[0], { prep_state: 'prepared', purchase_yield: '' });
    r.ingredients.push({ canonical_id: 'oil', clean_name: 'Oil', quantity: 5, unit: 'cup', prep_state: 'as_purchased' }, { clean_name: 'Unknown', quantity: '' });
    f.project.yieldActuals = { 'demo-version-1': { usable_g: -1, portions: 1.5 } };
    f.project.reconciliations.push({ sourceKg: '', portions: 5, portionG: 5 });
  }),
  fixture('missing-and-stale-prices', f => {
    f.project.prices[0].date = '2020-01-01';
    f.versions[0].recipe_json.ingredients.push({ canonical_id: 'oil', clean_name: 'Oil', quantity: 100, unit: 'ml', prep_state: 'as_purchased' });
  }),
  fixture('incompatible-price-pack', f => { f.project.prices[0].unit = 'l'; }),
  fixture('missing-price-scalar-and-invalid-price-policy', f => { delete f.project.prices[0].packPrice; f.project.priceMaxAgeDays = 'invalid'; }),
  fixture('pack-rounding-below-six-decimal-boundary', f => { f.versions[0].recipe_json.ingredients[0].quantity = 2.0000008; }),
  fixture('pack-rounding-above-six-decimal-boundary', f => { f.versions[0].recipe_json.ingredients[0].quantity = 2.0000012; }),
  fixture('free-price-and-measured-mass-gain', f => {
    f.project.prices[0].packPrice = 0;
    const p = f.versions[0].recipe_json.yield_profile;
    Object.assign(p, { same_scope: true, reviewed: true, portion_g: 160 });
    for (const stage of ['purchased', 'prepared', 'cooked', 'usable']) Object.assign(p[stage], { basis: 'measured', source: 'Synthetic scale evidence' });
    p.cooked.grams = 12000;
    f.project.yieldActuals = { 'demo-version-1': { usable_g: 6900, portions: 43 } };
    f.project.reconciliations[0].resolution = 'Different stages'; f.project.reconciliations[0].reviewed = true;
  }),
  fixture('missing-recipe-yield', f => { f.versions[0].recipe_json.yield.quantity = ''; }),
  fixture('zero-target-and-scale-limit', f => { f.project.menu[0].quantity = 0; f.project.menu.push({ versionId: 'demo-version-1', quantity: 80160, unit: 'portion' }); }),
  fixture('cross-domain-target', f => { f.project.menu[0].unit = 'each'; }),
  fixture('unreviewed-zero-stock-and-empty-profile', f => {
    f.project.prices[0].reviewed = false;
    delete f.versions[0].recipe_json.yield_profile;
    f.versions[0].recipe_json.ingredients.push({ canonical_id: 'eggs', clean_name: 'Egg', quantity: 3, unit: 'pcs', prep_state: 'as_purchased' });
    f.project.prices.push({ ...f.project.prices[0], reviewed: true, key: 'eggs||each', packQuantity: 6, unit: 'each', packPrice: '2.10' });
  }),
];
writeFileSync(new URL('../../src/operations/fixtures/arithmetic/v1.json', import.meta.url), JSON.stringify({ schemaVersion: 1, referenceEngineVersion: 3, policy: parityPolicy, cases }, null, 2) + '\n');
process.stdout.write(`Pinned ${cases.length} synthetic arithmetic cases.\n`);
