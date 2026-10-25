"""Cumulative ownership, runtime assembly, immutable object and failure gates.

The optional real-input suite prepares small temporary receipts and reads the
reviewed compiler objects. It never links a native image or packages an IPA.
"""
import argparse
import copy
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest

import build_cumulative as b


def synthetic_stages():
    stages = []
    ranges = [(101496, 101581), (101581, 101588), (101588, 101598)]
    replacements = [list(range(1, 121)) + [52124], list(range(121, 128)), [128, 52124]]
    for index, (old, count) in enumerate(ranges):
        rows = [dict(method_id=mid, strategy='replace', before_code_sha256=str(index), after_code_sha256=str(index + 1))
                for mid in replacements[index]]
        wanted = set(replacements[index]) | set(range(old, count))
        stages.append((str(index), dict(old_methods=old, total_methods=count, methods=rows),
                       dict(functions=[dict(method=mid) for mid in wanted], generated_initializers={}), {}))
    return stages


class CumulativeGuards(unittest.TestCase):
    def test_unique_ownership_and_equipment_to_final_response_contract(self):
        owners, replacements = b.select_owners(synthetic_stages())
        self.assertEqual(len(owners), 231)
        self.assertEqual(owners[52124], 2)
        response = next(row for row in replacements if row['method_id'] == 52124)
        self.assertEqual((response['before_code_sha256'], response['after_code_sha256']), ('0', '3'))

    def test_additional_duplicate_rejected(self):
        stages = synthetic_stages()
        stages[-1][1]['methods'].append(dict(method_id=1, strategy='replace'))
        stages[-1][2]['functions'].append(dict(method=1))
        with self.assertRaisesRegex(ValueError, 'Only the final town'):
            b.select_owners(stages)

    def test_missing_helper_rejected(self):
        stages = synthetic_stages()
        stages[-1][2]['functions'].pop()
        with self.assertRaisesRegex(ValueError, 'complete prepared'):
            b.select_owners(stages)

    def test_generated_initializer_rejected_before_link(self):
        stages = synthetic_stages()
        stages[-1][2]['generated_initializers'] = {'unreviewed': -1}
        with self.assertRaisesRegex(ValueError, 'Generated initializer'):
            b.select_owners(stages)

    def test_definition_view_preserves_symbol_order_and_owning_binary(self):
        symbols = [SimpleNamespace(name=name, numberof_sections=section, value=value) for name, section, value in
                   [('m:1:real', 1, 0), ('m:2:stub', 1, 16), ('_x_284_aotInfo', 2, 32), ('lCPI0', 2, 48)]]
        binary = SimpleNamespace(symbols=symbols, sections=[SimpleNamespace(name='__text'), SimpleNamespace(name='__const')])
        view = b.ObjectView(binary, dict(selected_methods=[1], final_metadata_stage=False))
        self.assertIs(view.original, binary)
        self.assertEqual([s.name for s in view.symbols], [s.name for s in symbols])
        self.assertEqual([s.numberof_sections for s in view.symbols], [1, 0, 0, 2])
        self.assertEqual([s.numberof_sections for s in symbols], [1, 1, 2, 2])
        self.assertEqual(view.symbols[1].value, 16)

    def test_runtime_source_rule_restores_earlier_helper_header(self):
        def body(mid, stack):
            return [mid, stack, 1, 0, 0, b'', [], []]
        data = {b'base': [body(0, 5)], b'ops': [body(0, 1), body(1, 0)],
                b'town': [body(0, 1), body(1, 1), body(2, 2)]}
        class ABC:
            def __init__(self, raw):
                self.bodies = copy.deepcopy(data[raw])
            def serialize(self):
                return repr(self.bodies).encode()
        stage = SimpleNamespace(original=SimpleNamespace(abcfmt=SimpleNamespace(ABC=ABC), link=SimpleNamespace(freeze=lambda v: v)))
        runtime, changes = b.assemble_runtime(b'base', [b'ops', b'town'], {1: 0, 2: 1}, stage)
        self.assertEqual(runtime, repr([body(0, 5), body(1, 0), body(2, 2)]).encode())
        self.assertEqual([row['method'] for row in changes], [0, 1])

    def test_changed_pin_rejected(self):
        with tempfile.TemporaryDirectory(prefix='cumulative-pins-') as folder:
            source = Path(folder) / 'input'
            source.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'Pinned cumulative input changed'):
                b.validate_pins(dict(source_pins={str(source): b.sha(b'original')}), {})

    def test_existing_preparation_output_preserved(self):
        with tempfile.TemporaryDirectory(prefix='cumulative-retained-') as folder:
            output = Path(folder)
            retained = output / 'original'
            retained.write_bytes(b'unchanged')
            with self.assertRaisesRegex(ValueError, 'Fresh preparation'):
                b.prepare(SimpleNamespace(output=output), None)
            self.assertEqual(retained.read_bytes(), b'unchanged')


