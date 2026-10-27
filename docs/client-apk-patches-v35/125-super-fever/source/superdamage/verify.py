"""从真实ABC运行finish、完整_calculate与完整敌伤入口，并做行为变异复审。"""
import copy
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bootstrap
from bootstrap import ROOT, BASE, output_path
from framework import Editor, sha
from swfabc import SwfAbc
from multiabc import compose
import asm
import bodies
from superdamage.fixture import Harness, attack, calculate, enemy_case


def scenarios(before, after, overrides=None):
    checks = []
    def check(name, got, expected):
        assert got == expected, (name, got, expected)
        checks.append(name)
    def value(abc, ref=4, strength=100, **kw):
        h = Harness(abc, overrides=overrides if abc is after else None)
        a = attack(h, ref, strength)
        result, stats = calculate(h, a, **kw)
        return result['damage'] / 100, stats
    for ref in [0, 1, 2, 3]:
        for ability, resistance in [(0, 0), (100000, 25000), (-50000, -10000)]:
            check(f'old-ref{ref}-{ability}-{resistance}', value(after, ref, ability=ability, resistance=resistance)[0],
                  value(before, ref, ability=ability, resistance=resistance)[0])
    for kind in ['createdByDirectAttack', 'createdByPowerFlipAction', 'createdByMainSkillAction',
                 'createdByUnisonSkillAction', 'createdBySkillInvoker']:
        for ref in [0, 1, 2]:
            results = []
            for abc in [before, after]:
                h = Harness(abc, overrides=overrides if abc is after else None)
                a = attack(h, ref, 50000)
                a.pop('wfxSuperFixed', None)
                a.update(createdByAbility=False, powerFlipChargeLv=2)
                a[kind] = True
                results.append(calculate(h, a)[0])
            check('old-native-'+kind+'-'+str(ref), results[1], results[0])
    check('fixed-naked', value(after)[0], 100)
    check('fixed-no-ability', value(after, ability=300000)[0], 100)
    check('legacy3-ability-kept', value(after, 3, ability=300000)[0], 400)
    check('fixed-enemy-ability-resistance', value(after, ability=300000, resistance=25000)[0], 75)
    check('fixed-enemy-element-resistance', value(after, element_resistance=100000)[0], 50)
    check('fixed-enemy-element-vulnerable', value(after, element_resistance=-50000)[0], 150)
    check('fixed-no-element-advantage', value(after, opposite=1.5)[0], 100)
    check('fixed-no-random', value(after, random=0.95)[0], 100)
    check('fixed-no-field', value(after, field=500000)[0], 100)
    buffs = {'getStatModifierSeparatedTermAbilityDamage': 200000,
             'getStatModifierSeparatedTermDamage': 300000,
             'getStatModifierAdversityMin': 50000, 'getStatModifierAdversityMax': 50000,
             'getStatModifierAllCharacterSlayers': [{'target': 1, 'n': 200000}],
             'getStatModifierPinchSlayer': 500000}
    check('fixed-no-attacker-buffs', value(after, ability=200000, attacker=buffs, target={'matchCharacterGroup': True})[0], 100)
    slayers = {'getStatModifierAllConditionSlayers': [
        {'target': 1, 'attackKind': {'index': 0}, 'n': 200000},
        {'target': 1, 'attackKind': {'index': 4}, 'n': 300000}],
        'getStatModifierTriggerEnemySlayer': 50000}
    check('fixed-no-condition-or-trigger-slayers', value(after, attacker=slayers, target={'matchCondition': True})[0], 100)
    check('fixed-conditional-enemy-resistance', value(after, attacker={'matchCondition': True},
        target={'getResistanceToConditionEnemies': [{'target': 1, 'strength': 20000}]})[0], 80)
    check('fixed-enemy-pinched', value(after, attacker=buffs, target={'hasPinched': True})[0], 150)
    check('fixed-enemy-guard', value(after, target={'hasGuarded': True})[0], 20)
    check('fixed-flat-cut', value(after, target={'getStatModifierElementDamageCut': 1000})[0], 90)
    check('fixed-percent-cut', value(after, target={'getStatModifierElementDamageCutPercent': lambda el, n: n*100*0.25})[0], 75)
    check('fixed-invincible', value(after, target={'isInvincible': True})[0], 0)
    check('fixed-metal1', value(after, target={'getMetalKind': 1})[0], 1)
    check('fixed-metal2', value(after, target={'getMetalKind': 2})[0], 0)
    check('fixed-cap', value(after, strength=10**12)[0], 999999999)
    for name, args, expected in [
        ('primary', {}, 25), ('other-end', {'primary': False}, None),
        ('spectator', {'mybattle': False}, None), ('dead', {'receivable': False}, None),
        ('zero', {'damage': 0}, None), ('overkill', {'hp': 1000}, 10),
        ('summon', {'detail': {'createdBySummonsMultiBall': True, 'createdByPrimarySquad': False}}, 25),
        ('coop-ball', {'detail': {'createdByPrimarySquad': False, 'originMemberIndex': 1}}, 25),
        ('hostile', {'detail': {'isFromHostile': True}}, None),
        ('explicit-other-owner', {'detail': {'wfxSuperOwnerLocal': False}}, None),
        ('explicit-local-owner', {'detail': {'wfxSuperOwnerLocal': True}}, 25),
        ('boss', {'detail': {'createdByBoss': True}}, None),
        ('funnel', {'detail': {'createdByFunnel': True}}, None),
        ('unowned', {'detail': {'createdByPrimarySquad': False, 'originMemberIndex': -1}}, None)]:
        h = Harness(after, overrides=overrides)
        events = enemy_case(h, **args)
        got = [n for kind, n in events if kind == 'record']
        check('record-'+name, got, [] if expected is None else [expected])
        old = enemy_case(Harness(before), **args)
        check('old-enemy-effects-'+name, [ev for ev in events if ev[0] != 'record'], old)
    return checks


