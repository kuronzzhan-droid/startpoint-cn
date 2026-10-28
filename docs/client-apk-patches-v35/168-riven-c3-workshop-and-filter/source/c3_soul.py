"""C3 instance soul names in existing inventory and party thumbnail grids."""
import asm
from c1_lookup import number
from c2_common import DYNAMIC, get, set_, queue
from c3_soul_labels import label_code, layout_code, culling_extent

NAME='wfx_riven_name'


def row_name(e, first):
    row, ident, info = range(first,first+3)
    gp=lambda n: ('getproperty',e.q(n))
    return [('setlocal',row),('getlocal_1',),gp('id'),('setlocal',ident),
            ('getlocal',ident),number(e,16000000),('iflt','soul_row_done'),
            ('getlocal',ident),number(e,16000200),('ifgt','soul_row_done'),
            ('getlocal',row),gp('kind'),gp('params'),number(e,0),('getproperty',DYNAMIC),
            ('setlocal',info),('getlocal',info),*set_(e,NAME,[('getlocal_1',),
                ('callproperty',e.q('get_name'),0)]),
            ('label','soul_row_done'),('getlocal',row)]


def queue_soul_splices(e):
    result={}
    for label in ['ItemTableTranslator/translateFromItem','AbilitySoulThumbnailListRepository/translate']:
        body=e.body(label); ops=asm.decode(body[5]); assert ops[-1].name=='returnvalue'
        result[label]=queue(e,label,row_name(e,body[2]),len(ops)-1)
    label='PanelInnerContentItemListTableView/run'
    body=e.body(label); ops=asm.decode(body[5]); assert ops[-1].name=='returnvoid'
    result[label]=queue(e,label,layout_code(e,body[2]),len(ops)-1)
    label='PanelInnerContentItemListTableView/draw'
    body=e.body(label); ops=asm.decode(body[5])
    assert ops[83].name=='callproperty' and e.abc.mn_name(ops[83].args[0])=='append'
    # Existing locals: info=5, created thumbnail=6, setlocal6 is #86.
    assert ops[86].name=='setlocal' and ops[86].args==[6]
    result[label]=queue(e,label,label_code(e,5,6,body[2],'draw'),87)
    label='PanelInnerContentItemListTableView/apply'
    body=e.body(label); ops=asm.decode(body[5])
    assert ops[177].name=='callpropvoid' and e.abc.mn_name(ops[177].args[0])=='showItem'
    result[label]=queue(e,label,label_code(e,14,12,body[2],'apply'),178)
    queue(e,label,layout_code(e,body[2]+3,from_parameter=True),2)
    assert ops[-1].name=='returnvoid'
    queue(e,label,[('getlocal_0',),('getproperty',e.q('itemTable')),
                   ('callpropvoid',e.q('layoutItems'),0)],len(ops)-1)
    label='ComplexThumbnailView/culling'
    body=e.body(label); ops=asm.decode(body[5])
    assert ops[37].name=='getproperty' and e.abc.mn_name(ops[37].args[0])=='top'
    assert ops[38].name=='pushdouble' and e.abc.doubles[ops[38].args[0]]==84
    assert ops[39].name=='subtract'
    result[label]=queue(e,label,culling_extent(e,body[2]),39)
    return result



