"""Incremental N6: shared ball action selection and party resource closure."""
import asm
from dual_pf.common import MEMBER
from dual_pf_preload.code import runtime_q
from . import bundled, preload, select

TARGETS = ['MemberImpl/wfxDualPfLogic', 'BattlePartyLogic/resolvePathCollection']
PARTY = 'pinball.common.data.party::BattlePartyLogic'


def build(e):
    builtin_keys, evidence = bundled.load()
    resolver_q = e.add_method(MEMBER, 'wfxBallPfActionKey', 'String', ['int', '*'],
                              select.resolver(e, builtin_keys), 5, static=True)
    x = runtime_q(e)
    original = asm.decode(e.body(TARGETS[0])[5])
    assert [op.name for op in original[:2]] == ['getlocal_0', 'pushscope']
    e.insert(TARGETS[0], 2, select.select_member(e, x, resolver_q))
    scan_q = e.add_method(PARTY, 'wfxBallPfPreload', 'void', ['*'],
                          preload.scan(e, resolver_q), 10)
    ops = asm.decode(e.body(TARGETS[1])[5])
    assert ops[-1].name == 'returnvoid'
    e.insert(TARGETS[1], len(ops) - 1,
             [('getlocal_0',), ('getlocal_1',), ('callpropvoid', scan_q, 1)],
             incoming=asm.ENTER)
    return {'capability': 'client.ball.pf_action@1', 'targets': TARGETS,
            'action_key': select.PREFIX + '<canonical positive multiball id>',
            'shared_selector': 'MemberImpl/wfxDualPfLogic -> wfxBallPfActionKey',
            'fallback': 'missing/empty CAS, missing PFA table/row/level, or bundled collision -> native type PF',
            'bundled_collision_evidence': evidence,
            'preload': {'entry': TARGETS[1], 'helper': 'BattlePartyLogic/wfxBallPfPreload',
                        'scope': 'every current and remote BattlePartyLogic through existing p12b entry',
                        'scan': 'all canonical N6 keys plus N5 keys accepted by the same interval validator',
                        'n5_only': 'native type PF three levels even without any wfx42 or N6',
                        'levels': [1, 2, 3], 'element': 'MultiballTable.element',
                        'closure': 'existing wfxDualPreloadPaths -> addActionDsl -> leading and view resolver'},
            'no_config': 'original native PF path and zero additional action keys',
            'no_actor_ids': True, 'no_cross_player_messages': True}
