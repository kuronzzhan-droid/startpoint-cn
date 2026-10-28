"""Native equipment protection control on the existing soul detail dialog."""
import asm
from c1_lookup import number, lookup
from c2_common import DYNAMIC, get, set_, queue, prefix

KEY = 'c9_riven_lock'
BUTTON, RESPONSE = 0x6D000000, 0x6E000000
ASSET = 'scene/common_ui_iosbundled/item_detail'


def find_record(e, ident, scratch, record, fail):
    return [number(e, 16000999) if op == number(e,16000200) else op
            for op in lookup(e,ident,scratch,record,fail)]


def metadata(e, meta, fail):
    """The ordinary detail content is a typed enum; only our config is dynamic."""
    q=e.q;g=lambda n:('getlocal',n)
    return [('getlocal_0',),('getproperty',q('contents')),('setlocal',meta),
            g(meta),('iffalse',fail),g(meta),('getproperty',q('length')),
            number(e,3),('iflt',fail),g(meta),number(e,2),('getproperty',DYNAMIC),
            ('setlocal',meta),g(meta),('getproperty',q('index')),number(e,16),('ifne',fail),
            g(meta),('getproperty',q('params')),number(e,4),('getproperty',DYNAMIC),
            *get(e,KEY),('setlocal',meta),g(meta),('iffalse',fail)]


def attach(e, first):
    ident,scratch,record,config=range(first,first+4);g=lambda n:('getlocal',n)
    # Preserve all five official config fields and attach only to actual cards.
    return [('setlocal',config),('getlocal_1',),('getproperty',e.q('id')),('setlocal',ident),
            *find_record(e,ident,scratch,record,'c9_attach_done'),g(config),
            *set_(e,KEY,[e.string('item_id'),g(ident),e.string('riven_id'),g(record),*get(e,'riven_id'),
                        e.string('pending'),('pushfalse',),('newobject',3)]),
            ('label','c9_attach_done'),g(config)]


def register(e, first):
    return metadata(e,first,'c9_register_done') + [
        ('getlocal_0',),('getproperty',e.q('buttonGroup')),number(e,BUTTON),
        ('callpropvoid',e.q('append'),1),('label','c9_register_done')]


def render(e, meta, first, tag):
    ident,scratch,record,node=range(first,first+4);g=lambda n:('getlocal',n);q=e.q
    return [g(meta),*get(e,'node'),('setlocal',node),g(node),('iffalse',tag+'_done'),
            g(meta),*get(e,'item_id'),('setlocal',ident),
            *find_record(e,ident,scratch,record,tag+'_stale'),
            g(record),*get(e,'riven_id'),g(meta),*get(e,'riven_id'),('ifne',tag+'_stale'),
            g(node),g(meta),*get(e,'pending'),('not',),('setproperty',q('touchable')),
            g(node),g(record),*get(e,'locked'),('iffalse',tag+'_off_frame'),
            number(e,1),('jump',tag+'_set_frame'),('label',tag+'_off_frame'),number(e,2),
            ('label',tag+'_set_frame'),('callpropvoid',q('goto'),1),
            g(node),e.string('label_text'),('pushnull',),('callproperty',q('getText'),2),
            g(record),*get(e,'locked'),('iffalse',tag+'_off_text'),
            e.string('已锁定'),('jump',tag+'_set_text'),('label',tag+'_off_text'),e.string('未锁定'),
            ('label',tag+'_set_text'),('callpropvoid',q('set_text'),1),('jump',tag+'_done'),
            ('label',tag+'_stale'),g(node),('pushfalse',),('setproperty',q('touchable')),
            ('label',tag+'_done')]


def content_view(e, first):
    meta,root,node=range(first,first+3);g=lambda n:('getlocal',n);q=e.q
    code=[('getlocal_0',),('getproperty',q('config')),*get(e,KEY),('setlocal',meta),
          g(meta),('iffalse','c9_control_done'),('getlocal_0',),('getproperty',q('uiProvider')),
          e.string('assetPath'),e.string(ASSET),e.string('name'),e.string('layout/equipment_with_protection'),
          ('newobject',2),('callproperty',q('pinball.ui.provider:UiProvider::build'),1),('setlocal',root),
          g(root),e.string('protect_button'),('pushnull',),('callproperty',q('getContainer'),2),('setlocal',node),
          ('getlocal_0',),('getproperty',q('layer')),g(node),('callpropvoid',q('addChild'),1),
          g(node),number(e,320),g(node),('getproperty',q('width')),number(e,2),('divide',),
          ('subtract',),('setproperty',q('x')),
          g(node),('getlocal_0',),('getproperty',q('contentHeight')),number(e,24),('add',),('setproperty',q('y')),
          ('getlocal_0',),('getlocal_0',),('getproperty',q('contentHeight')),number(e,24),('add',),
          g(node),('getproperty',q('height')),('add',),number(e,24),('add',),('setproperty',q('contentHeight')),
          g(meta),*set_(e,'node',[g(node)])]
    code+=render(e,meta,first+3,'c9_initial')
    return code+[('label','c9_control_done')]


def group_view(e, first):
    # In the existing AbilitySoulDetail arm, config is local 13 and content local 41.
    return [('getlocal',13),*get(e,KEY),('setlocal',first),('getlocal',first),
            ('iffalse','c9_group_done'),('getlocal',first),*get(e,'node'),('setlocal',first+1),
            ('getlocal',first+1),('iffalse','c9_group_done'),
            ('getlocal_0',),('getproperty',e.q('buttonGroupView')),number(e,BUTTON),
            ('getlocal',first+1),('getlex',e.q('pinball.ui.component.button.behavior::ButtonAnimationBehaviorKind')),
            ('getproperty',e.q('Scale')),('callpropvoid',e.q('registerDisplayObjectAsButton'),3),
            ('label','c9_group_done')]


