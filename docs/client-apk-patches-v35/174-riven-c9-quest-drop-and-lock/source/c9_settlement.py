"""C9 granted cards remain attached to the current quest result context."""
import asm
from c1_lookup import number
from c2_common import DYNAMIC, OPTION, get, set_, queue, dtos
from c9_data import parse_granted
from c9_data_types import GRANTED
from c8_layout_color import color_description


def popup(e, first):
    ctx,ids,index,ident,saved,record,item,contents,affixes,rows,descriptions,term_i=range(first,first+12)
    q=e.q;g=lambda v:('getlocal',v);p=lambda v:('setlocal',v);n=lambda v:number(e,v)
    gp=lambda v:('getproperty',q(v)); call=lambda v,c:('callproperty',q(v),c)
    gl=[('getlocal_0',),gp('globalLogic')]
    code=[('getlocal_0',),gp('questResultContext'),p(ctx),g(ctx),('iffalse','c9_reward_done'),
          g(ctx),*get(e,GRANTED),p(ids),g(ids),('istype',q('Array')),('iffalse','c9_reward_done'),
          g(ids),gp('length'),('iffalse','c9_reward_done'),*gl,call('get_player',0),gp('saveData'),
          *get(e,'weapon_rivens'),p(saved),g(saved),('iffalse','c9_reward_done'),
          ('newarray',0),p(contents),g(contents),('getlex',q('pinball.dialog.general::DialogContent')),
          e.string('获得武器裂罅'),call('DynamicText',1),('callpropvoid',q('push'),1),
          n(0),p(index),('label','c9_reward_loop'),('avm_label',),g(index),g(ids),gp('length'),
          ('ifge','c9_reward_open'),g(ids),g(index),('getproperty',DYNAMIC),p(ident),
          g(saved),g(ident),('getproperty',DYNAMIC),p(record),g(record),('iffalse','c9_reward_next'),
          ('getlex',q('pinball.common.data.item::GeneralAbilitySoulLogic')),g(ident),
          *gl,call('getLogicAssets',0),('construct',2),p(item),g(record),*get(e,'affixes'),p(affixes)]
    emitted=dtos(e,affixes,rows,first+12,[*gl,call('getLogicAssets',0)],tag='c9_reward_dto')
    at=next(i for i,x in enumerate(emitted) if x==('newobject',3))
    emitted[at:at]=color_description(e,first+13,first+15,'c9_reward_color')
    code += emitted+[('newarray',0),p(descriptions),n(0),p(term_i),('label','c9_reward_term'),
            ('avm_label',),g(term_i),g(rows),gp('length'),('ifge','c9_reward_card'),
            g(descriptions),g(rows),g(term_i),('getproperty',DYNAMIC),*get(e,'description'),
            ('callpropvoid',q('push'),1),('inclocal_i',term_i),('jump','c9_reward_term'),
            ('label','c9_reward_card'),g(contents),('getlex',q('pinball.dialog.general::DialogContent')),
            g(item),call('get_name',0),call('ItemTitle',1),('callpropvoid',q('push'),1),
            g(contents),('getlex',q('pinball.dialog.general::DialogContent')),g(item),call('get_thumbnailId',0),
            ('getlex',q(OPTION)),g(item),call('get_rarity',0),call('Some',1),g(descriptions),e.string('词条'),
            e.string('showThumbnail'),('getlex',q(OPTION)),e.string('getIcon'),('pushtrue',),
            e.string('number'),('getlex',q(OPTION)),gp('None'),('newobject',2),call('Some',1),
            e.string('descriptionAutoSize'),('pushtrue',),e.string('elements'),('getlex',q(OPTION)),gp('None'),
            e.string('validation'),('getlex',q(OPTION)),gp('None'),e.string('message'),('getlex',q(OPTION)),gp('None'),
            ('newobject',5),call('AbilitySoulDetail',5),('callpropvoid',q('push'),1),
            ('label','c9_reward_next'),('inclocal_i',index),('jump','c9_reward_loop'),
            ('label','c9_reward_open'),g(contents),gp('length'),n(1),('ifle','c9_reward_done'),
            ('getlocal_0',),('getlex',q('pinball.dialog.general::OkDialog')),g(contents),
            ('getlex',q('pinball.common.tools::FunctionTools')),gp('emptyFunction1'),('construct',2),('dup',),p(first+16),
            ('callpropvoid',q('openDialog'),1),('getlocal_0',),gp('sceneState'),g(first+16),
            ('ifne','c9_reward_done'),g(ctx),*set_(e,GRANTED,[('newarray',0)]),
            ('label','c9_reward_done')]
    return code


def queue_settlement(e):
    report={}
    label='BattleQuestFinishRealRemote/successHandler';body=e.body(label);ops=asm.decode(body[5])
    hits=[i for i,o in enumerate(ops) if o.name=='setlocal' and o.args==[70]
          and ops[i-1].name=='coerce_a' and ops[i-2].name=='newobject' and ops[i-2].args==[29]]
    assert len(hits)==1,hits
    report[label]=queue(e,label,parse_granted(e,[('getlocal_1',),('getproperty',e.q('rawData')),*get(e,'data')],
                           [('getlocal',70)],body[2],'c9_finish_granted'),hits[0]+1)
    label='BattleQuestFinishLoadingTask/processQuestFinish';body=e.body(label);ops=asm.decode(body[5])
    hits=[i for i,o in enumerate(ops) if o.name=='setlocal' and o.args==[62]
          and ops[i-1].name=='coerce_a' and ops[i-2].name=='newobject' and ops[i-2].args==[35]]
    assert len(hits)==1,hits
    report[label]=queue(e,label,parse_granted(e,[('getlocal_1',)],[('getlocal',62)],body[2],
                                           'c9_context_granted'),hits[0]+1)
    for label in ('QuestResultScene/run','QuestResultScene/viewDidChange'):
        body=e.body(label);ops=asm.decode(body[5])
        report[label]=queue(e,label,popup(e,body[2]),len(ops)-1)
    return {'methods':report,'route':'BattleQuestFinishRealRemote -> processQuestFinish -> gotoQuestResult -> QuestResultScene',
            'single_and_multi':'gotoQuestResult selects Single, MultiHost, MultiGuest before the same QuestResult constructor',
            'storage':'current QuestResultContext only; no player/global queue',
            'consume':'replace context granted list only after openDialog returns and sceneState equals the created dialog',
            'native_ui':['OkDialog','DialogContent.ItemTitle','DialogContent.AbilitySoulDetail']}
