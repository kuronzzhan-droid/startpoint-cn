"""PF 快照与 Lv4 数据化：既有类追加方法及指令表达式替换。"""
from __future__ import annotations
import copy
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from framework import asm
asm.MNEMONICS.setdefault('avm_label', 0x09)

BATTLE = 'pinball.scene.battle.battle::Battle'
RESOLVER = 'pinball.scene.battle.battle.action::ActionEvaluationResolver'
VIEW = 'pinball.scene.battle.view.flipper::BattleFlipperView'
LEGACY_KEY = 'override_fox_oracle_autumn_dual_pf'
RED = 0xFF4040


def rgb_default():
    # 与 v34 同一运行时合成；不向数值池追加 FF4040。
    return [('pushshort', 255), ('pushbyte', 16), ('lshift',), ('pushbyte', 64),
            ('pushbyte', 8), ('lshift',), ('bitor',), ('pushbyte', 64), ('bitor',)]


def unique(e, name):
    hits = [i for i in range(1, len(e.abc.multinames))
            if e.abc.multinames[i][0] == 7 and e.abc.mn_name(i) == name]
    if len(hits) != 1:
        raise asm.AsmError(f'PF symbol {name}: {hits}')
    return hits[0]


def rewrite(e, label, replacements):
    """替换指定指令区间，所有旧分支目标按原指令映射；不碰其他指令。"""
    body = e.body(label)
    old = asm.decode(body[5])
    assert not body[6]
    changes = {start: (end, asm.assemble(block)) for start, end, block in replacements}
    mapping, out, origins = {}, [], []
    i = 0
    while i < len(old):
        mapping[i] = len(out)
        if i in changes:
            end, block = changes[i]
            offset = len(out)
            for c in copy.deepcopy(block):
                if c.target is not None:
                    c.target += offset
                out.append(c); origins.append(None)
            i = end
        else:
            out.append(copy.deepcopy(old[i])); origins.append(i); i += 1
    mapping[len(old)] = len(out)
    for c, origin in zip(out, origins):
        if origin is None:
            continue
        if c.target is not None:
            c.target = mapping[c.target]
        if c.name == 'lookupswitch':
            c.default = mapping[c.default]
            c.cases = [mapping[x] for x in c.cases]
    e.replace(label, asm.encode(out)[0])


