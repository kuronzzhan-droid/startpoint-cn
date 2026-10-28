"""小型指令构造器；不编译AS、不重写原方法。"""
BATTLE = 'pinball.scene.battle.battle::Battle'


def local(index):
    return [('getlocal', index)]


class Ops:
    def __init__(self, editor):
        self.e = editor
        self.runtime = next(i for i, row in enumerate(editor.abc.multinames)
                            if row[0] == 0x1B)

    def q(self, name):
        return self.e.newq(name)

    def num(self, value):
        return [self.e.number(value)]

    def string(self, value):
        return [self.e.string(value)]

    def get(self, target, *names):
        code = list(target)
        for name in names:
            code.append(('getproperty', self.q(name)))
        return code

    def set(self, target, name, value):
        return list(target) + list(value) + [('setproperty', self.q(name))]

    def index(self, target, index):
        return list(target) + list(index) + [('getproperty', self.runtime)]

    def put(self, target, index, value):
        return list(target) + list(index) + list(value) + [('setproperty', self.runtime)]

    def call(self, target, name, *args, void=False):
        code = list(target)
        for arg in args:
            code.extend(arg)
        return code + [('callpropvoid' if void else 'callproperty', self.q(name), len(args))]

    def static(self, name, *args, void=False):
        return self.call([('getlex', self.e.q(BATTLE))], name, *args, void=void)

    def object(self, fields):
        code = []
        for key, value in fields.items():
            code.extend(self.string(key))
            code.extend(value)
        return code + [('newobject', len(fields))]

    def slot(self, name):
        return self.get([('getlex', self.e.q(BATTLE))], name)

    def slot_set(self, name, value):
        return self.set([('getlex', self.e.q(BATTLE))], name, value)


NULL = [('pushnull',)]
TRUE = [('pushtrue',)]
FALSE = [('pushfalse',)]
ARRAY = [('newarray', 0)]
OBJECT = [('newobject', 0)]
PROLOGUE = [('getlocal_0',), ('pushscope',)]
