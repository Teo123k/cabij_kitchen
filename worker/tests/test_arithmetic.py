import json
import unittest
from decimal import Decimal, localcontext
from pathlib import Path

from worker.arithmetic import calculate_yield, convert, rounded, run


class ArithmeticTests(unittest.TestCase):
    def test_units_require_same_domain(self):
        self.assertEqual(convert('1.5', 'kg', 'g'), Decimal(1500))
        self.assertEqual(convert(3, 'pcs', 'each'), Decimal(3))
        for source, target in [('l', 'g'), ('each', 'portion'), ('cup', 'ml')]:
            with self.assertRaisesRegex(ValueError, 'UNIT CONVERSION REQUIRED'):
                convert(1, source, target)

    def test_pack_ratio_rounding_matches_current_contract(self):
        self.assertEqual(rounded(Decimal('1.0000004')), 1)
        self.assertEqual(rounded(Decimal('1.0000006')), Decimal('1.000001'))
        self.assertEqual(rounded(Decimal('-1.2345675')), Decimal('-1.234567'))

    def test_yield_missing_is_distinct_from_zero(self):
        missing = calculate_yield({})
        self.assertIsNone(missing['projectedUsable'])
        self.assertIsNone(missing['actualUsable'])
        measured_zero = calculate_yield({'usable': {'grams': 0}, 'portion_g': 10}, actual={'usable_g': 0, 'portions': 0, 'source': 'scale'})
        self.assertEqual(measured_zero['projectedUsable'], 0)
        self.assertEqual(measured_zero['actualUsable'], 0)
        self.assertEqual(measured_zero['portionCount'], 0)
        self.assertIsNone(measured_zero['variancePercent'])

    def test_fractional_portions_and_mass_gain_are_explicit(self):
        report = calculate_yield({'purchased': {'grams': 100}, 'prepared': {'grams': 120}, 'usable': {'grams': 105}, 'portion_g': 20}, scale=2, target=10)
        self.assertEqual(report['portionCount'], 5)
        self.assertEqual(report['remainderGrams'], 5)
        self.assertEqual(report['allocationDifference'], 10)
        self.assertTrue(any('gains mass' in warning for warning in report['warnings']))
        self.assertFalse(report['measured'])

    def test_invalid_actual_measurement_is_not_silently_zero(self):
        report = calculate_yield(actual={'usable_g': -1, 'portions': '1.5'})
        self.assertIsNone(report['actualUsable'])
        self.assertIsNone(report['actualPortions'])

    def test_input_is_unchanged_and_decimal_context_is_local(self):
        fixture = json.loads((Path(__file__).parents[2] / 'src/operations/fixtures/arithmetic/v1.json').read_text())['cases'][1]['request']
        before = json.dumps(fixture, sort_keys=True)
        with localcontext() as context:
            context.prec = 10
            result = run(fixture)
            self.assertEqual(context.prec, 10)
        self.assertEqual(json.dumps(fixture, sort_keys=True), before)
        self.assertEqual(result['mode'], 'shadow')
        self.assertNotIn('ready', result['arithmetic'])
        self.assertNotIn('schedule', result['arithmetic'])

    def test_unknown_contract_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'schemaVersion'):
            run({'schemaVersion': 2})


if __name__ == '__main__':
    unittest.main()
