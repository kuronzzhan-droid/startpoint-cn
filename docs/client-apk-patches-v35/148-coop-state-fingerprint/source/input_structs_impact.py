"""Freeze reviewed Impact erased record types, with current-ABC method evidence."""
import json
import bootstrap
from framework import Editor
from common import listing


def make():
    records = {}
    attack = {key: 'Boolean' for key in '''createdByNormalAttack createdByPrimarySquad
        createdBySummonsMultiBall createdByPowerFlipAction createdByMainSkillAction
        createdByUnisonSkillAction createdByAbility createdByUnisonAbility createdByDirectAttack
        createdByBoss createdByFunnel createdByOuthole damageIncreasedBecauseOppositeElement
        damageIncreasedBecauseTargetIsPinched damageDecreasedBecauseTargetIsGuarded incrementCombo
        incrementComboEvenIfTargetIsDead createdByPoison decrementCoffinCount isForBarrier
        isFriendlyFire isDamageReceivable isDuringPiercing isDuringFlying shouldShowDamageFont'''.split()}
    attack.update({key: 'Number' for key in 'damage toughness fever elementResistanceRate reductionDamage'.split()})
    attack.update({key: 'int' for key in '''attackSource originMemberIndex powerFlipChargeLv
        specificDamageResistance executionCount trialId damageCheckId multiballId originMemberKind
        multiballIndex multiballCount'''.split()})
    attack.update(enemyId='String', enemyPartTargets='uint', friendlyFireDerivation='String',
                  specialExtraDamageRates='intmap:Number')
    records['record:ImpactAttack'] = attack
    records['record:ImpactHeal'] = dict(cure='Number', contributorBattleId='String', createdByContinue='Boolean',
        isFromHostile='Boolean', statsBattleId='String', shouldCountForMission='Boolean',
        originMemberIndex='int', createdBySummonsMultiBall='Boolean', isHealRejected='Boolean')
    records['record:ImpactConditionChanges'] = dict(resistedEffect='Boolean', isFromHostile='Boolean',
        statsBattleId='String', contents='array:pinball.online.battle.impact.condition::ConditionChangeResultContent',
        shouldCountForMission='Boolean', linkedTrialId='int', createdByConditionShare='Boolean', forceApply='Boolean')
    records['record:ImpactConditionCancels'] = dict(content='pinball.common.data.character.condition::ConditionTargetKind',
        candidateIds='array:String', number='int', isFromHostile='Boolean', statsBattleId='String',
        shouldCountForMission='Boolean', originMemberIndex='int', createdByConditionShare='Boolean',
        syncMode='pinball.battle.action.dsl.const::DeleteConditionSyncMode')
    records['record:ImpactDecreaseCoffinCount'] = dict(count='int')
    records['record:ImpactSkillChain'] = dict(numChains='int', damage='Number', damageIncreasedBecauseOppositeElement='Boolean',
        damageIncreasedBecauseTargetIsPinched='Boolean', isForBarrier='Boolean', damageCheckId='int', trialId='int')
    records['record:ImpactBarrier'] = dict(barrierHp='Number')
    records['record:ImpactDamageShare'] = dict(damage='Number', isForBarrier='Boolean', createdByPoison='Boolean',
        damageCheckId='int', isOnlyCoop='Boolean')
    records['record:ImpactConditionConsume'] = dict(uniqueConditionId='int', limit='option:int', createdByConditionShare='Boolean')
    records['record:ImpactRecoveryHitCountCheck'] = dict(trialId='int', count='int')
    records['record:ImpactHitEffect'] = dict(serial='Boolean', paths='array:String',
        position='pinball.online.battle.impact::ImpactHitEffectPosition', randomRotation='Boolean')
    records['record:GeneralBipolarDecreaseValue'] = dict(count='int', value='Number')
    variants = ['Attack', 'Heal', 'ConditionChanges', 'ConditionCancels', 'DecreaseCoffinCount',
                'SkillChain', 'Barrier', 'DamageShare', 'ConditionConsume', 'RecoveryHitCountCheck']
    overrides = [dict(owner='pinball.online.battle.impact::ImpactResultContent', variant=i, param=0,
                      type='record:Impact' + name) for i, name in enumerate(variants)]
    overrides += [dict(owner='pinball.common.data.character.condition::ConditionChangeContent', variant=10, param=0,
                       type='array:pinball.common.data.ability::CharacterGroup'),
                  dict(owner='pinball.common.data.character.condition::ConditionChangeContent', variant=34, param=1,
                       type='array:record:GeneralBipolarDecreaseValue')]
    overrides += [dict(owner='pinball.common.data.character.condition::ConditionTargetKind', variant=i, param=0,
                       type='int') for i in (5, 43)]
    overrides.append(dict(owner='pinball.online::BattleZoneCoopCommand', variant=8, param=1,
                          type='array:String'))
    slots = {'pinball.online.battle.impact::ImpactResult/id': 'option:String',
             'pinball.online.battle.impact::ImpactResult/hitEffect': 'option:record:ImpactHitEffect'}
    base = 'pinball.online.battle.impact.condition::ConditionChangeResultContent/'
    slots.update({base + key: 'option:int' for key in ['ballFlipLimit', 'powerFlipLimit', 'endPowerFlipLimit']})
    slots[base + 'endPowerFlipAcceptedLevels'] = 'array:int'
    return dict(records=records, overrides=overrides, slots=slots)


def main():
    bootstrap.check_baseline()
    e, result = Editor(bootstrap.BASE, {}), make()
    labels = ['NormalAttackCalculator/_calculate', 'FixedAttackCalculator/calculate', 'RatioAttackCalculator/calculate',
              'NoDamageAttackCalculator/calculate', 'NormalHealCalculator/calculate', 'ConditionChangeCalculator/calculate',
              'ConditionCancelCalculator/calculate', 'ConditionConsumeCalculator/calculate', 'SkillChainCalculator/calculate',
              'BarrierCalculator/calculate', 'DamageShareCalculator/calculateFromAttackResult', 'RecoveryHitCountCheckCalculator/calculate',
              'DamageCheckGaugeImpl/getDamageCheckId', 'HitCountCheck/matchTrial', 'ImpactCalculator/calculate',
              'EnemyImpl/applyConditionCancelSync', 'EnemyImpl/sendConditionCancelSyncTo']
    result['evidence'] = []
    for label in labels:
        b = e.body(label)
        lines = listing(e.abc, b[5])
        dest = bootstrap.output_path(bootstrap.ROOT/'audit'/'inputs'/'structs'/(label.replace('/', '__')+'.pcode.txt'))
        dest.write_text('\n'.join(lines)+'\n', encoding='utf-8')
        result['evidence'].append(dict(method=label, sha=bootstrap.sha(b[5]), header=b[1:5],
                                       pcode=str(dest.relative_to(bootstrap.ROOT))))
    dest = bootstrap.output_path(bootstrap.ROOT/'input-structs-impact.json')
    dest.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print('Impact records', len(result['records']), 'factory overrides', len(result['overrides']))


if __name__ == '__main__': main()
