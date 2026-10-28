"""C9 locked-card guards and server-authored dismantle reward preview."""
import asm
from c1_lookup import number
from c2_common import DYNAMIC, context, get, set_, queue, prefix
from c9_actions_lock import queue_lock


def locked_notice(e, record, tag):
    q=e.q
    return [('getlocal',record),*get(e,'locked'),('iffalse',tag+'_ok'),
            ('getlocal_0',),('getproperty',q('scene')),e.string('已锁定'),
            ('getlex',q('pinball.context.scene.instantMessage::InstantMessagePosition')),
            ('getproperty',q('Center')),('callpropvoid',q('showInstantMessage'),2),
            ('returnvoid',),('label',tag+'_ok')]


def preview(e, record, first):
    """Original confirmation text is on stack; authoritative rewards may be empty."""
    message,rows,index,row,ident,count=range(first,first+6);g=lambda n:('getlocal',n);q=e.q
    code=[('setlocal',message),g(record),*get(e,'dismantle_return'),('setlocal',rows),
          g(rows),('pushnull',),('ifeq','c9_preview_done'),g(rows),('getproperty',q('length')),
          ('iffalse','c9_preview_empty'),g(message),e.string('\n分解后获得 '),('add',),
          ('setlocal',message),number(e,0),('setlocal',index),
          ('label','c9_preview_loop'),('avm_label',),g(index),g(rows),('getproperty',q('length')),
          ('ifge','c9_preview_done'),g(rows),g(index),('getproperty',DYNAMIC),('setlocal',row),
          g(row),number(e,0),('getproperty',DYNAMIC),('convert_i',),('setlocal',ident),
          g(row),number(e,1),('getproperty',DYNAMIC),('convert_i',),('setlocal',count),
          g(index),('iffalse','c9_preview_name'),g(message),e.string('、'),('add',),
          ('setlocal',message),('label','c9_preview_name'),g(message),g(ident),
          number(e,16000900),('ifne','c9_preview_other'),e.string('裂罅碎片'),
          ('jump','c9_preview_append'),('label','c9_preview_other'),
          ('getlocal_0',),('getproperty',q('globalLogic')),g(ident),('callproperty',q('getItem'),1),
          ('callproperty',q('get_name'),0),('label','c9_preview_append'),('add',),
          e.string(' ×'),('add',),g(count),('add',),('setlocal',message),
          ('inclocal_i',index),('jump','c9_preview_loop'),('label','c9_preview_empty'),
          g(message),e.string('\n分解后无返还'),('add',),('setlocal',message),
          ('label','c9_preview_done'),g(message)]
    return code


def locked_response(e, first):
    ctx=first;q=e.q;g=lambda n:('getlocal',n)
    return context(e,ctx,'c9_response_done')+[
        g(ctx),*get(e,'c4_conflict_reason'),e.string('locked'),('ifne','c9_response_done'),
        g(ctx),*get(e,'c4_conflict'),('iffalse','c9_response_done'),
        ('getlocal_0',),('getproperty',q('drawResult')),('getproperty',q('index')),
        number(e,0),('ifne','c9_response_done'),('getlocal_0',),('getproperty',q('drawResult')),
        ('getproperty',q('params')),number(e,0),('getproperty',DYNAMIC),g(ctx),('ifne','c9_response_done'),
        g(ctx),*get(e,'c4_request_remote'),g(ctx),*get(e,'c4_response_remote'),('ifne','c9_response_done'),
        g(ctx),*set_(e,'c4_conflict',[('pushfalse',)]),
        g(ctx),*set_(e,'c4_request_kind',[e.string('lock')]),
        ('getlocal_0',),('getproperty',q('scene')),e.string('已锁定'),
        ('getlex',q('pinball.context.scene.instantMessage::InstantMessagePosition')),
        ('getproperty',q('Center')),('callpropvoid',q('showInstantMessage'),2),
        ('label','c9_response_done')]


def queue_actions(e):
    result=queue_lock(e)
    for label in ('ExBoostWindow/buttonClicked','ExBoostWindow/selectDiscardHandler'):
        ops=asm.decode(e.body(label)[5]);first=e.body(label)[2]
        anchor=next(i for i,o in enumerate(ops) if o.name=='pushstring'
                    and e.abc.s(o.args[0])==('c4_dismantle_target' if label.endswith('buttonClicked') else 'c4_dismantle'))
        # Locate the first identity read in the C4 card branch, not C8 navigation.
        if label.endswith('buttonClicked'):
            hits=[i for i,o in enumerate(ops) if o.name=='pushstring' and e.abc.s(o.args[0])=='c4_dismantle_target'
                  and i+2<len(ops) and ops[i+1].name=='getlocal' and ops[i+2].name=='pushstring']
            assert len(hits)==1,hits
            anchor=hits[0];record=ops[anchor+1].args[0];at=anchor-1
        else:
            identity=next(i for i in range(anchor) if ops[i].name=='pushstring' and e.abc.s(ops[i].args[0])=='riven_id')
            record=ops[identity-1].args[0]
            # Run only after the original fresh identity comparison succeeds.
            at=identity+3
            assert ops[at-1].name=='ifne'
        result[label]={'locked_guard':queue(e,label,locked_notice(e,record,'c9_guard'),at)}
        if label.endswith('buttonClicked'):
            text=next(i for i,o in enumerate(ops) if o.name=='pushstring' and e.abc.s(o.args[0]).startswith('确定分解这张裂罅吗'))
            result[label]['reward_preview']=queue(e,label,preview(e,record,first),text+1,asm.SKIP)
    label='ExBoostWindow/characterExBoostSelectRemoteInput'
    result[label]=prefix(e,label,locked_response)
    return {'methods':result,'lock_path':'weapon_riven/lock','lock_payload':['item_id','riven_id','locked'],
            'lock_control':'existing equipment_with_protection.protect_button asset and native button group',
            'preview_source':'dismantle_return (empty explicitly means no reward)',
            'lock_guards':['open confirmation','confirm fresh identity','server reason locked']}
