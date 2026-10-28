"""Reflow the native selection dialog before its independent scroll setup."""
import asm
from c1_lookup import number
from c2_common import context, get, queue, DYNAMIC
from c2_page_view import ui
from c2_presentation import title
from c11_icons_emit import quality
from c13_layout_text import g, prop, native_text, quality_html
from c13_layout_controls import field


def geometry(e, first):
    ctx, node, oldh, newh, top, total = range(first, first + 6); q = e.q; n = lambda x: number(e, x)
    code = context(e, ctx, 'c13_dialog_done')
    # Actual detail text has already composed at the final 872px width.
    for field_name, height in [('nowDetailView', oldh), ('newDetailView', newh)]:
        code += [('getlex', q('Math')), n(140), ('getlex', q('Math')), n(460),
                 ('getlocal_0',), ('getproperty', q(field_name)), ('callproperty', q('get_height'), 0),
                 n(64), ('add',), ('callproperty', q('min'), 2), ('callproperty', q('max'), 2), ('setlocal', height)]
    code += [n(410), ('setlocal', top)]
    for name, viewfield, height in [('now_detail', 'nowDetailView', oldh), ('new_detail', 'newDetailView', newh)]:
        code += ui(e, [g(1)], ['content', name]) + [('setlocal', node)]
        code += prop(e, [g(node)], 'x', [n(10)]) + prop(e, [g(node)], 'y', [g(top)])
        code += [g(node), e.string('border'), ('pushnull',), ('callproperty', q('getImage'), 2),
                 g(height), ('setproperty', q('height'))]
        if name == 'new_detail':
            code += [g(node), e.string('orange_border'), ('pushnull',), ('callproperty', q('getImage'), 2),
                     g(height), n(8), ('add',), ('setproperty', q('height'))]
        for key, value in [('set_x', n(32)), ('set_y', n(48))]:
            code += [('getlocal_0',), ('getproperty', q(viewfield)), value, ('callpropvoid', q(key), 1)]
        code += [g(top), g(height), ('add',), n(56), ('add',), ('setlocal', top)]
    code += [g(top), n(168), ('add',), ('setlocal', total), g(4), g(total), ('callpropvoid', q('set_height'), 1),
             g(1), g(total), ('negate',), n(2), ('divide',), ('setproperty', q('y'))]
    for name in ('top_border', 'bottom_border', 'check_box'):
        code += ui(e, [g(1)], ['content', name]) + [('pushfalse',), ('setproperty', q('visible'))]
    code += ui(e, [g(1)], ['content'], 'notice') + [('pushfalse',), ('setproperty', q('visible'))]
    code += ui(e, [g(1)], ['content']) + [n(1), ('callproperty', q('getChildAt'), 1), ('pushfalse',), ('setproperty', q('visible'))]
    return code + [('label', 'c13_dialog_done')]


def heading(e, first, thumbnail_local):
    ctx, node, grade = range(first, first + 3); q=e.q; n=lambda x:number(e,x)
    code=context(e,ctx,'c13_dialog_header_done')
    code+=ui(e,[g(1)],['content'],'dialog_title')+[('setlocal',node)]
    code+=native_text(e,node,[n(10)],[n(2)],[n(936)],[n(68)],44,'center')
    code+=ui(e,[g(1)],['content','character_detail'])+[('setlocal',node)]
    code+=prop(e,[g(node)],'x',[n(478)])+prop(e,[g(node)],'y',[n(168)])
    code+=[g(node),n(0),('callproperty',q('getChildAt'),1),('pushfalse',),('setproperty',q('visible'))]
    code+=[g(thumbnail_local),n(0),('callpropvoid',q('set_x'),1),g(thumbnail_local),n(0),('callpropvoid',q('set_y'),1),
           g(thumbnail_local),n(144),n(168),('divide',),('callpropvoid',q('set_scale'),1)]
    code+=ui(e,[g(1)],['content','character_detail'],'name')+[('setlocal',node)]
    code+=native_text(e,node,[n(450),('negate',)],[n(92)],[n(900)],[n(62)],40,'center')
    from c12_layout_text import fit
    code+=[g(node),('callpropvoid',q('disableHtmlText'),0),*title(e,ctx),('setlocal',grade)]
    code+=fit(e,node,grade,first+3,'c13_dialog_name_fit')
    code+=[g(node),g(grade),('callpropvoid',q('set_text'),1)]
    code+=field(e,ctx,node,'c13_dialog_quality',ui(e,[g(1)],['content','character_detail']),width=900,height=48,size=28)
    code+=prop(e,[g(node)],'x',[n(450),('negate',)])+prop(e,[g(node)],'y',[n(158)])
    code+=prop(e,[g(node)],'isHtmlText',[('pushtrue',)])
    code+=[g(node),*(e.string(quality_html(i)) for i in range(1,6)),('newarray',5),
           *quality(e,[g(ctx),*get(e,'record')],grade,'c13_dialog_quality'),n(1),('subtract_i',),
           ('getproperty',DYNAMIC),('setproperty',q('text')),('label','c13_dialog_header_done')]
    return code


def apply(e):
    label='ExBoostSelectDialogView/run';body=e.body(label);ops=asm.decode(body[5]);result={}
    hits=[i for i,op in enumerate(ops) if op.name=='constructprop' and e.abc.mn_name(op.args[0]).endswith('::ExBoostDetailView')]
    assert len(hits)==2
    for i,at in enumerate(hits):
        code=context(e,body[2]+10,'c13_dialog_width_done_'+str(i))+[('pop',),number(e,872),('label','c13_dialog_width_done_'+str(i))]
        result['width_'+str(i)]=queue(e,label,code,at,asm.SKIP)
    at=next(i for i,op in enumerate(ops) if op.name=='findproperty' and e.abc.mn_name(op.args[0])=='setupNowDetailScrollArea')
    result['geometry']=queue(e,label,geometry(e,body[2]+20),at)
    thumb=next(i for i,op in enumerate(ops) if op.name=='getlex' and e.abc.mn_name(op.args[0]).endswith('::ItemThumbnailView'))
    construct=next(i for i in range(thumb,len(ops)) if ops[i].name=='construct' and ops[i].args==[3])
    assert ops[construct+1].name=='setlocal';local=ops[construct+1].args[0]
    result['heading']=queue(e,label,heading(e,body[2]+30,local),len(ops)-1)
    return {label:result}
