"""Reuse the existing inventory labels and native detail title controls."""
import asm
from c1_lookup import number
from c2_common import DYNAMIC, get, queue
from c9_lists import current_lookup
from c10_strings import TEXT
from c12_layout_text import g, read, write, raw, plain, fit, quality, escaped


def multiline(e, first, tag, native=True, info=None, default=0x444444, fixed_width=None):
    value, node, grade, index, ident, scratch, record = range(first, first + 7)
    flag = first + 10
    code = [('setlocal', value), ('setlocal', node), ('pushfalse',), ('setlocal', flag)]
    for n in range(1, 6):
        code += [g(value), e.string(TEXT['quality'] + TEXT['quality_' + str(n)]),
                 ('callproperty', e.q('http://adobe.com/AS3/2006/builtin::indexOf'), 1),
                 ('setlocal', index), g(index), number(e, 0), ('iflt', tag + '_next_' + str(n)),
                 number(e, n), ('setlocal', grade), ('jump', tag + '_apply'),
                 ('label', tag + '_next_' + str(n))]
    # Native title instances can be reused. Restore their authored attributes
    # only when this component previously enabled HTML; ordinary plain titles
    # preserve their own untouched formats and scaling.
    code += [*raw(e, node, native), ('getproperty', e.q('isHtmlText')), ('iffalse', tag + '_done'),
             *plain(e, node, native, default),
             *raw(e, node, native), ('pushtrue',), ('setproperty', e.q('wordWrap')),
             *write(e, node, 'autoScale', [('pushtrue',)], native)]
    if native:
        attrs = [g(node), ('getproperty', e.q('data')), ('getproperty', e.q('attributes'))]
        for source, target in [('fontSize', 'size'), ('letterSpacing', 'letterSpacing')]:
            code += [*read(e, node, 'format', True), *attrs, ('getproperty', e.q(source)),
                     ('setproperty', e.q(target))]
        code += write(e, node, 'textHeight', [*attrs, ('getproperty', e.q('height'))], True)
    else:
        code += [*write(e, node, 'height', [number(e, 60)], False),
                 *read(e, node, 'format', False), number(e, 20), ('setproperty', e.q('size'))]
    code += [('jump', tag + '_done'), ('label', tag + '_apply'), ('pushtrue',), ('setlocal', flag),
             g(value), number(e, 0), g(index),
             ('callproperty', e.q('http://adobe.com/AS3/2006/builtin::substr'), 2), ('setlocal', value),
             *plain(e, node, native, default), *read(e, node, 'format', native),
             number(e, 32 if native else 20), ('setproperty', e.q('size')),
             *read(e, node, 'format', native), number(e, 0), ('setproperty', e.q('letterSpacing'))]
    if fixed_width is not None:
        code += write(e, node, 'textWidth', [number(e, fixed_width)], True)
    if info is not None:
        # draw/apply both establish the final available width before measuring.
        code += [g(info), *get(e, 'wfxSoulRivenRow'), ('iffalse', tag + '_grid'),
                 *write(e, node, 'width', [('getlocal_0',), ('getproperty', e.q('contentWidth')),
                                         number(e, 220), ('subtract',)], False),
                 ('jump', tag + '_width'), ('label', tag + '_grid'),
                 *write(e, node, 'width', [number(e, 168)], False), ('label', tag + '_width'),
                 *read(e, node, 'format', False), number(e, 20), ('setproperty', e.q('size'))]
    code += [*fit(e, node, value, first + 7, tag + '_fit', native),
             *raw(e, node, native), ('pushtrue',), ('setproperty', e.q('isHtmlText')),
             *write(e, node, 'textHeight' if native else 'height', [number(e, 80 if native else 92)], native),
             *escaped(e, value), e.string('\n'), ('add',), *quality(e, grade), ('add',),
             ('setlocal', value)]
    if info is not None:
        code += [g(info), ('getproperty', e.q('itemId')), ('setlocal', ident),
                 *current_lookup(e, ident, scratch, record, tag + '_done'),
                 g(value), e.string('\n词条 '), ('add',), g(record), *get(e, 'affixes'),
                 ('getproperty', e.q('length')), ('add',), e.string(' 条'), ('add',), ('setlocal', value)]
    return code + [('label', tag + '_done'), g(node), g(value)]


