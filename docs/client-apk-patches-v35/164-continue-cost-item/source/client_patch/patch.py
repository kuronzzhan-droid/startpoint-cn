"""Explicit allowlist of original method bodies; only reversible insertions."""
import asm
from .common import Code, OWNER
from . import config, ui

GETTERS = ('get_continueVirtualMoney', 'get_beforeVirtualMoney', 'get_afterVirtualMoney')
TARGETS = tuple(f'{cls}/{method}' for cls in ('ContinueDialog', 'Continue2Dialog') for method in GETTERS) + (
    'ContinueDialog/canContinue', 'ContinueDialog/buttonClicked', 'Continue2Dialog/initialize',
    'ContinueDialogView/setupTexts', 'BattleScenePlayingStateImpl/annihilatedDialog2TryAgainSelected',
    'BattleScene/startQuestPlayContinue',
)

def insert_start(e, label, code):
    ins = asm.decode(e.body(label)[5])
    assert [x.name for x in ins[:2]] == ['getlocal_0', 'pushscope'], label
    e.insert(label, 2, code)

def build(e):
    c = Code(e)
    config.build(c)
    ui.build(c)
    for cls in ('ContinueDialog', 'Continue2Dialog'):
        quest = 'questId' if cls == 'ContinueDialog' else 'questIdGroup'
        for method, field in zip(GETTERS, ('amount', 'before', 'after')):
            insert_start(e, f'{cls}/{method}', c.cost(quest) + [
                ('dup',), ('iffalse', 'NATIVE'), c.p(field), ('convert_i',), ('returnvalue',),
                ('label', 'NATIVE'), ('pop',),
            ])
    insert_start(e, 'ContinueDialog/canContinue', c.cost('questId') + [
        ('dup',), ('iffalse', 'NATIVE'), c.p('after'), ('pushbyte', 0), ('greaterequals',),
        ('returnvalue',), ('label', 'NATIVE'), ('pop',),
    ])
    # Only replace the native shortage-stone message when this is the continue
    # button on an item-configured quest; retire/legal buttons stay native.
    insert_start(e, 'ContinueDialog/buttonClicked', [
        ('getlocal_1',), ('pushbyte', 0), ('ifne', 'NATIVE'),
        *c.cost('questId'), ('setlocal_3',), ('getlocal_3',), ('iffalse', 'NATIVE'),
        ('getlocal_3',), c.p('after'), ('pushbyte', 0), ('ifge', 'NATIVE'),
        ('getlocal_0',), c.p('logicScene'), ('getlocal_3',), c.p('itemName'),
        c.text('数量不足'), ('add',),
        c.lex('pinball.context.scene.instantMessage::InstantMessagePosition'), c.p('Center'),
        c.call('showInstantMessage', 2, void=True), ('returnvoid',), ('label', 'NATIVE'),
    ])
    insert_start(e, 'Continue2Dialog/initialize', c.cost('questIdGroup') + [
        ('setlocal', 4), ('getlocal', 4), ('iffalse', 'NATIVE'),
        ('getlocal_0',), c.lex(OWNER), ('getlocal', 4), c.helper('wfxContinueContents', 1),
        ('setproperty', c.q('contents')), ('returnvoid',), ('label', 'NATIVE'),
    ])
    label = 'ContinueDialogView/setupTexts'
    ins = asm.decode(e.body(label)[5])
    returns = [i for i, x in enumerate(ins) if x.name == 'returnvoid']
    assert returns == [len(ins)-1]
    e.insert(label, returns[0], [c.lex(OWNER), ('getlocal_0',), c.helper('wfxContinueView', 1, void=True)])
    insert_start(e, 'BattleScenePlayingStateImpl/annihilatedDialog2TryAgainSelected', c.cost('questId', scene=True) + [
        ('dup',), ('iffalse', 'NATIVE'), c.p('after'), ('pushbyte', 0), ('iflt', 'SHORT'),
        ('getlocal_0',), c.call('startQuestPlayContinue', void=True), ('returnvoid',),
        ('label', 'SHORT'), ('getlocal_0',), c.call('openAnnihilatedDialog', void=True), ('returnvoid',),
        ('label', 'NATIVE'), ('pop',),
    ])
    # The server consumes this ordinal as the idempotency identity. The native
    # successful-continue counter survives resume and advances after success.
    label = 'BattleScene/startQuestPlayContinue'
    ins = asm.decode(e.body(label)[5])
    at = [i+1 for i, x in enumerate(ins) if x.name == 'setlocal_3']
    assert len(at) == 1 and ins[at[0]-4].name == 'callproperty'
    assert e.abc.mn_name(ins[at[0]-4].args[0]) == 'getStatistics'
    e.insert(label, at[0], c.cost('questId') + [
        ('iffalse', 'NATIVE'), ('getlocal_3',), ('getlocal_0',), c.p('myBattle'),
        c.p('continueCounter'), c.call('getCurrentContinueCount'),
        ('setproperty', e.newq('wfx_continue_count')), ('label', 'NATIVE'),
    ])
    # Haxe emits an unreachable jump after canContinue's return, targeting
    # method-end. Preserve that original instruction and append a dead return
    # anchor so the strict structural checker can validate every branch target.
    for label in TARGETS:
        ins = asm.decode(e.body(label)[5])
        if any(x.target == len(ins) for x in ins):
            returns = e.abc.mn_name(e.abc.methods[e.body(label)[0]][0])
            tail = [('returnvoid',)] if returns == 'void' else [('pushfalse',), ('returnvalue',)]
            e.insert(label, len(ins), tail)
    return {
        'configuration': 'custom_ability_string continue_cost_<questId>=<itemId>:<amount>',
        'valid_domain': 'canonical positive decimal int32 for itemId and amount; existing ItemTable key',
        'quest_identity': 'QuestIdBattleKindTools.toAnyQuestId(dialog.questId / questIdGroup / scene.questId)',
        'inventory': 'globalLogic.get_player().getItemNumber(itemId)',
        'synchronization': 'unchanged RealRemoteService.earlySuccessHandler data.item_list dictionary and PlayerLogic.applyCommonResponseItemList',
        'helper_owner': OWNER,
        'no_classes_added': True,
    }