def update(e, first):
    q=e.q;g=lambda n:('getlocal',n)
    return metadata(e,first,'c9_update_done')+[
        g(first),*get(e,'notice'),('iffalse','c9_update_no_notice'),
        ('getlocal_0',),g(first),*get(e,'notice'),
        ('getlex',q('pinball.context.scene.instantMessage::InstantMessagePosition')),
        ('getproperty',q('Center')),('callpropvoid',q('showInstantMessage'),2),
        g(first),*set_(e,'notice',[('pushnull',)]),('label','c9_update_no_notice')
    ]+render(e,first,first+1,'c9_update_render')+[('label','c9_update_done')]


def response(e, first):
    """Existing (int,int,Object) callback preserves the actual response payload."""
    meta,data=first,first+1;g=lambda n:('getlocal',n);q=e.q
    return [('getlocal_1',),number(e,BUTTON),('ifne','c9_callback_original'),
            ('getlocal_2',),number(e,RESPONSE),('ifne','c9_callback_original'),
            *metadata(e,meta,'c9_callback_done'),g(meta),*set_(e,'pending',[('pushfalse',)]),
            ('getlocal_3',),('getproperty',q('rawData')),*get(e,'data'),('setlocal',data),
            g(data),*get(e,'weapon_riven_conflict'),('iffalse','c9_callback_done'),
            g(meta),e.string('notice'),g(data),*get(e,'reason'),e.string('locked'),
            ('ifne','c9_callback_changed'),e.string('已锁定'),('jump','c9_callback_message'),
            ('label','c9_callback_changed'),e.string('裂罅已变化，请重试'),
            ('label','c9_callback_message'),('setproperty',DYNAMIC),
            ('label','c9_callback_done'),('returnvoid',),('label','c9_callback_original')]


def click(e, first):
    meta,ident,scratch,record,service=range(first,first+5);g=lambda n:('getlocal',n);q=e.q
    code=[('getlocal_1',),number(e,BUTTON),('ifne','c9_lock_original')]
    code+=metadata(e,meta,'c9_lock_original')
    code += [g(meta),*get(e,'pending'),('iftrue','c9_lock_done'),
             g(meta),*get(e,'item_id'),('setlocal',ident),
             *find_record(e,ident,scratch,record,'c9_lock_stale'),
             g(record),*get(e,'riven_id'),g(meta),*get(e,'riven_id'),('ifne','c9_lock_stale'),
             g(meta),*set_(e,'pending',[('pushtrue',)]),
             ('getlex',q('pinball.context.remote.real::RealRemoteService')),
             ('getlocal_0',),('getproperty',q('logic')),('getproperty',q('remote')),('construct',1),('setlocal',service),
             g(service),e.string('weapon_riven/lock'),e.string('item_id'),g(ident),
             e.string('riven_id'),g(record),*get(e,'riven_id'),e.string('locked'),
             g(record),*get(e,'locked'),('not',),('convert_i',),('newobject',3),
             ('getlex',q('pinball.common.tools._FunctionTools::BindImpl3_1')),
             ('getlocal_0',),('getproperty',q('sliderValueChangedForAbilityDescriptionVariationWithLevel')),
             number(e,BUTTON),number(e,RESPONSE),('construct',3),('getproperty',q('execute')),
             ('callpropvoid',q('startUserRequest'),3),('jump','c9_lock_done'),
             ('label','c9_lock_stale'),('getlocal_0',),e.string('裂罅已变化，请重试'),
             ('getlex',q('pinball.context.scene.instantMessage::InstantMessagePosition')),
             ('getproperty',q('Center')),('callpropvoid',q('showInstantMessage'),2),
             ('label','c9_lock_done'),('returnvoid',),('label','c9_lock_original')]
    return code


def queue_lock(e):
    result={}
    label='AbilitySoulDetailDialog/initialize';ops=asm.decode(e.body(label)[5])
    at=next(i for i,o in enumerate(ops) if o.name=='callproperty' and e.abc.mn_name(o.args[0])=='AbilitySoulDetail')
    assert ops[at-1].name=='newobject' and ops[at-1].args==[5]
    result[label]=queue(e,label,attach(e,e.body(label)[2]),at)
    for label,fn in [('GeneralDialog/preparation',register),('DialogAbilitySoulDetailView/run',content_view)]:
        ops=asm.decode(e.body(label)[5]);assert ops[-1].name=='returnvoid'
        result[label]=queue(e,label,fn(e,e.body(label)[2]),len(ops)-1)
    label='GeneralDialogView/run';ops=asm.decode(e.body(label)[5])
    assert ops[1119].name=='callpropvoid' and e.abc.mn_name(ops[1119].args[0])=='addContent'
    result[label]=queue(e,label,group_view(e,e.body(label)[2]),1120)
    result['GeneralDialog/update']=prefix(e,'GeneralDialog/update',update)
    result['GeneralDialog/buttonClicked']=prefix(e,'GeneralDialog/buttonClicked',click)
    label='GeneralDialog/sliderValueChangedForAbilityDescriptionVariationWithLevel'
    result[label]=prefix(e,label,response)
    return result