def add_helpers(e):
    q = lambda n: unique(e, n)
    B = q(BATTLE)
    read = e.newq('wfxPfReadString')
    parse = e.newq('wfxPfParseUInt')
    cfg = e.newq('wfxPf4Config')
    grad = e.newq('wfxPf4Gradient')
    cache = e.add_slot(BATTLE, 'wfxPf4CachedByBattle', 'Object', static=True)
    mnl = next(i for i in range(1, len(e.abc.multinames)) if e.abc.multinames[i][0] == 0x1b)
    # 返回 nullable String。Maybe 先判空，MasterMap 必须 exists 后 get。
    e.add_method(BATTLE, 'wfxPfReadString', 'String', ['Object', 'String'], [
        ('getlocal_0',), ('pushscope',),
        ('getlocal_1',), ('iffalse', 'NONE'),
        ('getlocal_1',), ('getlex', q('pinball.master.generated::CustomAbilityStringTable')),
        ('callproperty', q('pinball.asset.logic:ILogicAssetContainer::getMasterTableMaybe'), 1),
        ('astype', q('pinball.master.generated::CustomAbilityStringTable')), ('setlocal_3',),
        ('getlocal_3',), ('iffalse', 'NONE'),
        ('getlocal_3',), ('callproperty', q('get_data'), 0), ('setlocal_3',),
        ('getlocal_3',), ('getlocal_2',), ('callproperty', q('pinball.master.runtime:MasterMap::exists'), 1),
        ('iffalse', 'NONE'),
        ('getlocal_3',), ('getlocal_2',), ('callproperty', q('pinball.master.runtime:MasterMap::get'), 1),
        ('getproperty', q('string')), ('coerce_s',), ('returnvalue',),
        ('label', 'NONE'), ('pushnull',), ('returnvalue',),
    ], 4, static=True)
    # 严格无符号数：空串、错误进制字符、超过上界均返回 -1。
    e.add_method(BATTLE, 'wfxPfParseUInt', 'int', ['String', 'int', 'int'], [
        ('getlocal_0',), ('pushscope',),
        ('getlocal_1',), ('iffalse', 'BAD'),
        ('pushbyte', 0), ('setlocal', 4), ('pushbyte', 0), ('setlocal', 5),
        ('label', 'LOOP'), ('avm_label',),
        ('getlocal', 4), ('getlocal_1',), ('getproperty', q('length')), ('ifge', 'DONE'),
        ('getlocal_1',), ('getlocal', 4), ('callproperty', q('http://adobe.com/AS3/2006/builtin::charCodeAt'), 1),
        ('convert_i',), ('setlocal', 6),
        ('getlocal', 6), e.number(97), ('iflt', 'UPPER'),
        ('getlocal', 6), e.number(87), ('subtract',), ('setlocal', 6), ('jump', 'DIGIT'),
        ('label', 'UPPER'), ('getlocal', 6), e.number(65), ('iflt', 'DECIMAL'),
        ('getlocal', 6), e.number(55), ('subtract',), ('setlocal', 6), ('jump', 'DIGIT'),
        ('label', 'DECIMAL'), ('getlocal', 6), e.number(57), ('ifgt', 'BAD'),
        ('getlocal', 6), e.number(48), ('subtract',), ('setlocal', 6),
        ('label', 'DIGIT'), ('getlocal', 6), ('pushbyte', 0), ('iflt', 'BAD'),
        ('getlocal', 6), ('getlocal_2',), ('ifge', 'BAD'),
        ('getlocal', 5), ('getlocal_2',), ('multiply',), ('getlocal', 6), ('add',), ('setlocal', 5),
        ('getlocal', 5), ('getlocal_3',), ('ifgt', 'BAD'),
        ('inclocal_i', 4), ('jump', 'LOOP'),
        ('label', 'DONE'), ('getlocal', 5), ('convert_i',), ('returnvalue',),
        ('label', 'BAD'), e.number(-1), ('returnvalue',),
    ], 7, static=True)
    e.add_method(BATTLE, 'wfxPf4Config', 'Array', ['Object', 'Object'], [
        ('getlocal_0',), ('pushscope',),
        ('getlex', B), ('getproperty', cache), ('iftrue', 'CACHE_READY'),
        ('getlex', B), ('findpropstrict', q('flash.utils::Dictionary')), ('pushtrue',),
        ('constructprop', q('flash.utils::Dictionary'), 1), ('setproperty', cache),
        ('label', 'CACHE_READY'),
        ('getlex', B), ('getproperty', cache), ('getlocal_1',), ('getproperty', mnl),
        ('dup',), ('iftrue', 'CACHED'), ('pop',),
        ('label', 'LOAD'),
        e.number(100), *rgb_default(), ('newarray', 2), ('setlocal_3',),
        ('getlocal_1',), ('iffalse', 'DONE'),
        ('getlocal_2',), ('iffalse', 'DONE'),
        ('getlocal_2',), ('getlex', q('pinball.master.generated::CustomAbilityStringTable')),
        ('callproperty', q('pinball.asset.logic:ILogicAssetContainer::getMasterTableMaybe'), 1),
        ('astype', q('pinball.master.generated::CustomAbilityStringTable')), ('setlocal', 6),
        ('getlocal', 6), ('iffalse', 'DONE'),
        ('getlocal', 6), ('callproperty', q('get_data'), 0), ('setlocal', 6),
        ('getlex', B), ('getproperty', cache), ('getlocal_1',), ('getlocal_3',), ('setproperty', mnl),
        e.string('wfx_pf4_'),
        ('getlocal_1',), ('getproperty', q('initialData')), ('callproperty', q('get_leaderCharacterId'), 0),
        ('add',), ('setlocal', 7),
        ('getlocal', 6), ('getlocal', 7), ('callproperty', q('pinball.master.runtime:MasterMap::exists'), 1),
        ('iffalse', 'DONE'),
        ('getlocal', 6), ('getlocal', 7), ('callproperty', q('pinball.master.runtime:MasterMap::get'), 1),
        ('getproperty', q('string')), ('coerce_s',), ('setlocal', 4),
        ('getlocal', 4), ('iffalse', 'DONE'),
        ('getlocal', 4), e.string(':'), ('callproperty', q('http://adobe.com/AS3/2006/builtin::split'), 1), ('setlocal', 4),
        ('getlex', B), ('getlocal', 4), ('pushbyte', 0), ('getproperty', mnl), ('pushbyte', 10), e.number(2147483647),
        ('callproperty', parse, 3), ('setlocal', 5),
        ('getlocal', 5), ('pushbyte', 0), ('iflt', 'COLOR'),
        ('getlocal_3',), ('pushbyte', 0), ('getlocal', 5), ('setproperty', mnl),
        ('label', 'COLOR'), ('getlocal', 4), ('getproperty', q('length')), ('pushbyte', 2), ('ifne', 'DONE'),
        ('getlocal', 4), ('pushbyte', 1), ('getproperty', mnl), ('setlocal', 4),
        ('getlocal', 4), ('getproperty', q('length')), ('pushbyte', 6), ('ifne', 'DONE'),
        ('getlex', B), ('getlocal', 4), ('pushbyte', 16), e.number(0xFFFFFF), ('callproperty', parse, 3), ('setlocal', 5),
        ('getlocal', 5), ('pushbyte', 0), ('iflt', 'DONE'),
        ('getlocal_3',), ('pushbyte', 1), ('getlocal', 5), ('setproperty', mnl),
        ('label', 'DONE'), ('getlocal_3',), ('returnvalue',),
        ('label', 'CACHED'), ('returnvalue',),
    ], 8, static=True)
    code = [('getlocal_0',), ('pushscope',)]
    for shift in (16, 8, 0):
        code += [e.number(255), e.number(255), ('getlocal_1',), e.number(shift), ('urshift',), e.number(255),
                 ('bitand',), ('subtract',), ('getlocal_2',), ('multiply',), e.number(9), ('divide',),
                 ('convert_i',), ('subtract',), ('convert_i',)]
        if shift:
            code += [e.number(shift), ('lshift',)]
        if shift != 16:
            code += [('bitor',)]
    e.add_method(BATTLE, 'wfxPf4Gradient', 'int', ['int', 'int'], code + [('returnvalue',)], 3, static=True)
    return {'battle': B, 'read': read, 'cfg': cfg, 'grad': grad, 'mnl': mnl}


