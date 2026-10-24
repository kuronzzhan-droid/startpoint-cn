"""稻穗视觉按角色数据化，及码24最终乘积非负补丁。"""
import json
from pathlib import Path
import asm
from framework import Editor
from bootstrap import BASE
from swfabc import SwfAbc
from perf2_core import splice_with_exits
from . import helpers

HERE = Path(__file__).resolve().parent
TAG = 'cn.mod.InahoAbilityVisuals'


def external(e):
    aux = Editor(SwfAbc(BASE, tag=TAG.encode()),
                 locks=json.loads((HERE / 'aux-locks.json').read_text(encoding='utf-8')))
    # 独立 ABC 没有 index 名；使用已有公开 member 属性的命名空间追加调用 QName。
    member = next(i for i in range(1, len(aux.abc.multinames)) if aux.abc.mn_name(i) == 'member')
    reader = aux.pool.public_qname('wfxAbilityVisualPaths', helpers.unique(aux, 'Object'))
    # 此极小 ABC 没有动态索引；用 Array.shift() 消费临时数组避免追加 ns_set。
    shift = aux.pool.public_qname('shift', helpers.unique(aux, 'http://adobe.com/AS3/2006/builtin::indexOf'))
    for label, slot in [('InahoAbilityVisuals$/shot', 1), ('InahoAbilityVisuals$/hit', 2)]:
        # 插入点2后旧逻辑完全保留。配置不存在进入旧稻穗判定；存在但空槽跳官方出口。
        code = [('getlocal_1',), ('getproperty', member), ('callproperty', reader, 0),
                ('setlocal_3',), ('getlocal_3',), ('pushnull',), ('ifeq', 'OLD')]
        for _ in range(slot):
            code += [('getlocal_3',), ('callproperty', shift, 0), ('pop',)]
        code += [('getlocal_3',), ('callproperty', shift, 0), ('setlocal_3',),
                 ('getlocal_3',), ('iffalse', 'OFFICIAL'), ('getlocal_3',), ('returnvalue',),
                 ('label', 'OLD')]
        body = aux.body(label)
        raw, exc, _, _ = splice_with_exits(body, 2, code, {'OFFICIAL': 8}, asm.ENTER)
        aux.replace(label, raw, exc)
    # 无条件预载旧6路径被旁路；真实队伍资源由 BattleCharacterLogic 入口负责。
    aux.insert('InahoAbilityVisuals$/preload', 2, [('returnvoid',)])
    aux.apply()
    e.extra_editors[TAG] = aux


def build(e):
    locks = json.loads((HERE / 'locks.json').read_text(encoding='utf-8'))
    e.locks.update(locks)
    helpers.build(e)
    # 和 party 在同一个原始方法上统一 splice；双方插入点互不覆盖。
    e.insert('BattleCharacterLogic/resolvePathCollection', 2, [
        ('getlocal_0',), ('getlocal_1',), ('getlocal_2',),
        ('callpropvoid', e.newq('wfxPreloadAbilityVisuals'), 2),
    ])
    label = 'MemberImpl/wfxDirectFactor'
    body = e.body(label)
    ins = asm.decode(body[5])
    assert ins[-2].name == 'multiply' and ins[-1].name == 'returnvalue'
    e.insert(label, len(ins)-1, [
        ('dup',), ('pushbyte', 0), ('ifge', 'OK'), ('pop',), ('pushbyte', 0),
        ('label', 'OK'),
    ])
    external(e)
    return {'capability': 'ability-visuals-v1', 'fixed_code': 24}
