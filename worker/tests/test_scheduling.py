import copy
import json
import math
from pathlib import Path
import subprocess
import sys
import unittest

from worker.scheduling import clock, date_number, minutes, priority_task_order, run, schedule_evidence, working_days

ROOT = Path(__file__).parents[2]
FIXTURES = json.loads((ROOT / 'src/operations/fixtures/scheduling/v1.json').read_text())['cases']


def fixture(name):
    return copy.deepcopy(next(row['request'] for row in FIXTURES if row['name'] == name))


class SchedulingTests(unittest.TestCase):
    def test_all_pinned_reference_results_match_exactly(self):
        for row in FIXTURES:
            with self.subTest(case=row['name']):
                result = run(row['request'])
                self.assertEqual(result['scheduling'], row['expected']['scheduling'])
                self.assertEqual(result['mode'], 'shadow')

    def test_passive_time_releases_labour_but_retains_equipment(self):
        plan = run(fixture('multiple batches release chef during passive occupancy'))['scheduling']
        self.assertTrue(any(a['chefId'] == b['chefId'] and a['activeEnd'] <= b['start'] < a['end'] for a in plan['schedule'] for b in plan['schedule'] if a['id'] != b['id']))
        for a in plan['schedule']:
            for b in plan['schedule']:
                if a['id'] == b['id']:
                    continue
                if a.get('equipmentId') and a.get('equipmentId') == b.get('equipmentId'):
                    self.assertTrue(a['end'] <= b['start'] or b['end'] <= a['start'])

    def test_priority_promotes_dependencies_without_bypassing_roles(self):
        plan = run(fixture('urgent dependent promotes prerequisites'))['scheduling']
        self.assertEqual(plan['schedule'][0]['versionId'], 'second')
        self.assertEqual(plan['schedule'][0]['sourceStepIndex'], 0)
        blocked = run(fixture('priority cannot bypass skill and equipment'))['scheduling']
        self.assertTrue(any(t['id'] == 'second:0:2' and 'upstream' in t['reason'] for t in blocked['unscheduled']))

    def test_shared_nested_recipe_finishes_before_parent(self):
        plan = run(fixture('nested shared recipe finishes before parent'))['scheduling']
        child = [t for t in plan['schedule'] if t['versionId'] == 'child']
        self.assertEqual(len(child), 1)
        parent = next(t for t in plan['schedule'] if t['versionId'] == 'demo-version-1')
        self.assertLessEqual(child[0]['end'], parent['start'])
        self.assertEqual(parent['dependencies'], ['child:0:0', 'child:0:0'])

    def test_advance_prep_requires_reference_and_dated_staff(self):
        accepted = run(fixture('advance prep and service day dependencies'))['scheduling']
        self.assertEqual(accepted['schedule'][0]['start'], -900)
        self.assertGreaterEqual(accepted['schedule'][1]['start'], 540)
        for name in ['advance prep without reference is blocked', 'advance prep without review is blocked', 'dated staff differs from service day']:
            self.assertFalse(run(fixture(name))['scheduling']['schedule'])

    def test_missing_time_is_not_reviewed_even_if_reference_coerces_blank(self):
        plan = run(fixture('missing active time blocks despite reference coercion'))['scheduling']
        self.assertTrue(any(e['code'] == 'DURATION REVIEW REQUIRED' for e in plan['exceptions']))
        self.assertFalse(next(c['passed'] for c in plan['evidence']['checks'] if c['name'] == 'Reviewed timing inputs'))

    def test_evidence_detects_tampered_allocations_independently(self):
        request = fixture('equipment passive occupancy rejects contention')
        result = run(request)['scheduling']
        plan = {**result, 'engineVersion': 3, 'project': request['project'], 'clientId': request['clientId'], 'recipes': request['versions'],
                'recipeTargets': [{'id': v['id'], 'quantity': 160, 'scale': 1} for v in request['versions']]}
        cooks = [t for t in plan['schedule'] if t.get('equipmentId')]
        a, b = cooks
        b.update(start=a['start'], activeEnd=a['activeEnd'], end=a['end'], chefId=a['chefId'])
        checks = {c['name']: c['passed'] for c in schedule_evidence(plan)['checks']}
        self.assertFalse(checks['No overlapping active work'])
        self.assertFalse(checks['Equipment availability & capacity'])
        plan['schedule'][-1]['start'] = 0
        checks = {c['name']: c['passed'] for c in schedule_evidence(plan)['checks']}
        self.assertFalse(checks['Recipe order & dependencies'])
        self.assertFalse(checks['Service window'])

    def test_empty_schedule_never_reports_positive_checks(self):
        evidence = run(fixture('empty menu has no positive evidence claim'))['scheduling']['evidence']
        self.assertTrue(all(c['passed'] is None for c in evidence['checks']))

    def test_calendar_priority_and_clock_helpers(self):
        self.assertTrue(math.isnan(date_number('2026-02-30')))
        self.assertTrue(math.isnan(minutes('24:00')))
        self.assertTrue(math.isnan(minutes('9:00')))
        self.assertEqual(clock(-900), '09:00')
        self.assertEqual(clock(540.5), '09:0.5')
        project = fixture('duplicate and future days ignored; missing arrays inherit')['project']
        self.assertEqual([d['date'] for d in working_days(project)], ['2026-11-19', '2026-11-20'])
        tasks = [dict(id='a', dependencies=[], priority='normal'), dict(id='b', dependencies=[], priority='normal'), dict(id='c', dependencies=['b'], priority='urgent')]
        self.assertEqual([t['id'] for t in priority_task_order(tasks)], ['b', 'c', 'a'])

    def test_inputs_unchanged_and_no_authority_fields(self):
        request = fixture('baseline source order and evidence')
        before = copy.deepcopy(request)
        response = run(request)
        self.assertEqual(request, before)
        for field in ('ready', 'approvedAt', 'approvedBy', 'status'):
            self.assertNotIn(field, response['scheduling'])

    def test_cli_rejects_unknown_malformed_nonfinite_and_oversize_input(self):
        for payload in ['{"schemaVersion":2}', '{', '{"schemaVersion":1,"x":NaN}', ' ' * (4 * 1024 * 1024 + 1)]:
            result = subprocess.run([sys.executable, '-m', 'worker.scheduling'], input=payload, text=True, capture_output=True, cwd=ROOT, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            response = json.loads(result.stdout)
            self.assertEqual(response['mode'], 'shadow')
            self.assertIn('error', response)
        with self.assertRaisesRegex(ValueError, 'schemaVersion'):
            run({'schemaVersion': 2})


if __name__ == '__main__':
    unittest.main()
