"""Round18 compact checkpoint sampler; never invoke the legacy full snapshot."""
from pathlib import Path
import json
import bootstrap
from fp_fields_base import Gen, START, NULL, TRUE
import compact_fields_codec
import compact_fields_enemy
import compact_fields_zone


def build(editor):
    g = Gen(editor)
    compact_fields_codec.build(g)
    compact_fields_enemy.build(g)
    compact_fields_zone.build(g)
    l, n, s, q = g.l, g.n, g.s, g.q
    code = START + g.lex('Battle') + [('getproperty', q('wfxFpEnabled')), ('iftrue', 'ENABLED')]
    code += NULL + [('returnvalue',), ('label', 'ENABLED')]
    code += g.obj({}) + [('setlocal', 2)] + g.arr([]) + [('setlocal', 3)]
    for name in ('stateFrame', 'currentZoneIndex'):
        code += g.set(l(2), s('/battle/' + name), g.p(l(1), 'Battle', name))
    code += g.set(l(2), s('/battle/state'), g.raw(g.p(l(1), 'Battle', 'state'), 'index'))
    code += g.p(l(1), 'Battle', 'autoplayer') + [('setlocal', 4)]
    code += l(4) + [('iffalse', 'AUTORNG')]
    code += g.p(l(4), 'BattleAutoplayer', 'random') + [('setlocal', 4), ('label', 'AUTORNG')]
    code += g.call('wfxFpRng', l(4), l(2), l(3), s('/rng/autoplayer')) + [('pop',)]
    code += NULL + [('setlocal', 4)] + g.p(l(1), 'Battle', 'zoneManager') + [('setlocal', 5)]
    code += l(5) + [('iffalse', 'ZONESELECTED')]
    code += g.p(l(5), 'ZoneManagerImpl', 'state') + [('setlocal', 5)]
    code += g.raw(l(5), 'index') + n(0) + [('ifne', 'TRANSITION')]
    code += g.at(g.raw(l(5), 'params'), n(0)) + [('setlocal', 4), ('jump', 'ZONESELECTED')]
    code += [('label', 'TRANSITION')] + g.raw(l(5), 'index') + n(1) + [('ifne', 'ZONESELECTED')]
    code += g.at(g.raw(l(5), 'params'), n(3)) + [('setlocal', 4), ('label', 'ZONESELECTED')]
    code += g.call('wfxFpZoneRng', l(4), l(2), l(3)) + [('pop',)]
    code += l(4) + [('iftrue', 'ZONE')]
    for key in ('/zone', '/enemies', '/rng/enemies'):
        code += g.set(l(2), s(key), NULL)
    code += g.call('wfxFpCompactFunnels', NULL, l(2), l(3)) + [('pop',)]
    code += g.call('wfxFpCompactModifier', NULL, l(2)) + [('pop',), ('jump', 'DONE')]
    code += [('label', 'ZONE')]
    code += g.set(l(2), s('/zone'), g.arr([g.p(l(4), 'ZoneImpl', 'index'),
                                        g.p(l(4), 'ZoneImpl', 'floorIndex'),
                                        g.raw(g.p(l(4), 'ZoneImpl', 'state'), 'index')]))
    code += g.p(g.p(l(4), 'ZoneImpl', 'enemyManager'), 'EnemyManagerImpl', 'enemies') + [('setlocal', 5)]
    code += g.arr([]) + [('setlocal', 6)] + g.arr([]) + [('setlocal', 9)]
    for part in ('h', 'rh'):
        code += g.p(l(5), 'StringMap', part) + [('setlocal', 7)]
        code += l(7) + [('iffalse', part + 'DONE')] + n(0) + [('setlocal', 8)]
        code += [('label', part + 'LOOP'), ('hasnext2', 7, 8), ('iffalse', part + 'DONE')]
        code += g.call('wfxFpCompactEnemy', l(7) + l(8) + [('nextvalue',)], l(6), l(3), l(9)) + [('pop',)]
        code += [('jump', part + 'LOOP'), ('label', part + 'DONE')]
    code += g.set(l(2), s('/enemies'), compact_fields_codec.summary(g, l(6), True))
    code += g.set(l(2), s('/rng/enemies'), compact_fields_codec.summary(g, l(9), True))
    code += g.call('wfxFpCompactFunnels', g.p(l(4), 'ZoneImpl', 'funnelManager'), l(2), l(3)) + [('pop',)]
    code += g.call('wfxFpCompactModifier', g.p(l(4), 'ZoneImpl', 'modifierFieldManager'), l(2)) + [('pop',)]
    code += [('label', 'DONE')] + l(3) + s('path') + [('callpropvoid', q('sortOn'), 1)]
    code += g.obj({'values': l(2), 'unsupported': l(3)}) + [('returnvalue',)]
    g.method('Battle', 'wfxFpCompactSnapshot', 'Object', ['pinball.scene.battle.battle::Battle'], code, 10)
    audit = {'slots': g.audit, 'helpers': g.helpers, 'detail_limit': compact_fields_codec.DETAIL_LIMIT,
             'reused_helpers': ['wfxFpF64', 'wfxFpEnum', 'wfxFpPointer', 'wfxFpEnemyState', 'wfxFpRng', 'wfxFpZoneRng']}
    bootstrap.output_path(Path(__file__).with_name('compact-field-slots-audit.json')).write_text(
        json.dumps(audit, ensure_ascii=False, indent=2), encoding='utf-8')
    return {'snapshot': g.helpers['wfxFpCompactSnapshot'], 'helpers': g.helpers, 'audit': audit}
