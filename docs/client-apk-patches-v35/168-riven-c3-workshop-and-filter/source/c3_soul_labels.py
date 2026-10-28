"""Inline label/grid layout emitters; all UI classes and fonts already exist."""
from c1_lookup import number
from c2_common import DYNAMIC, get
NAME='wfx_riven_name'
CHILD='wfx-riven-name'


def label_code(e, info, thumbnail, first, tag):
    name, layer, text = range(first,first+3)
    g=lambda n: ('getlocal',n)
    p=lambda n: ('setlocal',n)
    gp=lambda n: ('getproperty',e.q(n))
    sp=lambda n: ('setproperty',e.q(n))
    num=lambda n: number(e,n)
    end=tag+'_label_end'; ready=tag+'_label_ready'; clear=tag+'_label_clear'
    code=[g(info),*get(e,NAME),p(name),g(thumbnail),gp('layer'),p(layer),
          g(layer),e.string(CHILD),('callproperty',e.newq('getChildByName'),1),('coerce_a',),p(text),
          g(name),('iffalse',clear),g(text),('iftrue',ready),
          ('getlex',e.q('starling.text::TextField')),num(168),num(60),g(name),
          ('getlex',e.q('starling.text::TextFormat')),('getlex',e.q('pinball.font::Fonts')),
          ('callproperty',e.q('get_defaultFont'),0),gp('fontName'),num(20),num(3355443),
          ('construct',3),('construct',4),p(text),g(text),e.string(CHILD),sp('name'),
          g(text),num(84),('negate',),sp('x'),g(text),num(84),sp('y'),
          g(text),('pushfalse',),sp('touchable'),g(text),('pushtrue',),sp('autoScale'),
          g(text),('pushtrue',),sp('wordWrap'),g(layer),g(text),('callpropvoid',e.q('addChild'),1),
          ('label',ready),g(text),g(name),sp('text'),('jump',end),
          ('label',clear),g(text),('iffalse',end),g(layer),g(text),('pushtrue',),
          ('callpropvoid',e.q('removeChild'),2),('label',end)]
    return code


def layout_code(e, first, from_parameter=False):
    items, index, row = range(first,first+3)
    g=lambda n: ('getlocal',n)
    p=lambda n: ('setlocal',n)
    gp=lambda n: ('getproperty',e.q(n))
    num=lambda n: number(e,n)
    source=[('getlocal_1',)] if from_parameter else [('getlocal_0',),gp('items')]
    reset=[('getlocal_0',),gp('itemTable'),gp('thumbnailLayouter'),gp('thumbnailRect'),
           num(168),('setproperty',e.q('height'))]
    return [*reset,*source,p(items),num(0),p(index),
            ('label','soul_layout_loop'),('avm_label',),g(index),g(items),gp('length'),('ifge','soul_layout_done'),
            g(items),g(index),('getproperty',DYNAMIC),gp('kind'),p(row),
            g(row),gp('index'),num(0),('ifne','soul_layout_next'),
            g(row),gp('params'),num(0),('getproperty',DYNAMIC),*get(e,NAME),('iftrue','soul_layout_expand'),
            ('label','soul_layout_next'),('inclocal_i',index),('jump','soul_layout_loop'),
            ('label','soul_layout_expand'),('getlocal_0',),gp('itemTable'),gp('thumbnailLayouter'),
            gp('thumbnailRect'),num(232),('setproperty',e.q('height')),
            ('label','soul_layout_done')]


def culling_extent(e, first):
    """The name extends 60px below the 168px icon; preserve other bounds."""
    return [('getlocal_0',),('getproperty',e.q('layer')),e.string(CHILD),
            ('callproperty',e.newq('getChildByName'),1),('iffalse','soul_culling_original'),
            ('pop',),number(e,144),('label','soul_culling_original')]