def snapshot(e, m):
    q = lambda n: unique(e, n)
    snap = e.newq('wfxUsesSnapCombo')
    # 先旧键直返，新增标记只在同样的 Ball 上获取其 Squad 资产容器。
    e.add_method(RESOLVER, 'wfxUsesSnapCombo', 'Boolean', ['String', 'Object'], [
        ('getlocal_0',), ('pushscope',),
        ('getlocal_1',), e.string(LEGACY_KEY), ('ifeq', 'YES'),
        ('getlocal_2',), ('getproperty', q('type')), ('getproperty', q('index')), ('pushbyte', 2), ('ifne', 'NO'),
        ('getlocal_2',), ('getproperty', q('type')), ('getproperty', q('params')), ('pushbyte', 0), ('getproperty', m['mnl']),
        ('astype', q('pinball.scene.battle.battle.squad.ball::BallImpl')), ('setlocal_3',),
        ('getlocal_3',), ('iffalse', 'NO'),
        ('getlocal_3',), ('getproperty', q('squad')), ('astype', q('pinball.scene.battle.battle.squad::SquadImpl')), ('setlocal_3',),
        ('getlocal_3',), ('iffalse', 'NO'),
        ('getlex', m['battle']), ('getlocal_3',), ('getproperty', q('logicAssets')), e.string('wfx_snapcombo_'),
        ('getlocal_1',), ('add',), ('callproperty', m['read'], 2), ('setlocal_3',),
        ('getlocal_3',), ('iffalse', 'NO'),
        ('getlocal_3',), e.string('0'), ('ifeq', 'NO'),
        ('label', 'YES'), ('pushtrue',), ('returnvalue',),
        ('label', 'NO'), ('pushfalse',), ('returnvalue',),
    ], 4)
    label = 'ActionEvaluationResolver/<ctor>'
    c = asm.decode(e.body(label)[5])
    assert c[127].name == 'pushstring' and e.abc.s(c[127].args[0]) == LEGACY_KEY
    # 原比较 (key != legacy) 改为 (!helper(key, context))，旧跳转不动。
    rewrite(e, label, [(122, 127, [('getlocal_0',)] + [
        (x.name, *x.args) for x in c[122:127]] + [('getlocal', 5), ('callproperty', snap, 2)]),
        (127, 128, [('pushtrue',)])])


