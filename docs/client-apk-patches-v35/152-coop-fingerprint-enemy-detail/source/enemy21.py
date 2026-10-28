"""Round21 enemy detail extension; old group hashes remain byte-for-byte defined."""
import json
import asm
import bootstrap
from fp_fields_base import Gen, START, NULL, TRUE, FALSE
import enemy21_codec
import enemy21_conditions
import enemy21_events
import enemy21_spawn

TARGETS = ['Battle$/wfxFpCompactSnapshot']
DETAIL_LIMIT = 32
DETAIL_FIELDS = ('address', 'enemyId', 'kind', 'hp', 'position', 'stateName',
    'stateFrame', 'stateGroup', 'conditions', 'spawnPoint', 'counters', 'trialGauge',
    'legacyCompactEnemy', 'reservedParalysis', 'trialFull', 'spawnSlots')
COUNTERS = ('frameCount', 'animationFrameCount', 'lastStateChangedFrameCount',
            'synchronizeCount', 'funnelSpawnCount', 'enemyActionCount', 'advanceFrameCount')


def record(g):
    l, n, s = g.l, g.n, g.s
    # enemy1 unsupported2 path3 hp4 spawn5 state6 stateName7 trial8 scratch9 legacy10 scratchRng11.
    c = START + NULL + [('setlocal', 4)] + NULL + [('setlocal', 5)] + NULL + [('setlocal', 8)] + NULL + [('setlocal', 12)]
    c += g.p(l(1), 'EnemyImpl', 'healthPointGauge') + [('setlocal', 9)]
    c += l(9) + [('iffalse', 'HPDONE')]
    c += g.p(l(9), 'HealthPointGaugeImpl', 'healthPoint') + [('setlocal', 9)]
    c += l(9) + [('iffalse', 'HPDONE')]
    c += g.arr([g.f64(g.p(l(9), 'Decimal100ClosedInterval', name)) for name in ('value', 'max')]) + [('setlocal', 4)]
    c += [('label', 'HPDONE')] + g.p(l(1), 'EnemyImpl', 'spawnPoint') + [('setlocal', 9)]
    c += l(9) + [('iffalse', 'SPAWNDONE')]
    c += g.raw(l(9), 'index') + n(1) + [('ifne', 'SPAWNSOME')]
    c += g.arr([n(1)]) + [('setlocal', 5), ('jump', 'SPAWNDONE'), ('label', 'SPAWNSOME')]
    c += g.raw(l(9), 'index') + n(0) + [('ifne', 'SPAWNBAD')]
    c += g.at(g.raw(l(9), 'params'), n(0)) + [('setlocal', 9)]
    c += l(9) + [('istype', g.e.q(g.cls('FunnelSpawnPointImpl'))), ('iffalse', 'SPAWNBAD')]
    c += g.arr([n(0), g.f64(g.p(l(9), 'FunnelSpawnPointImpl', 'x')),
                g.f64(g.p(l(9), 'FunnelSpawnPointImpl', 'y')),
                g.p(l(9), 'FunnelSpawnPointImpl', 'available')]) + [('setlocal', 5), ('jump', 'SPAWNDONE')]
    c += [('label', 'SPAWNBAD')] + g.unsupported(l(2), g.add(l(3), s('/spawnPoint')), 'spawn_point_type')
    c += [('label', 'SPAWNDONE')] + g.p(l(1), 'EnemyImpl', 'state') + [('setlocal', 6)]
    c += g.raw(l(6), 'tag') + [('setlocal', 7)]
    c += g.raw(l(6), 'index') + n(0) + [('ifne', 'UNIQUE')]
    c += g.raw(g.at(g.raw(l(6), 'params'), n(0)), 'tag') + [('setlocal', 7), ('jump', 'TRIAL')]
    c += [('label', 'UNIQUE')] + l(1) + [('istype', g.e.q(g.cls('GeneralEnemy'))), ('iffalse', 'TRIAL')]
    c += g.p(g.at(g.raw(l(6), 'params'), n(0)), 'GeneralEnemyUniqueState', 'id') + [('setlocal', 7)]
    c += [('label', 'TRIAL')] + l(1) + [('istype', g.e.q(g.cls('GeneralEnemy'))), ('iffalse', 'DONE')]
    c += g.p(l(1), 'GeneralEnemy', 'hitCountCheck') + [('setlocal', 9)]
    c += l(9) + [('iffalse', 'DONE')]
    c += g.call('wfxFp21Trial', l(9), l(2), g.add(l(3), s('/trial'))) + [('setlocal', 12)]
    c += g.arr([g.p(l(9), 'HitCountCheck', name) for name in ('isGaugeAppeared', 'linkedConditionCount', 'prevPrevented')])
    c += [('setlocal', 8), ('label', 'DONE')]
    c += g.arr([]) + [('setlocal', 10)] + g.arr([]) + [('setlocal', 11)]
    c += g.call('wfxFpCompactEnemy', l(1), l(10), l(2), l(11)) + [('pop',)]
    c += g.lex('JSON') + g.at(l(10), n(0)) + [('callproperty', g.q('parse'), 1), ('setlocal', 10)]
    items = [g.enum(g.p(l(1), 'EnemyImpl', 'address'), l(2), g.add(l(3), s('/address'))),
        g.p(l(1), 'EnemyImpl', 'enemyId'), g.p(l(1), 'EnemyImpl', 'kind'), l(4),
        g.arr([g.f64(g.p(l(1), 'EnemyImpl', name)) for name in ('x', 'y', 'z')]), l(7),
        g.p(l(1), 'EnemyImpl', 'stateFrame'), g.p(l(1), 'EnemyImpl', 'currentStateGroup'),
        g.call('wfxFp21Conditions', g.p(l(1), 'EnemyImpl', 'conditionSlot'), l(2), g.add(l(3), s('/conditions')), n(0)),
        l(5), g.arr([g.p(l(1), 'EnemyImpl', name) for name in COUNTERS]), l(8), l(10),
        g.call('wfxFp21Paralysis', g.p(l(1), 'EnemyImpl', 'reservedParalysisConditions'), l(2), g.add(l(3), s('/reservedParalysis'))), l(12)]
    c += g.lex('JSON') + g.arr(items) + [('callproperty', g.q('stringify'), 1), ('returnvalue',)]
    g.method('Battle', 'wfxFp21Enemy', 'String', ['*', 'Array', 'String'], c, 13)


