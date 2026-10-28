"""C3 inventory display grouping; item master categories remain untouched."""
import asm
from c1_lookup import number
from c2_common import DYNAMIC, get, queue, prefix

GROUP = 16000000
TITLE = '裂罅'
PUSH = 'http://adobe.com/AS3/2006/builtin::push'


def regroup(e, first):
    src, dst, keys, ki, key, rows, ri, row, ordinary, rivens, ident = range(first, first + 11)
    g=lambda n: ('getlocal',n)
    p=lambda n: ('setlocal',n)
    gp=lambda n: ('getproperty',e.q(n))
    num=lambda n: number(e,n)
    def append_group(k, rs):
        return [g(dst),gp('_keys'),*k,('callpropvoid',e.q(PUSH),1),
                g(dst),gp('map'),gp('h'),*k,g(rs),('setproperty',DYNAMIC)]
    code=[p(src),('getlex',e.q('pinball.common.ds::OrderedMap')),
          ('getlex',e.q('haxe.ds::IntMap')),('construct',0),('construct',1),p(dst),
          g(src),gp('_keys'),p(keys),num(0),p(ki),
          ('label','inv_group_loop'),('avm_label',),g(ki),g(keys),gp('length'),('ifge','inv_done'),
          g(keys),g(ki),('getproperty',DYNAMIC),('convert_i',),p(key),
          g(src),gp('map'),gp('h'),g(key),('getproperty',DYNAMIC),p(rows),
          g(key),num(5),('ifne','inv_group_original'),
          ('newarray',0),p(ordinary),('newarray',0),p(rivens),num(0),p(ri),
          ('label','inv_row_loop'),('avm_label',),g(ri),g(rows),gp('length'),('ifge','inv_rows_done'),
          g(rows),g(ri),('getproperty',DYNAMIC),p(row),
          g(row),gp('kind'),gp('params'),num(0),('getproperty',DYNAMIC),gp('itemId'),
          ('convert_i',),p(ident),g(ident),num(16000000),('iflt','inv_normal_row'),
          g(ident),num(16000200),('ifgt','inv_normal_row'),
          g(rivens),g(row),('callpropvoid',e.q(PUSH),1),('jump','inv_row_next'),
          ('label','inv_normal_row'),g(ordinary),g(row),('callpropvoid',e.q(PUSH),1),
          ('label','inv_row_next'),('inclocal_i',ri),('jump','inv_row_loop'),
          ('label','inv_rows_done'),g(ordinary),gp('length'),('iffalse','inv_no_normal')]
    code+=append_group([num(5)],ordinary)
    code += [('label','inv_no_normal'),g(rivens),gp('length'),('iffalse','inv_group_next')]
    code+=append_group([num(GROUP)],rivens)
    code += [('jump','inv_group_next'),('label','inv_group_original')]
    code+=append_group([g(key)],rows)
    return code+[('label','inv_group_next'),('inclocal_i',ki),('jump','inv_group_loop'),
                 ('label','inv_done'),g(dst)]


def title_run(e, first):
    layout, txt = first, first + 1
    gp=lambda n: ('getproperty',e.q(n))
    return [('getlocal_0',),gp('title'),e.string(TITLE),('ifne','inv_title_original'),
            ('getlocal_0',),gp('uiProvider'),e.string('assetPath'),e.string('scene/common_ui_bundled/panel'),
            e.string('name'),e.string('layout/panelTitle'),('newobject',2),
            ('callproperty',e.q('build'),1),('setlocal',layout),
            ('getlocal_0',),('getlocal',layout),('setproperty',e.q('layout')),
            ('getlocal_0',),gp('layer'),('getlocal',layout),('callpropvoid',e.q('addChild'),1),
            ('getlocal',layout),e.string('title'),('pushnull',),('callproperty',e.q('getContainer'),2),
            e.string('text'),('pushnull',),('callproperty',e.q('getText'),2),('setlocal',txt),
            ('getlocal',txt),e.string(TITLE),('callpropvoid',e.q('set_text'),1),
            ('getlocal',txt),('getlex',e.q('starling.text::TextFieldAutoSize')),gp('HORIZONTAL'),
            ('callpropvoid',e.q('set_autoSize'),1),
            ('getlocal',txt),('pushfalse',),('callpropvoid',e.q('set_autoScale'),1),
            ('returnvoid',),('label','inv_title_original')]


def queue_inventory_splices(e):
    from c3_soul import queue_soul_splices
    label='ItemTableTranslator/translateFromCategorizedItems'
    ops=asm.decode(e.body(label)[5]); assert ops[-1].name=='returnvalue'
    result={label:queue(e,label,regroup(e,e.body(label)[2]),len(ops)-1)}
    label='ItemCategoryKindTools$/getUiStringId'
    result[label]=queue(e,label,[('getlocal_1',),number(e,GROUP),
        ('ifne','inv_category_original'),e.string(TITLE),('returnvalue',),('label','inv_category_original')],0)
    result['PanelContainerTitleView/run']=prefix(e,'PanelContainerTitleView/run',title_run)
    result.update(queue_soul_splices(e))
    return result


