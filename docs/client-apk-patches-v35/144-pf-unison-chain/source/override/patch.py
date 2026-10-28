"""PF 覆盖来源旁路登记；原 instant/during 字段与读取完全保留。"""
import hashlib
import asm

CLS = 'pinball.scene.battle.battle.ability::BattleAbilityTotalizerImpl'
INSTANT = 'BattleAbilityTotalizerImpl/applyInstantCommonContent'
DURING = 'BattleAbilityTotalizerImpl/addDuringContent'
TARGETS = [INSTANT, DURING]
ADDED = ['BattleAbilityTotalizerImpl/wfxPfLedger',
         'BattleAbilityTotalizerImpl/wfxPfRecord',
         'BattleAbilityTotalizerImpl/wfxPfSelect']
LOCKS = {
    INSTANT: {'sha': '94accfba40eede1982c0e8d62bf9b55b35ddf20e701948dbc45d892659ce0b4a',
              'header': [8, 20, 1, 2]},
    DURING: {'sha': '8d64bbf5744ba5a257ee6f81e46eec7995868d8eb62f6df6583411bcfde0d4bc',
             'header': [9, 7, 1, 2]},
}


def install_ledger(e):
    q = e.q
    cache = e.add_slot(CLS, 'wfxPfLedgers', 'haxe.ds::WeakMap', static=True)
    code = [('getlocal_0',), ('pushscope',),
            ('getlex', q(CLS)), ('getproperty', cache), ('setlocal_1',),
            ('getlocal_1',), ('iftrue', 'READY'),
            ('getlex', q('haxe.ds::WeakMap')), ('construct', 0), ('setlocal_1',),
            ('getlex', q(CLS)), ('getlocal_1',), ('setproperty', cache),
            ('label', 'READY'),
            ('getlocal_1',), ('getlocal_0',), ('callproperty', q('get'), 1), ('setlocal_2',),
            ('getlocal_2',), ('iftrue', 'DONE'),
            ('newarray', 0), ('newarray', 0), ('newarray', 2), ('setlocal_2',),
            ('getlocal_1',), ('getlocal_0',), ('getlocal_2',), ('callpropvoid', q('set'), 2),
            ('label', 'DONE'), ('getlocal_2',), ('returnvalue',)]
    return e.add_method(CLS, 'wfxPfLedger', 'Array', [], code, 3)


def install_record(e, ledger):
    q, n = e.q, e.number
    x = next(i for i, v in enumerate(e.abc.multinames) if v[0] == 0x1b)
    # args id1, levels2, checker3(null=>instant), packed source4; ledger5/list6/i7.
    code = [('getlocal_0',), ('pushscope',),
            ('getlocal_0',), ('callproperty', ledger, 0), ('setlocal', 5),
            ('getlocal_3',), ('iftrue', 'DURING'),
            ('getlocal', 5), n(0), ('getproperty', x), ('setlocal', 6),
            n(0), ('setlocal', 7), ('jump', 'CHECK'),
            ('label', 'LOOP'), ('avm_label',),
            ('getlocal', 6), ('getlocal', 7), ('getproperty', x),
            n(0), ('getproperty', x), ('getlocal', 4), ('ifne', 'NEXT'),
            ('getlocal', 6), ('getlocal', 7), n(1),
            ('callpropvoid', q('http://adobe.com/AS3/2006/builtin::splice'), 2),
            ('jump', 'APPEND'),
            ('label', 'NEXT'), ('inclocal_i', 7),
            ('label', 'CHECK'), ('getlocal', 7), ('getlocal', 6),
            ('getproperty', q('length')), ('iflt', 'LOOP'),
            ('label', 'APPEND'), ('getlocal', 6), ('getlocal', 4),
            ('getlocal_1',), ('getlocal_2',), ('newarray', 3),
            ('callpropvoid', q('http://adobe.com/AS3/2006/builtin::push'), 1), ('returnvoid',),
            ('label', 'DURING'), ('getlocal', 5), n(1), ('getproperty', x),
            ('getlocal', 4), ('getlocal_1',), ('getlocal_2',), ('getlocal_3',), ('newarray', 4),
            ('callpropvoid', q('http://adobe.com/AS3/2006/builtin::push'), 1), ('returnvoid',)]
    return e.add_method(CLS, 'wfxPfRecord', 'void', ['String', 'Array', '*', 'int'], code, 8)


