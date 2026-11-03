"""独立复审最终 SWF；所有报告仅落 run9/review。"""
import copy
import hashlib
import json
from pathlib import Path

from probe_runtime import ROOT, make_world, kind, VM, none
from swfabc import SwfAbc
from common import freeze
import asm
import bodies

OUT = Path(__file__).resolve().parent
EXPECTED = '764254976d9f0c5a246f16d89e31da3e3347d752582938c9033e59237a57fabb'
TARGETS = {'BattleCharacterLogic/wfxPartyMask', 'BattleCharacterLogic/getElement',
           'BattleCharacterLogic/getInstantAbiltyCountWithoutLimit',
           'TriggerableAbilityDialogAllAbilitiesGenerator/addAbility'}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def check_scope(before, after, ok):
    report = json.loads((ROOT / 'run9' / 'build-report.json').read_text(encoding='utf-8'))
    labels = bodies.label_map(before)
    changed = {labels.get(i, f'anonymous:{i}') for i, body in enumerate(before.bodies)
               if freeze(body) != freeze(after.bodies[i])}
    ok('只有四个指定原方法记录改变', changed == TARGETS)
    ok('恰好追加七个助手', len(after.bodies) - len(before.bodies) == 7)
    ok('全部原方法签名前缀不变', after.methods[:len(before.methods)] == before.methods)
    for label in TARGETS:
        index = bodies.resolve(before, label)
        original, current = before.bodies[index], after.bodies[index]
        actual = asm.unsplice_many(current[5], report['changed'][label]['insertions'])
        ok('撤销拼接逐字节恢复/' + label, actual == original[5])
    for added in report['added']:
        label, source = added['label'], added.get('derived_from')
        if not source:
            continue
        old = before.bodies[bodies.resolve(before, source)]
        new = after.bodies[bodies.resolve(after, label)]
        old_sig, new_sig = before.methods[old[0]], after.methods[new[0]]
        expected = copy.deepcopy(old_sig)
        if 'wfxResolveOwn' in label:
            expected[1].append(next(i for i in range(1, len(after.multinames))
                                    if after.mn_name(i) == 'Boolean'))
        ok('克隆签名返回类型flags和可选参数/' + label, new_sig == expected)
    pairs = [('BattleCharacterLogic/wfxElementBeforeOwnerMain', 'BattleCharacterLogic/getElement', {}),
             ('BattleCharacterLogic/wfxCachedElementBeforeOwnerMain', 'BattleCharacterLogic/get_element',
              {'wfxElementBeforeOwnerMain': 'getElement'}),
             ('BattlePartyLogic/wfxSameElementBeforeOwnerMain', 'BattlePartyLogic/getNumberOfSameElement',
              {'wfxCachedElementBeforeOwnerMain': 'get_element'})]
    for label, source, rewrites in pairs:
        new = copy.deepcopy(after.bodies[bodies.resolve(after, label)])
        old = before.bodies[bodies.resolve(before, source)]
        ops = asm.decode(new[5])
        for operation in ops:
            if operation.name == 'callproperty':
                name = after.mn_name(operation.args[0]).split('::')[-1]
                if name in rewrites:
                    operation.args[0] = next(i for i in range(1, len(before.multinames))
                                            if before.mn_name(i) == rewrites[name])
        new[5] = asm.encode(ops)[0]
        new[0] = old[0]
        ok('快照除指定路由外完整记录不变/' + label, freeze(new) == freeze(old))
    reason_pairs = [
        ('wfxResolveOwnPrecondition', 'resolvePrecondition', [(2, 2, 'forbid'), (55, 6, 'forbid')]),
        ('wfxResolveOwnAbility', 'resolve', [(2, 2, 'forbid'), (77, 1, 'forbid'), (155, 1, 'forbid')])]
    for new_name, old_name, insertions in reason_pairs:
        new = after.bodies[bodies.resolve(after, 'AbilityDisabledReasonResolver/' + new_name)]
        old = before.bodies[bodies.resolve(before, 'AbilityDisabledReasonResolver/' + old_name)]
        raw = asm.unsplice_many(new[5], insertions)
        ops = asm.decode(raw)
        for operation in ops:
            if operation.name == 'callpropvoid' and after.mn_name(operation.args[0]) == 'wfxResolveOwnPrecondition':
                operation.args = [next(i for i in range(1, len(before.multinames))
                                      if before.mn_name(i) == 'resolvePrecondition'), 5]
        ok('原因助手除范围注入和参数传递外逐字节原生/' + new_name, asm.encode(ops)[0] == old[5])
        ops = asm.decode(new[5])
        parameter, safe_local = (6, 14) if old_name == 'resolvePrecondition' else (5, 12)
        ok('额外参数先保存到原生local范围外/' + new_name,
           ops[2].name == 'getlocal' and ops[2].args == [parameter]
           and ops[3].name == 'setlocal' and ops[3].args == [safe_local]
           and safe_local >= old[2])


