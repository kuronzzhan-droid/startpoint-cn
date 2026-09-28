"""有限 AVM2 解释器（私有名副本）：执行装备详情文案覆盖前后的真实字节码。

以私有模块名 ``equipment_desc_override_avm_base`` 按路径导入 ``equipment-rules/avm_interp.py``
（**不改它一个字**），复用 ``AvmThrow`` / ``Cls`` / ``slice_method`` 与值语义辅助函数；
``DescInterp`` 继承它的 ``Interp``，指令循环是原循环的副本，只追加本补丁与被覆盖的原生体会走到的部分：

* 内建 String / Array：``split`` / ``join`` / ``push`` / ``sort`` / ``concat`` / ``indexOf`` / ``length``；
* int 键：``IntMap.h[k]`` 的 MultinameL 读写与 ``in`` 保持 int 键（Flash Dictionary 语义）；
* ``newfunction``：闭包执行 ABC 里的真实方法体（原生 IntMap 排序比较器）；
* ``callproperty`` 取到非函数时按 TypeError 报错，不静默。

遇到未支持的指令仍然直接报错，绝不静默跳过。
"""
from __future__ import annotations

import functools
import importlib.util
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE_PATH = HERE.parent / 'equipment-rules' / 'avm_interp.py'
BASE_MODULE = 'equipment_desc_override_avm_base'
ABCASM = HERE.parent / 'abcasm'
if str(ABCASM) not in sys.path:
    sys.path.insert(0, str(ABCASM))

import asm as _asm  # noqa: E402  abcasm/asm.py（只用 decode 解闭包体）


