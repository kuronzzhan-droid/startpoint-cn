"""来源转换须保留原伤害参数，副位限制不能吞掉开场/移动。"""
import json
from copy import deepcopy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import wf_mod_tool as core
import wf_wind_dragon_revision as r
from wf_celtie_fever_skill import parse

ROOT = Path(__file__).resolve().parents[2]
PKG = ROOT / 'work/character_packs/land_dragon_wind_poc/package/roots/common'


class RevisionTests(unittest.TestCase):
    def test_only_bonus_kinds_change(self):
        rows = [[''] * 126 for _ in range(4)]
        for row in rows:
            row[5] = '0'
        rows[0][47] = '34'; rows[0][51:53] = ['15000', '30000']
        rows[1][5] = '1'; rows[1][109] = '2'
        rows[2][5] = '1'; rows[2][109] = '411'
        rows[3][5] = '1'; rows[3][109] = '3'
        after = r.bonus_rows(rows)
        self.assertEqual(['388', '154', '412', '3'], [after[0][47], *[x[109] for x in after[1:]]])
        after[0][47], after[1][109], after[2][109] = '34', '2', '411'
        self.assertEqual(rows, after)

    def test_unison_whole_party_rule_and_idempotence(self):
        donor = [''] * 126
        for i,v in {5:'1',6:'0',13:'0',20:'0',85:'(None)',97:'0'}.items(): donor[i]=v
        base = [['dragon_2','true','power_flip','0',''] + ['']*121]
        result = r.add_unison_block(base, donor)
        row = result[-1]
        self.assertEqual(('true','203','423','5','(None)','12'), tuple(row[i] for i in (1,6,109,110,111,118)))
        self.assertFalse(int(row[118]) & (1|2))
        self.assertEqual(['']*6,row[7:13])
        self.assertEqual(result, r.add_unison_block(result,donor))

    def test_self_rule_cannot_be_reused_as_party_rule(self):
        donor = [''] * 126
        for i,v in {5:'1',6:'0',13:'0',20:'0',85:'(None)',97:'0'}.items(): donor[i]=v
        base = [['wolf_1','true','power_flip','0',''] + ['']*121]
        result = r.add_unison_block(base, donor, target='self')
        self.assertEqual(('203','0','(None)','12'), tuple(result[-1][i] for i in (6,110,111,118)))
        self.assertEqual(result, r.add_unison_block(result, donor, target='self'))
        with self.assertRaisesRegex(ValueError, 'differs'):
            r.add_unison_block(result, donor, target='party')

    @unittest.skipUnless(PKG.is_dir(), 'local source candidate required')
    def test_every_real_random_skill_attack_retains_magnitude_and_flat_damage(self):
        for level in (1,2):
            path = PKG/f'battle/action/skill/action/rare5/{r.CODE}${r.CODE}_{level}.action.dsl.amf3.deflate'
            before=parse(path.read_bytes());after=r.ability_skill(before)
            self.assertEqual(102,after[10])
            self.assertEqual(list(r.nodes(before,'CreateNormalAttack')),list(r.nodes(after,'CreateNormalAttack')))
            areas=list(r.nodes(after,'CreateHitArea'))
            self.assertEqual(25,len(areas))
            self.assertTrue(all(a[24]==102 for a in areas))
            restored=deepcopy(after);restored[10]=before[10]
            for a,b in zip(r.nodes(restored,'CreateHitArea'),r.nodes(before,'CreateHitArea')):a[24]=b[24]
            self.assertEqual(before,restored)

    def test_fox_removes_only_direct_combo_reward(self):
        row=['']*126
        for i,v in {5:'0',6:'12',27:'20',47:'226',30:'100000',31:'100000',51:'1000000',52:'1000000'}.items():row[i]=v
        other=deepcopy(row);other[27]='4'
        self.assertEqual([other],r.remove_fox_direct_combo([row,other]))


if __name__ == '__main__':unittest.main()
