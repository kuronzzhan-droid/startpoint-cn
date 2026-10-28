"""Native item-table DTOs, selection callbacks and payment consumers."""
import asm
from c2_common import DYNAMIC,OPTION,get,set_,prefix,queue
from c2_page_logic import STATE,ORDER
from c2_transaction import refresh
from c17_cost_common import g,p,n,context,current,resolve


def items(e,first):
    code,ctx,record,opts,pair,selected=current(e,first,'c17_items');q=e.q
    out,index,item,count=range(first+7,first+11)
    code += [('newarray',0),p(out),*n(e,0),p(index),('label','c17_items_loop'),('avm_label',),
        g(index),g(opts),('getproperty',q('length')),('ifge','c17_items_done'),g(opts),g(index),('getproperty',DYNAMIC),p(pair),
        ('getlocal_0',),('getproperty',q('globalLogic')),g(pair),*n(e,0),('getproperty',DYNAMIC),('callproperty',q('getItem'),1),p(item),
        ('getlocal_0',),('getproperty',q('player')),g(pair),*n(e,0),('getproperty',DYNAMIC),('callproperty',q('getItemNumber'),1),p(count),
        g(out),e.string('itemId'),g(pair),*n(e,0),('getproperty',DYNAMIC),e.string('kind'),
        ('getlex',q('pinball.ui.component.item::ItemThumbnailKind')),g(item),('callproperty',q('get_thumbnailId'),0),
        g(item),('callproperty',q('get_rarity'),0),('callproperty',q('Item'),2),e.string('number'),('getlex',q(OPTION)),
        g(count),('callproperty',q('Some'),1),e.string('isEnable'),g(count),g(pair),*n(e,1),('getproperty',DYNAMIC),
        ('greaterequals',),('newobject',4),('callpropvoid',q('http://adobe.com/AS3/2006/builtin::push'),1),('inclocal_i',index),('jump','c17_items_loop'),
        ('label','c17_items_done'),g(out),('returnvalue',),('label','c17_items_original')]
    return code


def update(e,first):
    code,ctx,record,opts,pair,selected=current(e,first,'c17_update');q=e.q
    index=first+10
    code += [*n(e,0),p(index),('label','c17_buttons_loop'),('avm_label',),g(index),g(opts),('getproperty',q('length')),
        ('ifge','c17_buttons_done'),('getlocal_0',),('getproperty',q('buttonGroup')),*n(e,83886080),g(index),('add_i',),
        ('callproperty',q('exists'),1),('iftrue','c17_buttons_next'),('getlocal_0',),('getproperty',q('buttonGroup')),*n(e,83886080),g(index),('add_i',),
        ('callpropvoid',q('append'),1),('label','c17_buttons_next'),('inclocal_i',index),('jump','c17_buttons_loop'),('label','c17_buttons_done'),
        ('getlocal_0',),('getproperty',q('viewOrder')),('getlex',q(ORDER)),('getlex',q(OPTION)),g(selected),
        ('callproperty',q('Some'),1),('getlocal_0',),('callproperty',q('getExBoostItems'),0),
        ('callproperty',q('UpdateExBoostItems'),2),('callpropvoid',q('notifyCommand'),1),
        ('getlocal_0',),('callpropvoid',q('updateExBoostButtonState'),0)]
    from c8_navigation_view import refresh_arrows
    code += refresh_arrows(e,first+7)
    return code+[('returnvoid',),('label','c17_update_original')]


def clicked(e,first):
    code=context(e,first,'c17_click_original');q=e.q
    code += [('getlocal_1',),*n(e,83886080),('iflt','c17_click_original'),('getlocal_1',),*n(e,100663296),('ifge','c17_click_original'),
        ('getlocal_0',),('getproperty',q('drawResult')),('getproperty',q('index')),*n(e,0),('ifne','c17_click_done'),
        ('getlocal_0',),('getproperty',q('drawResult')),('getproperty',q('params')),*n(e,0),('getproperty',DYNAMIC),g(first),('ifne','c17_click_done'),
        ('getlocal_0',),('getproperty',q('scene')),('getlocal_0',),('getproperty',q('kind')),('callproperty',q('isInputAvailableForStateKind'),1),
        ('iffalse','c17_click_done'),('getlocal_0',),('getproperty',q('scene')),('callproperty',q('isMainLoop'),0),('iffalse','c17_click_done'),
        ('getlocal_0',),('getproperty',q('windowStatus')),('getproperty',q('index')),*n(e,0),('ifne','c17_click_done')]
    more,ctx,record,opts,pair,selected=current(e,first+1,'c17_click');index=first+8
    code += more+[('getlocal_1',),*n(e,83886080),('subtract_i',),p(index),g(index),g(opts),('getproperty',q('length')),('ifge','c17_click_done'),
        g(ctx),*set_(e,'c17_cost_item_id',[g(opts),g(index),('getproperty',DYNAMIC),*n(e,0),('getproperty',DYNAMIC)]),*refresh(e),
        ('label','c17_click_done'),('returnvoid',),('label','c17_click_original')]
    return code


