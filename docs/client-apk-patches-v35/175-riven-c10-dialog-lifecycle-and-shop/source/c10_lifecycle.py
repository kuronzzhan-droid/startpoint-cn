"""Register C9's lock button through GeneralDialog's original constructor IDs.

bookChild does not initialize the child immediately.  During GeneralDialog's
preparation its new ButtonGroupLogic still has a Create-phase Gear, so append
raises G2007.  The existing native constructor/prepare path owns registration.
"""
import asm
from c1_lookup import number
from c2_common import queue
from c9_actions_lock import metadata, BUTTON


def queue_lifecycle(e):
    label = 'GeneralDialog/preparation'
    body = e.body(label)
    ops = asm.decode(body[5])
    ctor = [i for i, o in enumerate(ops) if o.name == 'constructprop'
            and e.abc.mn_name(o.args[0]).endswith('::ButtonGroupLogic')]
    assert len(ctor) == 1
    at = ctor[0] - 6
    assert ops[at].name == 'findproperty' and e.abc.mn_name(ops[at].args[0]) == 'buttonGroup'
    assert ops[ctor[0] - 1].name == 'getlocal' and ops[ctor[0] - 1].args == [4]
    additions = metadata(e, body[2], 'c10_lock_ids_done') + [
        ('getlocal', 4), number(e, BUTTON),
        ('callpropvoid', e.q('http://adobe.com/AS3/2006/builtin::push'), 1),
        ('label', 'c10_lock_ids_done')]
    early = queue(e, label, additions, at)
    # C9's append is the final side effect.  Preserve its bytes for reversal;
    # return before the entire obsolete metadata/append suffix.
    append = [i for i, o in enumerate(ops) if o.name == 'callpropvoid'
              and e.abc.mn_name(o.args[0]) == 'append']
    assert append == [len(ops) - 2] and ops[-1].name == 'returnvoid'
    suffix = append[0] - 29
    assert suffix == 2142
    assert ops[suffix].name == 'getlocal_0'
    assert ops[suffix + 1].name == 'getproperty' and e.abc.mn_name(ops[suffix + 1].args[0]) == 'contents'
    late = queue(e, label, [('returnvoid',)], suffix)
    return {'method': label, 'constructor_ids': early, 'skip_obsolete_append': late,
            'button_id': BUTTON, 'new_methods': 0, 'new_traits': 0,
            'root_cause': 'C9 lock append runs while booked ButtonGroupLogic Gear is still Create',
            'weapon_entry': 'C9 SingleButton already enters the original constructor ID list',
            'reroll_entry': 'existing buttonLayoutKind follows the original constructor ID list'}
