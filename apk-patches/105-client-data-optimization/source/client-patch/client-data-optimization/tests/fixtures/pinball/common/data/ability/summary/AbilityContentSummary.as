package pinball.common.data.ability.summary { public class AbilityContentSummary {public static var getterCalls:int=0; public var values:Object;public function AbilityContentSummary(v:Object){values=v;}
public function getStatModifierAttackPoint(all:Boolean=false):Number{getterCalls++;return Number(values.getStatModifierAttackPoint);}
public function getStatModifierSkillDamage(all:Boolean=false):Number{getterCalls++;return Number(values.getStatModifierSkillDamage);}
public function getStatModifierDirectAttackDamage(all:Boolean=false):Number{getterCalls++;return Number(values.getStatModifierDirectAttackDamage);}
public function getStatModifierAbilityDamage(all:Boolean=false):Number{getterCalls++;return Number(values.getStatModifierAbilityDamage);}
public function getStatModifierPowerFlipDamage(all:Boolean=false):Number{getterCalls++;return Number(values.getStatModifierPowerFlipDamage);}
public function getStatModifierMultiballAttackPoint(all:Boolean=false):Number{getterCalls++;return Number(values.getStatModifierMultiballAttackPoint);}
public function getStatModifierMultiballDirectDamage(all:Boolean=false):Number{getterCalls++;return Number(values.getStatModifierMultiballDirectDamage);}
public function getSkillGauge():Number{getterCalls++;return Number(values.gauge);}
public function getFixedSkillGauge():int{getterCalls++;return int(values.fixed);}
public function getSecondSkillGauge():Number{getterCalls++;return Number(values.second);}
} }