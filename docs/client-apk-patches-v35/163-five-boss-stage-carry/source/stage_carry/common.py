"""Small assembly helpers; property names always resolve to exact QNames."""
BCD = 'pinball.common.data.battle.restore::BattleContinuationData'
SLOT = 'pinball.scene.battle.battle.condition::ConditionSlot'
COND = 'pinball.common.data.character.condition::Condition'
SQUAD = 'pinball.scene.battle.battle.squad::SquadImpl'
STRINGMAP = 'haxe.ds::StringMap'


class Code:
    def __init__(self, editor):
        self.e = editor
        # Native public runtime-name multiname (used by the locked input).
        candidates = [i for i, m in enumerate(editor.abc.multinames)
                      if m and m[0] == 0x1b and tuple(editor.abc.ns_sets[m[1]]) == (editor.abc.multinames[editor.q('index')][1],)]
        if len(candidates) != 1:
            raise ValueError(('ambiguous public runtime property', candidates))
        self.dynamic = candidates[0]

    def q(self, name):
        return self.e.q(name)

    def get(self, name):
        return ('getproperty', self.q(name))

    def put(self, name):
        return ('setproperty', self.q(name))

    def call(self, name, argc=0):
        return ('callproperty', self.q(name), argc)

    def void(self, name, argc=0):
        return ('callpropvoid', self.q(name), argc)

    def at(self, index):
        return [self.e.number(index), ('getproperty', self.dynamic)]

    def helper(self, name, argc=0, void=False):
        return ('callpropvoid' if void else 'callproperty', self.e.newq(name), argc)

    def add(self, cls, name, returns, args, code, locals_, static=False):
        encoded = []
        for instruction in code:
            encoded.append(instruction)
            if instruction[0] == 'label':
                encoded.append(('avm_label',))
        return self.e.add_method(cls, name, returns, args, encoded, locals_, static)
