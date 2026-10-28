"""C23 shared emitters: single-method inserts only (no new methods, no traits).

Every block is built from instructions already used by C1-C22/round2 inserts.
Reads of properties that a host might not carry are preceded by an AVM2 `in`
test, so missing data takes the block's own fallback instead of throwing.
"""
import hashlib
import c23_paths  # noqa: F401  (path setup)
import asm
import bodies

DYN = 14                      # MultinameL used by riven patches for o[key]
FRAGMENT = 16000900
LOWER, UPPER = 16000001, 16000999
ROW = 0x05000000              # C3 riven row domain in EquipmentListScene
CAP = 20                      # server batch limit
PROTECTED = ('ActionEvaluator', 'NormalAttackCalculator', 'MemberImpl', 'AbilityDamageShot')
LOCK_KEY = 'c9_riven_lock'
LOCK_BUTTON = 0x6D000000      # C9 lock button id (GeneralDialog)

# GeneralDialog (detail popup) ids
DETAIL_DISMANTLE = 0x6F000000
DETAIL_CONFIRM = 0x70000000
DETAIL_RESPONSE = 0x71000000
# EquipmentListScene (裂罅工坊) ids
B_ENTER = 0x26000000
B_CANCEL = 0x27000000
B_CONFIRM = 0x28000000
B_SEND = 0x29000000

TEXT = {
    'detail_button': '分解',
    'confirm_one': '确定分解这张裂罅吗？分解后无法恢复，并会解除所有编队中的装备。',
    'confirm_ok': '分解',
    'gain_prefix': '\n分解后获得 裂罅碎片 ×',
    'gain_none': '\n分解后无返还',
    'locked': '已锁定的裂罅不能分解',
    'pending': '有未确定的重铸结果，不能分解',
    'changed': '裂罅已变化，请重试',
    'done_one': '已分解，获得裂罅碎片 ×',
    'done_one_plain': '已分解',
    'enter': '批量分解',
    'cancel': '取消',
    'confirm': '分解',
    'hint': '点选要分解的裂罅（一次最多 20 张）',
    'cap': '一次最多分解 20 张',
    'none': '请先选择要分解的裂罅',
    'confirm_batch_a': '确定分解选中的 ',
    'confirm_batch_b': ' 张裂罅吗？分解后无法恢复，并会解除所有编队中的装备。\n分解后获得 裂罅碎片 ×',
    'done_batch_a': '分解了 ',
    'done_batch_b': ' 张裂罅，获得裂罅碎片 ×',
    'done_batch_plain': ' 张裂罅',
    'bar_owned': '裂罅碎片',
    'bar_batch_a': '已选 ',
    'bar_batch_b': '/20 · 可得碎片',
}
ICON_NAME = 'c23-craft-icon'
DIM_NAME = 'c23-dim'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def g(n):
    return ('getlocal', n)


def p(n):
    return ('setlocal', n)


