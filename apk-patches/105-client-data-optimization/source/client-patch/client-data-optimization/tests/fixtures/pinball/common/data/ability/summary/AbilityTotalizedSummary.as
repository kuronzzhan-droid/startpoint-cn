package pinball.common.data.ability.summary {import pinball.common.data.character.BattleCharacterLogic;public class AbilityTotalizedSummary {public var thresholdMode:int;public var battleCharacterLogic:BattleCharacterLogic;public var ability:AbilityContentSummary;public var fixedSkillGauge:int;
public var statModifierAttackPoint:Number;
public var statModifierSkillDamage:Number;
public var statModifierDirectAttackDamage:Number;
public var statModifierAbilityDamage:Number;
public var statModifierPowerFlipDamage:Number;
public var skillGauge:Number;
public var secondSkillGauge:Number;
public var statModifierMultiballAttackPoint:Number;
public var statModifierMultiballDirectAttackDamage:Number;
public var attackTotalValue:Number;
public var skillDamageTotalValue:Number;
public var directAttackDamageTotalValue:Number;
public var abilityDamageTotalValue:Number;
public var powerFlipDamageTotalValue:Number;
public function AbilityTotalizedSummary(c:BattleCharacterLogic,a:AbilityContentSummary,m:int){} } }