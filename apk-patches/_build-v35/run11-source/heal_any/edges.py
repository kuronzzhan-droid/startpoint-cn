"""层数快照、多个状态、空槽、旧功能共存和小数边界。"""
from .runtime import World, enum
from .cases import TABLE


def suite(abc):
    checks=[]
    def make(table=None, **kw):
        h=World(abc,table or TABLE,**kw)
        owner=h.unit([h.condition(34),h.condition(35)])
        target=h.unit(hp=0)
        return h,owner,target
    for percent in [5,10,15,20,25,29,30,35,50,75,100]:
        table={34:'wfx:34:10:10000:0:any',35:'wfx:35:10:100:0:any'}
        h,o,t=make(table)
        h.heal(t,percent,origin=-1); h.tick(30)
        assert h.amounts()==[percent]*2 and h.fever_ratios()==[percent/100]
        checks.append('integer-boundary.'+str(percent))
    for code in [34,35]:
        for layers in [0,-1]:
            h=World(abc,TABLE);h.unit([h.condition(code,layers)]);t=h.unit(hp=0)
            h.heal(t,5,origin=-1);h.tick(30)
            assert not h.shots and not h.fever
            checks.append(f'nonpositive-layers.{code}.{layers}')
    h,o,t=make()
    h.primary['members'].insert(0,enum(1))
    h.primary['members'].insert(0,None)
    h.heal(t,5,origin=-1);h.tick(30)
    assert h.amounts()==[10,10] and h.fever_ratios()==[.05]
    checks.append('empty-member-slots-skipped')
    h,o,t=make()
    h.heal(t,5,origin=99);h.tick(30)
    assert h.amounts()==[10,10] and h.fever_ratios()==[.05]
    checks.append('both-new-codes-never-look-up-invalid-healer')
    h,o,t=make()
    h.heal(t,5,origin=-1)
    o['conditionSlot']=h.slot()
    h.tick(30)
    assert h.amounts()==[10,10] and h.fever_ratios()==[.05]
    checks.append('state-removal-preserves-pending-damage')
    h,o,t=make()
    h.heal(t,5,origin=-1)
    changed=dict(h.battle)
    h.manager['battle']=changed
    h.tick(30)
    assert not h.shots
    for member in h.members:member['battle']=changed
    h.heal(t,5,origin=-1);h.tick(30)
    assert h.amounts()==[10,10]
    checks.append('battle-object-reset-discards-old-damage-tail')
    h,o,t=make({**TABLE,36:'wfx:34:50:200000:0:second',37:'wfx:35:50:1000:0:second'})
    o['conditionSlot']=h.slot([h.condition(34,2),h.condition(35,2),h.condition(36),h.condition(37)])
    h.heal(t,5,origin=-1);h.tick(30)
    assert h.amounts()==[40,40] and h.fever_ratios()==[.2] and len(h.fever)==1
    checks.append('multiple-states-layer-weighted-one-fever-call-per-holder')
    h,o,t=make({**TABLE,27:'wfx:27:0:10000:0:overflow'})
    o['conditionSlot']=h.slot([h.condition(27),h.condition(34),h.condition(35)])
    t['getRealMaximumHealthPoint']=lambda:10000
    t['getRealCurrentHealthPoint']=lambda:10000
    h.heal(t,5);h.tick(30)
    assert len(h.shots)==4 and h.fever_ratios()==[.1]
    checks.append('code27-coexists-with34-35')
    h,o,t=make(loaded=False)
    h.heal(t,5,origin=-1);h.tick(30)
    assert not h.shots and not h.fever
    checks.append('unloaded-table-safe-no-new-effect')
    h,o,t=make(native_fever=True)
    h.native_fever.gauge['state']=enum(2)
    h.native_fever.gauge['feverPoint']['value']=990
    h.heal(t,5,origin=-1)
    assert h.native_fever.gauge['feverPoint']['value']==1000
    checks.append('native-fever-mode-refill-clamped')
    for codes in [(30,31,34,35),(30,34),(31,35)]:
        h=World(abc,TABLE)
        h.unit([h.condition(code) for code in codes]);t=h.unit(hp=0)
        h.battle['__isMyBattle__']=lambda:False
        h.heal(t,5);h.tick(30)
        assert not h.shots and not h.fever
        checks.append('other-battle-new-presence-still-suppresses-legacy.'+str(codes))
    return checks
