"""静态有效的真实方法字节变异；只由完整方法行为快照检出。"""
import copy
import asm
from static_check import check_body
from materials.patches import TARGETS,SITES
from materials.helper import HELPER
from materials.cases import body
from materials.runtime import capture,world


def scenarios():
    out=[]
    for step in range(9):
        out += [dict(step=step,key='1',crystals=9,cores=1),dict(step=step,key='1',crystals=2,cores=9),
                dict(step=step,key='1',crystals=9,cores=0),dict(step=step,cid=111183),dict(step=step,cid=141099)]
    out += [dict(step=0,key='0'),dict(step=0,key='1',rarity=4),dict(step=0,key='1',highest=100)]
    return out


def reference(abc):return [capture(abc,**p)[0] for p in scenarios()]


def smoke(abc,expected):
    for p,want in zip(scenarios(),expected):
        actual,_=capture(abc,**p)
        assert actual==want,('真实字节码语义偏差',p,[(key,want[key],actual[key]) for key in actual if actual[key]!=want[key]])
    return len(expected)


def candidates(abc):
    def emit(label,name,edit):
        b=body(abc,label);ins=asm.decode(b[5]);edit(ins)
        raw=asm.encode(ins)[0];assert raw!=b[5]
        test=copy.deepcopy(b);test[5]=raw
        static=check_body(abc,test)
        assert asm.encode(asm.decode(raw))[0]==raw
        return label,name,raw,static
    for label,(at,_,prop) in zip(TARGETS,SITES):
        pos=at+(3 if prop else 2)
        def toggle(ins,pos=pos):
            assert ins[pos].name=='iftrue';ins[pos].op=asm.MNEMONICS['iffalse']
        yield emit(label,'全程开关分支反转',toggle)
    for label in TARGETS[3:]:
        def core(ins):
            hit=[x for x in ins if x.name=='pushshort' and x.args==[302]]
            assert len(hit)==1;hit[0].args=[320]
        yield emit(label,'悖论之核ID变为超限结晶ID',core)
    def rarity(ins):
        hits=[x for x in ins if x.name=='pushbyte' and x.args==[5]];assert len(hits)==1;hits[0].args=[4]
    yield emit(HELPER,'星级5变4',rarity)
    def level(ins):
        hits=[x for x in ins if x.name=='pushbyte' and x.args==[120]];assert len(hits)==1;hits[0].args=[121]
    yield emit(HELPER,'O1最高等级门槛120变121',level)
    def step(ins):
        hits=[x for x in ins if x.name=='pushbyte' and x.args==[0]];assert len(hits)==1;hits[0].args=[1]
    yield emit(HELPER,'全程起点0变1',step)
    def value(ins):
        hits=[x for x in ins if x.name=='ifstrictne'];assert len(hits)==1;hits[0].op=asm.MNEMONICS['ifstricteq']
    yield emit(HELPER,'数据值1判定反转',value)
    def prefix(ins):
        hits=[x for x in ins if x.name=='pushstring' and abc.strings[x.args[0]]==b'wfx_overlimit_full_']
        assert len(hits)==1;hits[0].args=[abc.strings.index(b'wfx_adaptive_')]
    yield emit(HELPER,'角色数据键前缀错误',prefix)
    def off(ins):
        hits=[x for x in ins if x.name=='pushtrue'];assert len(hits)==1;hits[0].op=asm.MNEMONICS['pushfalse']
    yield emit(HELPER,'有效数据键仍禁用',off)
    def on(ins):
        hits=[x for x in ins if x.name=='pushfalse'];assert len(hits)==1;hits[0].op=asm.MNEMONICS['pushtrue']
    yield emit(HELPER,'无效及无键误启用',on)
    def minimum(ins):
        hits=[x for x in ins if x.name=='ifnlt'];assert len(hits)==2;hits[0].op=asm.MNEMONICS['iflt']
    yield emit(TARGETS[3],'核心数量最小值比较反转',minimum)
    def gate(ins):
        hits=[x for x in ins if x.name=='ifgt'];assert len(hits)==1;hits[0].op=asm.MNEMONICS['ifge']
    yield emit(TARGETS[4],'缺核0个仍通过按钮门槛',gate)
