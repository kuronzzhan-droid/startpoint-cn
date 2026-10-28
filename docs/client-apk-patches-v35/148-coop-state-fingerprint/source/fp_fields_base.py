"""指纹字段生成的短指令构件；只解析当前 ABC trait，不依赖旧偏移。"""
from pathlib import Path
import json

BATTLE = 'pinball.scene.battle.battle::Battle'


class Gen:
    def __init__(self, editor):
        self.e, self.audit, self.helpers = editor, [], {}
        self.classes = {editor.abc.mn_name(r[0]).split('::')[-1]: editor.abc.mn_name(r[0])
                        for r in editor.abc.instances}
        ns = editor.abc.multinames[editor.q('index')][1]
        sets = editor.abc.ns_sets
        if (ns,) not in sets:
            sets.append((ns,))
        runtime = (0x1B, sets.index((ns,)))
        if runtime not in editor.abc.multinames:
            editor.abc.multinames.append(runtime)
        self.rt = editor.abc.multinames.index(runtime)

    def cls(self, short):
        return self.classes.get(short, short)

    def q(self, name):
        try:
            return self.e.q(name)
        except Exception:
            return self.e.newq(name)

    def field(self, owner, name):
        """精确 class trait；继承查找；拒绝把 getter 当槽。"""
        owner = self.cls(owner)
        original = owner
        while owner:
            _, row = self.e.instance(owner)
            hits = [t for t in row[6] if self.e.abc.mn_name(t.name).split('::')[-1] == name]
            if hits:
                if len(hits) != 1 or hits[0].data[0] != 'slot':
                    raise ValueError(f'not an unambiguous raw slot: {owner}.{name}')
                t = hits[0]
                info = dict(owner=owner, requestedOwner=original, name=name, multiname=t.name,
                            namespace=list(self.e.abc.multinames[t.name]),
                            type=self.e.abc.mn_name(t.data[2]) if t.data[2] else '*')
                if info not in self.audit:
                    self.audit.append(info)
                return t.name
            owner = self.e.abc.mn_name(row[1]) if row[1] else None
        raise ValueError(f'missing raw slot: {original}.{name}')

    def method(self, owner, name, returns, args, code, locals_):
        code = sum(([x, ('avm_label',)] if x[0] == 'label' else [x] for x in code), [])
        q = self.e.add_method(self.cls(owner), name, returns, args, code, locals_, static=True)
        self.helpers[name] = q
        return q

    def s(self, value): return [self.e.string(value)]
    def n(self, value): return [self.e.number(value)]
    def l(self, index): return [('getlocal', index)]
    def lex(self, name): return [('getlex', self.e.q(self.cls(name)))]
    def p(self, value, owner, name): return value + [('getproperty', self.field(owner, name))]
    def raw(self, value, name): return value + [('getproperty', self.q(name))]
    def at(self, value, key): return value + key + [('getproperty', self.rt)]
    def call(self, name, *args):
        return self.lex('Battle') + sum(args, []) + [('callproperty', self.q(name), len(args))]
    def f64(self, value): return self.call('wfxFpF64', value)
    def ptr(self, value): return self.call('wfxFpPointer', value)
    def add(self, *values):
        return values[0] + sum((v + [('add',)] for v in values[1:]), [])
    def obj(self, fields):
        return sum((self.s(k) + v for k, v in fields.items()), []) + [('newobject', len(fields))]
    def arr(self, items): return sum(items, []) + [('newarray', len(items))]
    def enum(self, value, unsupported, path):
        return self.call('wfxFpEnum', value, unsupported, path)
    def set(self, target, key, value):
        return target + key + value + [('setproperty', self.rt)]
    def push(self, target, value):
        return target + value + [('callpropvoid', self.q('push'), 1)]
    def unsupported(self, arr, path, reason):
        return self.push(arr, self.obj({'path': path, 'reason': self.s(reason)}))
    def save_audit(self):
        root = Path(__file__).resolve().parent
        (root / 'field-slots-audit.json').write_text(json.dumps({
            'source': str(self.e.swf.path) if hasattr(self.e.swf, 'path') else 'current editor ABC',
            'note': '仅按当前ABC精确slot trait生成裸读取；未调用随机或状态修改getter',
            'slots': self.audit, 'helpers': self.helpers}, ensure_ascii=False, indent=2), encoding='utf-8')


NULL = [('pushnull',)]
TRUE = [('pushtrue',)]
FALSE = [('pushfalse',)]
START = [('getlocal_0',), ('pushscope',)]
