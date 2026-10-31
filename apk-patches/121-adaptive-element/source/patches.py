"""TASK2 第1、2组：单方法指令插入，保留v35a含11/32旧补丁。"""
import asm
from .common import data_helpers,sym,n
from . import adaptive,leaders

def build(e):
    asm.MNEMONICS.setdefault('avm_label',0x09)
    h=data_helpers(e); adaptive.build(e,h); k=leaders.build(e,h)
    # 仅放开 unisonable 列过滤，保留其它原生前置/kind判定。
    e.insert('BattleCharacterLogic/getOpitionAbilitiesWithoutAbilitySoul',85,[
        ('getlocal_0',),('callproperty',h['mask'],0),('pushbyte',1),('bitand',),('bitor',)])
    for label,at,tutorial,summary in [
        ('BattleCharacterLogic/getAvailableAbilities',549,('getlocal',6),('pushfalse',)),
        ('BattleCharacterLogic/getAvailableAbilitiesWithCond',None,('getlocal',5),('getlocal',6))]:
        if at is None:
            at=len(asm.decode(e.body(label)[5]))-2
        e.insert(label,at,[('getlocal_0',),('getlocal',7),('getlocal_1',),('getlocal_2',),
                          tutorial,summary,('callpropvoid',k['add'],5)])
    e.insert('AbilitySummarizer$/summaryAbilities',301,[
        ('getlocal',11),('getlocal',12),('getlocal_1',),('getlocal',10),('pushfalse',),('getlocal',4),
        ('callpropvoid',k['add'],5)])
    e.insert('BattleCharacterLogic/resolvePathCollection',781,[
        ('getlocal_0',),('getlocal_1',),('getlocal_2',),('getlocal_3',),('callpropvoid',k['preload'],3)])
    q=lambda name:sym(e,name)
    # 新合击队长技的slot0不是主位队长；仅覆盖新增origin号段。
    e.insert('BattleCharacterLogic/getInstantAbiltyCountWithoutLimit',2,[
        ('getlocal',4),*n(e,1021000),('iflt','OLD'),('getlocal',4),*n(e,1024000),('ifge','OLD'),
        ('getlocal_1',),('getproperty',q('index')),('pushbyte',6),('ifne','NOT_LEADER_NEGATIVE'),
        ('getlex',q('pinball.common.data.ability.instant::InitialAbilityCountKind')),
        ('pushbyte',0),('callproperty',q('General'),1),('returnvalue',),
        ('label','NOT_LEADER_NEGATIVE'),('getlocal_1',),('getproperty',q('index')),('pushbyte',7),('ifne','OLD'),
        ('getlex',q('pinball.common.data.ability.instant::InitialAbilityCountKind')),
        ('pushbyte',1),('callproperty',q('General'),1),('returnvalue',),('label','OLD')])