def views(e):
    result = {}
    for label, info in [('PanelInnerContentItemListTableView/draw', 5),
                        ('PanelInnerContentItemListTableView/apply', 14)]:
        body = e.body(label); ops = asm.decode(body[5])
        at = next(i for i, op in enumerate(ops) if op.name == 'setproperty'
                  and e.abc.mn_name(op.args[0]) == 'text')
        result[label] = {'text': queue(e, label, multiline(e, body[2] + 20, 'c12_panel',
                                     native=False, info=info, default=0x333333), at, asm.SKIP)}
        # C8 soul rows apply this height after the text hook; preserve 92px.
        heights = [i for i in range(at + 1, len(ops)) if ops[i].name == 'pushbyte'
                   and ops[i].args == [60] and ops[i + 1].name == 'setproperty'
                   and e.abc.mn_name(ops[i + 1].args[0]) == 'height']
        for i in heights:
            code = [g(body[2] + 30), ('iffalse', 'c12_original_height'), ('pop',), number(e, 92),
                    ('label', 'c12_original_height')]
            result[label]['soul_height'] = queue(e, label, code, i + 1, asm.SKIP)
    # Inventory cards need room for all three lines; the soul page's later C8
    # single-column geometry remains at its original 168px row height.
    for label in ('PanelInnerContentItemListTableView/run', 'PanelInnerContentItemListTableView/apply'):
        ops = asm.decode(e.body(label)[5])
        at = [i for i, op in enumerate(ops) if op.name == 'pushint' and e.abc.ints[op.args[0]] == 232]
        assert len(at) == 1, (label, at)
        first = e.body(label)[2] + 20
        source = [('getlocal_1',)] if label.endswith('/apply') else [('getlocal_0',), ('getproperty', e.q('items'))]
        # C3 stops at its first name (which may be unknown). Scan the full
        # current list here so a later revealed row still gets its third line.
        code = [*source, ('setlocal', first), number(e, 0), ('setlocal', first + 1),
                ('label', 'c12_height_scan'), ('avm_label',), g(first + 1), g(first),
                ('getproperty', e.q('length')), ('ifge', 'c12_height_done'),
                g(first), g(first + 1), ('getproperty', DYNAMIC), ('getproperty', e.q('kind')),
                ('setlocal', first + 2), g(first + 2), ('getproperty', e.q('index')),
                number(e, 0), ('ifne', 'c12_height_next'), g(first + 2),
                ('getproperty', e.q('params')), number(e, 0), ('getproperty', DYNAMIC),
                ('getproperty', e.q('itemId')), ('setlocal', first + 2),
                g(first + 2), number(e, 16000001), ('iflt', 'c12_height_next'),
                g(first + 2), number(e, 16000999), ('ifgt', 'c12_height_next'),
                ('pop',), number(e, 264), ('jump', 'c12_height_done'),
                ('label', 'c12_height_next'), ('inclocal_i', first + 1), ('jump', 'c12_height_scan'),
                ('label', 'c12_height_done')]
        result.setdefault(label, {})['grid_height'] = queue(e, label, code, at[0] + 1, asm.SKIP)
    label = 'ComplexThumbnailView/culling'; ops = asm.decode(e.body(label)[5])
    at = [i for i, op in enumerate(ops) if op.name == 'pushint' and e.abc.ints[op.args[0]] == 144]
    assert len(at) == 1
    code = [('pop',), ('getlocal_0',), ('getproperty', e.q('layer')), e.string('wfx-riven-name'),
            ('callproperty', e.q('getChildByName'), 1), ('getproperty', e.q('height')),
            number(e, 84), ('add',)]
    result[label] = queue(e, label, code, at[0] + 1, asm.SKIP)
    targets = [('ExBoostWindowView/onApplyExBoostInformation', 'characterName', 0x444444),
               ('ExBoostWindowView/setupExBoostInformationWindow', 'characterName', 0x444444),
               ('ExBoostSelectDialogView/run', 'getExBoostCharacterName', 0xFAFAFA),
               ('DialogItemTitleView/run', None, 0x444444)]
    for label, marker, default in targets:
        body = e.body(label); ops = asm.decode(body[5])
        hits = [0] if marker is None else [i for i, op in enumerate(ops) if
                (op.name == 'pushstring' and e.abc.s(op.args[0]) == marker)
                or (op.name in ('getproperty', 'callproperty')
                    and e.abc.mn_name(op.args[0]).split('::')[-1] == marker)]
        sites = sorted({next(i for i in range(hit, len(ops)) if ops[i].name == 'callpropvoid'
                       and e.abc.mn_name(ops[i].args[0]) == 'set_text') for hit in hits})
        assert sites, (label, marker)
        result[label] = [queue(e, label, multiline(e, body[2] + 20, 'c12_title_' + str(n),
                                                 default=default,
                                                 fixed_width=550 if label.startswith('ExBoostWindowView/') else None), at, asm.SKIP)
                         for n, at in enumerate(sites)]
    from c12_layout_geometry import geometry
    result.update(geometry(e))
    return result
