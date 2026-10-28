"""Selected payment item confirmation and cost conflict notice."""
import asm
from c2_common import DYNAMIC,MODE,get,set_,queue,prefix
from c2_presentation import global_logic,text
from c2_presentation_dialogs import check_values_mode
from c17_cost_common import g,p,n,current


def values(e,first):
    code,ctx,record,*_=current(e,first,'c17_confirm');item=first+7;q=e.q
    code += [*global_logic(e),g(ctx),*get(e,'c17_cost_item_id'),('callproperty',q('getItem'),1),p(item)]
    for field,value in [('c17_confirm_item',[g(ctx),*get(e,'c17_cost_item_id')]),('c17_confirm_cost',[g(ctx),*get(e,'c17_cost')]),
                       ('c17_confirm_revision',[g(record),*get(e,'revision')]),('c17_confirm_owner',[g(record),*get(e,'riven_id')])]:code += [g(ctx),*set_(e,field,value)]
    for key,value in [('mode',[e.string(MODE)]),('itemThumbnail',[g(item),('callproperty',q('get_thumbnailId'),0)]),
        ('itemRarity',[g(item),('callproperty',q('get_rarity'),0)]),('itemName',[g(item),('callproperty',q('get_name'),0)]),
        ('itemNum',[*global_logic(e),('callproperty',q('get_player'),0),g(ctx),*get(e,'c17_cost_item_id'),('callproperty',q('getItemNumber'),1)]),
        ('itemCostNum',[g(ctx),*get(e,'c17_cost')]),('exAbilityMinNum',n(e,1)),('exAbilityMaxNum',n(e,4)),
        ('roll_count',[g(record),*get(e,'roll_count')])]:code += [e.string(key),*value]
    return code+[('newobject',9),('returnvalue',),('label','c17_confirm_original')]


def view(e,first,tag):
    q=e.q;v=[('getlocal_0',),('getproperty',q('values'))]
    code=check_values_mode(e,tag+'_done')
    code += text(e,1,('content',),'description',[e.string('是否使用 '),*v,*get(e,'itemCostNum'),('add',),
        e.string(' 个'),('add',),*v,*get(e,'itemName'),('add',),e.string('重铸？'),('add',)])
    code += text(e,1,('content',),'label_item',[*v,*get(e,'itemName'),e.string('余额'),('add',)])
    return code+[('label',tag+'_done')]


def apply(e):
    report={};label='ExBoostDrawConfirmDialog/getValuesForView';report[label]=prefix(e,label,values)
    label='ExBoostDrawConfirmDialogView/run';body=e.body(label);ops=asm.decode(body[5])
    report[label]=[queue(e,label,view(e,body[2],f'c17_confirm_view_{i}'),i) for i,o in enumerate(ops) if o.name=='returnvoid']
    # Carry the error reason into the existing return-to-list marker, whose
    # lifetime survives closing the stale window and its global context.
    for label in ('ExBoostWindow/characterExBoostDrawRemoteInput','ExBoostWindow/characterExBoostSelectRemoteInput',
                  'ExBoostWindow/selectDiscardHandler'):
        ops=asm.decode(e.body(label)[5]);sites=[]
        for i,o in enumerate(ops):
            if o.name!='pushstring' or e.abc.s(o.args[0])!='wfx_riven_return':continue
            at=next(j for j in range(i+1,i+15) if ops[j].name=='newobject')
            before=next(j for j in range(i-1,-1,-1) if ops[j].name=='pushstring' and e.abc.s(ops[j].args[0])=='c4_request_kind')
            ctx=ops[before-1].args[0]
            sites.append(queue(e,label,[('dup',),e.string('c17_cost_error'),g(ctx),*get(e,'c4_conflict_reason'),e.string('cost'),('equals',),('setproperty',DYNAMIC)],at+1))
        report[label]=sites
    label='LogicScene/finishTransition';ops=asm.decode(e.body(label)[5]);at=next(i for i,o in enumerate(ops) if o.name=='pushstring' and e.abc.s(o.args[0])=='裂罅已变化，请重试')
    flag=next(i for i,o in enumerate(ops[:at]) if o.name=='pushstring' and e.abc.s(o.args[0])=='show_message');marker=ops[flag-1].args[0]
    report[label]=queue(e,label,[g(marker),*get(e,'c17_cost_error'),('iffalse','c17_notice_done'),('pop',),e.string('道具不足'),('label','c17_notice_done')],at+1,asm.SKIP)
    return report
