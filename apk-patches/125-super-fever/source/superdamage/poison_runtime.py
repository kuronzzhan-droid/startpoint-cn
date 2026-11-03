"""毒和实际共享伤害的原生方法串联；不模拟来源判定算法。"""
from .fixture import Harness, VM, enum, noop, enemy_case


def target(**options):
    return {'isHostile':lambda:True,'isImmunisitionFriendlyFire':lambda:False,
            'getRealCurrentHealthPoint':lambda:options.get('hp',100000),
            'isInvincible':lambda:options.get('invincible',False),
            'isInvincibleByPhaseChange':lambda:options.get('phase',False),
            'isBreakableBlock':lambda:False,'getMetalKind':lambda poison:options.get('metal',0),
            'hasBarrier':lambda:options.get('barrier',False),
            'matchTrial':lambda *args:None,
            'isDamageReceivable':lambda:options.get('receivable',True),
            'getDamageCheckId':lambda:None}


def setup(h):
    h.lex['Decimal100_Impl_'].update(min=min,fromFloat=lambda n:n*100)
    h.lex['FloatInt_Impl_'].update(toFloat=float)
    h.lex['Damage_Impl_']={'_new':lambda n:n}
    h.lex['CommonBattleConstants']={'MAX_DAMAGE':999999999}
    h.lex['ImpactSourceContent']['FixedAttack']=lambda obj:enum(2,obj)


def slip(h, stats_battle='battle-A', origin=0, hostile=False, poison=True, amount=2500):
    setup(h)
    captured=[]
    enemy={'x':0,'y':0,'battle':{'get_id':lambda:'battle-A'},
           'zoneManager':{'addImpact':lambda enemy,impact:captured.append(impact)}}
    h.bind(enemy,'EnemyImpl',['addSelfImpact'])
    modifier={'statsBattleId':stats_battle,'originMemberIndex':origin,'isFromHostile':hostile}
    h.run('EnemyImpl/applySlipHandler',enemy,amount,poison,modifier)
    assert len(captured)==1 and captured[0]['createdByCoopCommand'] is False
    return captured[0]['content']['params'][0]


def fixed(h, source, **options):
    setup(h)
    return h.run('FixedAttackCalculator/calculate',{},target(**options),source)


def share(h, result, only_coop=False, chain=False, **options):
    method='calculateFromSkillChainResult' if chain else 'calculateFromAttackResult'
    return h.run('DamageShareCalculator/'+method,{},target(),target(**options),result,only_coop)


def apply_share(h,result,primary=True,mybattle=True,hp=100000):
    events=[]
    leader={'wfxSuperRecordDamage':lambda value:events.append(('record',value))}
    enemy={'kind':1,'xdebugSettings':{'bossRejectAttack':False,'zakoRejectAttack':False},
           'battle':{'__isMyBattle__':lambda:mybattle},
           'healthPointGauge':{'calcurateDamageWithoutOverdamage':lambda damage,barrier:min(damage,hp)},
           'stats':{'summerizeDamageShareToEnemy':lambda *args:events.append(('stats',args[3]))},
           'squadManager':{'primary':{'getMember':lambda n:enum(0,leader)}},
           'subtractHealthPoint':lambda damage,barrier,check,shared:events.append(('subtract',damage,barrier,shared))}
    h.bind(enemy,'EnemyImpl',['wfxSuperRecordAttack'])
    h.run('EnemyImpl/applyDamageShare',enemy,{'createdByPrimaryBattle':primary},result,None)
    return events


def apply_attack(h,result,**options):
    original=h.run
    def run(label,obj,*args):
        if label=='EnemyImpl/applyAttack':
            obj['comboCalculator']={'createCombo':noop}
        return original(label,obj,*args)
    h.run=run
    try:return enemy_case(h,detail=result,**options)
    finally:h.run=original
