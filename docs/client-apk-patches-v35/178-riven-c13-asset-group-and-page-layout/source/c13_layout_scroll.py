"""Override local viewport scalars, never shared UI guide definitions."""
import asm
from c1_lookup import number
from c2_common import context, get, queue
from c13_layout_text import g


def apply(e):
    result={}
    targets=[('ExBoostWindowView/setupExAbilitiesScrollArea',2,3,4,5,True),
             ('ExBoostWindowView/refreshExAbilitiesScrollArea',1,2,3,4,True),
             ('ExBoostSelectDialogView/setupNowDetailScrollArea',2,3,4,5,False),
             ('ExBoostSelectDialogView/setupNewDetailScrollArea',2,3,4,5,False)]
    for label,x,y,w,h,page in targets:
        body=e.body(label);ops=asm.decode(body[5]);tag='c13_scroll_'+label.split('/')[-1]
        height=next(i for i,op in enumerate(ops) if op.name=='getproperty' and e.abc.mn_name(op.args[0])=='height')
        assert ops[height+1].name=='convert_d' and ops[height+2].name=='setlocal' and ops[height+2].args==[h]
        ctx=body[2];code=context(e,ctx,tag+'_done')
        if page:
            code += [g(ctx),*get(e,'c13_viewport'),('iffalse',tag+'_done'),number(e,0),('setlocal',x),
                     number(e,0),('setlocal',y),g(ctx),*get(e,'c13_width'),number(e,64),('subtract',),('setlocal',w),
                     g(ctx),*get(e,'c13_viewport'),('setlocal',h)]
        else:
            code += [number(e,4),('setlocal',x),number(e,4),('setlocal',y),number(e,928),('setlocal',w),
                     ('getlocal_1',),e.string('border'),('pushnull',),('callproperty',e.q('getImage'),2),
                     ('getproperty',e.q('height')),number(e,8),('subtract',),('setlocal',h)]
        code += [('label',tag+'_done')]
        result[label]={'viewport':queue(e,label,code,height+3)}
        if page:
            hits=[i for i,op in enumerate(ops) if op.name=='getproperty' and e.abc.mn_name(op.args[0])=='height'
                  and ops[i-1].name=='getproperty' and e.abc.mn_name(ops[i-1].args[0])=='informationLayer']
            assert len(hits)==2,(label,hits)
            for index,at in enumerate(hits):
                marker=tag+'_content_'+str(index)
                fix=context(e,ctx,marker)+[g(ctx),*get(e,'c13_content_height'),('iffalse',marker),
                    ('pop',),g(ctx),*get(e,'c13_content_height'),('label',marker)]
                result[label]['content_'+str(index)]=queue(e,label,fix,at+1,asm.SKIP)
    return result
