"""静态有效语义变异必须使独立业务断言失败；每例恢复原字节。"""
import copy
import asm
import bodies
from static_check import check_body
from perf2_core import splice_with_exits
from .patches import ADDED, SAMPLE, PRELOAD
from .cases import scenarios
from .resources import suite
from .edges import suite as edges
from .coop_cases import suite as coop
from overflow.base_runtime import CODE_CACHE as HEAL_CACHE
from superfever.base_runtime import CODE_CACHE as FEVER_CACHE


def clear(abc):
    HEAL_CACHE.pop(id(abc),None)
    FEVER_CACHE.pop(id(abc),None)


def candidates(before, after):
    for label in [SAMPLE,PRELOAD]:
        yield label,'restore-v35j',copy.deepcopy(before.bodies[bodies.resolve(before,label)])
    changes = {
        'MemberImpl/wfxHealAnyValue': [('quantization-divisor', 'pushbyte', [10], [20]),
                                    ('quantization-numerator', 'pushbyte', [100], [99])],
        'MemberImpl/wfxHealAnyDamage': [('classification-modulus','pushbyte',[10],[9])],
        'MemberImpl/wfxHealAnyFever': [('native-kind','pushbyte',[101],[100])],
        'MemberImpl/wfxHealAnySample': [('damage-code','pushbyte',[34],[33]),
                                      ('fever-code','pushbyte',[35],[33]),
                                      ('damage-exclusion-mask','pushbyte',[1],[0]),
                                      ('fever-exclusion-mask','pushbyte',[2],[0])],
    }
    for label, edits in changes.items():
        b=after.bodies[bodies.resolve(after,label)]
        for name,op,args,replacement in edits:
            code=asm.decode(b[5])
            at=next(i for i,r in enumerate(code) if r.name==op and r.args==args)
            code[at].args=replacement
            changed=copy.deepcopy(b);changed[5]=asm.encode(code)[0]
            yield label,name,changed
    # Reintroduce precisely the superseded restriction: valid bytecode, wrong ruling B.
    label = 'MemberImpl/wfxHealAnySample'
    original = after.bodies[bodies.resolve(after, label)]
    legacy = asm.decode(before.bodies[bodies.resolve(before, SAMPLE)][5])
    symbol = lambda name: next(ins.args[0] for ins in legacy
                              if ins.name in ('getproperty', 'callproperty')
                              and before.mn_name(ins.args[0]) == name)
    source = [('getlocal_2',), ('getproperty', symbol('statsBattleId')), ('getlocal_0',),
              ('getproperty', symbol('battle')), ('callproperty', symbol('get_id'), 0),
              ('ifeq', 'PASS'), ('pushbyte', 0), ('returnvalue',),
              ('label', 'PASS'), ('label', 'END')]
    changed = copy.deepcopy(original)
    changed[5], changed[6], _, _ = splice_with_exits(original, 2, source, {}, asm.ENTER)
    yield label, 'restore-superseded-cross-statsBattleId-filter', changed
    # Flip concrete semantic branches (not unconditional loops).
    for label in ADDED:
        if 'CT' in label:
            continue  # CT has dedicated semantic mutations and assertions.
        body=after.bodies[bodies.resolve(after,label)]
        for at,ins in enumerate(asm.decode(body[5])):
            opposite={'ifngt':'ifgt','ifne':'ifeq','ifstrictne':'ifstricteq',
                      'ifge':'iflt','iftrue':'iffalse','iffalse':'iftrue'}.get(ins.name)
            if not opposite: continue
            code=asm.decode(body[5]);code[at].op=asm.MNEMONICS[opposite]
            changed=copy.deepcopy(body);changed[5]=asm.encode(code)[0]
            yield label,f'branch-{at}-{ins.name}-{opposite}',changed


def run(before,after):
    rows=[]
    for label,name,changed in candidates(before,after):
        index=bodies.resolve(after,label)
        original=after.bodies[index]
        changed[0]=original[0]
        check_body(after,changed)
        try:
            after.bodies[index]=changed
            clear(after)
            if label==PRELOAD: suite(before,after)
            else:
                scenarios(after); edges(after); coop(after)
                from .ct_cases import suite as ct_cases
                ct_cases(after)
        except AssertionError as exc:
            rows.append({'method':label,'mutation':name,'static_valid':True,
                         'status':'killed','failure':str(exc)[:350], 'business_assertion':True})
        except Exception as exc:
            rows.append({'method':label,'mutation':name,'static_valid':True,
                         'status':'killed','failure':type(exc).__name__+': '+str(exc)[:350],
                         'business_assertion':False})
        else:
            rows.append({'method':label,'mutation':name,'static_valid':True,'status':'survived'})
        finally:
            after.bodies[index]=original
            clear(after)
    return rows
