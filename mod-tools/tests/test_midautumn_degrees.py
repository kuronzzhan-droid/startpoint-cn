import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import wf_midautumn_degrees as d
import wf_share_update_codec as codec


class MidautumnDegreeTests(unittest.TestCase):
    def test_names_preserve_every_nontitle_cell(self):
        for logical, changes in [(d.CHARACTER, {18:d.LEADER}),
                                 (d.TEXT, {4:d.SKILL, 6:d.SKILL+'＋', 10:d.LEADER})]:
            rows = [[str(i) for i in range(40)]]
            before = copy.deepcopy(rows)
            actual = d.rename_rows(logical, rows)
            self.assertEqual(rows, before)
            for index, value in enumerate(before[0]):
                self.assertEqual(actual[0][index], changes.get(index, value))

    def test_nested_skill_only_changes_title_not_program_or_energy(self):
        rows = [['old title', 'original description', '500', '', '', '', '', 'original/program']]
        raw = codec.pack({d.NAME_KEYS[d.ACTION]: codec.pack({
            '1':codec.csv_write(rows), '2':codec.csv_write(rows)}), 'other':b'untouched'})
        operations = d.name_operations(d.ACTION, raw)
        self.assertEqual(len(operations), 2)
        for op in operations:
            self.assertEqual(op['after']['csv'][0][1:], rows[0][1:])
            self.assertEqual(op['after']['csv'][0][0], d.SKILL+('＋' if op['path'][1]=='2' else ''))

    def test_unrecognized_skill_reference_rejected(self):
        with self.assertRaises(ValueError): d.rename_rows(d.CAS, [['unrelated text']])

    def test_reference_and_rename_are_idempotent(self):
        first = d.rename_rows(d.CAS, [['强化『月下咆哮·烈焰甩尾』：光环的范围扩大']])
        self.assertEqual(first, [['强化『烈焰轰鸣』：光环的范围扩大']])
        self.assertEqual(first, d.rename_rows(d.CAS, first))


if __name__ == '__main__': unittest.main()
