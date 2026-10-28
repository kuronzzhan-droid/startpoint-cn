"""Conflict navigation and existing generic dialog; method-body emitters only."""
from c1_lookup import number
from c2_common import DYNAMIC, OPTION, get, set_, queue
from c2_page_logic import loaded
from c2_transaction import STATUS
from c3_weapon_common import safe_buttons, TOGGLE
import asm

RETURN = 'wfx_riven_return'
MESSAGE = '裂罅已变化，请重试'


def recover_window(e, ctx, first, show_message=True):
    """Called only after processing has closed, or before any request was sent."""
    q = e.q
    state, scene = first, first + 1
    g = lambda n: ('getlocal', n)
    gp = lambda n: ('getproperty', q(n))
    code = [('getlocal_0',), ('callpropvoid', q('unlockForExBoost'), 0),
            ('getlocal_0',), gp('scene'), ('setlocal', scene),
            g(scene), ('callpropvoid', q('unlockGeneralMenu'), 0),
            ('getlocal_0',), ('getlex', q(STATUS)), gp('Neutral'),
            ('setproperty', q('windowStatus')),
            g(ctx), *set_(e, 'c4_conflict', [('pushfalse',)]),
            g(ctx), *set_(e, 'c4_response_remote', [('pushnull',)]),
            g(ctx), *set_(e, 'c4_request_remote', [('pushnull',)]),
            g(ctx), *set_(e, 'c4_request_kind', [('pushnull',)]),
            *loaded(e), ('setlocal', state), g(state),
            *set_(e, RETURN, [e.string('origin'), g(scene),
                e.string('show_message'), ('pushtrue',) if show_message else ('pushfalse',),
                ('newobject', 2)]),
            g(scene), ('getlex', q('pinball.common.data.scene::TransitionKind')),
            ('getlex', q('pinball.common.data.scene::SceneKind')), number(e, 0),
            ('getlex', q(OPTION)), gp('None'), ('callproperty', q('EquipmentList'), 2),
            ('callproperty', q('SimpleOut'), 1), ('callpropvoid', q('changeSceneSimply'), 1)]
    return code


def notice(e, first):
    q = e.q
    state, marker = first, first + 1
    g = lambda n: ('getlocal', n)
    return [*loaded(e), ('setlocal', state), g(state), ('iffalse', 'c4_notice_done'),
            g(state), *get(e, RETURN),
            ('setlocal', marker), g(marker), ('iffalse', 'c4_notice_done'),
            g(marker), *get(e, 'origin'), ('getlocal_0',), ('ifeq', 'c4_notice_done'),
            g(state), *set_(e, RETURN, [('pushnull',)]),
            g(marker), *get(e, 'show_message'), ('iffalse', 'c4_notice_done'),
            ('getlocal_0',), ('getlex', q('pinball.dialog.general::OkDialog')),
            ('getlex', q('pinball.dialog.general::DialogContent')), e.string(MESSAGE),
            ('callproperty', q('DynamicText'), 1), ('newarray', 1),
            ('getlex', q('pinball.common.tools::FunctionTools')),
            ('getproperty', q('emptyFunction1')), ('construct', 2),
            ('callpropvoid', q('openDialog'), 1), ('label', 'c4_notice_done')]


def list_mode(e, first):
    return [*loaded(e), *get(e, RETURN), ('iffalse', 'c4_list_done'),
            ('getlocal_0',), ('getproperty', e.q('filterSetting')),
            *set_(e, 'wfxRiven', [('pushtrue',)]), ('label', 'c4_list_done')]


def queue_ui(e):
    result = {}
    label = 'LogicScene/finishTransition'
    body = e.body(label); ops = asm.decode(body[5])
    assert ops[-1].name == 'returnvoid'
    result[label] = queue(e, label, notice(e, body[2]), len(ops) - 1)
    label = 'EquipmentListScene/run'
    body = e.body(label); ops = asm.decode(body[5])
    result[label] = queue(e, label, list_mode(e, body[2]))
    code = [('getlocal_0',), ('getproperty', e.q('filterSetting')), *get(e, 'wfxRiven'),
            ('iffalse', 'c4_safe_done'), *safe_buttons(e, [('pushfalse',)]),
            ('getlocal_0',), ('getproperty', e.q('buttonGroup')), number(e, TOGGLE),
            ('callproperty', e.q('get'), 1), ('getlex', e.q(OPTION)),
            e.string('裂罅 → 装备'), ('callproperty', e.q('Some'), 1),
            ('setproperty', e.q('labelText')),
            ('label', 'c4_safe_done')]
    assert ops[-1].name == 'returnvoid'
    queue(e, label, code, len(ops) - 1)
    return result
