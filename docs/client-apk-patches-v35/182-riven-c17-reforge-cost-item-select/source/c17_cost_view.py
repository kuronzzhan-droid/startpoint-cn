"""Restore the authored EX item grid and selection frame within the Riven page."""
import asm
from c2_common import get,set_,queue
from c2_page_view import panel,ui
from c2_presentation import global_logic,text
from c13_layout_text import native_text
from c17_cost_common import g,p,n,current,context


def geometry(e,first,tag):
    code,ctx,record,opts,pair,selected=current(e,first,tag,fresh=False);q=e.q
    node,h,w,item,size=range(first+7,first+12)
    code += [g(ctx),*get(e,'c13_reforge'),('iffalse',tag+'_original'),
        g(ctx),*get(e,'c13_viewport'),p(h),g(ctx),*get(e,'c13_width'),p(w)]
    code += panel(e)+[*n(e,0),('callproperty',q('getChildAt'),1),p(node),g(node),g(h),*n(e,980),('add',),('setproperty',q('height'))]
    for key in ('c13_dismantle','c13_reforge'):
        code += [g(ctx),*get(e,key),g(h),*n(e,894),('add',),('setproperty',q('y'))]
    # Reuse the official label as the grid heading. The existing managed fee
    # field owns the entire fee line, so its width can adapt to long item names.
    code += panel(e,'label_item_select')+[p(node)]
    code += native_text(e,node,n(e,32),[g(h),*n(e,544),('add',)],[g(w),*n(e,64),('subtract',)],n(e,48),28,'left')
    code += [g(node),('callpropvoid',q('disableHtmlText'),0),g(node),e.string('请选择要使用的道具'),('callpropvoid',q('set_text'),1)]
    code += ui(e,panel(e),['select_item_table'])+[p(node)]
    for key,values in [('visible',[('pushtrue',)]),('x',n(e,32)),('y',[g(h),*n(e,606),('add',)])]:
        code += [g(node),*values,('setproperty',q(key))]
    code += [('getlocal_0',),('getproperty',q('selectItemTableView')),('callproperty',q('get_width'),0),g(w),*n(e,64),('subtract',),
        ('ifeq',tag+'_width_ready'),('getlocal_0',),('getproperty',q('selectItemTableView')),g(w),*n(e,64),('subtract',),
        ('callpropvoid',q('set_width'),1),('label',tag+'_width_ready'),
        *global_logic(e),g(ctx),*get(e,'c17_cost_item_id'),('callproperty',q('getItem'),1),p(item),
        g(ctx),*get(e,'c13_fee_label'),p(node),g(node),*n(e,32),('setproperty',q('x')),
        g(node),g(w),*n(e,64),('subtract',),('setproperty',q('width')),
        g(node),*n(e,64),('setproperty',q('height')),g(node),('pushtrue',),('setproperty',q('wordWrap')),
        g(node),('pushfalse',),('setproperty',q('autoScale')),g(node),('getproperty',q('format')),*n(e,24),('setproperty',q('size')),
        g(node),e.string('本次重铸费用 '),('getlex',q('pinball.common.tools::StringExtended')),g(ctx),*get(e,'c17_cost'),
        ('callproperty',q('commaSeparate'),1),('add',),e.string(' 个 '),('add',),g(item),('callproperty',q('get_name'),0),('add',),
        e.string('（持有 '),('add',),('getlex',q('pinball.common.tools::StringExtended')),*global_logic(e),
        ('callproperty',q('get_player'),0),g(ctx),*get(e,'c17_cost_item_id'),('callproperty',q('getItemNumber'),1),
        ('callproperty',q('commaSeparate'),1),('add',),e.string('）'),('add',),('setproperty',q('text')),
        # Native raw TextField vertical autosize exposes the full wrapped height.
        # Explicit 24..18 sizes allow at most seven compositions; native autoScale
        # stays disabled, and the final field always returns to a fixed 64px box.
        *n(e,24),p(size),g(node),e.string('vertical'),('setproperty',q('autoSize')),
        ('label',tag+'_fee_fit'),('avm_label',),g(node),('getproperty',q('format')),g(size),('setproperty',q('size')),
        g(node),('getproperty',q('textBounds')),('getproperty',q('height')),*n(e,64),('ifle',tag+'_fee_fitted'),
        g(size),*n(e,18),('ifle',tag+'_fee_fitted'),('declocal_i',size),('jump',tag+'_fee_fit'),
        ('label',tag+'_fee_fitted'),g(node),e.string('none'),('setproperty',q('autoSize')),
        g(node),*n(e,64),('setproperty',q('height')),('label',tag+'_original')]
    return code


def setup_grid(e,first,tag):
    code,ctx,record,opts,pair,selected=current(e,first,tag);q=e.q
    return code+[('getlocal_0',),('getproperty',q('selectItemTableView')),('getlocal_0',),('getproperty',q('registerSelectItemButton')),
        ('callpropvoid',q('iterThumbnails'),1),('getlocal_0',),g(selected),('callpropvoid',q('onSelectExBoostItem'),1),
        ('label',tag+'_original')]


def apply(e):
    report={}
    for label in ('ExBoostWindowView/setupButtons','ExBoostWindowView/setupExBoostInformationWindow',
                  'ExBoostWindowView/onApplyExBoostInformation','ExBoostWindowView/draw'):
        body=e.body(label);ops=asm.decode(body[5]);rows=[]
        # All inherited Riven geometry emitters use this viewport subtraction.
        for i,o in enumerate(ops):
            if o.name=='pushint' and e.abc.ints[o.args[0]]==896:
                rows.append(queue(e,label,[('pop',),*n(e,1192)],i+1,asm.SKIP))
            if (o.name=='pushint' and e.abc.ints[o.args[0]]==160 and
                    any(x.name=='getproperty' and e.abc.mn_name(x.args[0])=='safeArea' for x in ops[i+1:i+5])):
                rows.append(queue(e,label,[('pop',),*n(e,80)],i+1,asm.SKIP))
        for i,o in enumerate(ops):
            if o.name!='returnvoid':continue
            code=geometry(e,body[2],f'c17_geometry_{i}')
            if label.endswith('setupButtons'):code += setup_grid(e,body[2]+16,f'c17_register_{i}')
            rows.append(queue(e,label,code,i))
        report[label]=rows
    label='ExBoostWindowView/setupExBoostInformationWindow';body=e.body(label);ops=asm.decode(body[5])
    at=next(i for i,o in enumerate(ops) if o.name=='pushstring' and e.abc.s(o.args[0])=='numRows')+2
    assert ops[at-1].name=='pushbyte' and ops[at-1].args==[2]
    code=context(e,body[2]+24,'c17_grid_rows_done')+[('pop',),*n(e,1),('label','c17_grid_rows_done')]
    report['native_grid_rows']=queue(e,label,code,at,asm.SKIP)
    return report
