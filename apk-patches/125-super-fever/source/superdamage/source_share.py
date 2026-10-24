"""实际伤害共享保留原攻击归属；公共chain和只同步镜像不归本队累计。"""
import asm
from .poison import OWNER

TARGETS = ['DamageShareCalculator/calculateFromAttackResult', 'EnemyImpl/applyDamageShare']
FIELDS = ('isFromHostile', 'createdByBoss', 'createdByFunnel',
          'createdByPrimarySquad', 'createdBySummonsMultiBall', 'originMemberIndex')


def install(e):
    q, owner = e.q, e.newq(OWNER)
    label = TARGETS[0]
    ins = asm.decode(e.body(label)[5])
    assert ins[66].name == 'newobject' and ins[66].args == [5]
    code = []
    # Nonexistent hostile metadata (e.g. native FixedAttack) means false;
    # a nonexistent origin never becomes slot0 through int(undefined).
    for field in FIELDS:
        code += [('dup',), e.string(field), ('getlocal_3',), ('in',), ('iffalse', 'ABSENT_'+field),
                 ('getlocal_3',), ('getproperty', q(field)), ('jump','HAVE_'+field),
                 ('label','ABSENT_'+field), e.number(-1) if field == 'originMemberIndex' else ('pushfalse',),
                 ('label','HAVE_'+field)]
        code += [('convert_i',)] if field == 'originMemberIndex' else [('convert_b',)]
        code += [('setproperty', q(field))]
    code += [e.string(OWNER), ('getlocal_3',), ('in',), ('iffalse', 'CLASSIFY'),
             ('getlocal_3',), ('getproperty', owner), ('iffalse', 'NO'),
             ('label', 'CLASSIFY')]
    for field in ('isFromHostile','createdByBoss','createdByFunnel'):
        code += [('dup',), ('getproperty', q(field)), ('iftrue', 'NO')]
    for field in ('createdByPrimarySquad','createdBySummonsMultiBall'):
        code += [('dup',), ('getproperty', q(field)), ('iftrue', 'YES')]
    code += [('dup',), ('getproperty', q('originMemberIndex')), e.number(0), ('iflt', 'NO'),
             ('dup',), ('getproperty', q('originMemberIndex')), e.number(3), ('ifge', 'NO'),
             ('label', 'YES'), ('dup',), ('pushtrue',), ('setproperty', owner), ('jump', 'DONE'),
             ('label', 'NO'), ('dup',), ('pushfalse',), ('setproperty', owner), ('label', 'DONE')]
    e.insert(label, 67, code)
    label = TARGETS[1]
    ins = asm.decode(e.body(label)[5])
    assert ins[62].name == 'setlocal' and ins[62].args == [4]
    e.insert(label, 63, [
        ('getlocal_2',), ('getproperty', q('isOnlyCoop')), ('iftrue', 'OLD'),
        e.string(OWNER), ('getlocal_2',), ('in',), ('iffalse', 'OLD'),
        ('getlocal_0',), ('getlocal_1',), ('getlocal_2',), ('getlocal', 4),
        ('callpropvoid', e.newq('wfxSuperRecordAttack'), 3), ('label', 'OLD')])
