"""Build-time emitters for authoritative cost selection; no runtime helper methods."""
from c2_common import DYNAMIC, MODE, get, set_, fresh_record


def g(i): return ('getlocal', i)
def p(i): return ('setlocal', i)
def n(e, value):
    if -128 <= value <= 127: return [('pushbyte', value & 255)]
    try: return [e.number(value)]
    except Exception:
        # Integer immediates avoid changing any numeric constant pool.
        return [('pushshort', value)] if 0 <= value <= 32767 else [e.string(str(value)), ('convert_i',)]


def context(e, ctx, fail):
    """C15-compatible read guard: never call getLoadedData while its Option is None."""
    q=e.q
    code=[('getlex',q('PinballClientMain')),('getproperty',q('top')),p(ctx),g(ctx),('iffalse',fail)]
    for field in ('logic','globalLogic','logicStatus'):
        code += [g(ctx),('getproperty',q(field)),p(ctx),g(ctx),('iffalse',fail)]
    return code+[g(ctx),('getproperty',q('loadedData')),('getproperty',q('index')),
        *n(e,0),('ifne',fail),g(ctx),('callproperty',q('getLoadedData'),0),p(ctx),g(ctx),('iffalse',fail),
        g(ctx),*get(e,MODE),p(ctx),g(ctx),('iffalse',fail),g(ctx),*get(e,'mode'),e.string(MODE),('ifne',fail)]


def resolve(e, ctx, record, first, tag):
    """Resolve saved selection against current ordered options, resetting on card change."""
    opts,pair,index,chosen=range(first,first+4);q=e.q
    code=[g(record),*get(e,'cost_options'),p(opts),g(opts),('iffalse',tag+'_legacy'),
          g(opts),('getproperty',q('length')),('iftrue',tag+'_options'),('label',tag+'_legacy'),
          *n(e,2370099),g(record),*get(e,'next_cost'),('newarray',2),('newarray',1),p(opts),
          ('label',tag+'_options'),*n(e,0),p(chosen),
          g(ctx),*get(e,'c17_cost_owner'),g(record),*get(e,'riven_id'),('ifne',tag+'_selected'),
          g(ctx),*get(e,'c17_cost_slot'),g(ctx),*get(e,'item_id'),('ifne',tag+'_selected'),
          *n(e,0),p(index),('label',tag+'_loop'),('avm_label',),g(index),g(opts),('getproperty',q('length')),
          ('ifge',tag+'_selected'),g(opts),g(index),('getproperty',DYNAMIC),p(pair),
          g(pair),*n(e,0),('getproperty',DYNAMIC),g(ctx),*get(e,'c17_cost_item_id'),('ifne',tag+'_next'),
          g(index),p(chosen),('jump',tag+'_selected'),('label',tag+'_next'),('inclocal_i',index),
          ('jump',tag+'_loop'),('label',tag+'_selected'),g(opts),g(chosen),('getproperty',DYNAMIC),p(pair)]
    for field,value in [('c17_cost_owner',[g(record),*get(e,'riven_id')]),('c17_cost_slot',[g(ctx),*get(e,'item_id')]),
        ('c17_cost_item_id',[g(pair),*n(e,0),('getproperty',DYNAMIC)]),
        ('c17_cost',[g(pair),*n(e,1),('getproperty',DYNAMIC)]),('c17_cost_index',[g(chosen)])]:
        code += [g(ctx),*set_(e,field,value)]
    return code,opts,pair,chosen


def current(e, first, tag, fresh=True):
    ctx,record,scratch=range(first,first+3)
    code=context(e,ctx,tag+'_original')
    code += fresh_record(e,ctx,record,scratch,tag+'_original') if fresh else [g(ctx),*get(e,'record'),p(record)]
    more,opts,pair,index=resolve(e,ctx,record,first+3,tag+'_resolve')
    return code+more,ctx,record,opts,pair,index