def _load_base():
    if BASE_MODULE in sys.modules:
        return sys.modules[BASE_MODULE]
    spec = importlib.util.spec_from_file_location(BASE_MODULE, BASE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[BASE_MODULE] = module
    spec.loader.exec_module(module)
    return module


base = _load_base()
AvmThrow, Cls, slice_method = base.AvmThrow, base.Cls, base.slice_method
_truthy, _to_int, _i32 = base._truthy, base._to_int, base._i32
_loose_eq, _strict_eq, _type_matches = base._loose_eq, base._strict_eq, base._type_matches
GLOBALS = base.GLOBALS


def short(name):
    return name.split('::')[-1] if isinstance(name, str) else name


def to_string(value):
    """AS3 ``String(v)`` 的子集（``+`` 拼接、convert_s）：null -> "null"。"""
    if value is None:
        return 'null'
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def as_string(value):
    """``Array.join`` 的元素转换：null / undefined -> ""。"""
    return '' if value is None else to_string(value)


def _string_member(obj, name):
    if name == 'split':
        return lambda sep=None: [obj] if sep is None else obj.split(sep)
    if name == 'length':
        return len(obj)
    if name == 'indexOf':
        return lambda needle, start=0: obj.find(needle, int(start))
    raise KeyError(f'String has no member {name}')


def _array_member(obj, name):
    if name == 'length':
        return len(obj)
    if name == 'join':
        return lambda sep=',': as_string(sep).join(as_string(x) for x in obj)
    if name == 'push':
        def push(*values):
            obj.extend(values)
            return len(obj)
        return push
    if name == 'concat':
        def concat(*values):
            out = list(obj)
            for value in values:
                out.extend(value if isinstance(value, list) else [value])
            return out
        return concat
    if name == 'sort':
        def sort(compare=None):
            if compare is None:
                obj.sort(key=as_string)
            else:
                obj.sort(key=functools.cmp_to_key(lambda a, b: (lambda r: (r > 0) - (r < 0))(float(compare(a, b)))))
            return obj
        return sort
    raise KeyError(f'Array has no member {name}')


def lookup(obj, key):
    """属性读取：int 键原样用；String / Array 走内建；其余交给 equipment-rules 的查找规则。"""
    if isinstance(key, bool):
        key = to_string(key)
    if isinstance(key, (int, float)) and not isinstance(key, bool):
        if isinstance(obj, list):
            index = int(key)
            return obj[index] if 0 <= index < len(obj) else None
        if isinstance(obj, dict):
            if key not in obj:
                raise KeyError(f'object has no key {key!r}')
            return obj[key]
        raise KeyError(f'{type(obj).__name__} has no index {key!r}')
    if isinstance(obj, str):
        return _string_member(obj, short(key))
    if isinstance(obj, list):
        name = short(key)
        if name.isdigit():
            index = int(name)
            return obj[index] if index < len(obj) else None
        return _array_member(obj, name)
    return base._lookup(obj, key)


def store(obj, key, value):
    if isinstance(key, (int, float)) and not isinstance(key, bool):
        if isinstance(obj, dict):
            obj[key] = value
            return
        if isinstance(obj, list):
            index = int(key)
            while len(obj) <= index:
                obj.append(None)
            obj[index] = value
            return
    if isinstance(obj, dict):
        obj[short(key)] = value
    else:
        setattr(obj, short(key), value)


def contains(obj, key):
    """AVM2 ``in``：对象有无该属性（IntMap.h 的 int 键按 int 比较）。"""
    if isinstance(obj, dict):
        return key in obj
    if isinstance(obj, list):
        return isinstance(key, int) and 0 <= key < len(obj)
    if isinstance(obj, Cls):
        return key in obj.statics
    raise KeyError(f'in: unsupported object {type(obj).__name__}')


class DescInterp(base.Interp):
    """equipment-rules ``Interp`` 的扩展：``run`` 是其循环的副本 + 上面列出的补充。"""

    def __init__(self, abc, lex=None, max_steps=400000):
        super().__init__(abc, lex, max_steps)
        self._method_bodies = None

    def _runtime_name(self, index, stack):
        kind = self.abc.multinames[index][0]
        if kind in (0x1B, 0x1C):                 # MultinameL / MultinameLA：保留 int 键
            return stack.pop()
        return super()._runtime_name(index, stack)

    def _closure(self, method_index, scopes):
        if self._method_bodies is None:
            self._method_bodies = {body[0]: body for body in self.abc.bodies}
        body = self._method_bodies[method_index]
        code = _asm.decode(body[5])
        captured = list(scopes)

        def closure(*args):
            return self.run(code, [GLOBALS, *args], scopes=captured)
        return closure

    def call(self, fn, args, what):
        if not callable(fn):
            raise AvmThrow({'code': 'TypeError', 'message': f'{what} is not a function'})
        return fn(*args)

    def run(self, ins, args, scopes=None):  # noqa: C901 —— 与原循环保持同一结构，便于逐段对照
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
                stack.append(None if value is None and op == 'coerce_s' else to_string(value))
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
                stack.append(lookup(stack.pop(), key))
            elif op in ('setproperty', 'initproperty'):
                value = stack.pop()
                key = self._runtime_name(a[0], stack)
                store(stack.pop(), key, value)
            elif op == 'getslot':
                stack.append(lookup(stack.pop(), 'slot%d' % a[0]))
            elif op == 'setslot':
                value, obj = stack.pop(), stack.pop()
                obj['slot%d' % a[0]] = value
            elif op in ('callproperty', 'callpropvoid', 'callproplex'):
                vals = [stack.pop() for _ in range(a[1])][::-1]
                obj = stack.pop()
                name = self.name(a[0])
                result = self.call(lookup(obj, name), vals, name)
                if op != 'callpropvoid':
                    stack.append(result)
            elif op == 'constructprop':
                vals = [stack.pop() for _ in range(a[1])][::-1]
                obj = stack.pop()
                cls = obj if isinstance(obj, Cls) else lookup(obj, self.name(a[0]))
                stack.append(cls.ctor(*vals))
            elif op == 'construct':
                vals = [stack.pop() for _ in range(a[0])][::-1]
                cls = stack.pop()
                stack.append(cls.ctor(*vals))
            elif op == 'call':
                vals = [stack.pop() for _ in range(a[0])][::-1]
                _receiver, fn = stack.pop(), stack.pop()
                stack.append(self.call(fn, vals, 'call'))
            elif op == 'newfunction':                            # 追加：真实闭包体
                stack.append(self._closure(a[0], scopes))
            elif op == 'in':                                     # 追加：int 键 in
                obj, key = stack.pop(), stack.pop()
                stack.append(contains(obj, key))
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
                    stack.append(to_string(c) + to_string(b))
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
