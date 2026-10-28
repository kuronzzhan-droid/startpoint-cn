"""主 Battle 在真实推进入口绑定；所有字段读取均在隔离的诊断助手中。"""
from fp_emit import BATTLE, Ops, local as L, PROLOGUE, TRUE
from fp_fields_base import Gen

TARGETS = ['BattleScenePlayingStateImpl/proceedBattles']


def build(editor):
    o, g = Ops(editor), Gen(editor)
    # Raw exact traits identify the same Battle used by get_myBattle and
    # myBattleDriver.proceed. No gameplay getter runs during diagnostic binding.
    driver = g.field('BattleScenePlayingStateImpl', 'myBattleDriver')
    scene = g.field('BattleScenePlayingStateImpl', 'scene')
    battle = g.field('BattleDriver', 'battle')
    c = PROLOGUE + [('label', 'TRY')]
    c += o.slot('wfxFpEnabled') + [('iffalse', 'DONE')]
    c += L(1) + [('iffalse', 'DONE')]
    c += L(1) + [('getproperty', driver), ('setlocal_2',)]
    c += L(2) + [('iffalse', 'DONE')]
    c += L(2) + [('getproperty', battle), ('setlocal_2',)]
    c += L(2) + [('iffalse', 'DONE')]
    c += o.static('wfxFpBind', L(2), L(1) + [('getproperty', scene)]) + [('pop',)]
    c += [('label', 'DONE'), ('returnvoid',), ('label', 'END'),
          ('label', 'CATCH'), ('pop',), ('getlocal_0',), ('pushscope',)]
    c += o.slot_set('wfxFpReadFailed', TRUE) + [('returnvoid',)]
    editor.add_method(BATTLE, 'wfxFpBindPrimary', 'void', ['*'], c, 3,
                      static=True, exceptions=[('TRY', 'END', 'CATCH', 0, 0)])
    editor.insert(TARGETS[0], 2, o.static('wfxFpBindPrimary', L(0), void=True))
    return {'hook': TARGETS[0], 'instruction': 2, 'helper': 'Battle$/wfxFpBindPrimary',
            'slots': g.audit, 'replica_hook': 'BattleDerailleur/proceed',
            'rng_change': 'none: existing wfxFpRng rng_type branch omits values'}
