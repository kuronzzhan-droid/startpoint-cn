"""跨组真实调用链：Fever点→原生状态→敌伤累计→移除→能力攻击→完整伤害计算。"""
from .fixture import Harness as DamageHarness, enemy_case, calculate
from superfever.runtime import Harness as FeverHarness, row


def verify(abc):
    h = FeverHarness(abc, {100: row('wfx:60:101:10000:10:energy', -1, 11),
        101: row('wfx:61:0:2000:102:super', 600, 3),
        102: row('super_end', 1, 1), 103: row('wfx:62:0:500:0:bonus', -1, 1)})
    members = [h.unit() for _ in range(3)]
    d = DamageHarness(abc)
    template = d.unit()
    for k, v in template.items():
        members[0].setdefault(k, v)
    original_shot = h.shot
    def shot(*args):
        original_shot(*args)
        d.shot(*args)
    h.zone_manager['executeAbilityDamage'] = shot
    h.add_condition(members[2], 100, duration=-1, maximum=11)
    h.add_condition(members[1], 103, duration=-1, maximum=1)
    timeline = []
    def snap(event):
        timeline.append(dict(event=event, energy_layers=h.layers(members[2], 100),
                             super_layers=[h.layers(m, 101) for m in members], shots=len(h.shots)))
    h.add(9); snap('Fever +9')
    assert timeline[-1]['energy_layers']==10 and timeline[-1]['super_layers']==[0,0,0]
    h.add(1); snap('Fever +1, first S')
    assert timeline[-1]['energy_layers']==1 and timeline[-1]['super_layers']==[1,1,1]
    record = members[0]['wfxSuperRecordDamage']
    enemy_case(d, damage=3000, record=record)
    enemy_case(d, damage=7000, detail={'createdBySummonsMultiBall': True}, record=record)
    enemy_case(d, primary=False, damage=9000, record=record)
    h.add(10); snap('own damage 30+70, remote 90 excluded; Fever +10')
    assert timeline[-1]['super_layers']==[2,2,2]
    enemy_case(d, damage=5000, detail={'createdByPrimarySquad': False, 'originMemberIndex': 1}, record=record)
    h.remove(members[0], 101); snap('own coop ball +50; remove leader S')
    assert len(h.shots)==2 and all(s['reference']==4 and s['strength']==37.5 for s in h.shots)
    assert [h.layers(m,102) for m in members]==[1,1,1]
    actual = []
    for index, (_, impact) in enumerate(d.impacts):
        result, _ = calculate(d, impact['content'], ability=300000, resistance=25000 if index==0 else 0)
        actual.append(result['damage']/100)
    assert actual==[28,37], actual
    timeline[-1].update(accumulated=150, base_ratio=2000, bonus=500, emitted_base=37.5,
                        target_final_damage=actual, end_marker_layers=[h.layers(m,102) for m in members])
    h.remove(members[0],101)
    assert len(h.shots)==2
    assert all(ev['owner']==0 for ev in h.shots)
    return dict(status='pass', checks=10, timeline=timeline,
                scope='真实跨组调用链；外围表/成员/敌人/图形服务采用受控对象',
                expected='150*(2000+500)/10000=37.5；25%能力抗性敌取整28，无抗性敌取整37')
