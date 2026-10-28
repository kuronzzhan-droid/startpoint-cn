"""Bound oversized native text rasters without changing logical text or HTML."""
from types import SimpleNamespace
import asm
import bodies
from bootstrap import sha
from framework import Editor

LABEL = 'TrueTypeCompositor/renderText'
CODE_SHA = 'a626fe6352d2dbeab725f4f9c2c08c1226be01308b55adad331e470c88d5bf1b'
HEADER = [7, 22, 0, 1]


def apply(abc):
    editor = Editor(SimpleNamespace(abc=abc), {LABEL: {'sha': CODE_SHA, 'header': HEADER}})
    body = editor.body(LABEL)
    assert sha(body[5]) == CODE_SHA and body[1:5] == HEADER
    ops = asm.decode(body[5])
    assert len(ops) == 332

    def q(name):
        hits = [i for i, mn in enumerate(abc.multinames)
                if mn[0] == 7 and abc.mn_name(i) == name]
        assert len(hits) == 1, (name, hits)
        return hits[0]

    g = lambda n: ('getlocal', n)
    put = lambda n: ('setlocal', n)
    scale, largest = body[2], body[2] + 1
    assert ops[233].name == 'getlocal' and ops[233].args == [18]
    assert ops[318].name == 'callpropvoid' and abc.mn_name(ops[318].args[0]) == 'setTo'
    assert ops[319].name == 'getlocal' and ops[319].args == [20]
    editor.insert(LABEL, 2, [('pushbyte', 1), put(scale)])
    # Keep the existing text measurement, font sizes, HTML and alignment. Only
    # the physical BitmapData is reduced when the measured image exceeds GPU
    # limits. The original recursive branch remains byte-for-byte recoverable,
    # but its condition sees bounded dimensions and therefore never recurses.
    code = [('getlex', q('Math')), g(16), g(18), ('callproperty', q('max'), 2), put(largest),
            g(largest), g(10), ('ifle', 'END'),
            g(10), ('pushbyte', 4), ('subtract',), g(largest), ('divide',), put(scale)]
    for dim in (16, 18):
        code += [('getlex', q('Math')), g(dim), g(scale), ('multiply',),
                 ('callproperty', q('ceil'), 1), ('convert_i',), put(dim),
                 g(dim), ('pushbyte', 1), ('ifge', f'floor_{dim}'),
                 ('pushbyte', 1), put(dim), ('label', f'floor_{dim}'),
                 g(dim), g(10), ('ifle', f'cap_{dim}'), g(10), put(dim),
                 ('label', f'cap_{dim}')]
    editor.insert(LABEL, 233, code)
    # Matrix.scale also scales tx/ty, retaining the original crop/alignment
    # translation. Texture.fromBitmapData consumes bitmap.scale in fillMeshBatch
    # and restores logical dimensions while preserving all text content.
    editor.insert(LABEL, 319, [
        ('getlex', q('starling.text:TrueTypeCompositor::sHelperMatrix')),
        g(scale), g(scale), ('callpropvoid', q('scale'), 2),
        g(20), g(scale), ('setproperty', q('scale'))])
    editor.apply()
    assert not editor.new_methods and not editor.traits
    assert bodies.resolve(abc, LABEL) == 6
    return editor.report[LABEL]
