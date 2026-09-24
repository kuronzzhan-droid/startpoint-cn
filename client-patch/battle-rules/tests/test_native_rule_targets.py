"""Execute native target parsing and matching; empty groups must not mean all members."""
import hashlib
from pathlib import Path
import sys
import unittest

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parents[3] / 'mod-tools'))
from core import SwfAbc, asm, bodies
from vm import run
from wf_battle_rules import make_row

BASE = Path('D:/WF/out/月兔回槽性能与狮子PF点火-20260925/gauge-performance.swf')
BASE_SHA = '6e7b2db7923d2456ce2b6edc9a42aba51f1f87a099ecc4f606c1de7fc302c497'
METHODS = (
    'AbilityValues$/parseAt110',
    'AbilityValues$/parseAt111',
    'AbilityTargetKindTools$/resolve',
    'OrCharacterGroup_Impl_$/resolveOptional',
    'OrCharacterGroup_Impl_$/resolve',
    'MemberImpl/matchOptionCharacterGroup',
    'SquadMemberSource/matchMaybeCharacterGroup',
    'SquadMemberSource/matchCharacterGroup',
)


class NativeTargetChain:
    """Only enum construction and asset-table access are host stubs, not decisions."""

    def __init__(self, path=BASE):
        path = Path(path)
        if hashlib.sha256(path.read_bytes()).hexdigest() != BASE_SHA:
            raise ValueError('native target fixture is not the verified 1044 SWF')
        self.abc = SwfAbc(path).abc
        self.code = {
            name: asm.decode(self.abc.bodies[bodies.resolve(self.abc, name)][5])
            for name in METHODS
        }
        self.lex = {
            'haxe.ds::Option': {
                'Some': lambda value: dict(index=0, params=[value]),
                'None': dict(index=1, params=[]),
            },
            'pinball.master.generated::AbilityValues': {
                'parseAt111': lambda row: self.call(METHODS[1], None, row),
            },
            'pinball.common.data.ability::AbilityTargetMasterValue': {
                'Party': lambda value: dict(index=5, params=[value]),
                'ExceptMyself': lambda value: dict(index=1, params=[value]),
            },
            'pinball.common.data.ability::AbilityTargetKind': {
                'Party': lambda value: dict(index=2, params=[value]),
                'ExceptMyself': lambda value: dict(index=1, params=[value]),
            },
            'pinball.common.data.ability._OrCharacterGroup::OrCharacterGroup_Impl_': {
                'resolveOptional': lambda value, asset: self.call(METHODS[3], None, value, asset),
                'resolve': lambda value, asset: self.call(METHODS[4], None, value, asset),
                '_new': lambda value: value,
            },
        }
        # The native resolver requests these tables even for an empty group list.
        for table in ('GenderTable', 'RaceTable', 'CharacterTagTable'):
            self.lex['pinball.master.generated::' + table] = table
        self.asset = {
            'pinball.asset.logic:ILogicAssetContainer::getMasterTable':
                lambda table: {'get_data': lambda: {}},
        }
        self.source = {
            'matchCharacterGroup': lambda groups: self.call(METHODS[7], self.source, groups),
            'matchMaybeCharacterGroup': lambda groups: self.call(METHODS[6], self.source, groups),
        }

    def call(self, method, *args):
        return run(self.code[method], self.abc, list(args), self.lex)

    def evaluate(self, row):
        master = self.call(METHODS[0], None, row)
        target = self.call(METHODS[2], None, master, self.asset)
        groups = target['params'][0]
        member = {'source': self.source}
        return {
            'master_target': master,
            'resolved_target': target,
            'member_matches': self.call(METHODS[5], member, groups),
        }


def donor():
    row = [''] * 126
    row[5], row[85], row[97] = '1', '(None)', '0'
    for column in (6, 13, 20):
        row[column] = '0'
    return row


@unittest.skipUnless(BASE.is_file(), 'local native 1044 fixture unavailable')
class NativeRuleTargetsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.native = NativeTargetChain()

    def test_empty_group_excludes_members_but_none_sentinel_matches(self):
        row = make_row(donor(), 'native_target_regression', 423, 12, target='party')
        row[111] = ''  # Reproduce the faulty deployed row, without normalizing it.
        broken = self.native.evaluate(row)
        self.assertEqual({'index': 0, 'params': [[]]}, broken['resolved_target']['params'][0])
        self.assertFalse(broken['member_matches'])
        row[111] = '(None)'
        fixed = self.native.evaluate(row)
        self.assertEqual({'index': 1, 'params': []}, fixed['resolved_target']['params'][0])
        self.assertTrue(fixed['member_matches'])

    def test_generated_unfiltered_targets_survive_native_parse_and_match(self):
        for content, code in ((423, 12), (424, 104)):
            for target, index in (('party', 2), ('others', 1)):
                for kwargs in ({}, {'groups': ''}, {'groups': '(None)'}):
                    with self.subTest(content=content, target=target, kwargs=kwargs):
                        row = make_row(donor(), 'native_target_regression', content,
                                       code, target=target, **kwargs)
                        result = self.native.evaluate(row)
                        self.assertEqual(index, result['resolved_target']['index'])
                        self.assertTrue(result['member_matches'])


if __name__ == '__main__':
    unittest.main()
