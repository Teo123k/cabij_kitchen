import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { compareScheduling, referenceScheduling, schedulingPolicy } from '../../../tools/parity/schedulingContract.js';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/scheduling/v1.json', import.meta.url)));
const root = new URL('../../../', import.meta.url);
test('scheduling shadow contract and pinned policy cannot drift', () => {
  assert.deepEqual(fixtures.policy, schedulingPolicy);
  assert.equal(fixtures.referenceEngineVersion, 3);
});
for (const fixture of fixtures.cases) {
  test(`Python scheduling shadow parity: ${fixture.name}`, () => {
    const before = structuredClone(fixture.request);
    const reference = referenceScheduling(fixture.request);
    assert.deepEqual(reference, fixture.expected, 'JS reference changed; inspect the difference before deliberate repinning.');
    const child = spawnSync('python3', ['-m', 'worker.scheduling'], { cwd: root, input: JSON.stringify(fixture.request), encoding: 'utf8', timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
    assert.ifError(child.error); assert.equal(child.status, 0, child.stderr || child.stdout);
    const actual = JSON.parse(child.stdout);
    assert.equal(actual.mode, 'shadow'); assert.equal(actual.engineVersion, 'python-scheduling-shadow-v1');
    assert.equal(actual.referenceEngineVersion, 3);
    assert.deepEqual(compareScheduling(reference.scheduling, actual.scheduling), []);
    assert.deepEqual(fixture.request, before);
    for (const field of ['ready', 'approvedBy', 'approvedAt', 'status']) assert.ok(!Object.hasOwn(actual.scheduling, field));
  });
}
test('scheduling comparator rejects timing, identity, ordering, shape and evidence changes exactly', () => {
  for (const [expected, actual] of [[540, 540.00000001], [null, 0], [1, '1'], [{ end: 600 }, {}], [{ chefId: 'a' }, { chefId: 'b' }], [['a', 'b'], ['b', 'a']], [{ passed: false }, { passed: true }], [[], {}], [{ x: undefined }, {}]]) assert.ok(compareScheduling(expected, actual).length);
  assert.deepEqual(compareScheduling({ rows: [{ start: 540 }], missing: null }, { rows: [{ start: 540 }], missing: null }), []);
});
