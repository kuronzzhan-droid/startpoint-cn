"""Compact diagnostic codecs; sort only newly owned arrays and read raw RNG."""
from fp_fields_base import START, NULL

DETAIL_LIMIT = 4


def build(g):
    l, n, s, q = g.l, g.n, g.s, g.q
    # Sorted JSON record strings contain no literal LF, so LF is an unambiguous
    # separator. Both lanes are wrapping int32 arithmetic over UTF-16 units.
    code = START + l(1) + [('callpropvoid', q('sort'), 0)]
    code += l(1) + s('\n') + [('callproperty', q('join'), 1), ('setlocal', 3)]
    code += g.raw(l(3), 'length') + [('setlocal', 9)]
    code += n(5381) + [('setlocal', 4)] + n(0) + [('setlocal', 5)]
    code += n(0) + [('setlocal', 6)]
    code += [('label', 'LOOP')] + l(6) + l(9) + [('ifge', 'DONE')]
    code += l(3) + l(6) + [('callproperty', q('charCodeAt'), 1), ('setlocal', 7)]
    code += l(4) + n(33) + [('multiply_i',)] + l(7) + [('bitxor',), ('setlocal', 4)]
    code += l(5) + n(65599) + [('multiply_i',)] + l(7) + [('add_i',), ('setlocal', 5)]
    code += [('inclocal_i', 6), ('jump', 'LOOP'), ('label', 'DONE')]
    code += g.obj({'count': g.raw(l(1), 'length'),
                   'hash': g.add(s('d32:'), l(4) + n(0) + [('urshift',)], s(':'), l(5) + n(0) + [('urshift',)])})
    code += [('setlocal', 8)] + l(2) + [('iffalse', 'RETURN')]
    code += g.raw(l(1), 'length') + n(DETAIL_LIMIT) + [('ifgt', 'RETURN')]
    code += g.set(l(8), s('entries'), l(1))
    code += [('label', 'RETURN')] + l(8) + [('returnvalue',)]
    g.method('Battle', 'wfxFpCompactSet', 'Object', ['Array', 'Boolean'], code, 10)

    code = START + l(1) + [('iftrue', 'PRESENT')] + NULL + [('returnvalue',), ('label', 'PRESENT')]
    code += l(1) + [('istype', g.e.q(g.cls('Xorshift'))), ('iffalse', 'UNKNOWN')]
    code += g.p(l(1), 'Xorshift', 'randomNum') + [('returnvalue',), ('label', 'UNKNOWN')]
    code += g.unsupported(l(2), l(3), 'rng_type') + NULL + [('returnvalue',)]
    g.method('Battle', 'wfxFpCompactRng', '*', ['*', 'Array', 'String'], code, 4)


def json(g, value):
    return g.lex('JSON') + value + [('callproperty', g.q('stringify'), 1)]


def summary(g, array, details=False):
    return g.call('wfxFpCompactSet', array, [('pushtrue' if details else 'pushfalse',)])