def check_elements(before, after, ok, executed):
    layouts = {'six': (1, 1, 1, 1, 1, 1), 'five': (1, 1, 1, 1, 1, 2),
               'mixed': (0, 1, 2, 3, 4, 5)}
    for layout, elements in layouts.items():
        for mask in range(32):
            for slot in range(3):
                source_index = slot + 3
                target_element = 2 if layout == 'six' else 1
                changes = {source_index: [(target_element, 11)]}
                e, party, main, _ = make_world(after, mask, elements, changes)
                old_e, old_p, old_main, _ = make_world(before, mask, elements, changes)
                old_mask = old_main['wfxPartyMask']()
                allow = bool(old_mask & 1 and (not old_mask & 8 or slot == 0))
                member = party['get_unisonCharacters']()[slot]['params'][0]
                actual = member['get_element']()
                expected = target_element if allow else elements[source_index]
                prefix = f'{layout}/mask{mask}/slot{slot}'
                ok(prefix + '/202变属性', actual == expected)
                ok(prefix + '/掩码始终按v35h判据', main['wfxPartyMask']() == old_mask)
                ok(prefix + '/再次读取缓存', member['get_element']() == actual)
                ok(prefix + '/快照统计不改外部缓存', member['cachedElement'] == actual)
                fresh = party['get_unisonCharacters']()[slot]['params'][0]
                ok(prefix + '/原生getter每次新对象且缓存空', fresh is not member and fresh['cachedElement'] is None)
                executed.update(e.executed)
    for mask in (None, 16, 18, 27, 31):
        for mode in ('no_party', 'first_none'):
            e, p, m, u = make_world(after, mask, changes={3: [(2, 11)]}, first_none=mode == 'first_none')
            if mode == 'no_party':
                m['party'] = u['party'] = None
            ok(f'无队伍/{mask}/{mode}/202原生', u['get_element']() == 1)
            ok(f'无队伍/{mask}/{mode}/掩码0', m['wfxPartyMask']() == 0)
            executed.update(e.executed)


def check_context(after, ok, executed):
    for mask in (1, 9, 16, 18, 27, 31):
        e, p, main, _ = make_world(after, mask)
        mains = p['get_mainCharacters']()
        unisons = p['get_unisonCharacters']()
        ok(f'真实主位getter隔离合击/{mask}', all(x['params'][0]['party'] is not p for x in mains))
        ok(f'真实合击getter保留队伍/{mask}', all(x['params'][0]['party'] is p for x in unisons))
        for slot in range(3):
            member = unisons[slot]['params'][0]
            for origin in (1000999, 1001000, 1006999, 1007000, 1011000, 1021000, 1023000):
                allow = bool(mask & 1 and (not mask & 8 or slot == 0) and 1001000 <= origin < 1007000)
                ok(f'来源边界/{mask}/{slot}/{origin}', member['wfxOwnerMainUnlocked'](origin) == allow)
            resolver = {'party': p}
            for category in (0, 1, 2, 3, 4):
                for number in (0, 1, 6, 7):
                    ability = {'get_originKind': lambda c=category, n=number: kind(c, n)}
                    result = e.run('AbilityDisabledReasonResolver/wfxOwnAbilityUnlocked', resolver, ability, True, slot)
                    expected = bool(category == 0 and 1 <= number <= 6 and mask & 1 and (not mask & 8 or slot == 0))
                    ok(f'面板真实getter归属/{mask}/{slot}/{category}/{number}', result == expected)
        executed.update(e.executed)


def run():
    path = ROOT / 'run9' / 'v35i.swf'
    assert sha(path.read_bytes()) == EXPECTED
    before = SwfAbc(ROOT / 'run8' / 'v35h.swf').abc
    after = SwfAbc(path).abc
    checks, executed = [], set()
    def ok(name, result):
        assert result, name
        checks.append(name)
    check_scope(before, after, ok)
    check_elements(before, after, ok, executed)
    check_context(after, ok, executed)
    labels = bodies.label_map(after)
    methods = {body[0]: labels.get(i, f'anonymous:{i}') for i, body in enumerate(after.bodies)}
    report = {'status': 'pass', 'output_sha256': EXPECTED, 'check_count': len(checks),
              'checks': checks, 'executed_methods': sorted(methods[x] for x in executed),
              'source_sha256': {p.name: sha(p.read_bytes()) for p in (Path(__file__), OUT / 'probe_runtime.py')},
              'prior_rejected_candidate': {'sha256': 'fc077dd5edfad4ef0233de9a8d8041fc77ef3f785701d7b93cdd6bfc2e4e151b',
                  'finding': '202-720 plus mask16/18 recursively reentered live element evaluation',
                  'probe_result': 'RecursionError', 'resolution': 'all bit16 queries route through v35h snapshots'},
              'unverified': ['完整 AIR', 'Android 真机', '实际 UI', '设备性能'],
              'fixture_boundary': '角色/队伍构造初始化、主表、普通能力输入为夹具；party getter/缓存/元素/掩码/来源助手为真实最终字节码。'}
    (OUT / 'review-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': 'pass', 'checks': len(checks), 'sha256': EXPECTED}))


if __name__ == '__main__':
    run()
