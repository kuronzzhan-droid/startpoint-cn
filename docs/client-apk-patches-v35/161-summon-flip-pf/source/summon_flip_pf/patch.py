"""N5 method-level incremental patch against locked p12b."""
import asm
from . import config, queue
from .config import BALL, SQUAD

TARGETS = ['BallImpl/resolveCollisionForPrimaryOrSummons', 'SquadImpl/willRemove']


def build(e):
    x = next(i for i, row in enumerate(e.abc.multinames) if row[0] == 0x1b)
    queues = e.add_slot(BALL, 'wfxSummonFlipQueues', 'flash.utils::Dictionary', True)
    pending = e.add_slot(BALL, 'wfxSummonFlipPending', 'flash.utils::Dictionary', True)
    cooldown = e.add_slot(BALL, 'wfxSummonFlipCooldown', 'flash.utils::Dictionary', True)
    eligible = e.add_method(BALL, 'wfxSummonFlipMember', '*', [], config.eligible(e, x), 4)
    parse = e.add_method(BALL, 'wfxSummonFlipInterval', 'int', ['String'], config.interval(e, x), 4, static=True)
    interval = e.add_method(BALL, 'wfxSummonFlipConfig', 'int', ['*'], config.config(e, x, parse), 4)
    ongoing = e.add_method(BALL, 'wfxSummonFlipOngoing', 'Boolean', [], config.ongoing(e, x), 3)
    capture = e.add_method(BALL, 'wfxSummonFlipCapture', 'void', ['int'],
                           queue.capture(e, x, queues, pending, interval, eligible, ongoing), 8)
    launch = e.add_method(BALL, 'wfxSummonFlipLaunch', 'void', ['int', 'int', '*'],
                          queue.launch(e, x, cooldown, eligible, ongoing), 9)
    flush = e.add_method(SQUAD, 'wfxSummonFlipFlush', 'void', [], queue.flush(e, x, queues, pending, launch), 10)
    ins = asm.decode(e.body(TARGETS[0])[5])
    calls = [i for i, op in enumerate(ins) if op.name == 'callproperty'
             and e.abc.mn_name(op.args[0]).split('::')[-1] == 'getPowerFlipChargeLv']
    assert len(calls) == 1
    pos = calls[0] + 1
    while ins[pos].name == 'convert_i': pos += 1
    assert ins[pos].name == 'setlocal_3'
    e.insert(TARGETS[0], pos + 1, [('getlocal_0',), ('getlocal_3',), ('callpropvoid', capture, 1)])
    removal = asm.decode(e.body(TARGETS[1])[5])
    sites = [i for i, op in enumerate(removal) if op.name == 'callpropvoid'
             and e.abc.mn_name(op.args[0]) == 'wfxDualPfFlush']
    assert len(sites) == 1
    e.insert(TARGETS[1], sites[0] + 1, [('getlocal_0',), ('callpropvoid', flush, 0)])
    return {'capability': 'client.summon.flip_pf@1', 'targets': TARGETS,
            'capture': 'native hitByFlipper path immediately after original getPowerFlipChargeLv; N3 included',
            'dispatch': 'primary willRemove after p12b N4 snapshot drain; N5 event adds N4 layers for next frame',
            'ownership': 'exact Ball.battle.squadManager == summon squadManager; same primary manager; no local-player gate',
            'ongoing': 'ActionType.PowerFlip.params[0] exact ball identity across active evaluator list',
            'interval': 'canonical 1 or 1:<nonnegative int32 frames>; default zero; successful launch frame',
            'dedup': 'weak primary and ball dictionaries with scalar-only values; one row per ball per frame; native active squad order',
            'pf': 'reuse wfxDualPfLogic and native MemberImpl.startPowerFlip; own condition counts plus one native team event',
            'no_combo_consumption': True, 'no_terminate': True, 'no_cross_player_messages': True}
