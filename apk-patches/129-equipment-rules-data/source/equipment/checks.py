"""完整 wf 方法真实字节码矩阵：旧默认等价、新数据、边界与安全表读取。"""
from .harness import World, summary


def suite(before, after):
    rows, executed = [], set()

    def expect(name, got, wanted):
        assert got == wanted, f'{name}: got {got!r}, expected {wanted!r}'
        rows.append({'name': name, 'result': got})

    def world(abc, **kwargs):
        obj = World(abc, **kwargs)
        return obj

    def done(obj):
        executed.update(obj.executed)

    # Every old membership edge and representative interior remains exact.
    for sid in (0, 5910100, 5910101, 5910150, 5910199, 5910200,
                5920000, 5920001, 5920500, 5920999, 5921000, 6100001):
        for method in ('wfIsCursedSoul', 'wfIsDecaySoul'):
            old, new = world(before), world(after)
            expect(f'legacy {method} {sid}', new.call(method, sid), old.call(method, sid))
            done(new)
    for sid in (5910101, 5910199, 5920001, 5920999, 5900000):
        keys = [sid + 1000 * n for n in range(1, 4)]
        for other in range(6):
            for weapon, enhancement in ((False, False), (True, False), (True, True)):
                ids = [sid] + [5910102 if sid < 5920000 else 100001] * other
                old = world(before, soul_keys=keys, enh_keys=keys)
                new = world(after, soul_keys=keys, enh_keys=keys)
                expect(f'legacy rule {sid} others={other} weapon={weapon} enhancement={enhancement}',
                       summary(new.rule(sid, ids, weapon, enhancement)),
                       summary(old.rule(sid, ids, weapon, enhancement)))
                done(new)
    for sid in (5920001, 5920999):
        for n in (1, 2, 3):
            for missing in ('soul', 'enhancement'):
                kw = {'soul_keys': [] if missing == 'soul' else [sid + 1000*n],
                      'enh_keys': []}
                old, new = world(before, **kw), world(after, **kw)
                ids = [sid] + [100001] * n
                expect(f'legacy absent {sid} tier={n} {missing}', summary(new.rule(sid, ids, True)),
                       summary(old.rule(sid, ids, True)))
                done(new)
    for weapon, soul in ((None, None), (5920001, None), (None, 5920001),
                         (5920001, 5920001), (100001, 100002)):
        keys = [5921001, 5922001, 5923001]
        old = world(before, soul_keys=keys, enh_keys=keys)
        new = world(after, soul_keys=keys, enh_keys=keys)
        expect(f'legacy preload {weapon}/{soul}', new.preload(weapon, soul), old.preload(weapon, soul))
        done(new)
    for count in range(7):
        old, new = world(before), world(after)
        ids = [5910101] * count
        for curse in (False, True):
            expect(f'legacy count {count} curse={curse}',
                   new.call('wfCountEquipment', new.party(ids), curse),
                   old.call('wfCountEquipment', old.party(ids), curse))
        done(new)

    # Validation is atomic: malformed rows never partly enable a rule.
    invalid = ['', '2', '2:0', '2:0:0:extra', ':0:0', '2::0', '2:0:',
               '1:0:0', '7:0:0', '-1:0:0', 'nan:0:0', '2.5:0:0',
               '2:-1:3', '2:1.5:3', '2:2147483648:3', '2:Infinity:3',
               '2:1:0', '2:0:3', '2:1:7', '2:1:-1', '2:1:2.5', '2:1:nan']
    for value in invalid:
        new = world(after, table={'equipment_rule_5910101': value, 'equipment_rule_5920001': value})
        expect('invalid config '+repr(value), new.call('wfxEquipmentConfig', 5910101), None)
        expect('invalid keeps cursed '+repr(value), new.call('wfIsCursedSoul', 5910101), True)
        expect('invalid keeps decay '+repr(value), new.call('wfIsDecaySoul', 5920001), True)
        done(new)
    for loaded in (False, True):
        new = world(after, loaded=loaded)
        expect(f'missing/ unloaded config {loaded}', new.call('wfxEquipmentConfig', 6100001), None)
        expect(f'missing keeps original {loaded}', summary(new.rule(6100001, [6100001])), {'soul': 6100001})
        done(new)
    new = world(after); new.character['logicAssets'] = None
    expect('null config assets', new.call('wfxEquipmentConfig', 6100001), None); done(new)

    for threshold in (2, 3, 6):
        table = {'equipment_rule_6100001': f'{threshold}:0:0'}
        for count in range(1, 7):
            new = world(after, table=table)
            expect(f'custom curse threshold={threshold} count={count}',
                   summary(new.rule(6100001, [6100001]*count)),
                   None if count >= threshold else {'soul': 6100001})
            done(new)
    # Per-item thresholds use the same six-slot cursed population.
    table = {'equipment_rule_6100001': '2:0:0', 'equipment_rule_6100002': '3:0:0'}
    new = world(after, table=table)
    expect('mixed cursed threshold2', summary(new.rule(6100001, [6100001,6100002])), None)
    expect('mixed cursed threshold3', summary(new.rule(6100002, [6100001,6100002])), {'soul':6100002})
    done(new)
    for sid, method in ((5910101, 'wfIsCursedSoul'), (5920001, 'wfIsDecaySoul')):
        new = world(after, table={f'equipment_rule_{sid}': '0:0:0'})
        expect('explicit disables '+str(sid), new.call(method, sid), False); done(new)

    for off in (1, 2, 4, 6):
        sid, stride = 6101001, 137
        keys = [sid + stride*n for n in range(1, 6)]
        table = {f'equipment_rule_{sid}': f'0:{stride}:{off}'}
        for other in range(6):
            for weapon in (False, True):
                new = world(after, table=table, soul_keys=keys, enh_keys=keys)
                result = summary(new.rule(sid, [sid]+[100001]*other, weapon))
                want = None if other >= off else {'soul': sid + stride*other}
                if want is not None and weapon:
                    want['enhancement'] = [sid+stride*other,3,5]
                expect(f'custom decay off={off} other={other} weapon={weapon}', result, want)
                done(new)
        new = world(after, table=table, soul_keys=keys, enh_keys=keys)
        got = new.preload(sid, sid)
        want = ([{'soul':sid+stride*n,'enhancement':[sid+stride*n,3,5]} for n in range(1,off)]
                + [{'soul':sid+stride*n} for n in range(1,off)])
        expect(f'custom preload off={off}', sorted(got,key=str), sorted(want,key=str)); done(new)
    # Resource keys are independent: a missing third tier must not hide fourth.
    sid, stride = 6101001, 137
    keys = [sid+stride*n for n in (1,2,4,5)]
    new = world(after, table={f'equipment_rule_{sid}':'0:137:6'}, soul_keys=keys, enh_keys=keys)
    expect('preload missing third retains fourth fifth', len(new.preload(sid,sid)), 8); done(new)
    for unloaded in ('AbilitySoulTable','EquipmentEnhancementAbilityTable'):
        new = world(after, soul_keys=[5921001], enh_keys=[5921001]); new.unloaded.add(unloaded)
        expect('unloaded tier table '+unloaded, summary(new.rule(5920001,[5920001,100001],True)),
               {'soul':5920001,'enhancement':[5920001,3,5]}); done(new)
    new = world(after); peek,soul = new.equip(5920001); soul['logicAssets'] = None
    expect('null tier assets', new.call('wfTierAbility',peek,soul,1), None); done(new)
    # Large configured strides may be legal but impossible tier IDs must not wrap.
    new = world(after,table={'equipment_rule_6101001':'0:2147483647:6'})
    expect('overflow tier key', summary(new.rule(6101001,[6101001,100001])), {'soul':6101001}); done(new)
    # Both flags can coexist: cursed exclusion runs before decay tier substitution.
    new = world(after,table={'equipment_rule_6101001':'2:137:6'},soul_keys=[6101138])
    expect('combined cursed and decay',summary(new.rule(6101001,[6101001,6101001])),None); done(new)
    return {'status':'PASS','checks':len(rows),'cases':rows,'executed_method_ids':sorted(executed)}
