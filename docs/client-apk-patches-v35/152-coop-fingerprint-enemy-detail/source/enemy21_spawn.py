"""Locate existing group spawn slots by object identity, never by coordinates."""
from fp_fields_base import START, NULL


def build(g):
    l, n, s = g.l, g.n, g.s
    # enemy1 zone2 result3 point4 manager5 sub6 points7 index8.
    c = START + g.arr([]) + [('setlocal', 3)]
    c += g.p(l(1), 'EnemyImpl', 'spawnPoint') + [('setlocal', 4)]
    c += l(4) + [('iffalse', 'DONE')]
    c += g.raw(l(4), 'index') + n(0) + [('ifne', 'DONE')]
    c += g.at(g.raw(l(4), 'params'), n(0)) + [('setlocal', 4)]
    c += g.p(l(2), 'ZoneImpl', 'funnelManager') + [('setlocal', 5)]
    c += l(5) + [('iffalse', 'DONE')]
    for group in range(1, 11):
        prefix = 'G' + str(group)
        c += g.p(l(5), 'FunnelManagerImpl', f'subManager{group:02d}') + [('setlocal', 6)]
        c += l(6) + [('iffalse', prefix + 'DONE')]
        c += g.p(l(6), 'FunnelSubManagerImpl', 'spawnPoints') + [('setlocal', 7)]
        c += l(7) + [('iffalse', prefix + 'DONE')]
        c += n(0) + [('setlocal', 8), ('label', prefix + 'LOOP')]
        c += l(8) + g.raw(l(7), 'length') + [('ifge', prefix + 'DONE')]
        c += g.at(l(7), l(8)) + l(4) + [('ifstrictne', prefix + 'NEXT')]
        c += g.push(l(3), g.arr([n(group), l(8)]))
        c += [('label', prefix + 'NEXT'), ('inclocal_i', 8), ('jump', prefix + 'LOOP'), ('label', prefix + 'DONE')]
    c += [('label', 'DONE')] + l(3) + [('returnvalue',)]
    g.method('Battle', 'wfxFp21SpawnSlots', 'Array', ['*', '*'], c, 9)
    # Attach this one final field while keeping the reviewed record helper's ABI.
    c = START + g.lex('JSON') + g.call('wfxFp21Enemy', l(1), l(3), s('/enemies/details'))
    c += [('callproperty', g.q('parse'), 1), ('setlocal', 4)]
    c += g.push(l(4), g.call('wfxFp21SpawnSlots', l(1), l(2)))
    c += g.lex('JSON') + l(4) + [('callproperty', g.q('stringify'), 1), ('returnvalue',)]
    g.method('Battle', 'wfxFp21EnemyAtZone', 'String', ['*', '*', 'Array'], c, 5)