def config_expr(e, m, source):
    q = lambda n: unique(e, n)
    obj = [('getlocal', 23)] if source == 'view' else [('getlocal_0',)]
    assets = obj + ([('getproperty', q('globalLogic'))] if source != 'member' else []) + [('getproperty', q('logicAssets'))]
    return [('getlex', m['battle'])] + obj + [('getproperty', q('battle'))] + assets + [('callproperty', m['cfg'], 2)]


def lv4(e, m):
    q = lambda n: unique(e, n)
    label = 'MemberImpl/startPowerFlip'
    code = asm.decode(e.body(label)[5])
    indexes = [i for i,c in enumerate(code) if c.name == 'pushbyte' and c.args == [100]]
    assert indexes == [31]
    expr = config_expr(e, m, 'member') + [('pushbyte', 0), ('getproperty', m['mnl'])]
    rewrite(e, label, [(31, 32, expr)])
    label = 'BattleFlipperImpl/update'
    code = asm.decode(e.body(label)[5])
    assert [i for i,c in enumerate(code) if c.name == 'pushbyte' and c.args == [100]] == [106, 120, 127]
    expr = config_expr(e, m, 'flipper') + [('pushbyte', 0), ('getproperty', m['mnl'])]
    rewrite(e, label, [(i, i+1, expr) for i in (106, 120, 127)])
    # 既有 View 的 red() 默认调用保持原样；自定义颜色使用官方 set_color，并在退出时恢复。
    view = next(e.abc.mn_name(row[0]) for row in e.abc.instances if e.abc.mn_name(row[0]).endswith('::BattleFlipperView'))
    accent = e.add_method(view, 'wfxPf4Accent', 'void', ['Object', 'Boolean', 'int'], [
        ('getlocal_0',), ('pushscope',),
        ('getlocal_3',), *rgb_default(), ('ifne', 'CUSTOM'),
        ('getlocal_1',), ('getlocal_2',), ('callpropvoid', q('red'), 1), ('returnvoid',),
        ('label', 'CUSTOM'), ('getlocal_1',), ('pushfalse',), ('callpropvoid', q('red'), 1),
        ('getlocal_2',), ('iffalse', 'WHITE'),
        ('getlocal_1',), ('getlocal_3',), ('callpropvoid', q('set_color'), 1), ('returnvoid',),
        ('label', 'WHITE'), ('getlocal_1',), e.number(0xFFFFFF), ('callpropvoid', q('set_color'), 1), ('returnvoid',),
    ], 4)
    label = 'BattleFlipperView/draw'
    c = asm.decode(e.body(label)[5])
    changes = [(773, 774, [*rgb_default(), ('setlocal', 26), ('pushfalse',)]),
               (777, 778, config_expr(e, m, 'view') + [('pushbyte', 1), ('getproperty', m['mnl']), ('convert_i',), ('setlocal', 26), ('getlocal', 23)]),
               (796, 805, [('getlocal', 26)]),
               (818, 843, [('getlex', m['battle']), ('getlocal', 26), ('getlocal', 24), ('callproperty', m['grad'], 2)])]
    for i in (868, 872, 876, 880):
        changes.append((i, i+4, [('getlocal_0',)] + [(x.name, *x.args) for x in c[i:i+3]] +
                        [('getlocal', 26), ('callpropvoid', accent, 3)]))
    rewrite(e, label, changes)


def build(e):
    m = add_helpers(e)
    snapshot(e, m)
    lv4(e, m)
    return {'groups': [5, 6], 'defaults': [100, RED]}
