"""Exact ABC symbols and small AVM2 assembly helpers."""
import asm

OWNER = 'pinball.dialog.continueDialog::Continue2Dialog'
CAS = 'pinball.master.generated::CustomAbilityStringTable'
ITEM = 'pinball.master.generated::ItemTable'
MASTER = 'pinball.master.runtime:MasterMap::'
ASSET = 'pinball.asset.logic:ILogicAssetContainer::'

class Code:
    def __init__(self, editor):
        self.e = editor
        self.q = self.symbol
        self.m = next(i for i, row in enumerate(editor.abc.multinames) if row and row[0] == 0x1b)

    def symbol(self, name):
        found = [i for i in range(1, len(self.e.abc.multinames))
                 if self.e.abc.multinames[i][0] == 7 and self.e.abc.mn_name(i) == name]
        if not found and name in ('itemName', 'thumbnail', 'item_id', 'amount', 'before', 'after'):
            return self.e.newq(name)
        if len(found) != 1:
            raise asm.AsmError(f'ambiguous/missing symbol {name}: {found}')
        return found[0]

    def p(self, name):
        return ('getproperty', self.q(name))

    def lex(self, name):
        return ('getlex', self.q(name))

    def call(self, name, count=0, void=False):
        return ('callpropvoid' if void else 'callproperty', self.q(name), count)

    def text(self, value):
        return self.e.string(value)

    def helper(self, name, count=0, void=False):
        return ('callpropvoid' if void else 'callproperty', self.e.newq(name), count)

    def add(self, name, returns, args, code, locals_):
        return self.e.add_method(OWNER, name, returns, args, code, locals_, static=True)

    def cost(self, quest_property, scene=False):
        code = [self.lex(OWNER), ('getlocal_0',), self.p('globalLogic'), ('getlocal_0',)]
        if scene:
            code += [self.p('scene')]
        return code + [self.p(quest_property), self.helper('wfxContinueCost', 2)]
