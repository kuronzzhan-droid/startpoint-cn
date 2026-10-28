"""Reroll page layout using only existing nodes, fonts and managed thumbnails."""
import asm
from c1_lookup import number
from c2_common import context, get, set_, DYNAMIC, queue
from c2_page_view import panel, ui

BUTTON_TEXT = 'c8-reroll-label'


def prop(e, source, name, value):
    return [*source, *value, ('setproperty', e.q(name))]


def local_geometry(e, first, with_label=False):
    ctx, node, text = first, first+1, first+2
    g = lambda n: ('getlocal', n)
    n = lambda v: number(e, v)
    q = e.q
    code = context(e, ctx, 'c8_geometry_done')
    code += panel(e) + [('setlocal', node)]
    # These anonymous images are locked against the existing asset's depth order.
    code += [g(node), n(2), ('callproperty', q('getChildAt'), 1),
             ('pushfalse',), ('setproperty', q('visible'))]
    code += [g(node), n(0), ('callproperty', q('getChildAt'), 1),
             n(720), ('setproperty', q('height'))]
    code += ui(e, [g(node)], ['select_item_table']) + [('pushfalse',), ('setproperty', q('visible'))]
    code += panel(e, 'character_name') + [('setlocal', text)]
    code += prop(e, [g(text)], 'x', [n(136)])
    code += [g(text), n(550), ('callpropvoid', q('set_textWidth'), 1),
             g(text), ('pushtrue',), ('callpropvoid', q('set_autoScale'), 1)]
    code += panel(e, 'label_item_select') + [('setlocal', text)]
    code += prop(e, [g(text)], 'x', [n(26)]) + prop(e, [g(text)], 'y', [n(630)])
    code += [g(text), n(665), ('callpropvoid', q('set_textWidth'), 1),
             g(text), ('pushtrue',), ('callpropvoid', q('set_autoScale'), 1),
             g(text), ('getproperty', q('rawTextField')), ('pushfalse',), ('setproperty', q('wordWrap')),
             g(text), ('callproperty', q('get_format'), 0), n(30), ('setproperty', q('size'))]
    code += [('getlocal_0',), ('getproperty', q('exBoostButton')), ('setlocal', node)]
    code += prop(e, [g(node)], 'x', [n(390)]) + prop(e, [g(node)], 'y', [n(1160)])
    code += ui(e, [g(node)], ['inner']) + [('setlocal', node)]
    code += [g(node), n(2), ('callproperty', q('getChildAt'), 1),
             ('pushfalse',), ('setproperty', q('visible'))]
    if with_label:
        code += [('getlex', q('starling.text::TextField')), n(216), n(74), e.string('重抽'),
                 ('getlex', q('starling.text::TextFormat')), ('getlex', q('pinball.font::Fonts')),
                 ('callproperty', q('get_defaultFont'), 0), ('getproperty', q('fontName')),
                 n(48), n(0xFFFFFF), ('construct', 3), ('construct', 4), ('setlocal', text)]
        code += prop(e, [g(text)], 'name', [e.string(BUTTON_TEXT)])
        code += prop(e, [g(text)], 'x', [n(108), ('negate_i',)])
        code += prop(e, [g(text)], 'y', [n(42)])
        code += prop(e, [g(text)], 'touchable', [('pushfalse',)])
        code += prop(e, [g(text)], 'autoScale', [('pushtrue',)])
        code += prop(e, [g(text)], 'wordWrap', [('pushfalse',)])
        code += [g(text), ('getproperty', q('format')), e.string('center'),
                 ('setproperty', q('horizontalAlign'))]
        code += [g(node), g(text), ('callpropvoid', q('addChild'), 1)]
    code += ui(e, [('getlocal_0',), ('getproperty', q('uiLayout'))], ['bottom_center','mana_board_button'])
    code += [('setlocal', node)] + prop(e, [g(node)], 'y', [n(1235)])
    code += [('label', 'c8_geometry_done')]
    return code