def state(e,first):
    code,ctx,record,opts,pair,selected=current(e,first,'c17_state');q=e.q
    return code+[g(record),*get(e,'pending'),('iftrue','c17_state_unavailable'),
        ('getlocal_0',),('getproperty',q('player')),g(ctx),*get(e,'c17_cost_item_id'),('callproperty',q('getItemNumber'),1),
        g(ctx),*get(e,'c17_cost'),('iflt','c17_state_short'),('getlex',q(STATE)),('getproperty',q('Possible')),('returnvalue',),
        ('label','c17_state_short'),('getlex',q(STATE)),e.string('道具'),('callproperty',q('InsufficientEitherStackOrItem'),1),('returnvalue',),
        ('label','c17_state_unavailable'),('getlex',q(STATE)),('getproperty',q('NotSelectedItem')),('returnvalue',),('label','c17_state_original')]


def apply(e):
    report={}
    for label,fn in [('getExBoostItems',items),('updateExBoostItems',update),('buttonClicked',clicked),('getExBoostState',state)]:
        full='ExBoostWindow/'+label;report[full]=prefix(e,full,fn)
    label='ExBoostWindow/viewInitialized';ops=asm.decode(e.body(label)[5]);at=next(i for i,o in enumerate(ops) if o.name=='returnvoid')
    report[label]=queue(e,label,[('getlocal_0',),('callpropvoid',e.q('updateExBoostItems'),0)],at)
    for label in ('ExBoostWindow/characterExBoost','ExBoostWindow/characterExBoostHandler'):
        body=e.body(label);ops=asm.decode(body[5]);first=body[2]
        code,ctx,*_=current(e,first,'c17_pay')
        if label.endswith('characterExBoostHandler'):
            code += [g(ctx),*get(e,'c17_confirm_item'),('iffalse','c17_confirm_current')]
            for old,new in [('c17_confirm_item','c17_cost_item_id'),('c17_confirm_cost','c17_cost'),('c17_confirm_owner','c17_cost_owner')]:
                code += [g(ctx),*get(e,old),g(ctx),*get(e,new),('ifne','c17_confirm_changed')]
            code += [g(ctx),*get(e,'c17_confirm_revision'),g(ctx),*get(e,'record'),*get(e,'revision'),('ifeq','c17_confirm_current'),
                ('label','c17_confirm_changed'),('getlocal_0',),('getproperty',e.q('scene')),e.string('重铸费用已变化，请重试'),
                ('getlex',e.q('pinball.context.scene.instantMessage::InstantMessagePosition')),('getproperty',e.q('Center')),
                ('callpropvoid',e.q('showInstantMessage'),2),('returnvoid',),('label','c17_confirm_current')]
        queue(e,label,code+[('label','c17_pay_original')])
        sites=[]
        for i,o in enumerate(ops):
            if o.name=='pushint' and e.abc.ints[o.args[0]]==2370099:
                sites.append(queue(e,label,[('pop',),g(ctx),*get(e,'c17_cost_item_id')],i+1,asm.SKIP))
            if o.name=='pushstring' and e.abc.s(o.args[0])=='next_cost':
                assert ops[i+1].name=='getproperty';sites.append(queue(e,label,[('pop',),g(ctx),*get(e,'c17_cost')],i+2,asm.SKIP))
            if o.name=='pushstring' and e.abc.s(o.args[0])=='深渊币不足':
                sites.append(queue(e,label,[('pop',),e.string('道具不足')],i+1,asm.SKIP))
        report[label]=sites
    label='ExBoostDrawRealRemote/<ctor>';ops=asm.decode(e.body(label)[5]);path=next(i for i,o in enumerate(ops) if o.name=='pushstring' and e.abc.s(o.args[0])=='weapon_riven/draw')
    at=next(i for i in range(path,len(ops)) if ops[i].name=='newobject')
    report[label]=queue(e,label,[('dup',),e.string('cost_item_id'),('getlocal',4),('setproperty',DYNAMIC)],at+1)
    return report