class Emit:
    """Per-method emitter: fresh locals, numbers, strings, multinames."""

    def __init__(self, e, label, reserve=24):
        self.e = e
        self.label = label
        body = e.body(label)
        used = e.__dict__.setdefault('_c23_locals', {})
        self.first = used.get(label, body[2])
        used[label] = self.first + reserve
        self.free = list(range(self.first, self.first + reserve))
        self.int_adds = e.__dict__.setdefault('_c23_int_adds', [])

    def local(self):
        return self.free.pop(0)

    def locals(self, n):
        return [self.local() for _ in range(n)]

    def n(self, value):
        if -128 <= value <= 127:
            return ('pushbyte', value & 255)
        for i, v in enumerate(self.e.abc.ints):
            if i and v == value:
                return ('pushint', i)
        before = len(self.e.abc.ints)
        index = self.e.pool.integer(value)
        if len(self.e.abc.ints) > before:
            self.int_adds.append(value)
        return ('pushint', index)

    def s(self, text):
        return self.e.string(text)

    def q(self, name):
        return self.e.q(name)

    # ---- dynamic access -------------------------------------------------
    def get(self, key):
        return [self.s(key), ('getproperty', DYN)]

    def set(self, key, value):
        """object already on stack."""
        return [self.s(key), *value, ('setproperty', DYN)]

    def has(self, obj, key, fail):
        """`key in obj` (true for declared traits and dynamic keys)."""
        return [self.s(key), *obj, ('in',), ('iffalse', fail)]

    def gp(self, name):
        return ('getproperty', self.q(name))

    # ---- shared runtime lookups ----------------------------------------
    def chain(self, out, fail):
        """out = PinballClientMain.top.logic.globalLogic.logicStatus (null-safe)."""
        code = [('getlex', self.q('PinballClientMain')), self.gp('top'), ('coerce_a',), p(out),
                g(out), ('iffalse', fail)]
        for field in ('logic', 'globalLogic', 'logicStatus'):
            code += [g(out), self.gp(field), ('coerce_a',), p(out), g(out), ('iffalse', fail)]
        return code

    def ctx(self, out, scratch, fail):
        """out = loadedData.wfx_riven, guarded against C2001 (loadedData None)."""
        code = self.chain(scratch, fail)
        code += self.has([g(scratch)], 'loadedData', fail)
        code += [g(scratch), self.gp('loadedData'), ('coerce_a',), p(out), g(out), ('iffalse', fail),
                 g(out), self.gp('index'), ('pushbyte', 0), ('ifne', fail),
                 g(scratch), ('callproperty', self.q('getLoadedData'), 0), ('coerce_a',), p(out),
                 g(out), ('iffalse', fail)]
        code += self.has([g(out)], 'wfx_riven', fail)
        code += [g(out), *self.get('wfx_riven'), ('coerce_a',), p(out), g(out), ('iffalse', fail)]
        return code

    def rivens(self, out, fail):
        """out = current saveData.weapon_rivens (getPlayerSaveData never throws C2001)."""
        code = self.chain(out, fail)
        code += [g(out), ('callproperty', self.q('getPlayerSaveData'), 0), ('coerce_a',), p(out),
                 g(out), ('iffalse', fail)]
        code += self.has([g(out)], 'weapon_rivens', fail)
        code += [g(out), *self.get('weapon_rivens'), ('coerce_a',), p(out), g(out), ('iffalse', fail)]
        return code

    def record(self, rivens, ident, out, fail):
        return [g(rivens), g(ident), ('getproperty', DYN), ('coerce_a',), p(out), g(out), ('iffalse', fail)]

    def flag(self, rec, key, tag):
        """Leave Boolean(rec[key]) on stack; a missing key is false."""
        return [self.s(key), g(rec), ('in',), ('iffalse', tag + '_no'),
                g(rec), *self.get(key), ('convert_b',), ('jump', tag + '_end'),
                ('label', tag + '_no'), ('pushfalse',), ('label', tag + '_end')]

    def blocked(self, rec, locked, pending, tag):
        """Booleans for locked / pending-draw into two locals."""
        return [*self.flag(rec, 'locked', tag + '_l'), p(locked),
                *self.flag(rec, 'pending', tag + '_p'), p(pending)]

    def fragments(self, rec, out, idx, row, tag):
        """out += sum(n for [16000900, n] in rec.dismantle_return)."""
        code = [self.s('dismantle_return'), g(rec), ('in',), ('iffalse', tag + '_done'),
                g(rec), *self.get('dismantle_return'), ('iffalse', tag + '_done'),
                ('pushbyte', 0), p(idx),
                ('label', tag + '_loop'), ('avm_label',),
                g(idx), g(rec), *self.get('dismantle_return'), self.gp('length'), ('ifge', tag + '_done'),
                g(rec), *self.get('dismantle_return'), g(idx), ('getproperty', DYN), ('coerce_a',), p(row),
                g(row), ('iffalse', tag + '_next'),
                g(row), ('pushbyte', 0), ('getproperty', DYN), ('convert_i',), self.n(FRAGMENT), ('ifne', tag + '_next'),
                g(out), g(row), ('pushbyte', 1), ('getproperty', DYN), ('convert_i',), ('add',), ('convert_i',), p(out),
                ('label', tag + '_next'), ('inclocal_i', idx), ('jump', tag + '_loop'),
                ('label', tag + '_done')]
        return code

    def instant(self, receiver, text):
        return [*receiver, *text, ('getlex', self.q('pinball.context.scene.instantMessage::InstantMessagePosition')),
                self.gp('Center'), ('callpropvoid', self.q('showInstantMessage'), 2)]

    def handler(self, receiver, code_id):
        """1-arg dialog handler that calls receiver.buttonClicked(code_id)."""
        return [('getlex', self.q('pinball.common.tools._FunctionTools::BindImpl2_1')),
                ('getlex', self.q('pinball.common.tools::FunctionTools0')), self.gp('expanded1'),
                ('getlex', self.q('pinball.common.tools._FunctionTools::BindImpl1_0')),
                *receiver, self.gp('buttonClicked'), self.n(code_id), ('construct', 2), self.gp('execute'),
                ('construct', 2), self.gp('execute')]

    def confirm_dialog(self, text, receiver, code_id):
        """Native GeneralDialog Select(分解, Close): confirm -> receiver.buttonClicked(code_id)."""
        q = self.q
        return [('getlex', q('pinball.dialog.general::GeneralDialog')),
                ('getlex', q('pinball.dialog.general::DialogContent')), *text,
                ('callproperty', q('DynamicText'), 1), ('newarray', 1),
                ('getlex', q('pinball.dialog.general::DialogButtonLayoutKind')),
                ('getlex', q('pinball.dialog.general.button::DialogButton')), self.s(TEXT['confirm_ok']),
                ('callproperty', q('PositiveDynamicText'), 1),
                ('getlex', q('pinball.dialog.general.button::DialogButton')), self.gp('Close'),
                *self.handler(receiver, code_id),
                ('getlex', q('pinball.common.tools::FunctionTools')), self.gp('emptyFunction1'),
                ('callproperty', q('Select'), 4), ('pushnull',), ('construct', 3)]

    def ok_dialog(self, text):
        q = self.q
        return [('getlex', q('pinball.dialog.general::OkDialog')),
                ('getlex', q('pinball.dialog.general::DialogContent')), *text,
                ('callproperty', q('DynamicText'), 1), ('newarray', 1),
                ('getlex', q('pinball.common.tools::FunctionTools')), self.gp('emptyFunction1'),
                ('construct', 2)]

    def remote(self, logic_owner, path, payload, callback):
        """new RealRemoteService(owner.logic.remote).startUserRequest(path, payload, callback)."""
        return [('getlex', self.q('pinball.context.remote.real::RealRemoteService')),
                *logic_owner, self.gp('logic'), self.gp('remote'), ('construct', 1),
                self.s(path), *payload, *callback, ('callpropvoid', self.q('startUserRequest'), 3)]

    def lock_meta(self, meta, fail):
        """C9 detail metadata: this.contents[2] is AbilitySoulDetail (16) with params[4].c9_riven_lock."""
        return [('getlocal_0',), self.gp('contents'), ('coerce_a',), p(meta),
                g(meta), ('iffalse', fail), g(meta), self.gp('length'),
                ('pushbyte', 3), ('iflt', fail), g(meta), ('pushbyte', 2), ('getproperty', DYN),
                ('coerce_a',), p(meta), g(meta), ('iffalse', fail),
                g(meta), self.gp('index'), ('pushbyte', 16), ('ifne', fail),
                g(meta), self.gp('params'), ('pushbyte', 4), ('getproperty', DYN), ('coerce_a',), p(meta),
                g(meta), ('iffalse', fail), *self.has([g(meta)], LOCK_KEY, fail),
                g(meta), *self.get(LOCK_KEY), ('coerce_a',), p(meta), g(meta), ('iffalse', fail)]

    def revealed(self, ident, fail):
        """Revealed instance 16000001..16000999 except 16000900 and themed 16000901..919."""
        return [g(ident), self.n(LOWER), ('iflt', fail), g(ident), self.n(UPPER), ('ifgt', fail),
                g(ident), self.n(FRAGMENT), ('subtract',), ('pushbyte', 0), ('ifeq', fail),
                g(ident), self.n(FRAGMENT), ('subtract',), ('pushbyte', 1), ('iflt', 'rv_ok_' + str(ident)),
                g(ident), self.n(FRAGMENT), ('subtract',), ('pushbyte', 19), ('ifle', fail),
                ('label', 'rv_ok_' + str(ident))]


class Queue:
    """Collect inserts per method with explicit anchors; applied once by c23_apply."""

    def __init__(self, editor):
        self.e = editor
        self.rows = []

    def add(self, feature, label, at, code, incoming=asm.FORBID, note=''):
        body = self.e.body(label)
        self.e.locks.setdefault(label, {'sha': sha(body[5]), 'header': list(body[1:5])})
        block = asm.assemble(code)
        self.e.insertions.setdefault(label, []).append((at, block, incoming))
        self.rows.append({'feature': feature, 'method': label, 'at': at, 'instructions': len(block),
                          'incoming': incoming, 'note': note, 'method_sha256_before': sha(body[5])})
        return at


def ops_of(e, label):
    return asm.decode(e.body(label)[5])


def mn(e, op):
    return str(e.abc.mn_name(op.args[0]))


def label_index(abc):
    return {l: i for i, l in bodies.label_map(abc).items()}