def extension(g):
    l, n, s = g.l, g.n, g.s
    # zone1 values2 unsupported3 group4 map5 records6 branch7 index8 enemy9 hash10.
    c = START + g.call('wfxFp21Events', l(1), l(2), l(3)) + [('pop',)]
    c += l(1) + [('iftrue', 'ZONE')]
    for key in ('/rng/conditionChange', '/rng/coffin'):
        c += g.set(l(2), s(key), NULL)
    c += [('returnvoid',), ('label', 'ZONE')]
    c += g.p(l(1), 'ZoneImpl', 'coffinManager') + [('setlocal', 10)]
    c += l(10) + [('iffalse', 'COFFINRNG')]
    c += g.p(l(10), 'CoffinManagerImpl', 'random') + [('setlocal', 10), ('label', 'COFFINRNG')]
    c += g.call('wfxFpRng', l(10), l(2), l(3), s('/rng/coffin')) + [('pop',)]
    c += g.p(l(1), 'ZoneImpl', 'impactManager') + [('setlocal', 10)]
    c += l(10) + [('iffalse', 'RNG')]
    c += g.p(l(10), 'ImpactManagerImpl', 'calculator') + [('setlocal', 10)]
    c += l(10) + [('iffalse', 'RNG')]
    c += g.p(l(10), 'ImpactCalculator', 'conditionChangeCalculator') + [('setlocal', 10)]
    c += l(10) + [('iffalse', 'RNG')]
    c += g.p(l(10), 'ConditionChangeCalculator', 'random') + [('setlocal', 10), ('label', 'RNG')]
    c += g.call('wfxFpRng', l(10), l(2), l(3), s('/rng/conditionChange')) + [('pop',)]
    c += g.at(l(2), s('/enemies')) + [('setlocal', 4)]
    c += l(4) + [('iftrue', 'GROUP')] + [('returnvoid',), ('label', 'GROUP')]
    c += g.raw(l(4), 'count') + n(DETAIL_LIMIT) + [('ifle', 'DETAILS')]
    c += g.set(l(4), s('details'), NULL) + g.set(l(4), s('detailsHash'), NULL)
    c += g.set(l(4), s('detailStatus'), s('hashed_only_count_gt_32'))
    c += g.unsupported(l(3), s('/enemies/details'), 'count_gt_32') + [('returnvoid',), ('label', 'DETAILS')]
    c += g.p(g.p(l(1), 'ZoneImpl', 'enemyManager'), 'EnemyManagerImpl', 'enemies') + [('setlocal', 5)]
    c += g.arr([]) + [('setlocal', 6)]
    for part in ('h', 'rh'):
        c += g.p(l(5), 'StringMap', part) + [('setlocal', 7)]
        c += l(7) + [('iffalse', part + 'DONE')] + n(0) + [('setlocal', 8)]
        c += [('label', part + 'LOOP'), ('hasnext2', 7, 8), ('iffalse', part + 'DONE')]
        c += l(7) + l(8) + [('nextvalue',), ('setlocal', 9)]
        c += g.push(l(6), g.call('wfxFp21EnemyAtZone', l(9), l(1), l(3)))
        c += [('jump', part + 'LOOP'), ('label', part + 'DONE')]
    c += g.call('wfxFpCompactSet', l(6), FALSE) + [('setlocal', 10)]
    c += g.set(l(4), s('detailsHash'), g.raw(l(10), 'hash')) + g.set(l(4), s('details'), l(6))
    c += g.set(l(4), s('detailStatus'), s('complete')) + [('returnvoid',)]
    g.method('Battle', 'wfxFp21Extend', 'void', ['*', 'Object', 'Array'], c, 11)


def build(editor):
    g = Gen(editor)
    enemy21_codec.build(g)
    enemy21_conditions.build(g)
    enemy21_events.build(g)
    record(g)
    enemy21_spawn.build(g)
    extension(g)
    ins = asm.decode(editor.body(TARGETS[0])[5])
    sorter = next(i for i, x in enumerate(ins) if x.name == 'callpropvoid' and editor.abc.mn_name(x.args[0]).split('::')[-1] == 'sortOn')
    if [x.name for x in ins[sorter-2:sorter]] != ['getlocal', 'pushstring'] or ins[sorter-2].args[0] != 3:
        raise ValueError('unexpected compact snapshot final unsupported sorter')
    editor.insert(TARGETS[0], sorter-2, g.call('wfxFp21Extend', g.l(4), g.l(2), g.l(3)) + [('pop',)])
    audit = {'target': TARGETS, 'detailLimit': DETAIL_LIMIT, 'detailFields': DETAIL_FIELDS,
        'counterFields': COUNTERS, 'conditionFields': enemy21_codec.CONDITION_FIELDS,
        'reservedFields': enemy21_codec.RESERVED_FIELDS, 'paralysisFields': enemy21_conditions.PARALYSIS_FIELDS, 'slots': g.audit,
        'helpers': g.helpers, 'legacyHashPreserved': True}
    bootstrap.output_path(bootstrap.ROOT / 'enemy21-audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding='utf-8')
    return audit
