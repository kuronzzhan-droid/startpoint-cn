"""从SWF真实AVM2字节码验证34/35、旧30/31对照和所有者归属。"""
from .runtime import World, enum
from heal_damage.damage_fixture import calculate

TABLE = {30:'wfx:30:4:10000:50000:old_damage', 31:'wfx:31:0:100:200:old_fever',
         34:'wfx:34:50:100000:150000:hidden_any_damage',
         35:'wfx:35:50:500:1000:hidden_any_fever'}


def parity(before, after):
    checks = []
    for codes in [[], [30], [31], [30,31], [27,30,31]]:
        for hp, cure in [(0,0), (50,25), (80,30), (100,.01), (80,20)]:
            for flags in [{}, {'isHealRejected':True}, {'isFromHostile':True},
                          {'createdByCoopCommand':True}, {'statsBattleId':'other'},
                          {'createdBySummonsMultiBall':True}, {'origin':-1}]:
                results = []
                for abc in [before, after]:
                    h = World(abc, {**TABLE,27:'wfx:27:0:10000:0:old_overflow'})
                    h.unit([h.condition(c) for c in codes])
                    t = h.unit(hp=hp)
                    h.heal(t, cure, **flags)
                    h.tick(60)
                    results.append(h.snapshot())
                assert results[0] == results[1], (codes, hp, cure, flags)
                checks.append(f'old.{codes}.{hp}.{cure}.{flags}')
    return checks


def scenarios(abc):
    checks = []
    def mark(text): checks.append(text)
    def world(codes=(34,35), *, layers=1, table=None, hp=0, maxhp=100, native=False, **kw):
        h = World(abc, table or TABLE, native_fever=native, **kw)
        owner = h.unit([h.condition(c,layers) for c in codes])
        target = h.unit(hp=hp,maxhp=maxhp)
        return h, owner, target
    def expect(h, damage, fever):
        h.tick(30)
        assert h.amounts() == ([damage]*2 if damage else []), h.amounts()
        assert h.fever_ratios() == ([fever] if fever else []), h.fever_ratios()
    for hp,cure,damage,fever in [(0,4.9,0,0), (0,5,10,.05), (0,12,20,.1),
                               (97,10,15,.1), (100,10,30,.2), (0,0,0,0)]:
        h,_,t = world(hp=hp)
        h.heal(t,cure,origin=-1); expect(h,damage,fever)
        mark(f'quantized.effective-overflow.{hp}.{cure}')
    # The recipient maximum is authoritative and quantization has no remainder state.
    h,_,t = world(maxhp=200)
    h.heal(t,9.9,origin=-1); h.heal(t,9.9,origin=-1); expect(h,0,0)
    mark('no-remainder-across-events-maxhp200')
    h,_,t = world()
    u = h.unit(hp=0)
    h.heal(t,4.9,origin=-1); h.heal(u,4.9,origin=-1); expect(h,0,0)
    mark('no-remainder-across-members')
    h,_,t = world()
    u = h.unit(hp=0)
    h.heal(t,12,origin=-1); h.heal(u,5,origin=-1); h.tick(30)
    assert h.amounts()==[30]*2 and h.fever_ratios()==[.1,.05]
    mark('members-quantize-before-sum')
    for flags in [{'origin':1}, {'origin':-1}, {'createdByCoopCommand':True},
                  {'createdByCoopCommand':True,'statsBattleId':'remote-source'},
                  {'statsBattleId':'remote-source'},
                  {'createdBySummonsMultiBall':True}, {'isFromHostile':True}]:
        h,_,t = world()
        h.heal(t,5,**flags); expect(h,10,.05)
        mark('source-independent.'+str(flags))
    for reject in ['isHealRejected','other-battle-owner','other-squad','not-member']:
        h,_,t=world()
        flags={}
        if reject=='isHealRejected': flags[reject]=True
        elif reject=='other-battle-owner': h.battle['__isMyBattle__']=lambda:False
        elif reject=='other-squad': t['squad']={'isPrimary':lambda:False}
        else: h.primary['members'].pop()
        h.heal(t,5,origin=-1,**flags); expect(h,0,0)
        mark('filter.'+reject)
    # Per-type exclusivity: only the corresponding old code is suppressed.
    for new,damage,fever in [([34],10,.05),([35],5,.05),([34,35],10,.05),([],5,.05)]:
        h,o,t=world(codes=(30,31,*new))
        t['conditionSlot']=h.slot([h.condition(30),h.condition(31)])
        h.heal(t,5,origin=1); expect(h,damage,fever)
        mark('typed-exclusion.'+str(new))
    h,o,t=world(codes=(30,31,34,35))
    h.heal(t,4.9); expect(h,0,0)
    mark('holder-presence-excludes-old-even-quantized-zero')
    for kind in range(5):
        table={34:f'wfx:34:{kind}:10000:50000:any',35:'wfx:35:0:100:200:any'}
        h,_,t=world(table=table,hp=80,stance={129989:{'main_stance':{'concepts':[2]}}})
        h.heal(t,30,origin=-1); expect(h,70,.4)
        mark('continuous-fallback.'+str(kind))
    h,o,t=world(layers=2)
    o2=h.unit([h.condition(34,3),h.condition(35,3)])
    h.heal(t,5,origin=-1); h.tick(30)
    assert h.amounts()==[20,20,30,30] and h.fever_ratios()==[.1,.15]
    assert [s['member'] for s in h.shots]==[0,0,2,2]
    mark('two-holders-layered-independent-ownership')
    h,o,t=world(codes=())
    o['conditionSlot']['invisibleSlot']=h.slot([h.condition(34),h.condition(35)],invisible=True)
    h.primary['members'].append(enum(0,o))
    h.heal(t,5,origin=-1); expect(h,10,.05)
    mark('invisible-holder-and-duplicate-member-identity')
    h,o,t=world(codes=())
    shared=h.slot([h.condition(34),h.condition(35)])
    shared['invisibleSlot']=h.slot([h.condition(34),h.condition(35)],invisible=True)
    o['conditionSlot']['squadSlot']=enum(0,shared)
    h.heal(t,5,origin=-1); expect(h,20,.1)
    mark('holder-squad-visible-and-invisible-slots')
    h,o,t=world()
    h.heal(t,5,origin=-1); h.tick(29)
    assert not h.shots
    h.tick(); h.heal(t,5,origin=-1)
    assert h.fever_ratios()==[.05,.05]
    h.tick(29); assert len(h.shots)==2
    h.tick(); assert len(h.shots)==4 and h.shots[-1]['frame']==60
    h.tick(100); h.heal(t,5,origin=-1); h.tick(30)
    assert len(h.shots)==6 and h.shots[-1]['frame']==190
    mark('original-window-cooldown-tail-no-extra-ct-fever-immediate')
    for kind in range(1,5):
        table={34:f'wfx:34:{50+kind}:100000:150000:any'}
        h,o,t=world(codes=(34,),table=table)
        h.heal(t,5,origin=1); h.tick(30)
        result,state=calculate(h,h.impacts[0][1]['content'],kind=kind)
        assert result['damage']==2250000 and result['originMemberIndex']==0
        assert state['step2Multiplier']==1000000
        mark('native-damage-holder-stat-classification.'+str(kind))
    h,o,t=world(native=True)
    h.heal(t,5,origin=-1)
    assert h.native_fever.gauge['feverPoint']['value']==50
    assert len(h.fever)==1 and h.fever[0][1:]==(True,101)
    mark('native-fever-maximum-1000-step5percent-add50')
    return checks
