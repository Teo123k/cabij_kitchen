import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { referenceArithmetic, compareArithmetic, parityPolicy } from '../../../tools/parity/arithmeticContract.js';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/arithmetic/v1.json', import.meta.url)));
const root = new URL('../../../', import.meta.url);
test('pinned parity policy cannot drift silently', () => { assert.deepEqual(fixtures.policy, parityPolicy); assert.equal(fixtures.referenceEngineVersion, 3); });
for (const fixture of fixtures.cases) {
  test(`Python arithmetic shadow parity: ${fixture.name}`, () => {
    const reference = referenceArithmetic(fixture.request);
    assert.deepEqual(reference, fixture.expected, 'Current JS changed against the reviewed fixture; inspect before repinning.');
    const child = spawnSync('python3', ['-m', 'worker.arithmetic'], { cwd: root, input: JSON.stringify(fixture.request), encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
    assert.ifError(child.error); assert.equal(child.status, 0, child.stderr || child.stdout);
    const actual = JSON.parse(child.stdout);
    assert.equal(actual.mode, 'shadow'); assert.equal(actual.engineVersion, 'python-arithmetic-shadow-v1'); assert.equal(actual.referenceEngineVersion, reference.referenceEngineVersion);
    assert.deepEqual(compareArithmetic(reference.arithmetic, actual.arithmetic), []);
    assert.deepEqual(compareArithmetic(reference.conversions, actual.conversions), []);
  });
}
test('parity rejects shape, missing-data, decision and numeric mismatches', () => {
  for (const [expected, actual] of [[null, 0], [1, '1'], [{ packs: 1 }, { packs: 2 }], [{ cost: null }, {}], [100, 100.01], [[], {}]]) assert.ok(compareArithmetic(expected, actual).length);
  assert.deepEqual(compareArithmetic(0.33, 0.33000000000000007), []);
  assert.ok(compareArithmetic({ packs: 1 }, { packs: 1.00000001 }).length);
});
