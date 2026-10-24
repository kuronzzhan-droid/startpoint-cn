"""有限 AVM2 解释器：直接执行补丁前后的真实字节码，用于行为回归与负对照。

不建模完整运行时，只覆盖本补丁涉及的方法切片、新增方法与两张表解析器会走到的指令。
对象一律用 dict 模拟：属性按完整多名查找，找不到再按 ``::`` 之后的短名查找；
类用 :class:`Cls` 表示（``getlex`` / ``findpropstrict`` 返回它，``constructprop`` 调它的 ctor）。
遇到未支持的指令直接报错，绝不静默跳过。
"""
from __future__ import annotations

import copy
import math


class AvmThrow(Exception):
    """字节码执行了 ``throw``；``value`` 是被抛出的对象。"""

    def __init__(self, value):
        super().__init__(repr(value))
        self.value = value


class Cls:
    """类对象：``ctor`` 用于 construct/constructprop，``statics`` 是静态成员。"""

    def __init__(self, name, ctor=None, **statics):
        self.name = name
        self.ctor = ctor
        self.statics = statics

    def __repr__(self):
        return f'<Cls {self.name}>'


def short(name):
    return name.split('::')[-1]


def _lookup(obj, key):
    if isinstance(obj, Cls):
        for k in (key, short(key)):
            if k in obj.statics:
                return obj.statics[k]
        raise KeyError(f'{obj.name} has no static {key}')
    if isinstance(obj, dict):
        for k in (key, short(key)):
            if k in obj:
                return obj[k]
        raise KeyError(f'object has no property {key}: keys={sorted(map(str, obj))[:12]}')
    if isinstance(obj, (list, tuple)):
        if key == 'length':
            return len(obj)
        return obj[int(key)]
    if obj is None:
        raise KeyError(f'null has no property {key}')
    return getattr(obj, short(key))


def _truthy(value):
    if value is None:
        return False
    if isinstance(value, float) and math.isnan(value):
        return False
    return bool(value)


def _is_ref(value):
    return isinstance(value, (dict, list, Cls)) or callable(value)


def _loose_eq(a, b):
    if _is_ref(a) or _is_ref(b):
        return a is b
    return a == b


def _strict_eq(a, b):
    if _is_ref(a) or _is_ref(b):
        return a is b
    num = (int, float)
    if isinstance(a, num) and isinstance(b, num) and not isinstance(a, bool) and not isinstance(b, bool):
        return a == b
    return type(a) is type(b) and a == b


def _i32(value):
    value = int(value) & 0xFFFFFFFF
    return value - (1 << 32) if value & 0x80000000 else value


def _to_int(value):
    if value is None:
        return 0
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return 0
        return _i32(math.trunc(value))
    if isinstance(value, str):
        try:
            return _i32(int(float(value)))
        except ValueError:
            return 0
    return _i32(int(value))


def _type_matches(value, cls):
    if not isinstance(value, dict):
        return False
    name = cls.name if isinstance(cls, Cls) else str(cls)
    return value.get('_type') in (name, short(name))


GLOBALS = {'int': lambda v=0: _to_int(v), 'Number': lambda v=0: float(v),
           'Boolean': lambda v=None: _truthy(v), 'String': lambda v='': str(v),
           'Math': {'floor': lambda v: float(math.floor(v)), 'ceil': lambda v: float(math.ceil(v)),
                    'max': max, 'min': min, 'abs': abs}}


