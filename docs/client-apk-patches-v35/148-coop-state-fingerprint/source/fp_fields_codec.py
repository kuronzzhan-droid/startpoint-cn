"""f64位编码、Pointer、按当前ABC签名限定的枚举复制。"""
from fp_fields_base import START, NULL

ENUMS = ('EnemyAddress', 'ZoneAddress', 'ZakoEmitterAddress', 'EnemyStateAddress',
         'UnitAddress', 'TrialKind', 'ModifierFieldContent', 'ConvertToAttackFromKind',
         'SeparatedTerm2ndDamageKind')


def build(g):
    e, q, l, n, s = g.e, g.q, g.l, g.n, g.s
    code = START + g.lex('flash.utils::ByteArray') + [('construct', 0), ('setlocal', 2)]
    code += l(2) + s('bigEndian') + [('setproperty', q('endian'))]
    code += l(2) + l(1) + [('callpropvoid', q('writeDouble'), 1)]
    code += l(2) + n(0) + [('setproperty', q('position'))]
    code += s('f64:') + [('setlocal', 3)] + n(0) + [('setlocal', 4)]
    code += [('label', 'LOOP')] + l(4) + n(8) + [('ifge', 'DONE')]
    code += l(2) + [('callproperty', q('readUnsignedByte'), 0), ('setlocal', 5)]
    for shift in (4, 0):
        code += l(3) + s('0123456789abcdef') + l(5)
        if shift:
            code += n(shift) + [('urshift',)]
        code += n(15) + [('bitand',), ('callproperty', q('charAt'), 1), ('add',), ('setlocal', 3)]
    code += [('inclocal_i', 4), ('jump', 'LOOP'), ('label', 'DONE')] + l(3) + [('returnvalue',)]
    g.method('Battle', 'wfxFpF64', 'String', ['Number'], code, 6)
    code = START + l(1)
    for source, target in (('~', '~0'), ('/', '~1')):
        code += s(source) + [('callproperty', q('split'), 1)] + s(target) + [('callproperty', q('join'), 1)]
    code += [('returnvalue',)]
    g.method('Battle', 'wfxFpPointer', 'String', ['String'], code, 2)

    # Helpers are generated only for explicit supported enum classes. Factory
    # argument types come from the current input ABC, including Number vs int.
    for name in ENUMS:
        ci, row = e.instance(g.cls(name))
        clsq = row[0]
        cases = []
        for trait in e.abc.classes[ci][1]:
            tag = e.abc.mn_name(trait.name).split('::')[-1]
            if tag.startswith('__'):
                continue
            if trait.data[0] == 'method':
                meth = e.abc.methods[trait.data[2]]
                if meth[0] != clsq:
                    continue
                cases.append((tag, [e.abc.mn_name(x) for x in meth[1]]))
            elif trait.data[0] == 'slot' and trait.data[2] == clsq:
                cases.append((tag, []))
        if not cases:
            raise ValueError('empty enum signatures: ' + name)
        g.audit.append({'enum': g.cls(name), 'factorySignatures': cases})
        code = START + g.raw(l(1), 'params') + [('setlocal', 5)]
        for i, (tag, types) in enumerate(cases):
            code += g.raw(l(1), 'tag') + s(tag) + [('ifne', 'N' + str(i))]
            items = [g.raw(l(1), 'index')]
            for j, typ in enumerate(types):
                value = g.at(l(5), n(j))
                if typ == 'Number':
                    value = g.f64(value)
                elif typ in ('int', 'uint', 'Boolean', 'String'):
                    pass
                elif typ.split('::')[-1] in ENUMS + ('AdditionalDirectAttackContent',):
                    value = g.call('wfxFpEnumDepth', value, l(2),
                                   g.add(l(3), s('/' + str(j + 1))), l(4) + n(1) + [('add_i',)])
                else:
                    raise ValueError(f'unhandled enum argument signature {name}.{tag}: {typ}')
                items.append(value)
            code += g.arr(items) + [('returnvalue',), ('label', 'N' + str(i))]
        code += g.unsupported(l(2), l(3), 'enum_variant') + NULL + [('returnvalue',)]
        g.method('Battle', 'wfxFpEnum' + name, '*', ['*', 'Array', 'String', 'int'], code, 6)

    code = START + l(1) + [('iftrue', 'NONNULL')] + NULL + [('returnvalue',), ('label', 'NONNULL')]
    code += l(4) + n(64) + [('ifgt', 'BAD')]
    for name in ENUMS:
        code += l(1) + [('istype', e.q(g.cls(name))), ('iffalse', 'NOT' + name)]
        code += g.call('wfxFpEnum' + name, l(1), l(2), l(3), l(4))
        code += [('returnvalue',), ('label', 'NOT' + name)]
    name = 'AdditionalDirectAttackContent'
    code += l(1) + [('istype', e.q(g.cls(name))), ('iffalse', 'BAD')]
    code += g.obj({'directAttackTimes': g.p(l(1), name, 'directAttackTimes'),
                   'directAttackDamage': g.f64(g.p(l(1), name, 'directAttackDamage'))})
    code += [('returnvalue',), ('label', 'BAD')]
    code += g.unsupported(l(2), l(3), 'enum_variant') + NULL + [('returnvalue',)]
    g.method('Battle', 'wfxFpEnumDepth', '*', ['*', 'Array', 'String', 'int'], code, 5)
    code = START + g.call('wfxFpEnumDepth', l(1), l(2), l(3), n(0)) + [('returnvalue',)]
    g.method('Battle', 'wfxFpEnum', '*', ['*', 'Array', 'String'], code, 4)

    # Raw Xorshift only; all other implementations explicitly lose coverage.
    code = START + l(1) + [('iftrue', 'RNG')] + g.set(l(2), l(4), NULL) + [('returnvoid',), ('label', 'RNG')]
    code += l(1) + [('istype', e.q(g.cls('Xorshift'))), ('iffalse', 'BAD')]
    code += g.set(l(2), l(4), g.p(l(1), 'Xorshift', 'randomNum')) + [('returnvoid',), ('label', 'BAD')]
    code += g.unsupported(l(3), l(4), 'rng_type') + [('returnvoid',)]
    g.method('Battle', 'wfxFpRng', 'void', ['*', 'Object', 'Array', 'String'], code, 5)
