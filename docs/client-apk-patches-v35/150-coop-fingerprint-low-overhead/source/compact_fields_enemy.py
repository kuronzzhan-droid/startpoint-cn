"""HP/state/trial and independently hashed enemy RNG records."""
from fp_fields_base import START, NULL, TRUE
from compact_fields_codec import DETAIL_LIMIT, json, summary


def build(g):
    l, n, s = g.l, g.n, g.s
    # Trial progress is read from the raw IntMap; copy each [id, f64(value)] before
    # sorting, retaining history while bounding emitted size for large maps.
    code = START + l(1) + [('iftrue', 'HAS')] + NULL + [('returnvalue',), ('label', 'HAS')]
    code += g.p(l(1), 'HitCountCheck', 'currentValues') + [('setlocal', 4)]
    code += l(4) + [('iffalse', 'KINDREADY')]
    code += g.enum(g.raw(l(4), 'kind'), l(2), l(3)) + [('setlocal', 4), ('label', 'KINDREADY')]
    code += NULL + [('setlocal', 5)]
    code += g.p(l(1), 'HitCountCheck', 'gauge') + [('setlocal', 6)]
    code += l(6) + [('iffalse', 'DONE')]
    code += g.p(g.p(l(6), 'OrochiExTrialGauge', 'trialProgress'), 'IntMap', 'h') + [('setlocal', 6)]
    code += g.arr([]) + [('setlocal', 5)] + n(0) + [('setlocal', 7)]
    code += [('label', 'LOOP'), ('hasnext2', 6, 7), ('iffalse', 'SUMMARIZE')]
    code += l(6) + l(7) + [('nextname',), ('convert_s',), ('setlocal', 8)]
    code += g.push(l(5), json(g, g.arr([l(8), g.f64(g.at(l(6), l(8) + [('convert_i',)]))])))
    code += [('jump', 'LOOP'), ('label', 'SUMMARIZE')]
    # Small progress maps preserve exact sorted entries; the enclosing enemy
    # record already hashes them, so an inner hash would duplicate the work.
    code += g.raw(l(5), 'length') + n(DETAIL_LIMIT) + [('ifgt', 'LARGE')]
    code += l(5) + [('callpropvoid', g.q('sort'), 0)]
    code += g.arr([g.raw(l(5), 'length'), NULL, l(5)]) + [('setlocal', 5), ('jump', 'DONE')]
    code += [('label', 'LARGE')] + summary(g, l(5), False) + [('setlocal', 5)]
    code += g.arr([g.raw(l(5), 'count'), g.raw(l(5), 'hash'), NULL]) + [('setlocal', 5), ('label', 'DONE')]
    code += g.arr([g.p(l(1), 'HitCountCheck', 'count'), l(4), l(5)]) + [('returnvalue',)]
    g.method('Battle', 'wfxFpCompactTrial', '*', ['*', 'Array', 'String'], code, 9)

    # Output tuple: address, HP value/max, state summary, stateFrame, stateGroup,
    # trial summary. RNG is copied into a distinct collection for diagnosis.
    code = START + g.enum(g.p(l(1), 'EnemyImpl', 'address'), l(3), s('/enemies/address')) + [('setlocal', 5)]
    code += json(g, l(5)) + [('setlocal', 6)]
    code += g.add(s('/enemies/'), g.ptr(l(6))) + [('setlocal', 7)]
    code += NULL + [('setlocal', 8)] + NULL + [('setlocal', 9)]
    code += g.p(l(1), 'EnemyImpl', 'healthPointGauge') + [('setlocal', 10)]
    code += l(10) + [('iffalse', 'HPREADY')]
    code += g.p(l(10), 'HealthPointGaugeImpl', 'healthPoint') + [('setlocal', 10)]
    code += l(10) + [('iffalse', 'HPREADY')]
    code += g.arr([g.f64(g.p(l(10), 'Decimal100ClosedInterval', 'value')),
                   g.f64(g.p(l(10), 'Decimal100ClosedInterval', 'max'))]) + [('setlocal', 8)]
    code += [('label', 'HPREADY')] + l(1) + [('istype', g.e.q(g.cls('GeneralEnemy'))), ('iffalse', 'DONE')]
    code += g.call('wfxFpCompactTrial', g.p(l(1), 'GeneralEnemy', 'hitCountCheck'), l(3), g.add(l(7), s('/trial'))) + [('setlocal', 9)]
    code += g.p(l(1), 'GeneralEnemy', 'stateChooser') + [('setlocal', 10)]
    code += l(10) + [('iffalse', 'RNGREADY')]
    code += g.p(l(10), 'GeneralEnemyStateChooser', 'random') + [('setlocal', 10), ('label', 'RNGREADY')]
    code += g.push(l(4), json(g, g.arr([l(5), g.call('wfxFpCompactRng', l(10), l(3), g.add(s('/rng/enemies/'), g.ptr(l(6))))])))
    code += [('label', 'DONE')]
    code += g.call('wfxFpEnemyState', l(1), l(3), l(7)) + [('setlocal', 10)]
    state = g.arr([g.raw(l(10), name) for name in ('index', 'common', 'uniqueId', 'uniqueFunnelSpawnCount')])
    record = g.arr([l(5), l(8), state,
                    g.p(l(1), 'EnemyImpl', 'stateFrame'), g.p(l(1), 'EnemyImpl', 'currentStateGroup'), l(9)])
    code += g.push(l(2), json(g, record)) + [('returnvoid',)]
    g.method('Battle', 'wfxFpCompactEnemy', 'void', ['*', 'Array', 'Array', 'Array'], code, 11)
