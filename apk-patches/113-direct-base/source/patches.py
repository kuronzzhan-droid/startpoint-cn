"""组 1–4：先追加辅助方法，再拼接到已锁定 v34 的三种目标方法。"""
import copy
import asm
from perf2_core import splice_with_exits
from . import query, consumers


def build(e):
    m = query.build(e)
    c = consumers.build(e, m)
    q = e.q
    label = 'MemberImpl/scheduleDirectAttack'
    body = copy.deepcopy(e.body(label))
    # old merge marker=0 or >=4；新阈值可为1/2/3，所以补偿条件改成 marker>=1。
    # 原数据的 marker 值域未改变，原Fever/韧性输出保持一致。
    ins = asm.decode(body[5])
    for at in (536, 544):
        assert ins[at].name == 'pushbyte' and ins[at].args == [4]
        ins[at].args = [1]
    body[5] = asm.encode(ins)[0]
    # #371 是旧凯尔分支公共出口；在其之后乘以数据倍率，原 Decimal 单位不变。
    block = [('getlocal', 26), ('getlocal_0',), ('getlocal_2',),
             ('callproperty', c['direct'], 1), ('multiply',), ('convert_d',), ('setlocal', 26)]
    code, exc, _ = asm.splice(body, 371, asm.assemble(block), asm.ENTER)
    body[5], body[6] = code, exc
    # 新入口跳入原合并体 #173；未命中仍走 #162 的原凯尔队长/4段判定。
    block = [('getlocal_0',), ('getlocal', 5), ('callproperty', c['merge'], 1),
             ('iftrue', 'MERGE'), ('label', 'END')]
    code, exc, _, _ = splice_with_exits(body, 162, block, {'MERGE': 173}, asm.ENTER)
    e.replace(label, code, exc)
    e.insert('MemberImpl/getStatModifierSkillGaugeCharging', 241,
             [('getlocal_0',), ('getlocal', 23), ('getlocal', 8),
              ('callproperty', c['charge'], 2), ('convert_d',), ('setlocal', 8)])
    e.insert('ConditionSlot/getOneSideTotalAbilityDamageResistance', 274,
             [('getlocal_3',), ('getlocal_0',), ('getlocal_1',),
              ('callproperty', c['resistance'], 1), ('add',), ('convert_d',), ('setlocal_3',)])
