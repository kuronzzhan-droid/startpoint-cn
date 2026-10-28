"""Shared emitters for round2 single-method inserts (no new methods, no traits).

Numeric constants: only ints already in the pool (16000000, 16000900, 16000999)
plus pushbyte. Themed-unknown test is d = id - 16000900, 1 <= d <= 19, which
avoids adding 16000901/16000919 to the int pool.
"""
import hashlib
import r2_paths  # noqa: F401  (path setup)
import asm
import bodies

DYNAMIC = 14            # MultinameL used by the riven patches for o[key]
OPTION = 'haxe.ds::Option'
UNKNOWN = 16000000
FRAGMENT = 16000900
UPPER = 16000999
LOWER = 16000001
THEMED_SPAN = 19        # 16000901 .. 16000919
PROTECTED = ('ActionEvaluator', 'NormalAttackCalculator', 'MemberImpl', 'AbilityDamageShot')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def num(e, value):
    if -128 <= value <= 127:
        return ('pushbyte', value & 255)
    for name, opcode in (('ints', 'pushint'), ('uints', 'pushuint')):
        for i, v in enumerate(getattr(e.abc, name)):
            if i and v == value:
                return (opcode, i)
    raise asm.AsmError('round2 does not add numeric pool constants: %r' % value)


def ops_of(e, label):
    return asm.decode(e.body(label)[5])


def int_value(abc, op):
    if op.name == 'pushint':
        return abc.ints[op.args[0]]
    if op.name == 'pushbyte':
        v = op.args[0]
        return v - 256 if v > 127 else v
    if op.name == 'pushshort':
        return op.args[0]
    if op.name == 'pushstring':
        s = abc.strings[op.args[0]]
        if s.isdigit():
            return int(s)
    return None


def mn(e, op):
    return str(e.abc.mn_name(op.args[0]))


def themed_jump(e, local, yes, no):
    """getlocal(local) is an int; jump to yes if 16000901..16000919 else no."""
    g = ('getlocal', local)
    return [g, num(e, FRAGMENT), ('subtract',), ('pushbyte', 1), ('iflt', no),
            g, num(e, FRAGMENT), ('subtract',), ('pushbyte', THEMED_SPAN), ('ifgt', no),
            ('jump', yes)]


def revealed_jump(e, local, yes, no):
    """Revealed instance: 16000001..16000999, not 16000900, not themed-unknown."""
    g = ('getlocal', local)
    return [g, num(e, LOWER), ('iflt', no), g, num(e, UPPER), ('ifgt', no),
            g, num(e, FRAGMENT), ('ifeq', no),
            g, num(e, FRAGMENT), ('subtract',), ('pushbyte', 1), ('iflt', yes),
            g, num(e, FRAGMENT), ('subtract',), ('pushbyte', THEMED_SPAN), ('ifle', no),
            ('jump', yes)]


def t1_block(e):
    """Before a branch consuming [id, 16000999]: themed ids get bound -1, so the
    instance test fails exactly as it does for 16000000 (NaN-safe)."""
    return [('pop',), ('dup',), num(e, FRAGMENT), ('subtract',), ('dup',), ('pushbyte', 1),
            ('ifnge', 'k1'), ('pushbyte', THEMED_SPAN), ('ifnle', 'k0'),
            ('pushbyte', 255), ('jump', 'done'),
            ('label', 'k1'), ('pop',), ('label', 'k0'), num(e, UPPER), ('label', 'done')]


def t2_block(e):
    """Before a branch consuming [id, 16000000]: themed ids compare as 16000000."""
    return [('pop',), ('dup',), num(e, FRAGMENT), ('subtract',), ('dup',), ('pushbyte', 1),
            ('ifnge', 'k1'), ('pushbyte', THEMED_SPAN), ('ifnle', 'k0'),
            ('pop',), num(e, UNKNOWN), ('jump', 'k0'),
            ('label', 'k1'), ('pop',), ('label', 'k0'), num(e, UNKNOWN)]


class Queue:
    """Collect inserts per method with explicit anchors; apply once."""

    def __init__(self, editor):
        self.e = editor
        self.rows = []

    def add(self, feature, label, at, code, incoming=asm.FORBID, note=''):
        body = self.e.body(label)
        self.e.locks.setdefault(label, {'sha': sha(body[5]), 'header': list(body[1:5])})
        block = asm.assemble(code)
        self.e.insertions.setdefault(label, []).append((at, block, incoming))
        self.rows.append({'feature': feature, 'method': label, 'at': at,
                          'instructions': len(block), 'incoming': incoming, 'note': note,
                          'method_sha256_before': sha(body[5])})
        return at


def first_free(e, label, reserve):
    """Fresh locals above the original localcount, reserved per method."""
    body = e.body(label)
    used = e.__dict__.setdefault('_r2_locals', {})
    start = used.get(label, body[2])
    used[label] = start + reserve
    return start


def label_index(abc):
    return {l: i for i, l in bodies.label_map(abc).items()}
