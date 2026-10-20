"""完整 NormalAttackCalculator/_calculate 的受控目标/成员边界。无公式替身。"""
import math
from .runtime import VM,noop,enum

def calculate(h,attack,kind=4,attack_point=1000,attack_bonus=50000,bonus=100000,resistance=25000,element_resistance=0):
 attacker=attack['attacker']
 zeros=['getStatModifierAttackPoint','getStatModifierTriggerEnemySlayer','getStatModifierSeparatedTermAbilityDamage',
        'getStatModifierAdversityMin','getStatModifierAdversityMax','getStatModifierAdversityMaxLimitless',
        'getStatModifierAdversityMinLimitless','getStatModifierSeparatedTermDamage','getStatModifierStunify','getStatModifierFeverPoint']
 for n in zeros:attacker[n]=lambda *args:0
 for n in ['getStatModifierAllConditionSlayers','getStatModifierAllBattleConditionSlayers','getStatModifierAllCharacterSlayers']:
  attacker[n]=lambda:[]
 for n in ['setExceptsReductionForStatistics','notifiyAttackModifierValue','notifySpecialExtraRate']:
  attacker[n]=noop
 for n in ['getStatModifierTriggerEnemyDisguiseStunWinceSlayer','isBoss','isFunnel']:
  attacker[n]=lambda *args:False
 attacker.update({'getAttackPoint':lambda:999999,'getStatModifierAbilityDamage':lambda:bonus,
                  'getDisguisableRelativeMaximumHealthPoint':lambda:10000,'getDisguisableRelativeCurrentHealthPoint':lambda:10000})
 target={}
 for n in ['getAttackPointFromConditionEnemies','getStatModifierElementResistanceToConditionEnemies','getResistanceToConditionEnemies','getTargetEnemy','matchTrial','getDamageCheckId']:
  target[n]=lambda *args:None
 for n in ['matchCharacterGroup','matchCondition','hasPinched','hasGuarded','isInvincible','isBreakableBlock','hasBarrier']:
  target[n]=lambda *args:False
 for n in ['getStatModifierElementDamageCut','getStatModifierElementDamageCutPercent','getMetalKind']:
  target[n]=lambda *args:0
 target.update({'setExceptsReductionForStatistics':noop,'isHostile':lambda:True,'isDamageReceivable':lambda:True,
                'getRealCurrentHealthPoint':lambda:10**12,'getStatModifierAbilityDamageResistance':lambda:resistance,
                'getStatModifierElementResistance':lambda n:element_resistance})
 h.lex['Decimal_Impl_'].update({'toFloat':lambda n:n/100000,'multiplyFloat':lambda a,b:a*b/100000,
                              'divideFloat':lambda a,b:a*100000/b,'min':min,'max':max,'multiply':lambda a,b:a*b/100000})
 h.lex['FloatInt_Impl_'].update({'toFloat':float,'max':max,'clamp':lambda n,a,b:max(a,min(n,b)),'floor':lambda n:math.floor(n+2e-10)})
 h.lex.update({'ImpactCalculator':{'hasDamageMovedBecauseElement':lambda *a:False,'getOppositeElementCorrectionFactor':lambda *a:1},
               'ConditionSlayerAttackKind':{'Attack':2,'All':0,'AbilityDamage':4},
               'Damage_Impl_':{'ffloor':lambda n:math.floor(n/100),'_new':lambda n:n,'isNaN':math.isnan,'toFloat':lambda n:n/100},
               'CommonBattleConstants':{'MAX_DAMAGE':999999999},
               'NormalAttackCalculator':{'COMBO_BONUS':0.1,'BUFF_COUNT_BONUS':0.1,'CORRECTION_FACTOR_TARGET_PINCHED':1.5,'CORRECTION_FACTOR_TARGET_GUARDED':0.5},
               'Maybe_Impl_':{'tmp':None},'IntMap':VM.Cls('IntMap',ctor=lambda:{'set':noop}),
               'Math':{'NaN':math.nan,'min':min}})
 obj={'getRandomCorrectionValue':lambda _:1,'modifierFieldManager':{'getModifierSeparatedTerm2ndAbilityDamage':lambda:0},'settings':{'playerAttackFix':enum(1)}}
 stats={'damageCount':0,'avarageDamage':0,'totalFever':0,'damage':0}
 attacker['notifiyAttackModifierBattleValue']=noop
 attacker['getStatModifierSeparatedTermConditionSlayers']=lambda:[]
 attacker['getStatModifierBattleTriggerEnemySlayer']=lambda *a:0
 attacker['getStatModifierPinchSlayer']=lambda:0
 attacker['getAttackPoint']=lambda:attack_point
 attacker['getStatModifierAttackPoint']=lambda:attack_bonus
 for name in ['getStatModifierSkillDamage','getStatModifierPowerFlipDamage','getStatModifierDirectAttackDamage']:
  attacker[name]=lambda:bonus
 for name in ['getStatModifierPowerFlipLvDamage','getStatModifierPowerFlipLvDamageAdd','getStatModifierSeparatedTermPowerFlipDamage','getStatModifierSeparatedTermSkillDamage','getStatModifierSeparatedTermDirectAttackDamage']:
  attacker[name]=lambda *a:0
 for name in ['getStatModifierSkillDamageResistance','getStatModifierPowerFlipDamageResistance','getStatModifierDirectAttackDamageResistance']:
  target[name]=lambda:resistance
 h.lex['BattleConditionSlayerAttackKind']={'PowerFlip':3}
 h.lex['ConditionSlayerAttackKind'].update({'Skill':1,'PowerFlip':3,'DirectAttack':5})
 obj['modifierFieldManager'].update({'getModifierSeparatedTerm2ndSkillDamage':lambda:0,'getModifierSeparatedTerm2ndPowerFlipDamage':lambda:0,'getModifierSeparatedTerm2ndDirectDamage':lambda:0})
 h.lex['NormalAttackCalculator']['STAT_MODIFIER_ATTACK_POINT_MIN']=-100000
 h.bind(h.lex['NormalAttackCalculator'],'NormalAttackCalculator$',['totalAttackPoint'])
 result=h.run('NormalAttackCalculator/_calculate',obj,target,attack,1,stats,True,{})
 return result,stats