def refresh_image(e, first):
    ctx, thumb = first, first+1
    return context(e, ctx, 'c8_image_done') + [
        ('getlocal', ctx), *get(e, 'c8_thumbnail'), ('setlocal', thumb),
        ('getlocal', thumb), ('iffalse', 'c8_image_done'), ('getlocal', thumb),
        ('getlocal_1',), *get(e, 'weaponImage'), number(e, 5),
        ('callpropvoid', e.q('replace'), 2), ('label', 'c8_image_done')]


def queue_page(e):
    result = {}
    label = 'ExBoostWindowView/setupButtons'
    ops = asm.decode(e.body(label)[5])
    first = e.body(label)[2]
    thumb = next(i for i,o in enumerate(ops) if o.name == 'getlex'
                 and e.abc.mn_name(o.args[0]) == 'pinball.ui.component.item::ItemThumbnailView')
    assert ops[thumb+2].name == 'getproperty' and e.abc.mn_name(ops[thumb+2].args[0]) == 'characterSelectButtonContainer'
    result[label] = {'parent': queue(e, label, [('pop',), *panel(e)], thumb+3)}
    assigned = next(i for i in range(thumb, len(ops)) if ops[i].name == 'setlocal')
    thumb_local = ops[assigned].args[0]
    # C2's context is the first free local before the thumbnail's info and image.
    ctx_local = thumb_local-2
    code = [('getlocal', ctx_local), *set_(e, 'c8_thumbnail', [('getlocal', thumb_local)])]
    result[label]['reference'] = queue(e, label, code, assigned+1)
    end_scale = next(i for i in range(assigned, len(ops)) if ops[i].name == 'callpropvoid'
                     and e.abc.mn_name(ops[i].args[0]) == 'set_scale')
    code=[]
    for method,value in [('set_x',74), ('set_y',72)]:
        code += [('getlocal',thumb_local),number(e,value),('callpropvoid',e.q(method),1)]
    code += [('getlocal',thumb_local),number(e,1),number(e,2),('divide',),('callpropvoid',e.q('set_scale'),1)]
    # C2's ordinary-context failure jumps to the instruction immediately after
    # the Riven set_scale. That incoming edge must bypass this Riven-only block;
    # only the successful thumbnail-construction fallthrough may enter it.
    result[label]['thumbnail_geometry'] = queue(e,label,code,end_scale+1,asm.SKIP)
    # Compact the destructive control to a two-character label.
    words=[i for i,o in enumerate(ops) if o.name=='pushstring' and e.abc.s(o.args[0])=='分解裂罅']
    assert len(words)==1
    result[label]['dismantle_label'] = queue(e,label,[('pop',),e.string('分解')],words[0]+1,asm.SKIP)
    result[label]['geometry'] = queue(e,label,local_geometry(e,first,True),len(ops)-1)
    label='ExBoostWindowView/draw'
    result[label] = queue(e,label,local_geometry(e,e.body(label)[2]),len(asm.decode(e.body(label)[5]))-1)
    label='ExBoostWindowView/onApplyExBoostInformation'
    result[label] = {'image':queue(e,label,refresh_image(e,e.body(label)[2]))}
    # Replace only the active C2 string values; inherited bytes remain reversible.
    for label in ('ExBoostWindowView/onApplyExBoostInformation','ExBoostWindowView/setupExBoostInformationWindow'):
        ops=asm.decode(e.body(label)[5]); changes=[]
        for old,new in [('下次费用：','本次费用 '),(' 深渊币\u3000余额：',' 深渊币（持有 ')]:
            hits=[i for i,o in enumerate(ops) if o.name=='pushstring' and e.abc.s(o.args[0])==old]
            assert len(hits)==1,(label,old,hits)
            changes.append(queue(e,label,[('pop',),e.string(new)],hits[0]+1,asm.SKIP))
        start=next(i for i,o in enumerate(ops) if o.name=='pushstring' and e.abc.s(o.args[0])=='下次费用：')
        end=next(i for i in range(start,len(ops)) if ops[i].name=='callpropvoid'
                 and e.abc.mn_name(ops[i].args[0])=='set_text')
        changes.append(queue(e,label,[e.string('）'),('add',)],end))
        result.setdefault(label,{})['fee']=changes
    return result
