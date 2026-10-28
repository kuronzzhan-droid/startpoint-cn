"""指纹传输助手的指令生成小工具；不包含游戏逻辑。"""
BATTLE = 'pinball.scene.battle.battle::Battle'


class Emit:
    def __init__(self, editor):
        self.e = editor
        self.cache = {}

    def q(self, name):
        if name not in self.cache:
            try:
                self.cache[name] = self.e.q(name)
            except Exception:
                self.cache[name] = self.e.newq(name)
        return self.cache[name]

    def l(self, index):
        return [('getlocal', index)]

    def n(self, value):
        return [self.e.number(value)]

    def s(self, value):
        return [self.e.string(value)]

    def g(self, local, name):
        return self.l(local) + [('getproperty', self.q(name))]

    def set(self, local, name, expr):
        return self.l(local) + expr + [('setproperty', self.q(name))]

    def call(self, local, name, *args, void=False):
        return self.l(local) + sum(args, []) + [
            ('callpropvoid' if void else 'callproperty', self.q(name), len(args))]

    def static(self, name, *args, void=False):
        return [('getlex', self.q(BATTLE))] + sum(args, []) + [
            ('callpropvoid' if void else 'callproperty', self.q(name), len(args))]

    def obj(self, fields):
        return sum((self.s(k) + v for k, v in fields.items()), []) + [('newobject', len(fields))]

    def arr(self, *values):
        return sum(values, []) + [('newarray', len(values))]

    def json(self, expr):
        return [('getlex', self.q('JSON'))] + expr + [('callproperty', self.q('stringify'), 1)]

    def guard(self, done='DONE'):
        return [('getlex', self.q(BATTLE)), ('getproperty', self.q('wfxFpEnabled')),
                ('iffalse', done)]

    def add(self, name, returns, args, body, locals_, exceptions=None):
        labelled = []
        for item in body:
            labelled.append(item)
            if item[0] == 'label':
                labelled.append(('avm_label',))
        return self.e.add_method(BATTLE, name, returns, args,
            [('getlocal_0',), ('pushscope',)] + labelled, locals_, static=True,
            exceptions=exceptions)

    def runtime(self):
        return next(i for i, row in enumerate(self.e.abc.multinames) if row[0] == 0x1B)

    def at(self, local, index):
        return self.l(local) + index + [('getproperty', self.runtime())]


NULL = [('pushnull',)]
TRUE = [('pushtrue',)]
FALSE = [('pushfalse',)]
EMPTY = [('newarray', 0)]
