"""Add the reroll action to an existing soul-detail dialog without new handlers."""
import asm
from c1_lookup import lookup, number
from c2_common import DYNAMIC, MODE, OPTION, queue


def detail_action(e, first):
    q = e.q
    ident, scratch, record, ctx, characters, carrier, transition, callback, close = range(first, first + 9)
    g = lambda n: ('getlocal', n)
    p = lambda n: ('setlocal', n)
    gp = lambda n: ('getproperty', q(n))
    call = lambda n,c: ('callproperty', q(n), c)
    cls = lambda n: ('getlex', q(n))
    bind1 = 'pinball.common.tools._FunctionTools::BindImpl1_0'
    bind2 = 'pinball.common.tools._FunctionTools::BindImpl2_1'
    code = [('getlocal_1',), gp('id'), p(ident)]
    code += lookup(e, ident, scratch, record, 'entry_done')
    code += [('getlocal_0',), gp('globalLogic'), call('get_player', 0),
             call('getCharacterRepository', 0), call('getAllIds', 0), p(characters),
             g(characters), gp('length'), ('iffalse', 'entry_done'),
             g(characters), number(e, 0), ('getproperty', DYNAMIC), ('convert_i',), p(carrier),
             e.string('mode'), e.string(MODE), e.string('item_id'), g(ident),
             e.string('record'), g(record), e.string('status_id'), g(ident), ('negate_i',),
             e.string('ability_id_list'), ('newarray', 0), ('newobject', 5), p(ctx),
             cls('pinball.common.data.scene::TransitionKind'),
             cls('pinball.common.data.scene::SceneKind'), cls(OPTION),
             cls('pinball.scene.expod.state::ExpodSceneStateKind'), g(carrier),
             cls(OPTION), g(ctx), call('Some', 1), call('ExBoost', 2), call('Some', 1),
             cls(OPTION), gp('None'), call('Expod', 2), call('SimpleOut', 1), p(transition),
             cls(bind2), cls('pinball.common.tools::FunctionTools0'), gp('expanded1'),
             cls(bind1), ('getlocal_0',), gp('logicScene'), gp('changeSceneWithPushBackScene'),
             g(transition), ('construct', 2), gp('execute'), ('construct', 2), gp('execute'), p(callback),
             ('getlocal_0',), gp('buttonLayoutKind'), gp('params'), number(e, 1),
             ('getproperty', DYNAMIC), p(close), ('getlocal_0',),
             cls('pinball.dialog.general::DialogButtonLayoutKind'),
             cls('pinball.dialog.general.button::DialogButton'), e.string('重抽'),
             call('PositiveDynamicText', 1), cls('pinball.dialog.general.button::DialogButton'),
             gp('Close'), g(callback), g(close), call('Select', 4),
             ('setproperty', q('buttonLayoutKind')), ('label', 'entry_done')]
    return code


def queue_entry(e):
    label = 'AbilitySoulDetailDialog/initialize'
    body = e.body(label)
    ops = asm.decode(body[5])
    returns = [i for i, op in enumerate(ops) if op.name == 'returnvoid']
    assert len(returns) == 1
    return {label: queue(e, label, detail_action(e, body[2]), returns[0])}
