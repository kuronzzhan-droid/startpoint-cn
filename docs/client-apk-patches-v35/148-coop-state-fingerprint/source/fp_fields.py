"""TASK16固定字段采样助手生成入口；只新增Battle静态方法。"""
from fp_fields_base import Gen, START, NULL, TRUE
import fp_fields_codec
import fp_fields_enemy
import fp_fields_zone


def build(editor):
    g = Gen(editor)
    fp_fields_codec.build(g)
    fp_fields_enemy.build(g)
    fp_fields_zone.build(g)
    l, s, n, q = g.l, g.s, g.n, g.q
    code = START + g.lex('Battle') + [('getproperty', q('wfxFpEnabled')), ('iftrue', 'ENABLED')]
    code += NULL + [('returnvalue',), ('label', 'ENABLED')]
    code += g.obj({}) + [('setlocal', 2)] + g.arr([]) + [('setlocal', 3)]
    code += g.set(l(2), s('/battle/id'), g.raw(g.p(l(1), 'Battle', 'initialData'), 'id'))
    for name in ('currentFrame', 'stateFrame', 'currentZoneIndex'):
        code += g.set(l(2), s('/battle/' + name), g.p(l(1), 'Battle', name))
    code += g.set(l(2), s('/battle/state'), g.raw(g.p(l(1), 'Battle', 'state'), 'index'))
    for name in ('rawFrame', 'rawTime'):
        code += g.set(l(2), s('/battle/' + name),
                      g.p(g.p(l(1), 'Battle', 'elapsedTimeCalculator'), 'ElapsedTimeCalculatorImpl', name))
    for name in ('baseSeed', 'separativeBaseSeed'):
        code += g.set(l(2), s('/battle/' + name),
                      g.p(g.p(l(1), 'Battle', 'randomSeedFactory'), 'RandomSeedFactoryImpl', name))
    code += g.p(l(1), 'Battle', 'autoplayer') + [('setlocal', 4)]
    code += l(4) + [('iffalse', 'AUTORNG')]
    code += g.p(l(4), 'BattleAutoplayer', 'random') + [('setlocal', 4)]
    code += [('label', 'AUTORNG')] + g.call('wfxFpRng', l(4), l(2), l(3), s('/rng/autoplayer')) + [('pop',)]

    # getCurrentZone's audited switch, reproduced through bare enum slots.
    code += NULL + [('setlocal', 4)]
    code += g.p(l(1), 'Battle', 'zoneManager') + [('setlocal', 5)]
    code += l(5) + [('iffalse', 'ZONESELECTED')]
    code += g.p(l(5), 'ZoneManagerImpl', 'state') + [('setlocal', 5)]
    code += g.raw(l(5), 'index') + n(0) + [('ifne', 'TRANSITION')]
    code += g.at(g.raw(l(5), 'params'), n(0)) + [('setlocal', 4), ('jump', 'ZONESELECTED')]
    code += [('label', 'TRANSITION')] + g.raw(l(5), 'index') + n(1) + [('ifne', 'ZONESELECTED')]
    code += g.at(g.raw(l(5), 'params'), n(3)) + [('setlocal', 4)]
    code += [('label', 'ZONESELECTED')]
    code += g.call('wfxFpZoneRng', l(4), l(2), l(3)) + [('pop',)]
    code += l(4) + [('iftrue', 'ZONE')]
    for key in ('/zone', '/enemies'):
        code += g.set(l(2), s(key), NULL)
    code += g.call('wfxFpFunnels', NULL, l(2), l(3)) + [('pop',)]
    code += g.call('wfxFpModifier', NULL, l(2), l(3)) + [('pop',), ('jump', 'DONE')]
    code += [('label', 'ZONE')] + g.set(l(2), s('/zone'), TRUE)
    for field in ('index', 'floorIndex'):
        code += g.set(l(2), s('/zone/' + field), g.p(l(4), 'ZoneImpl', field))
    code += g.set(l(2), s('/zone/state'), g.raw(g.p(l(4), 'ZoneImpl', 'state'), 'index'))
    code += g.p(g.p(l(4), 'ZoneImpl', 'enemyManager'), 'EnemyManagerImpl', 'enemies') + [('setlocal', 5)]
    code += g.arr([]) + [('setlocal', 6)]
    # StringMap.h and .rh contain all registered enemies; iterating values does
    # not call keys/getter or change the game's map or insertion ordering.
    for part in ('h', 'rh'):
        code += g.p(l(5), 'StringMap', part) + [('setlocal', 7)]
        code += l(7) + [('iffalse', part + 'DONE')] + n(0) + [('setlocal', 8)]
        code += [('label', part + 'LOOP'), ('hasnext2', 7, 8), ('iffalse', part + 'DONE')]
        code += g.push(l(6), g.call('wfxFpEnemy', l(7) + l(8) + [('nextvalue',)], l(2), l(3)))
        code += [('jump', part + 'LOOP'), ('label', part + 'DONE')]
    code += l(6) + [('callpropvoid', q('sort'), 0)] + g.set(l(2), s('/enemies'), l(6))
    code += g.call('wfxFpFunnels', g.p(l(4), 'ZoneImpl', 'funnelManager'), l(2), l(3)) + [('pop',)]
    code += g.call('wfxFpModifier', g.p(l(4), 'ZoneImpl', 'modifierFieldManager'), l(2), l(3)) + [('pop',)]
    code += [('label', 'DONE')] + l(3) + s('path') + [('callpropvoid', q('sortOn'), 1)]
    code += g.obj({'values': l(2), 'unsupported': l(3)}) + [('returnvalue',)]
    g.method('Battle', 'wfxFpSnapshot', 'Object', ['pinball.scene.battle.battle::Battle'], code, 9)
    g.save_audit()
    return {'snapshot': g.helpers['wfxFpSnapshot'], 'f64': g.helpers['wfxFpF64'],
            'pointer': g.helpers['wfxFpPointer'], 'enum': g.helpers['wfxFpEnum'],
            'rng': g.helpers['wfxFpRng'], 'helpers': g.helpers}
