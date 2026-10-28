"""Collision capture plus deterministic post-N4 frame-end dispatch."""
from dual_pf.common import HEAD, field, at, OPTION
from .config import BALL, SQUAD


def capture(e, x, queues, pending, config, eligible, ongoing):
    # lv=1; member=2; interval=3; primary=4; dict=5; state=6; frame=7.
    q = e.q
    return HEAD + [
        ('getlocal_1',), ('pushbyte', 1), ('iflt', 'DONE'),
        ('getlocal_1',), ('pushbyte', 3), ('ifgt', 'DONE'),
        ('getlocal_0',), ('callproperty', eligible, 0), ('setlocal_2',),
        ('getlocal_2',), ('iffalse', 'DONE'),
        ('getlocal_0',), ('getlocal_2',), ('callproperty', config, 1), ('setlocal_3',),
        ('getlocal_3',), ('pushbyte', 0), ('iflt', 'DONE'),
        ('getlocal_0',), ('callproperty', ongoing, 0), ('iftrue', 'DONE'),
        *field(2, 'squadManager', q), ('getproperty', q('primary')), ('setlocal', 4),
        *field(2, 'squadManager', q), ('getproperty', q('currentFrame')), ('convert_i',), ('setlocal', 7),
        ('getlex', q(BALL)), ('getproperty', queues), ('setlocal', 5),
        ('getlocal', 5), ('iftrue', 'CACHE'),
        ('getlex', q('flash.utils::Dictionary')), ('pushtrue',), ('construct', 1), ('setlocal', 5),
        ('getlex', q(BALL)), ('getlocal', 5), ('setproperty', queues),
        ('label', 'CACHE'), ('getlocal', 5), ('getlocal', 4), ('getproperty', x), ('setlocal', 6),
        ('getlocal', 6), ('iffalse', 'NEW'),
        *at(6, 0, x), ('getlocal', 7), ('ifstricteq', 'HAVE'),
        ('label', 'NEW'), ('getlocal', 7), ('pushfalse',), ('newarray', 2), ('setlocal', 6),
        ('getlocal', 5), ('getlocal', 4), ('getlocal', 6), ('setproperty', x),
        ('label', 'HAVE'), *at(6, 1, x), ('iftrue', 'DONE'),
        ('getlex', q(BALL)), ('getproperty', pending), ('setlocal', 5),
        ('getlocal', 5), ('iftrue', 'PENDING'),
        ('getlex', q('flash.utils::Dictionary')), ('pushtrue',), ('construct', 1), ('setlocal', 5),
        ('getlex', q(BALL)), ('getlocal', 5), ('setproperty', pending),
        ('label', 'PENDING'), ('getlocal', 5), ('getlocal_0',), ('getproperty', x), ('setlocal', 6),
        ('getlocal', 6), ('iffalse', 'APPEND'),
        *at(6, 0, x), ('getlocal', 7), ('ifstricteq', 'DONE'),
        ('label', 'APPEND'), ('getlocal', 5), ('getlocal_0',),
        ('getlocal', 7), ('getlocal_1',), ('getlocal_3',), ('newarray', 3), ('setproperty', x),
        ('label', 'DONE'), ('returnvoid',),
    ]


def launch(e, x, cooldown, eligible, ongoing):
    # level=1; interval=2; primary=3; member=4; dict=5; frame=6; last=7; logic=8.
    q = e.q
    return HEAD + [
        ('getlocal_0',), ('callproperty', eligible, 0), ('setlocal', 4),
        ('getlocal', 4), ('iffalse', 'DONE'),
        *field(4, 'squadManager', q), ('getproperty', q('primary')), ('getlocal_3',), ('ifstrictne', 'DONE'),
        ('getlocal_0',), ('callproperty', ongoing, 0), ('iftrue', 'DONE'),
        *field(4, 'squadManager', q), ('getproperty', q('currentFrame')), ('convert_i',), ('setlocal', 6),
        ('getlex', q(BALL)), ('getproperty', cooldown), ('setlocal', 5),
        ('getlocal', 5), ('iftrue', 'CACHE'),
        ('getlex', q('flash.utils::Dictionary')), ('pushtrue',), ('construct', 1), ('setlocal', 5),
        ('getlex', q(BALL)), ('getlocal', 5), ('setproperty', cooldown),
        ('label', 'CACHE'), ('getlocal', 5), ('getlocal_0',), ('getproperty', x), ('setlocal', 7),
        ('getlocal', 7), ('pushnull',), ('ifeq', 'LOGIC'),
        ('getlocal', 6), ('getlocal', 7), ('subtract',), ('getlocal_2',), ('iflt', 'DONE'),
        ('label', 'LOGIC'), ('getlocal', 4), ('callproperty', q('wfxDualPfLogic'), 0), ('setlocal', 8),
        ('getlocal', 8), ('iffalse', 'DONE'),
        # Mark before launch/notifications so callbacks cannot bypass cooldown.
        ('getlocal', 5), ('getlocal_0',), ('getlocal', 6), ('setproperty', x),
        ('getlocal', 4), ('getlocal', 8), ('getlocal_1',),
        ('getlex', q(OPTION)), ('getproperty', q('None')),
        ('callpropvoid', q('startPowerFlip'), 3),
        *field(4, 'squad', q), ('callpropvoid', q('countUpPowerFlip'), 0),
        ('getlocal_3',), ('getlocal_1',), ('callpropvoid', q('wfxDualPfNotify'), 1),
        ('label', 'DONE'), ('returnvoid',),
    ]


