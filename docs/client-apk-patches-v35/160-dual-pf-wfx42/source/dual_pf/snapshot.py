"""Snapshot all existing layer tokens before any PF callback is executed."""
from .common import CONDITION, SQUAD, HEAD, at, field, local


def collect(e, x):
    # this=holder; slot=1; output=2; map=3; keys=4; i=5; key=6;
    # condition=7; spec=8; accumulation=9.
    q = e.q
    return HEAD + [
        ('getlocal_1',), ('iffalse', 'RETURN'),
        *field(1, 'conditions', q), ('setlocal_3',),
        ('getlocal_3',), ('iffalse', 'RETURN'),
        *field(3, '_keys', q), ('setlocal', 4),
        ('pushbyte', 0), ('setlocal', 5), ('jump', 'TEST'),
        ('label', 'LOOP'), ('avm_label',),
        ('getlocal', 4), ('getlocal', 5), ('getproperty', x), ('setlocal', 6),
        *field(3, 'map', q), ('getlocal', 6), ('callproperty', q('get'), 1),
        ('setlocal', 7), ('getlocal', 7), ('iffalse', 'NEXT'),
        *field(7, 'content', q), ('getproperty', q('index')),
        ('pushbyte', 31), ('ifne', 'NEXT'),
        ('getlex', q(CONDITION)), *field(7, 'content', q),
        ('getproperty', q('params')), ('pushbyte', 0), ('getproperty', x),
        *field(1, 'asset', q), ('callproperty', q('wfxSpec'), 2), ('setlocal', 8),
        ('getlocal', 8), ('iffalse', 'NEXT'),
        *at(8, 0, x), ('pushbyte', 42), ('ifne', 'NEXT'),
        *at(8, 1, x), ('pushbyte', 1), ('iflt', 'NEXT'),
        *at(8, 1, x), ('pushbyte', 3), ('ifgt', 'NEXT'),
        *at(8, 2, x), ('pushbyte', 0), ('ifle', 'NEXT'),
        ('getlocal', 7), ('callproperty', q('get_currentAccumulation'), 0),
        ('convert_i',), ('setlocal', 9),
        ('getlocal', 9), ('pushbyte', 0), ('ifle', 'NEXT'),
        ('getlocal_2',), ('getlocal_0',), ('getlocal_1',), ('getlocal', 6),
        ('getlocal', 7), ('getlocal', 8), ('getlocal', 9), ('newarray', 6),
        ('callpropvoid', q('http://adobe.com/AS3/2006/builtin::push'), 1),
        ('label', 'NEXT'), ('inclocal_i', 5),
        ('label', 'TEST'), ('getlocal', 5), *field(4, 'length', q),
        ('iflt', 'LOOP'), ('label', 'RETURN'), ('returnvoid',),
    ]


def consume(e, x, execute):
    # row=1; primary=2; slot=3; condition=4; remaining snapshot tokens=5.
    q = e.q
    return HEAD + [
        *at(1, 1, x), ('setlocal_3',), *at(1, 3, x), ('setlocal', 4),
        *at(1, 5, x), ('convert_i',), ('setlocal', 5),
        ('label', 'LOOP'), ('avm_label',),
        ('getlocal', 5), ('pushbyte', 0), ('ifle', 'RETURN'),
        *field(3, 'conditions', q), ('getproperty', q('map')),
        *at(1, 2, x), ('callproperty', q('get'), 1),
        ('getlocal', 4), ('ifstrictne', 'RETURN'),
        ('getlocal', 4), ('callproperty', q('get_currentAccumulation'), 0),
        ('pushbyte', 0), ('ifle', 'RETURN'),
        # Consume through original Condition semantics, then original removal path.
        ('getlocal', 4), ('pushbyte', 1), ('callpropvoid', q('consumeNumAccumulation'), 1),
        ('getlocal', 4), ('callproperty', q('get_accumulatable'), 0),
        ('iffalse', 'REMOVE'),
        ('getlocal', 4), ('callproperty', q('get_currentAccumulation'), 0),
        ('pushbyte', 0), ('ifgt', 'EXECUTE'),
        ('label', 'REMOVE'), ('getlocal_3',), *at(1, 2, x),
        ('callpropvoid', q('removeCondition'), 1),
        ('label', 'EXECUTE'), ('declocal_i', 5),
        ('getlocal_0',), *at(1, 4, x), ('getlocal_2',),
        ('callpropvoid', execute, 2), ('jump', 'LOOP'),
        ('label', 'RETURN'), ('returnvoid',),
    ]


