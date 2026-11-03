"""码30资源预载：执行原生预载入口、真实助手与安全语义变异。"""
import copy
import json
import sys
from pathlib import Path
import bootstrap
from bootstrap import ROOT
sys.path.append(str(ROOT.parent/'run3'))
from superpreload.runtime import World
from superpreload.checks import behavior as prior_suite
from superfever.base_runtime import CODE_CACHE
import asm
import bodies
from static_check import check_body
from .patches import TARGET

UID = 910030
ROUTES = [('instant0', lambda h:h.instant(0,UID)), ('instant1', lambda h:h.instant(1,UID)),
          ('instant6', lambda h:h.instant(6,UID)), ('instant7', lambda h:h.instant(7,UID)),
          ('instant8', lambda h:h.instant(8,UID)), ('condition', lambda h:h.condition(UID)),
          ('dsl', lambda h:h.dsl(UID))]


def suite(before, after):
    old, new, executed = [], [], set()
    def check(name, actual, expected, target):
        assert actual==expected, (name,actual,expected)
        target.append(name)
    def world(abc, text, loaded=True):
        return World(abc,{UID:{'string_id':text,'icon_image':'native/test/icon'}},loaded)
    # 同时维持既有超级Fever全入口和安全读表的完整回归矩阵。
    regression = prior_suite(before, after)
    for route, call in ROUTES:
        for text in ['ordinary','wfx:27:0:10000:0:x','wfx:31:0:100:200:x',
                     'wfx:24:0:1000:0:x','wfx:30:bad','wfx:30:0:1:0', '', 'wfx:29:1:1:1:x']:
            a,b=world(before,text),world(after,text)
            call(a);call(b)
            check('legacy.'+route+'.'+text,b.paths,a.paths,old)
            executed.update(b.executed)
    native=[]
    for color in range(6):
        h=world(before,'ordinary');h.native_damage(color);native.extend(h.paths)
    expected=set(native)
    check('native.19_animations',len(expected),19,new)
    for route, call in ROUTES:
        h=world(after,'wfx:30:0:10000:50000:hidden_heal_damage');call(h)
        want=expected|{('image','native/test/icon')}
        if route in ('instant6','instant7','instant8'):
            want.add(('animation','native/generic/31'))
        check('heal_damage.'+route,set(h.paths),want,new);executed.update(h.executed)
    for arg in range(5):
        h=world(after,f'wfx:30:{arg}:1:0:x');h.helper(UID)
        check('all_categories.'+str(arg),set(h.paths),expected,new)
    h=world(after,'wfx:30:0:1:0:x',False);h.helper(UID)
    check('unloaded_table.safe',h.paths,[],new)
    h.loaded=True;h.helper(UID)
    check('unloaded_table.retry',set(h.paths),expected,new)
    h=World(after,{});h.helper(UID)
    check('missing_row.safe',h.paths,[],new)
    return {'old_parity_checks':old,'new_checks':new,
            'old_parity_count':len(old),'new_check_count':len(new),
            'regression_checks':regression['checks'], 'regression_check_count':len(regression['checks']),
            'executed_methods':sorted(executed|set(regression['executed_methods'])),
            'native_animations':sorted(expected)}


def mutants(abc):
    body=abc.bodies[bodies.resolve(abc,TARGET)]
    original=asm.decode(body[5])
    edits=[]
    at=next(i for i,v in enumerate(original) if v.name=='pushbyte' and v.args==[30])
    edits += [('code30_gate',at,[31],None), ('code30_branch',at+1,None,'ifeq')]
    at=next(i for i,v in enumerate(original) if v.name=='pushbyte' and v.args==[6])
    edits += [('missing_sixth_color',at,[5],None)]
    for kind in ('Hit','Player','Shot'):
        name='getAbilityDamage'+kind+'Effect'
        at=next(i for i,v in enumerate(original) if v.name=='callproperty' and abc.mn_name(v.args[0])==name)
        other='getAbilityDamage'+('Hit' if kind=='Shot' else 'Shot')+'Effect'
        q=next(i for i in range(len(abc.multinames)) if abc.mn_name(i)==other)
        edits += [('wrong_'+kind+'_animation',at,[q,1],None)]
    for name,at,args,op in edits:
        code=copy.deepcopy(original)
        if args is not None:code[at].args=args
        if op:code[at].op=asm.assemble([(op,'x'),('label','x'),('returnvoid',)])[0].op
        raw=asm.encode(code)[0];test=copy.deepcopy(body);test[5]=raw
        check_body(abc,test)
        yield name,raw


def run(before,after,mutations=True):
    baseline=suite(before,after);outcomes=[]
    body=after.bodies[bodies.resolve(after,TARGET)];saved=body[5]
    if mutations:
        for name,raw in mutants(after):
            body[5]=raw
            CODE_CACHE.pop(id(after),None)
            try:suite(before,after)
            except Exception as exc:outcomes.append({'name':name,'detected':True,'reason':str(exc)[:600]})
            else:outcomes.append({'name':name,'detected':False})
            finally:
                body[5]=saved
                CODE_CACHE.pop(id(after),None)
    final=suite(before,after)
    assert final==baseline
    survived=[row['name'] for row in outcomes if not row['detected']]
    result={**baseline,'status':'fail' if survived else 'pass','mutations':outcomes,
            'mutant_count':len(outcomes),'survived':survived,'final_baseline':'pass'}
    (ROOT/'heal_resources'/'verify-report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    assert not survived,survived
    return result
