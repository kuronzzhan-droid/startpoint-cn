"""Refresh already-built rows after common-response record replacement."""
import asm
from c1_lookup import number
from c2_common import DYNAMIC, get, set_, queue
from c8_navigation import records
from c9_lists import panel, weapon_new

CACHE='wfxRivenVisualRecord'


def panel_draw(e, first):
    rows,index,row,info,ident,collection,current,thumb=range(first,first+8)
    q=e.q;g=lambda n:('getlocal',n);p=lambda n:('setlocal',n)
    return [*records(e),p(collection),g(collection),('iffalse','refresh_done'),
            ('getlocal_0',),('getproperty',q('items')),p(rows),number(e,0),p(index),
            ('label','refresh_loop'),('avm_label',),g(index),g(rows),('getproperty',q('length')),
            ('ifge','refresh_done'),g(rows),g(index),('getproperty',DYNAMIC),p(row),
            g(row),('getproperty',q('kind')),('getproperty',q('index')),
            number(e,0),('ifne','refresh_next'),g(row),('getproperty',q('kind')),
            ('getproperty',q('params')),number(e,0),('getproperty',DYNAMIC),p(info),
            g(info),('getproperty',q('itemId')),p(ident),g(ident),number(e,16000001),
            ('iflt','refresh_next'),g(ident),number(e,16000999),('ifgt','refresh_next'),
            ('getlocal_0',),('getproperty',q('itemTable')),('getproperty',q('thumbnails')),
            ('getproperty',q('map')),('getproperty',q('h')),g(row),('getproperty',q('id')),
            ('getproperty',DYNAMIC),p(thumb),g(thumb),('iffalse','refresh_next'),
            g(collection),g(ident),('getproperty',DYNAMIC),p(current),
            g(info),*get(e,CACHE),g(current),('ifstricteq','refresh_next'),
            *panel(e,info,thumb,first+8),g(info),*set_(e,CACHE,[g(current)]),
            ('label','refresh_next'),('inclocal_i',index),('jump','refresh_loop'),
            ('label','refresh_done')]


def weapon_draw(e, first):
    item,collection,current,unseen,locked=range(first,first+5)
    q=e.q;g=lambda n:('getlocal',n);p=lambda n:('setlocal',n)
    return [('getlocal_0',),('getproperty',q('layout')),('iffalse','row_refresh_done'),
            ('getlocal_0',),('getproperty',q('item')),p(item),g(item),*get(e,'wfxRiven'),
            ('iffalse','row_refresh_done'),*records(e),p(collection),
            g(collection),('iffalse','row_refresh_done'),g(collection),g(item),*get(e,'item_id'),
            ('getproperty',DYNAMIC),p(current),g(item),*get(e,CACHE),g(current),
            ('ifstricteq','row_refresh_done'),('pushfalse',),p(unseen),('pushfalse',),p(locked),
            g(current),('iffalse','row_refresh_flags'),g(current),*get(e,'seen'),number(e,0),
            ('strictequals',),p(unseen),g(current),*get(e,'locked'),number(e,1),
            ('strictequals',),p(locked),('label','row_refresh_flags'),
            ('getlocal_0',),('getproperty',q('thumbnailView')),g(locked),
            ('callpropvoid',q('setProtectionIconVisible'),1),*weapon_new(e,unseen,first+5),
            g(item),*set_(e,CACHE,[g(current)]),('label','row_refresh_done')]


def queue_refresh(e):
    result={}
    for label,builder,offset in [('PanelInnerContentItemListTableView/draw',panel_draw,5),
            ('EquipmentListTableItemView/enhancedEffectAnimationDraw',weapon_draw,0)]:
        body=e.body(label);ops=asm.decode(body[5]);assert ops[-1].name=='returnvoid'
        # draw already has a C9 build-time splice using five scratch locals.
        result[label]=queue(e,label,builder(e,body[2]+offset),len(ops)-1)
    return result
