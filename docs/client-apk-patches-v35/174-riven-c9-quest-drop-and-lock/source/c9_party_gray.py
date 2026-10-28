"""Own only our grayscale filter; preserve any filter installed by native code."""
from c1_lookup import number
from c2_common import DYNAMIC, get, set_

OWNED = 'wfxRivenGrayFilter'
OWNER = 'wfxRivenGrayOwner'


def gray(e, inactive, first):
    state, current, owned = range(first, first+3)
    q=e.q; g=lambda n:('getlocal',n); p=lambda n:('setlocal',n)
    image=[('getlocal_0',),('getproperty',q('abilitySoul'))]
    return [('getlocal_0',),('getproperty',q('initialData')),p(state),
            g(state),('getproperty',q('index')),number(e,0),('ifne','gray_new_state'),
            g(state),('getproperty',q('params')),number(e,0),('getproperty',DYNAMIC),p(state),
            g(state),*get(e,OWNER),('iftrue','gray_state'),
            ('label','gray_new_state'),('getlocal_1',),('getproperty',q('index')),
            number(e,0),('ifne','gray_done'),('getlocal_1',),('getproperty',q('params')),
            number(e,0),('getproperty',DYNAMIC),p(state),
            e.string('imagePath'),g(state),*get(e,'imagePath'),
            e.string('wfxRivenInactive'),g(state),*get(e,'wfxRivenInactive'),
            e.string(OWNER),('pushtrue',),('newobject',3),p(state),
            ('getlocal_0',),('getlex',q('haxe.ds::Option')),g(state),
            ('callproperty',q('Some'),1),('setproperty',q('initialData')),
            ('label','gray_state'),g(state),*get(e,OWNED),p(owned),
            *image,('getproperty',q('filter')),p(current),g(inactive),('iffalse','gray_clear'),
            g(owned),('iffalse','gray_create'),g(current),g(owned),('ifeq','gray_done'),
            g(owned),('callpropvoid',q('dispose'),0),g(state),*set_(e,OWNED,[('pushnull',)]),
            ('label','gray_create'),g(current),('iftrue','gray_done'),
            ('getlex',q('starling.filters::ColorMatrixFilter')),('construct',0),p(owned),
            g(owned),number(e,1),('negate',),('callpropvoid',q('adjustSaturation'),1),
            *image,g(owned),('setproperty',q('filter')),g(state),*set_(e,OWNED,[g(owned)]),
            ('jump','gray_done'),('label','gray_clear'),g(owned),('iffalse','gray_done'),
            g(current),g(owned),('ifne','gray_dispose'),
            *image,('pushnull',),('setproperty',q('filter')),
            ('label','gray_dispose'),g(owned),('callpropvoid',q('dispose'),0),
            g(state),*set_(e,OWNED,[('pushnull',)]),('label','gray_done')]
