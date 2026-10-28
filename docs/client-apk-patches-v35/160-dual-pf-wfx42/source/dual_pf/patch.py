"""N4 opt-in dual PF; single original hook in frame-end squad removal phase."""
import asm
from dual_pf_preload import patch as preload
from . import actions, snapshot
from .common import MEMBER, SQUAD

TARGETS = ['SquadImpl/willRemove'] + preload.TARGETS
HELPERS = [
    'MemberImpl/wfxDualPfLogic', 'MemberImpl/wfxDualPfPartner',
    'SquadImpl/wfxDualPfNotify', 'MemberImpl/wfxDualPfExecute',
    'MemberImpl/wfxDualPfCollect', 'MemberImpl/wfxDualPfConsume',
    'SquadImpl/wfxDualPfFlush',
]


def build(e):
    x = next(i for i, row in enumerate(e.abc.multinames) if row[0] == 0x1b)
    frames = e.add_slot(SQUAD, 'wfxDualPfFrames', 'flash.utils::Dictionary', True)
    logic = e.add_method(MEMBER, 'wfxDualPfLogic', '*', [], actions.power_flip_logic(e, x), 2)
    partner = e.add_method(MEMBER, 'wfxDualPfPartner', '*', ['int'], actions.find_partner(e, x), 6)
    notify = e.add_method(SQUAD, 'wfxDualPfNotify', 'void', ['int'], actions.notify(e), 2)
    execute = e.add_method(MEMBER, 'wfxDualPfExecute', 'void', ['Array', '*'],
                           actions.execute(e, x, logic, partner, notify), 6)
    collect = e.add_method(MEMBER, 'wfxDualPfCollect', 'void', ['*', 'Array'],
                           snapshot.collect(e, x), 10)
    consume = e.add_method(MEMBER, 'wfxDualPfConsume', 'void', ['Array', '*'],
                           snapshot.consume(e, x, execute), 6)
    flush = e.add_method(SQUAD, 'wfxDualPfFlush', 'void', [],
                         snapshot.flush(e, x, frames, collect, consume), 11)
    ins = asm.decode(e.body(TARGETS[0])[5])
    assert [row.name for row in ins[:2]] == ['getlocal_0', 'pushscope']
    e.insert(TARGETS[0], 2, [('getlocal_0',), ('callpropvoid', flush, 0)])
    result = {
        'capability': 'client.pf.dual@1', 'wfx_code': 42, 'targets': TARGETS,
        'helpers': HELPERS, 'slots': ['SquadImpl$/wfxDualPfFrames'],
        'frame_end': 'ActiveSquadManager.removalPhase -> primary SquadImpl.willRemove; after ZoneManager.impactPhase',
        'tokens': 'snapshot each concrete Condition identity and current layer count before dispatch; consume one per token',
        'new_layers': 'added during dispatch remain outside the snapshot until the next logical frame',
        'partner': 'same squadManager, active non-removing SummonsMultiball, matching id and holder originMemberIndex, originMemberKind=0',
        'owner_scope': 'exact main-member origin; unison-origin summons excluded',
        'coop_scope': 'every Battle primary squad executes independently through its own SquadManager; no local-player gate',
        'native_pf': 'unmodified MemberImpl.startPowerFlip; executor self; native leader override and own speciality type',
        'events': 'one native team countUpPowerFlip/countUp(0)/tier counts/notifyFlipExecuted set per pair',
        'no_combo_consumption': True, 'no_terminate': True, 'no_cross_player_messages': True,
    }
    result['preload'] = preload.build(e)
    return result
