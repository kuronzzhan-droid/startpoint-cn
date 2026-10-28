"""Read existing hp_p1_para event clocks and complete trial history only."""
from fp_fields_base import START, NULL


def build(g):
    l, n, s = g.l, g.n, g.s
    # zone1 values2 unsupported3 records4 manager5 evaluatorNode6 evaluator7 eventNode8 event9.
    c = START + g.arr([]) + [('setlocal', 4)]
    c += l(1) + [('iffalse', 'DONE')]
    c += g.p(l(1), 'ZoneImpl', 'actionManager') + [('setlocal', 5)] + l(5) + [('iffalse', 'DONE')]
    c += g.p(l(5), 'ActionManagerImpl', 'actionEvaluatorManager') + [('setlocal', 5)] + l(5) + [('iffalse', 'DONE')]
    c += g.p(l(5), 'ActionEvaluatorManager', 'evaluators') + [('setlocal', 5)] + l(5) + [('iffalse', 'DONE')]
    c += g.p(l(5), 'List', 'h') + [('setlocal', 6), ('label', 'EVALUATOR')]
    c += l(6) + [('iffalse', 'DONE')]
    c += g.p(l(6), 'ListNode', 'item') + [('setlocal', 7)]
    c += g.p(l(7), 'ActionEvaluator', 'listeningEvents') + [('setlocal', 8)] + l(8) + [('iffalse', 'NEXTEVALUATOR')]
    c += g.p(l(8), 'List', 'h') + [('setlocal', 8), ('label', 'EVENT')]
    c += l(8) + [('iffalse', 'NEXTEVALUATOR')]
    c += g.p(l(8), 'ListNode', 'item') + [('setlocal', 9)]
    c += g.p(l(9), 'ListeningEvent', 'name') + s('hp_p1_para') + [('ifne', 'NEXTEVENT')]
    c += g.push(l(4), g.lex('JSON') + g.arr([
        g.call('wfxFp21Copy', g.p(l(7), 'ActionEvaluator', 'address'), l(3), s('/events/hp_p1_para/address'), n(0)),
        g.p(l(7), 'ActionEvaluator', 'frameCount'), g.p(l(9), 'ListeningEvent', 'frameCount'),
        g.p(l(9), 'ListeningEvent', 'evalCount')]) + [('callproperty', g.q('stringify'), 1)])
    c += [('label', 'NEXTEVENT')] + g.p(l(8), 'ListNode', 'next') + [('setlocal', 8), ('jump', 'EVENT')]
    c += [('label', 'NEXTEVALUATOR')] + g.p(l(6), 'ListNode', 'next') + [('setlocal', 6), ('jump', 'EVALUATOR')]
    c += [('label', 'DONE')] + l(4) + [('callpropvoid', g.q('sort'), 0)]
    c += g.set(l(2), s('/events/hp_p1_para'), l(4)) + [('returnvoid',)]
    g.method('Battle', 'wfxFp21Events', 'void', ['*', 'Object', 'Array'], c, 10)

    # trial1 unsupported2 path3 kind4 progress5 map6 iterator7 key8 gauge9.
    c = START + l(1) + [('iftrue', 'HAS')] + NULL + [('returnvalue',), ('label', 'HAS')]
    c += g.p(l(1), 'HitCountCheck', 'currentValues') + [('setlocal', 4)]
    c += l(4) + [('iffalse', 'KIND')]
    c += g.enum(g.raw(l(4), 'kind'), l(2), g.add(l(3), s('/kind'))) + [('setlocal', 4), ('label', 'KIND')]
    c += NULL + [('setlocal', 5)]
    c += g.p(l(1), 'HitCountCheck', 'gauge') + [('setlocal', 9)] + l(9) + [('iffalse', 'TRIALDONE')]
    c += g.p(g.p(l(9), 'OrochiExTrialGauge', 'trialProgress'), 'IntMap', 'h') + [('setlocal', 6)]
    c += g.arr([]) + [('setlocal', 5)] + n(0) + [('setlocal', 7), ('label', 'PROGRESS')]
    c += [('hasnext2', 6, 7), ('iffalse', 'SORT')]
    c += l(6) + l(7) + [('nextname',), ('convert_s',), ('setlocal', 8)]
    c += g.push(l(5), g.lex('JSON') + g.arr([l(8), g.f64(g.at(l(6), l(8) + [('convert_i',)]))]) + [('callproperty', g.q('stringify'), 1)])
    c += [('jump', 'PROGRESS'), ('label', 'SORT')] + l(5) + [('callpropvoid', g.q('sort'), 0), ('label', 'TRIALDONE')]
    c += g.arr([g.p(l(1), 'HitCountCheck', 'count'), l(4), l(5)]) + [('returnvalue',)]
    g.method('Battle', 'wfxFp21Trial', '*', ['*', 'Array', 'String'], c, 10)