def verify(before, after):
    baseline = scenarios(before, after)
    mutations = []
    labels = ['AbilityDamageShot/finish', 'NormalAttackCalculator/_calculate', 'EnemyImpl/wfxSuperRecordAttack', 'EnemyImpl/applyAttack']
    for label in labels:
        ins = asm.decode(after.bodies[bodies.resolve(after, label)][5])
        for i, item in enumerate(ins):
            if label.endswith('/_calculate'):
                selected = item.name == 'getproperty' and after.mn_name(item.args[0]) == 'wfxSuperFixed'
            elif label.endswith('/finish'):
                selected = item.name == 'pushbyte' and item.args == [4] and (i < 160 or i > 450)
            elif label.endswith('/applyAttack'):
                selected = item.name == 'callpropvoid' and after.mn_name(item.args[0]) == 'wfxSuperRecordAttack'
            else:
                selected = item.name in ('iffalse', 'iftrue', 'ifngt', 'iflt', 'ifge', 'ifne') or item.name == 'divide'
            if not selected:
                continue
            mutant = copy.deepcopy(ins)
            if item.name == 'getproperty':
                # 替换为旧已有字段false，固定路径失效。
                q = next(k for k in range(1, len(after.multinames)) if after.mn_name(k) == 'createdByDirectAttack')
                mutant[i].args[0] = q
            elif item.name == 'pushbyte':
                mutant[i].args[0] = 3
            elif item.name == 'callpropvoid':
                mutant[i].args[0] = next(k for k in range(1, len(after.multinames)) if after.mn_name(k) == 'showHitEffect')
            elif item.name == 'divide':
                mutant[i] = asm.assemble([('multiply',)])[0]
            else:
                mutant[i].op = {'iffalse': 0x11, 'iftrue': 0x12, 'ifngt': 0x17, 'iflt': 0x18, 'ifge': 0x15, 'ifne': 0x13}[item.name]
            try:
                scenarios(before, after, {label: mutant})
            except Exception as exc:
                mutations.append({'method': label, 'instruction': i, 'detected': True, 'error': str(exc)[:240]})
            else:
                raise AssertionError('变异存活: '+label+':'+str(i))
    assert scenarios(before, after) == baseline
    return {'status': 'pass', 'checks': len(baseline), 'cases': baseline, 'mutants': len(mutations),
            'mutation_results': mutations, 'survived': [], 'final_baseline': 'pass'}


def main():
    final = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT/'v35c.swf'
    before, after = SwfAbc(BASE).abc, SwfAbc(final).abc
    saved = after.serialize()
    report = verify(before, after)
    if len(sys.argv) > 1 and Path(sys.argv[1]).name == 'v35c.swf':
        from superdamage.integration import verify as verify_integration
        integrated = verify_integration(after)
        integrated['swf_sha256'] = sha(final.read_bytes())
        output_path(ROOT/'superdamage'/'integration-report.json').write_text(
            json.dumps(integrated, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
        report['integration'] = {'report': 'integration-report.json', 'checks': integrated['checks'], 'status': 'pass'}
    assert after.serialize() == saved
    report.update(swf_sha256=sha(final.read_bytes()), input_swf=str(final), abc_restoration='byte_identical')
    output_path(ROOT/'superdamage'/'verify-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({k: report[k] for k in ['status', 'checks', 'mutants']}))


if __name__ == '__main__':
    main()