class RealCumulativeBindings(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if INPUT_ROOT is None:
            raise unittest.SkipTest('Pass --input-root to bind the real reviewed carrier and objects')
        cls.temp = tempfile.TemporaryDirectory(prefix='cumulative-real-binding-')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.output = Path(cls.temp.name) / 'prepared'
        cls.args = SimpleNamespace(output=cls.output, equipment_link=INPUT_ROOT / 'equipment/link-report.json',
                                  equipment_package=INPUT_ROOT / 'equipment/package-report.json',
                                  stage_link=[INPUT_ROOT / name / 'linked/link-report.json' for name in ('operations', 'profile', 'town')])
        cls.result = b.prepare(cls.args, STAGE)
        cls.port = b.read(cls.output / 'port.json')
        cls.compiled = b.read(cls.output / 'compile-report.json')

    def test_real_prepare_matches_reviewed_final_runtime(self):
        self.assertEqual(self.result['methods'], 231)
        self.assertEqual(self.result['runtime_sha256'], '0604934d49f3c666735bad532f502a50895cb52b19eb233c05c433400e916a25')
        restored = self.port['runtime_assembly']['restored_bodies']
        self.assertIn(101586, [row['method'] for row in restored])
        self.assertEqual(self.port['full_abc_sha256'], b.FINAL_FULL_SHA)

    def test_real_object_views_select_exactly_one_definition_per_method(self):
        found, metadata = [], []
        sources = {row['method']: row for row in self.port['cumulative_sources']['methods']}
        with b.selected_objects(self.compiled, STAGE):
            for row in self.compiled['objects']:
                path = Path(row['name'])
                obj = STAGE.original.link.lief.parse(str(path))
                for symbol in obj.symbols:
                    if not symbol.numberof_sections:
                        continue
                    name = STAGE.original.link.aot.text(symbol.name)
                    if name.endswith('_284_aotInfo'):
                        metadata.append(str(path))
                    mid = b.method_id(name)
                    if mid in sources:
                        found.append(mid)
                        record, *_ = STAGE.support.symbol_record(obj, path, name, mid)
                        self.assertEqual(record.size, sources[mid]['size'])
                        self.assertEqual(str(path), sources[mid]['object_file'])
        self.assertEqual(sorted(found), sorted(sources))
        self.assertEqual(metadata, [self.port['cumulative_sources']['final_metadata_object']])

    def test_real_finalizer_binds_complete_objects_without_duplicate_stubs(self):
        import finalize_delta
        functions = [dict(method=row['method'], size=row['size'], address=row['source_link_address'])
                     for row in self.port['cumulative_sources']['methods']]
        with b.selected_objects(self.compiled, STAGE):
            rows = finalize_delta._compile_functions(self.compiled, functions, {}, STAGE.support, STAGE.original.link)
        self.assertEqual(len(rows), 231)
        self.assertEqual({row['method'] for row in rows}, {row['method'] for row in functions})

    def test_changed_object_selection_rejected(self):
        compiled = copy.deepcopy(self.compiled)
        next(row for row in compiled['objects'] if row['selected_methods'])['selected_methods'].pop()
        with self.assertRaisesRegex(ValueError, 'Object method selection changed'):
            b.validate_pins(self.port, compiled)

    def test_runtime_view_uses_verified_assembly_once(self):
        final_metadata = Path(self.port['cumulative_sources']['final_metadata_object'])
        obj = STAGE.original.link.lief.parse(str(final_metadata))
        symbol = next(STAGE.original.link.aot.text(s.name) for s in obj.symbols
                      if s.numberof_sections and STAGE.original.link.aot.text(s.name).endswith('_abcBytes'))
        info_name = next(STAGE.original.link.aot.text(s.name) for s in obj.symbols
                         if s.numberof_sections and STAGE.original.link.aot.text(s.name).endswith('_284_aotInfo'))
        info = STAGE.original.link.aot.extract_symbol_bytes(obj, info_name, 168)
        raw = STAGE.original.link.aot.extract_symbol_bytes(obj, symbol, STAGE.support.read64(info, 32))
        with b.runtime_view(self.port, self.output / 'port.json', STAGE):
            parsed = STAGE.original.abcfmt.ABC(raw)
        self.assertEqual(parsed.serialize(), (self.output / 'runtime-assembled.abc').read_bytes())


INPUT_ROOT = None
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--libraries', required=True, type=Path)
    parser.add_argument('--input-root', type=Path)
    args = parser.parse_args()
    INPUT_ROOT = args.input_root
    STAGE = b.initialize(args.libraries)
    unittest.main(argv=[sys.argv[0]], verbosity=2)
