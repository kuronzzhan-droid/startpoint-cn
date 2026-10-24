"""敌人已接受伤害后累计真实扣血量，包含本端协力球和召唤。"""
import asm

ENEMY = 'pinball.scene.battle.battle.enemy::EnemyImpl'


def install_record(e):
    q = e.q
    x = next(i for i, v in enumerate(e.abc.multinames) if v[0] == 0x1b)
    # impact, result, effectiveDamage(Decimal100). 一次实际applyAttack只计一次。
    code = [('getlocal_0',), ('pushscope',),
            ('getlocal_1',), ('getproperty', q('createdByPrimaryBattle')), ('iffalse', 'DONE'),
            ('getlocal_0',), ('getproperty', q('battle')), ('callproperty', q('__isMyBattle__'), 0), ('iffalse', 'DONE'),
            e.string('wfxSuperOwnerLocal'), ('getlocal_2',), ('in',), ('iffalse', 'OWNER_READY'),
            ('getlocal_2',), ('getproperty', e.newq('wfxSuperOwnerLocal')), ('iffalse', 'DONE'),
            ('label', 'OWNER_READY'),
            ('getlocal_2',), ('getproperty', q('isFromHostile')), ('iftrue', 'DONE'),
            ('getlocal_2',), ('getproperty', q('createdByBoss')), ('iftrue', 'DONE'),
            ('getlocal_2',), ('getproperty', q('createdByFunnel')), ('iftrue', 'DONE'),
            ('getlocal_3',), e.number(0), ('ifngt', 'DONE'),
            ('getlocal_2',), ('getproperty', q('createdByPrimarySquad')), ('iftrue', 'LOCAL'),
            ('getlocal_2',), ('getproperty', q('createdBySummonsMultiBall')), ('iftrue', 'LOCAL'),
            ('getlocal_2',), ('getproperty', q('originMemberIndex')), ('setlocal', 4),
            ('getlocal', 4), e.number(0), ('iflt', 'DONE'),
            ('getlocal', 4), e.number(3), ('ifge', 'DONE'),
            ('label', 'LOCAL'), ('getlocal_0',), ('getproperty', q('squadManager')),
            ('getproperty', q('primary')), e.number(0), ('callproperty', q('getMember'), 1), ('setlocal', 4),
            ('getlocal', 4), ('getproperty', q('index')), e.number(0), ('ifne', 'DONE'),
            ('getlocal', 4), ('getproperty', q('params')), e.number(0), ('getproperty', x),
            ('getlocal_3',), e.number(100), ('divide',),
            ('callpropvoid', e.newq('wfxSuperRecordDamage'), 1), ('label', 'DONE'), ('returnvoid',)]
    record = e.add_method(ENEMY, 'wfxSuperRecordAttack', 'void', ['*', '*', 'Number'], code, 5)
    label = 'EnemyImpl/applyAttack'
    ins = asm.decode(e.body(label)[5])
    call = next(i for i, v in enumerate(ins) if v.name == 'callproperty' and e.abc.mn_name(v.args[0]) == 'calcurateDamageWithoutOverdamage')
    at = next(i+1 for i in range(call+1, call+6) if ins[i].name == 'setlocal' and ins[i].args == [10])
    e.insert(label, at, [('getlocal_0',), ('getlocal_1',), ('getlocal_2',), ('getlocal', 10), ('callpropvoid', record, 3)])