class Interp:
    def __init__(self, abc, lex=None, max_steps=200000):
        self.abc = abc
        self.lex = dict(lex or {})
        self.max_steps = max_steps
        self.steps = 0

    def name(self, index):
        return self.abc.mn_name(index)

    def _runtime_name(self, index, stack):
        """MultinameL/RTQNameL 等运行时多名：从栈上取名字（命名空间部分忽略）。"""
        kind = self.abc.multinames[index][0]
        if kind in (0x1B, 0x1C):                 # MultinameL / MultinameLA
            return stack.pop()
        if kind in (0x11, 0x12):                 # RTQNameL / RTQNameLA
            name = stack.pop()
            stack.pop()
            return name
        if kind in (0x0F, 0x10):                 # RTQName / RTQNameA
            stack.pop()
        return self.name(index)

    def _lex(self, name):
        for key in (name, short(name)):
            if key in self.lex:
                return self.lex[key]
        if short(name) in GLOBALS:
            return GLOBALS[short(name)]
        raise KeyError(f'getlex {name} not provided')

    def _find(self, name, this):
        for key in (name, short(name)):
            if key in self.lex:
                return self.lex[key]
        if short(name) in GLOBALS:
            return GLOBALS
        return this

    def run(self, ins, args, scopes=None):
        regs = dict(enumerate(args))
        stack, scopes = [], list(scopes or [])
        pc = 0
        abc = self.abc
        while True:
            if pc >= len(ins):
                raise AssertionError('fell off the end of the method')
            x = ins[pc]
            self.steps += 1
            if self.steps > self.max_steps:
                raise AssertionError('instruction budget exhausted (loop?)')
            pc += 1
            op, a = x.name, x.args
            if op in ('nop', 'avm_label', 'label', 'debug', 'debugline', 'debugfile', 'bkpt'):
                continue
            if op == 'op_08':                                    # kill
                regs[a[0]] = None
            elif op.startswith('getlocal_'):
                stack.append(regs.get(int(op[-1])))
            elif op == 'getlocal':
                stack.append(regs.get(a[0]))
            elif op.startswith('setlocal_'):
                regs[int(op[-1])] = stack.pop()
            elif op == 'setlocal':
                regs[a[0]] = stack.pop()
            elif op in ('inclocal_i', 'inclocal'):
                regs[a[0]] = _to_int(regs.get(a[0])) + 1 if op == 'inclocal_i' else (regs.get(a[0]) or 0) + 1
            elif op in ('declocal_i', 'declocal'):
                regs[a[0]] = _to_int(regs.get(a[0])) - 1 if op == 'declocal_i' else (regs.get(a[0]) or 0) - 1
            elif op == 'pushscope':
                scopes.append(stack.pop())
            elif op == 'popscope':
                scopes.pop()
            elif op == 'getscopeobject':
                stack.append(scopes[a[0]])
            elif op == 'getglobalscope':
                stack.append(GLOBALS)
            elif op == 'pushbyte':
                stack.append(a[0] if a[0] < 128 else a[0] - 256)
            elif op == 'pushshort':
                stack.append(a[0] if a[0] < 0x8000 else a[0] - 0x10000)
            elif op == 'pushint':
                stack.append(abc.ints[a[0]])
            elif op == 'pushuint':
                stack.append(abc.uints[a[0]])
            elif op == 'pushdouble':
                stack.append(abc.doubles[a[0]])
            elif op == 'pushstring':
                stack.append(abc.strings[a[0]].decode('utf8'))
            elif op == 'pushtrue':
                stack.append(True)
            elif op == 'pushfalse':
                stack.append(False)
            elif op in ('pushnull', 'pushundefined'):
                stack.append(None)
            elif op == 'pushnan':
                stack.append(float('nan'))
            elif op == 'pop':
                stack.pop()
            elif op == 'dup':
                stack.append(stack[-1])
            elif op == 'swap':
                stack[-1], stack[-2] = stack[-2], stack[-1]
            elif op in ('coerce', 'coerce_a', 'coerce_o', 'convert_o', 'checkfilter'):
                pass
            elif op in ('coerce_s', 'convert_s'):
                value = stack.pop()
                stack.append(None if value is None and op == 'coerce_s' else ('null' if value is None else str(value)))
            elif op == 'convert_b':
                stack.append(_truthy(stack.pop()))
            elif op in ('convert_i', 'convert_u'):
                stack.append(_to_int(stack.pop()))
            elif op == 'convert_d':
                value = stack.pop()
                stack.append(float('nan') if value is None else float(value))
            elif op in ('astype', 'istype'):
                value = stack.pop()
                ok = _type_matches(value, self.name(a[0]))
                stack.append((value if ok else None) if op == 'astype' else ok)
            elif op in ('astypelate', 'istypelate'):
                cls, value = stack.pop(), stack.pop()
                ok = _type_matches(value, cls)
                stack.append((value if ok else None) if op == 'astypelate' else ok)
            elif op == 'getlex':
                stack.append(self._lex(self.name(a[0])))
            elif op in ('findpropstrict', 'findproperty'):
                stack.append(self._find(self.name(a[0]), regs.get(0)))
            elif op == 'getproperty':
                key = self._runtime_name(a[0], stack)
                stack.append(_lookup(stack.pop(), key))
            elif op in ('setproperty', 'initproperty'):
                value = stack.pop()
                key = self._runtime_name(a[0], stack)
                obj = stack.pop()
                if isinstance(obj, dict):
                    obj[short(key)] = value
                else:
                    setattr(obj, short(key), value)
            elif op == 'getslot':
                stack.append(_lookup(stack.pop(), 'slot%d' % a[0]))
            elif op == 'setslot':
                value, obj = stack.pop(), stack.pop()
                obj['slot%d' % a[0]] = value
            elif op in ('callproperty', 'callpropvoid', 'callproplex'):
                vals = [stack.pop() for _ in range(a[1])][::-1]
                obj = stack.pop()
                result = _lookup(obj, self.name(a[0]))(*vals)
                if op != 'callpropvoid':
                    stack.append(result)
            elif op == 'constructprop':
                vals = [stack.pop() for _ in range(a[1])][::-1]
                obj = stack.pop()
                cls = obj if isinstance(obj, Cls) else _lookup(obj, self.name(a[0]))
                stack.append(cls.ctor(*vals))
            elif op == 'construct':
                vals = [stack.pop() for _ in range(a[0])][::-1]
                cls = stack.pop()
                stack.append(cls.ctor(*vals))
            elif op == 'call':
                vals = [stack.pop() for _ in range(a[0])][::-1]
                _receiver, fn = stack.pop(), stack.pop()
                stack.append(fn(*vals))
            elif op == 'newarray':
                vals = [stack.pop() for _ in range(a[0])][::-1]
                stack.append(vals)
            elif op == 'newobject':
                obj = {}
                for _ in range(a[0]):
                    value, key = stack.pop(), stack.pop()
                    obj[key] = value
                stack.append(obj)
            elif op in ('add', 'subtract', 'multiply', 'divide', 'modulo'):
                b, c = stack.pop(), stack.pop()
                if op == 'add' and (isinstance(b, str) or isinstance(c, str)):
                    stack.append(str(c) + str(b))
                else:
                    c, b = float(c), float(b)
                    stack.append({'add': c + b, 'subtract': c - b, 'multiply': c * b,
                                  'divide': (c / b) if b else math.copysign(math.inf, c) if c else math.nan,
                                  'modulo': math.fmod(c, b) if b else math.nan}[op])
            elif op in ('add_i', 'subtract_i', 'multiply_i'):
                b, c = _to_int(stack.pop()), _to_int(stack.pop())
                stack.append(_i32({'add_i': c + b, 'subtract_i': c - b, 'multiply_i': c * b}[op]))
            elif op in ('increment_i', 'decrement_i'):
                stack.append(_i32(_to_int(stack.pop()) + (1 if op == 'increment_i' else -1)))
            elif op in ('increment', 'decrement'):
                stack.append(float(stack.pop()) + (1 if op == 'increment' else -1))
            elif op in ('negate', 'negate_i'):
                value = stack.pop()
                stack.append(-_to_int(value) if op == 'negate_i' else -float(value))
            elif op in ('bitand', 'bitor', 'bitxor', 'lshift', 'rshift'):
                b, c = _to_int(stack.pop()), _to_int(stack.pop())
                stack.append(_i32({'bitand': c & b, 'bitor': c | b, 'bitxor': c ^ b,
                                   'lshift': c << (b & 31), 'rshift': c >> (b & 31)}[op]))
            elif op == 'bitnot':
                stack.append(_i32(~_to_int(stack.pop())))
            elif op in ('equals', 'strictequals', 'lessthan', 'lessequals', 'greaterthan', 'greaterequals'):
                b, c = stack.pop(), stack.pop()
                stack.append({'equals': lambda: _loose_eq(c, b), 'strictequals': lambda: _strict_eq(c, b),
                              'lessthan': lambda: c < b, 'lessequals': lambda: c <= b,
                              'greaterthan': lambda: c > b, 'greaterequals': lambda: c >= b}[op]())
            elif op == 'not':
                stack.append(not _truthy(stack.pop()))
            elif op in ('iftrue', 'iffalse'):
                if _truthy(stack.pop()) == (op == 'iftrue'):
                    pc = x.target
            elif op in ('ifeq', 'ifne', 'iflt', 'ifle', 'ifgt', 'ifge', 'ifstricteq', 'ifstrictne',
                        'ifnlt', 'ifnle', 'ifngt', 'ifnge'):
                b, c = stack.pop(), stack.pop()
                ok = {'ifeq': lambda: _loose_eq(c, b), 'ifne': lambda: not _loose_eq(c, b),
                      'iflt': lambda: c < b, 'ifle': lambda: c <= b, 'ifgt': lambda: c > b,
                      'ifge': lambda: c >= b, 'ifstricteq': lambda: _strict_eq(c, b),
                      'ifstrictne': lambda: not _strict_eq(c, b), 'ifnlt': lambda: not c < b,
                      'ifnle': lambda: not c <= b, 'ifngt': lambda: not c > b,
                      'ifnge': lambda: not c >= b}[op]()
                if ok:
                    pc = x.target
            elif op == 'jump':
                pc = x.target
            elif op == 'lookupswitch':
                index = _to_int(stack.pop())
                pc = x.cases[index] if 0 <= index < len(x.cases) else x.default
            elif op == 'returnvalue':
                return stack.pop()
            elif op == 'returnvoid':
                return None
            elif op == 'throw':
                raise AvmThrow(stack.pop())
            else:
                raise AssertionError('unsupported instruction: ' + op)


def slice_method(instructions, start, end, epilogue):
    """复制 [start, end) 为独立指令表；跳到 end 的分支改指向追加的 epilogue。

    切片内若有分支跳出 [start, end]，说明锚点选错，直接报错。
    """
    code = copy.deepcopy(instructions[start:end])

    def rebase(target):
        if not start <= target <= end:
            raise AssertionError(f'branch leaves the slice: {target} not in [{start}, {end}]')
        return target - start

    for ins in code:
        if ins.target is not None:
            ins.target = rebase(ins.target)
        if ins.cases is not None:
            ins.default = rebase(ins.default)
            ins.cases = [rebase(t) for t in ins.cases]
    return code + list(epilogue)
