"""正常伤害计算器与敌人完整applyAttack的受控外围。"""
import sys
from bootstrap import RUN2
sys.path.append(str(RUN2))
from overflow.runtime import Harness, VM, noop, enum
from overflow.damage_fixture import calculate as base_calculate

# AVM2的动态Object缺此新属性返回undefined；测试其他缺字段仍保持严格检查。
_lookup = VM._lookup
def lookup(obj, key):
    if isinstance(obj, dict) and key.split('::')[-1] == 'wfxSuperFixed':
        return obj.get('wfxSuperFixed')
    return _lookup(obj, key)
VM._lookup = lookup


def calculate(h, attack, **options):
    original_run = h.run
    def run(label, obj, *args):
        if label == 'NormalAttackCalculator/_calculate':
            target = args[0]
            attacker = attack['attacker']
            for key in ['getStatModifierDirectAttackDamage', 'getStatModifierSeparatedTermDirectAttackDamage',
                        'getStatModifierPowerFlipDamage', 'getStatModifierPowerFlipLvDamageAdd',
                        'getStatModifierPowerFlipLvDamage', 'getStatModifierSeparatedTermPowerFlipDamage',
                        'getStatModifierBattleTriggerEnemySlayer', 'getStatModifierSkillDamage',
                        'getStatModifierSeparatedTermSkillDamage']:
                attacker.setdefault(key, lambda *a: 0)
            attacker['notifiyAttackModifierBattleValue'] = noop
            attacker['getStatModifierSeparatedTermConditionSlayers'] = lambda: []
            for key in ['getStatModifierDirectAttackDamageResistance', 'getStatModifierPowerFlipDamageResistance',
                        'getStatModifierSkillDamageResistance']:
                target.setdefault(key, lambda *a: 0)
            for key in ['getModifierSeparatedTerm2ndDirectDamage', 'getModifierSeparatedTerm2ndPowerFlipDamage',
                        'getModifierSeparatedTerm2ndSkillDamage']:
                obj['modifierFieldManager'][key] = lambda: 0
            for key, value in options.get('attacker', {}).items():
                attacker[key] = value if callable(value) else lambda *a, v=value: v
            for key, value in options.get('target', {}).items():
                target[key] = value if callable(value) else lambda *a, v=value: v
            obj['modifierFieldManager']['getModifierSeparatedTerm2ndAbilityDamage'] = lambda: options.get('field', 0)
            obj['getRandomCorrectionValue'] = lambda _: options.get('random', 1)
            obj['getRandomAddendValue'] = lambda _: 0
            h.lex['BattleConditionSlayerAttackKind'] = {'PowerFlip': 0}
            h.lex['ConditionSlayerAttackKind'].update(DirectAttack=1, Skill=3)
            h.lex['ImpactCalculator']['getOppositeElementCorrectionFactor'] = lambda *a: options.get('opposite', 1)
            h.lex['NormalAttackCalculator']['CORRECTION_FACTOR_TARGET_GUARDED'] = 0.2
            h.lex['NormalAttackCalculator']['STAT_MODIFIER_ATTACK_POINT_MIN'] = -90000
            h.bind(h.lex['NormalAttackCalculator'], 'NormalAttackCalculator$', ['totalAttackPoint'])
            h.lex['Decimal_Impl_']['clamp'] = lambda n, a, b: max(a, min(n, b))
        return original_run(label, obj, *args)
    h.run = run
    try:
        return base_calculate(h, attack, options.get('ability', 0), options.get('resistance', 0), options.get('element_resistance', 0))
    finally:
        h.run = original_run


def attack(h, reference=4, strength=100):
    member = h.unit()
    h.shot(member, h.enemies[0], enum(1, 0, {'origin': 0}, False), 1, reference, strength, False, 0)
    return h.impacts[-1][1]['content']


def enemy_case(h, **options):
    events = []
    def record(n):
        events.append(('record', n))
        if options.get('record'):
            options['record'](n)
    leader = {'wfxSuperRecordDamage': record}
    stats = {'add': noop, 'recordDamageToBoss': noop, 'recordDamageToFunnel': noop}
    leader['stats'] = stats
    manager = {'primary': {'getMember': lambda i: enum(0, leader)},
               'countUpDamageByAbility': noop, 'summerizeAttackResult': noop}
    enemy = {'kind': 1, 'xdebugSettings': {'bossRejectAttack': False, 'zakoRejectAttack': False},
             'battle': {'__isMyBattle__': lambda: options.get('mybattle', True)},
             'isDamageReceivable': lambda: options.get('receivable', True),
             'healthPointGauge': {'calcurateDamageWithoutOverdamage': lambda d, b: min(d, options.get('hp', 100000))},
             'squadManager': manager, 'stats': {**stats, 'summerizeAttackToEnemy': noop},
             'isBoss': lambda: False, 'isFunnel': lambda: False, 'isDead': lambda: False,
             'zone': {'isFeverMode': lambda: False}, 'enemyId': 'e', 'addFeverPoint': noop,
             'subtractHealthPoint': lambda *a: events.append(('subtract', a[0])),
             'battleAbilityTrigger': {'enemyDamageCountUp': noop}, 'subtractToughnessPointIfPossible': noop,
             'enemyParts': None, 'showHitEffect': noop, 'showDamageFont': noop,
             'viewOrder': {'playSoundEffect': noop}, 'conditionSlot': {'isInvincible': lambda: True},
             'effectOffsetX': 0, 'effectOffsetY': 0}
    h.lex['BattleSoundMode'] = {'Me': enum(0)}
    h.bind(enemy, 'EnemyImpl', ['wfxSuperRecordAttack'])
    impact = {'createdByPrimaryBattle': options.get('primary', True), 'hitEffect': enum(1),
              'hitEffectX': 0, 'hitEffectY': 0, 'hitEffectAngle': 0}
    detail = {k: False for k in ['isFromHostile', 'createdByBoss', 'createdByFunnel', 'createdBySummonsMultiBall',
              'createdByMainSkillAction', 'createdByUnisonSkillAction', 'createdByPowerFlipAction',
              'createdByDirectAttack', 'damageIncreasedBecauseTargetIsPinched']}
    detail.update({'damage': options.get('damage', 2500), 'isForBarrier': False, 'incrementCombo': False,
              'createdByPoison': False, 'createdByAbility': True, 'createdByPrimarySquad': True,
              'originMemberIndex': 0, 'fever': 0, 'damageCheckId': None, 'shouldShowDamageFont': False,
              'specificDamageResistance': 0, 'enemyPartTargets': 0, 'toughness': 0, 'multiballId': None})
    detail.update(options.get('detail', {}))
    h.run('EnemyImpl/applyAttack', enemy, impact, detail, None)
    return events
