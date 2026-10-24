"""共享applyHeal到原生Fever入槽的完整桥接，保留原生治疗/统计/过滤。"""
from .runtime import World
from .cases import SPEC


def suite(abc, overrides=None):
    from heal_damage.runtime import Harness
    checks, executed = [], set()
    def make(hp=80, maxhp=100, state=1, value=0):
        h = Harness(abc, {1: SPEC}, overrides=overrides)
        w = World(abc, state=state, value=value, overrides=overrides)
        h.zone['addFeverPoint'] = w.zone['addFeverPoint']
        h.lex['Decimal_Impl_'] = w.lex['Decimal_Impl_']
        h.unit([h.condition(1)])
        target = h.unit(hp=hp, maxhp=maxhp)
        return h, w, target
    def check(name, h, w, expected):
        actual = w.gauge['feverPoint']['value']
        assert abs(actual-expected) < 1e-8, (name, actual, expected)
        checks.append({'name': name, 'actual': actual, 'expected': expected})
        executed.update(w.executed)
        executed.update(['MemberImpl/applyHeal', 'MemberImpl/wfxHealSample', 'MemberImpl/wfxHealFever'])
    for hp, maxhp, cure, want in [(80,100,30,40),(160,200,60,40),(100,100,10,20),
                                 (80,100,20,20),(80,100,0,0),(.08,.1,.03,40)]:
        h,w,t=make(hp,maxhp); h.heal(t,cure)
        check(f'applyHeal.max{maxhp}.hp{hp}.cure{cure}',h,w,want)
    for flag in ['isHealRejected','isFromHostile','createdByCoopCommand','createdBySummonsMultiBall',
                 'statsBattleId','emptyMember','negativeOrigin','debugReject','remoteDisallowed']:
        h,w,t=make(); kw={flag:True}
        if flag=='statsBattleId':kw={flag:'remote'}
        if flag=='emptyMember':kw={'origin':2}
        if flag=='negativeOrigin':kw={'origin':-1}
        if flag=='debugReject':t['xdebugSettings']['playerRejectHeal']=True;kw={}
        if flag=='remoteDisallowed':h.battle['get_allowHealFromOtherPlayers']=lambda:False;kw={'createdByCoopCommand':True}
        h.heal(t,30,**kw);check('shared_filter.'+flag,h,w,0)
    for state, initial, want in [(2,10,50),(2,95,100),(2,100,100)]:
        h,w,t=make(state=state,value=initial);h.heal(t,30)
        check(f'applyHeal.fever.initial{initial}',h,w,want)
    h,w,t=make()
    for _ in range(5):
        target=h.unit(hp=80);h.heal(target,20)
    check('applyHeal.multitarget_sum',h,w,100)
    return {'checks':checks,'executed_methods':sorted(executed)}
