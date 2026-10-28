"""Enemy/试炼采样：真实slot，完整历史trialId，复制后排序。"""
from fp_fields_base import START, NULL, TRUE


def build(g):
    e, q, l, n, s = g.e, g.q, g.l, g.n, g.s
    # (enemy, unsupported, fieldPath) -> fixed state summary.
    code = START + g.p(l(1), 'EnemyImpl', 'state') + [('setlocal', 4)]
    code += NULL + [('setlocal', 5)] + NULL + [('setlocal', 6)] + NULL + [('setlocal', 7)]
    code += g.raw(l(4), 'index') + n(0) + [('ifne', 'UNIQUE')]
    code += g.raw(g.at(g.raw(l(4), 'params'), n(0)), 'index') + [('setlocal', 5), ('jump', 'DONE')]
    code += [('label', 'UNIQUE')] + l(1) + [('istype', e.q(g.cls('GeneralEnemy'))), ('iffalse', 'OTHER')]
    value = g.at(g.raw(l(4), 'params'), n(0))
    code += g.p(value, 'GeneralEnemyUniqueState', 'id') + [('setlocal', 6)]
    code += g.p(value, 'GeneralEnemyUniqueState', 'funnelSpawnCount') + [('setlocal', 7), ('jump', 'DONE')]
    code += [('label', 'OTHER')] + g.unsupported(l(2), g.add(l(3), s('/uniqueId')), 'enum_variant')
    code += [('label', 'DONE')] + g.obj({'index': g.raw(l(4), 'index'), 'common': l(5),
                                      'uniqueId': l(6), 'uniqueFunnelSpawnCount': l(7)}) + [('returnvalue',)]
    g.method('Battle', 'wfxFpEnemyState', 'Object', ['*', 'Array', 'String'], code, 8)

    # (enemy, values, unsupported) -> canonical, unescaped address key.
    code = START + g.enum(g.p(l(1), 'EnemyImpl', 'address'), l(3), s('/enemies/address')) + [('setlocal', 4)]
    code += g.lex('JSON') + l(4) + [('callproperty', q('stringify'), 1), ('setlocal', 5)]
    code += g.add(s('/enemies/'), g.ptr(l(5))) + [('setlocal', 6)]
    def put(suffix, value): return g.set(l(2), g.add(l(6), s(suffix)), value)
    code += put('/id', g.p(l(1), 'EnemyImpl', 'enemyId')) + put('/address', l(4))
    code += g.call('wfxFpEnemyState', l(1), l(3), l(6)) + [('setlocal', 7)]
    for suffix, field in (('/state', 'index'), ('/common', 'common'), ('/uniqueId', 'uniqueId'),
                          ('/uniqueFunnelSpawnCount', 'uniqueFunnelSpawnCount')):
        code += put(suffix, g.raw(l(7), field))
    for field in ('stateFrame', 'currentStateGroup', 'synchronizeCount', 'funnelSpawnCount'):
        code += put('/' + field, g.p(l(1), 'EnemyImpl', field))
    code += g.p(l(1), 'EnemyImpl', 'healthPointGauge') + [('setlocal', 7)]
    code += l(7) + [('iffalse', 'NOHP')]
    code += g.p(l(7), 'HealthPointGaugeImpl', 'healthPoint') + [('setlocal', 7)]
    code += l(7) + [('iffalse', 'NOHP')] + put('/hp', TRUE)
    for field in ('value', 'max'):
        code += put('/hp/' + field, g.f64(g.p(l(7), 'Decimal100ClosedInterval', field)))
    code += [('jump', 'GENERAL'), ('label', 'NOHP')] + put('/hp', NULL)
    code += [('label', 'GENERAL')] + l(1) + [('istype', e.q(g.cls('GeneralEnemy'))), ('iftrue', 'ISGENERAL')]
    code += put('/general', NULL) + put('/trial', NULL) + l(5) + [('returnvalue',)]
    code += [('label', 'ISGENERAL')] + put('/general', TRUE)
    code += put('/subroutineId', g.p(l(1), 'GeneralEnemy', 'subroutineId'))
    code += g.p(l(1), 'GeneralEnemy', 'stateChooser') + [('setlocal', 7)]
    code += l(7) + [('iffalse', 'NORNG')]
    code += g.p(l(7), 'GeneralEnemyStateChooser', 'random') + [('setlocal', 7)]
    code += [('label', 'NORNG')]
    code += g.call('wfxFpRng', l(7), l(2), l(3), g.add(s('/rng/enemy/'), g.ptr(l(5)))) + [('pop',)]
    code += g.p(l(1), 'GeneralEnemy', 'hitCountCheck') + [('setlocal', 7)]
    code += l(7) + [('iftrue', 'TRIAL')] + put('/trial', NULL) + l(5) + [('returnvalue',)]
    code += [('label', 'TRIAL')] + put('/trial', TRUE)
    code += put('/trial/count', g.p(l(7), 'HitCountCheck', 'count'))
    code += g.p(l(7), 'HitCountCheck', 'currentValues') + [('setlocal', 8)]
    code += l(8) + [('iffalse', 'NOKIND')]
    code += put('/trial/kind', g.enum(g.raw(l(8), 'kind'), l(3), g.add(l(6), s('/trial/kind'))))
    code += [('jump', 'GAUGE'), ('label', 'NOKIND')] + put('/trial/kind', NULL)
    code += [('label', 'GAUGE')] + g.p(l(7), 'HitCountCheck', 'gauge') + [('setlocal', 7)]
    code += l(7) + [('iftrue', 'HASGAUGE')] + put('/trial/gauge', NULL) + l(5) + [('returnvalue',)]
    code += [('label', 'HASGAUGE')] + put('/trial/gauge', TRUE)
    code += g.p(g.p(l(7), 'OrochiExTrialGauge', 'trialProgress'), 'IntMap', 'h') + [('setlocal', 8)]
    code += n(0) + [('setlocal', 9)] + g.arr([]) + [('setlocal', 10)]
    code += [('label', 'PROGRESS'), ('hasnext2', 8, 9), ('iffalse', 'PROGRESSDONE')]
    code += l(8) + l(9) + [('nextname',), ('convert_s',), ('setlocal', 11)]
    code += g.push(l(10), l(11))
    code += g.set(l(2), g.add(l(6), s('/trial/progress/'), g.ptr(l(11))),
                  g.at(l(8), l(11) + [('convert_i',)]))
    code += [('jump', 'PROGRESS'), ('label', 'PROGRESSDONE')]
    code += l(10) + [('callpropvoid', q('sort'), 0)] + put('/trial/progress', l(10))
    code += l(5) + [('returnvalue',)]
    g.method('Battle', 'wfxFpEnemy', 'String', ['*', 'Object', 'Array'], code, 12)
