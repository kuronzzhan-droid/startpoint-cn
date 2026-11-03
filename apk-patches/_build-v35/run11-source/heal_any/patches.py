"""第十一轮34/35：单方法可逆拼接，旧30/31按类型互斥。"""
import copy
import hashlib
import asm
from perf2_core import splice_with_exits
from . import values, sample, ct_patch

SAMPLE = 'MemberImpl/wfxHealSample'
PRELOAD = 'UniqueConditionLogic/wfxSuperPreload'
TARGETS = [SAMPLE, PRELOAD, ct_patch.TICK]
LOCKS = {
    SAMPLE: {'sha': '62bd04d56ce006807be873e98e7f0789ef90953329fb598dc280ce89d9e48a3f',
             'header': [3, 9, 1, 2]},
    PRELOAD: {'sha': '2f69b6f0ec4c5a5912dd92c1fc909405bdd0391d2ed00ed0b46c6875d41a4f7a',
              'header': [5, 6, 1, 2]},
}
ADDED = ['MemberImpl/' + n for n in ['wfxHealAnyValue', 'wfxHealAnyDamage',
         'wfxHealAnyFever', 'wfxHealAnyMembers', 'wfxHealAnySample']] + ct_patch.ADDED


def build(e):
    for label, lock in LOCKS.items():
        b = e.body(label)
        if hashlib.sha256(b[5]).hexdigest() != lock['sha'] or b[1:5] != lock['header']:
            raise asm.AsmError('heal-any unknown v35j SHA/header: ' + label)
    def exact(name):
        matches = [i for i in range(len(e.abc.multinames)) if e.abc.mn_name(i) == name]
        assert len(matches) == 1, (name, matches)
        return matches[0]
    m = {'x': next(i for i, row in enumerate(e.abc.multinames) if row[0] == 0x1b),
         'exact': exact, 'push': exact('http://adobe.com/AS3/2006/builtin::push'),
         'indexof': exact('http://adobe.com/AS3/2006/builtin::indexOf')}
    value = values.install(e, m)
    damage = values.damage(e, m, value)
    fever = values.fever(e, m, value)
    members = sample.holders(e, m)
    helper = sample.install(e, m, members, damage, fever)
    old = e.body(SAMPLE)
    work = copy.deepcopy(old)
    recovery, shift = [], 0
    inserts = [(2, [('getlocal_0',), ('getlocal_1',), ('getlocal_2',), ('getlocal_3',),
                    ('getlocal', 4), ('getlocal', 5), ('callproperty', helper, 5),
                    ('setlocal', 9), ('getlocal', 9), e.number(3), ('ifne', 'LEGACY'),
                    ('returnvoid',), ('label', 'LEGACY'), ('label', 'END')], {}),
               (65, [('getlocal', 9), e.number(1), ('bitand',), ('iftrue', 'SKIP'),
                     ('label', 'END')], {'SKIP': 69}),
               (69, [('getlocal', 9), e.number(2), ('bitand',), ('iftrue', 'SKIP'),
                     ('label', 'END')], {'SKIP': 73})]
    for at, source, exits in inserts:
        raw, exc, _, count = splice_with_exits(work, at + shift, source,
                       {name: target + shift for name, target in exits.items()}, asm.ENTER)
        recovery.append((at + shift, count, asm.ENTER))
        work[5], work[6] = raw, exc
        shift += count
    assert asm.unsplice_many(work[5], recovery) == old[5]
    e.replace(SAMPLE, work[5], work[6])
    e.report[SAMPLE]['insertions'] = recovery
    b = e.body(PRELOAD)
    source = [('getlocal_3',), e.number(0), ('getproperty', m['x']), e.number(34),
              ('ifeq', 'NATIVE30'), ('label', 'END')]
    raw, exc, _, count = splice_with_exits(b, 10, source, {'NATIVE30': 15}, asm.FORBID)
    recovery = [(10, count, asm.FORBID)]
    assert asm.unsplice_many(raw, recovery) == b[5]
    e.replace(PRELOAD, raw, exc)
    e.report[PRELOAD]['insertions'] = recovery
    ct_patch.install(e, m, value)
    return {'capabilities': ['heal-damage-any-source-v1', 'heal-fever-any-source-v1'],
            'targets': TARGETS, 'added': ADDED,
            'damage_queue': 'arg<1000 retains original code30 queue; CT uses holder window and drops blocked heals',
            'fever': 'per-recipient immediate native addFeverPoint kind101, no CT',
            'ownership': 'recipient in current primary squad; unique member identities; wfxRows(code,true)',
            'stats_filter': 'codes34/35 accept cross-statsBattleId actual local primary healing; codes30/31 original exclusion unchanged',
            'ruling': {'coop': 'B', 'fever': 'A: one immediate API per recipient event per holder; no batch marker'}}


apply = build