def flush(e, x, queues, pending, launch_method):
    # primary=this; dict=1; state/row=2; rows=3; node/index=4;
    # ball=5; frame=6; pending=7; squad=8; data=9.
    q = e.q
    return HEAD + [
        ('getlocal_0',), ('callproperty', q('isPrimary'), 0), ('iffalse', 'DONE'),
        ('getlocal_0',), ('callproperty', q('isActive'), 0), ('iffalse', 'DONE'),
        ('getlex', q(BALL)), ('getproperty', queues), ('setlocal_1',),
        ('getlocal_1',), ('iffalse', 'DONE'),
        ('getlocal_1',), ('getlocal_0',), ('getproperty', x), ('setlocal_2',),
        ('getlocal_2',), ('iffalse', 'DONE'),
        *field(0, 'squadManager', q), ('getproperty', q('currentFrame')), ('convert_i',), ('setlocal', 6),
        *at(2, 0, x), ('getlocal', 6), ('ifstrictne', 'DONE'),
        *at(2, 1, x), ('iftrue', 'DONE'),
        ('getlocal_2',), ('pushbyte', 1), ('pushtrue',), ('setproperty', x),
        ('getlex', q(BALL)), ('getproperty', pending), ('setlocal', 7),
        ('getlocal', 7), ('iffalse', 'DONE'), ('newarray', 0), ('setlocal_3',),
        *field(0, 'squadManager', q), ('getproperty', q('activeSquadManager')),
        ('getproperty', q('squads')), ('getproperty', q('h')), ('setlocal', 4),
        ('label', 'SCAN'), ('avm_label',), ('getlocal', 4), ('iffalse', 'DRAIN'),
        *field(4, 'item', q), ('setlocal', 8), *field(4, 'next', q), ('setlocal', 4),
        *field(8, 'squadManager', q), *field(0, 'squadManager', q), ('ifstrictne', 'SCAN'),
        *field(8, 'ball', q), ('setlocal', 5),
        ('getlocal', 7), ('getlocal', 5), ('getproperty', x), ('setlocal', 9),
        ('getlocal', 9), ('iffalse', 'SCAN'),
        *at(9, 0, x), ('getlocal', 6), ('ifstrictne', 'SCAN'),
        # Static values never retain object keys, even if a battle exits before flush.
        ('getlocal', 7), ('getlocal', 5), ('pushnull',), ('setproperty', x),
        ('getlocal_3',), ('getlocal', 5), *at(9, 1, x), *at(9, 2, x), ('newarray', 3),
        ('callpropvoid', q('http://adobe.com/AS3/2006/builtin::push'), 1), ('jump', 'SCAN'),
        ('label', 'DRAIN'), ('pushbyte', 0), ('setlocal', 4),
        ('label', 'LOOP'), ('avm_label',), ('getlocal', 4), *field(3, 'length', q), ('ifge', 'DONE'),
        ('getlocal_3',), ('getlocal', 4), ('getproperty', x), ('setlocal_2',), ('inclocal_i', 4),
        *at(2, 0, x), *at(2, 1, x), *at(2, 2, x), ('getlocal_0',),
        ('callpropvoid', launch_method, 3), ('jump', 'LOOP'),
        ('label', 'DONE'), ('returnvoid',),
    ]