def flush(e, x, frames, collect_method, consume_method):
    # frames=1; frame=2; snapshot=3; node=4; squad=5; members=6;
    # index=7; member=8; conditionSlot=9; row=10.
    q = e.q
    return HEAD + [
        ('getlocal_0',), ('callproperty', q('isPrimary'), 0), ('iffalse', 'RETURN'),
        ('getlocal_0',), ('callproperty', q('isActive'), 0), ('iffalse', 'RETURN'),
        # Every lockstep Battle simulates its own primary squad, including remote
        # players. __isMyBattle__ is a display/local-player flag, not ownership.
        ('getlex', q(SQUAD)), ('getproperty', frames), ('setlocal_1',),
        ('getlocal_1',), ('iftrue', 'CACHE'),
        ('getlex', q('flash.utils::Dictionary')), ('pushtrue',), ('construct', 1), ('setlocal_1',),
        ('getlex', q(SQUAD)), ('getlocal_1',), ('setproperty', frames),
        ('label', 'CACHE'), *field(0, 'squadManager', q),
        ('getproperty', q('currentFrame')), ('convert_i',), ('setlocal_2',),
        ('getlocal_1',), ('getlocal_0',), ('getproperty', x),
        ('getlocal_2',), ('ifstricteq', 'RETURN'),
        # Frame is marked before scanning: recursive willRemove calls cannot flush.
        ('getlocal_1',), ('getlocal_0',), ('getlocal_2',), ('setproperty', x),
        ('newarray', 0), ('setlocal_3',),
        *field(0, 'squadManager', q), ('getproperty', q('activeSquadManager')),
        ('getproperty', q('squads')), ('getproperty', q('h')), ('setlocal', 4),
        ('label', 'SQUADS'), ('avm_label',), ('getlocal', 4), ('iffalse', 'DRAIN'),
        *field(4, 'item', q), ('setlocal', 5),
        *field(4, 'next', q), ('setlocal', 4),
        ('getlocal', 5), ('callproperty', q('isActive'), 0), ('iffalse', 'SQUADS'),
        *field(5, 'members', q), ('setlocal', 6), ('pushbyte', 0), ('setlocal', 7),
        ('label', 'MEMBERS'), ('avm_label',),
        ('getlocal', 7), *field(6, 'length', q), ('ifge', 'SQUADS'),
        ('getlocal', 6), ('getlocal', 7), ('getproperty', x), ('setlocal', 8),
        ('inclocal_i', 7), *field(8, 'index', q), ('pushbyte', 0), ('ifne', 'MEMBERS'),
        *field(8, 'params', q), ('pushbyte', 0), ('getproperty', x), ('setlocal', 8),
        *field(8, 'conditionSlot', q), ('setlocal', 9),
        ('getlocal', 8), ('getlocal', 9), ('getlocal_3',), ('callpropvoid', collect_method, 2),
        *field(9, 'invisibleSlot', q), ('setlocal', 9),
        ('getlocal', 9), ('iffalse', 'MEMBERS'),
        ('getlocal', 9), *field(8, 'conditionSlot', q), ('ifstricteq', 'MEMBERS'),
        ('getlocal', 8), ('getlocal', 9), ('getlocal_3',), ('callpropvoid', collect_method, 2),
        ('jump', 'MEMBERS'),
        ('label', 'DRAIN'), ('pushbyte', 0), ('setlocal', 7),
        ('label', 'ROWS'), ('avm_label',),
        ('getlocal', 7), *field(3, 'length', q), ('ifge', 'RETURN'),
        ('getlocal_3',), ('getlocal', 7), ('getproperty', x), ('setlocal', 10),
        ('inclocal_i', 7), *at(10, 0, x), ('getlocal', 10), ('getlocal_0',),
        ('callpropvoid', consume_method, 2), ('jump', 'ROWS'),
        ('label', 'RETURN'), ('returnvoid',),
    ]