def install_select(e, ledger):
    q, n = e.q, e.number
    x = next(i for i, v in enumerate(e.abc.multinames) if v[0] == 0x1b)
    # args level1, owner index2, unison3; packed4, ledger5, list6, i7, row8.
    code = [('getlocal_0',), ('pushscope',),
            ('getlocal_2',), n(16), ('lshift',), n(1), ('bitor',), ('setlocal', 4),
            ('getlocal_0',), ('callproperty', ledger, 0), ('setlocal', 5),
            ('getlocal', 5), n(0), ('getproperty', x), ('setlocal', 6),
            ('getlocal', 6), ('getproperty', q('length')), n(1), ('subtract_i',),
            ('setlocal', 7), ('jump', 'ICHECK'),
            ('label', 'ILOOP'), ('avm_label',),
            ('getlocal', 6), ('getlocal', 7), ('getproperty', x), ('setlocal', 8),
            ('getlocal', 8), n(0), ('getproperty', x), ('getlocal', 4), ('equals',),
            ('getlocal_3',), ('ifne', 'INEXT'),
            ('getlocal', 8), n(2), ('getproperty', x), ('getlocal_1',),
            ('callproperty', q('http://adobe.com/AS3/2006/builtin::indexOf'), 1),
            n(-1), ('ifeq', 'DURING'),
            ('getlocal', 8), n(1), ('getproperty', x), ('returnvalue',),
            ('label', 'INEXT'), ('declocal_i', 7),
            ('label', 'ICHECK'), ('getlocal', 7), n(0), ('ifge', 'ILOOP'),
            ('label', 'DURING'),
            ('getlocal', 5), n(1), ('getproperty', x), ('setlocal', 6),
            n(0), ('setlocal', 7), ('jump', 'DCHECK'),
            ('label', 'DLOOP'), ('avm_label',),
            ('getlocal', 6), ('getlocal', 7), ('getproperty', x), ('setlocal', 8),
            ('getlocal', 8), n(0), ('getproperty', x), ('getlocal', 4), ('equals',),
            ('getlocal_3',), ('ifne', 'DNEXT'),
            ('getlocal', 8), n(3), ('getproperty', x), ('pushnull',),
            ('callproperty', q('getActiveCount'), 1), n(0), ('ifle', 'DNEXT'),
            ('getlocal', 8), n(2), ('getproperty', x), ('getlocal_1',),
            ('callproperty', q('http://adobe.com/AS3/2006/builtin::indexOf'), 1),
            n(-1), ('ifeq', 'DNEXT'),
            ('getlocal', 8), n(1), ('getproperty', x), ('returnvalue',),
            ('label', 'DNEXT'), ('inclocal_i', 7),
            ('label', 'DCHECK'), ('getlocal', 7), ('getlocal', 6),
            ('getproperty', q('length')), ('iflt', 'DLOOP'),
            ('pushnull',), ('returnvalue',)]
    return e.add_method(CLS, 'wfxPfSelect', 'String', ['int', 'int', 'Boolean'], code, 9)


def build(e):
    for label in TARGETS:
        body = e.body(label)
        if hashlib.sha256(body[5]).hexdigest() != LOCKS[label]['sha'] or body[1:5] != LOCKS[label]['header']:
            raise asm.AsmError('PF override input SHA/header mismatch: ' + label)
    ledger = install_ledger(e)
    record = install_record(e, ledger)
    install_select(e, ledger)
    q = e.q
    x = next(i for i, v in enumerate(e.abc.multinames) if v[0] == 0x1b)
    assert asm.decode(e.body(INSTANT)[5])[501].name == 'jump'
    e.insert(INSTANT, 501, [
        ('getlocal_0',), ('getlocal', 19), ('getproperty', q('id')),
        ('getlocal', 19), ('getproperty', q('forLevels')),
        ('pushnull',), ('getlocal', 4), ('callpropvoid', record, 4)])
    assert asm.decode(e.body(DURING)[5])[353].name == 'jump'
    e.insert(DURING, 353, [
        ('getlocal_0',), ('getlocal_1',), ('getproperty', q('params')), e.number(0),
        ('getproperty', x), ('getlocal_1',), ('getproperty', q('params')),
        e.number(1), ('getproperty', x), ('getlocal_2',), ('getlocal_3',),
        ('callpropvoid', record, 4)])
    return {'targets': TARGETS, 'added': ADDED,
            'api': 'wfxPfSelect(level, member.originMemberIndex, unison)',
            'source': 'exact packed OriginMemberInfo: memberIndex << 16 | unisonKind'}
