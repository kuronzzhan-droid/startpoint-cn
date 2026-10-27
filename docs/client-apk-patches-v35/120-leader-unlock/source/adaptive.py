"""只在 BattleCharacterLogic 的最终属性入口覆盖；原属性和编成逻辑不改。"""
from .common import CHAR,sym

def build(e,h):
    q=lambda name:sym(e,name)
    name=e.newq('wfxAdaptiveElement')
    code=[('getlocal_0',),('pushscope',),('getlocal_0',),('getproperty',q('party')),('iffalse','NONE')]
    # 与 native _getSelfAbilitySlot 的 isLearned 同义：当前玛纳能力等级 >= 1。
    # 不构造 AbilityLogic，不调用 get_element；因此不产生属性递归。
    for i in range(1,7):
        nxt='NEXT'+str(i)
        code += [('getlocal_0',),('getproperty',q('values')),('getproperty',q('ability_'+str(i))),
            ('setlocal_1',),('getlocal_1',),('getproperty',q('index')),('pushbyte',0),('ifne',nxt),
            ('getlocal_0',),e.string('wfx_adaptive_'),('getlocal_1',),('getproperty',q('params')),
            ('pushbyte',0),('getproperty',h['mnl']),('add',),('callproperty',h['read'],1),
            e.string('1'),('ifne',nxt),('getlocal_0',),('pushbyte',i),('getlocal_0',),
            ('pushbyte',i),('callproperty',q('getAbilityAwakeLevelAt'),1),
            ('callproperty',q('getAbilityPowerAt'),2),('pushbyte',1),('iflt',nxt),
            ('getlocal_0',),('getproperty',q('party')),('callproperty',q('get_leaderCharacter'),0),
            ('dup',),('iffalse','POP_NONE'),('callproperty',q('get_originalElement'),0),('returnvalue',),
            ('label',nxt)]
    code += [('jump','NONE'),('label','POP_NONE'),('pop',),('label','NONE'),('pushbyte',255),('returnvalue',)]
    e.add_method(CHAR,'wfxAdaptiveElement','int',[],code,2)
    # -1 是无自适应哨兵；旧 kind 720 全段保留，无键继续原方法。
    e.insert('BattleCharacterLogic/getElement',2,[
        ('getlocal_0',),('callproperty',name,0),('dup',),('pushbyte',255),('ifeq','LEGACY'),
        ('returnvalue',),('label','LEGACY'),('pop',)])
    # v35a 的 General._getSelfAbilitySlot 有意用原属性避免旧720递归。
    # Battle实例返回后仅修正自适应角色的资源ownerElement，编成类不受影响。
    slots=e.newq('wfxAdaptiveSlots')
    e.add_method(CHAR,'wfxAdaptiveSlots','Array',['Array'],[
        ('getlocal_0',),('pushscope',),('getlocal_0',),('callproperty',name,0),('setlocal_2',),
        ('getlocal_2',),('pushbyte',0),('iflt','DONE'),('pushbyte',0),('setlocal_3',),
        ('label','LOOP'),('avm_label',),('getlocal_3',),('getlocal_1',),
        ('getproperty',q('length')),('ifge','DONE'),('getlocal_1',),('getlocal_3',),
        ('getproperty',h['mnl']),('setlocal',4),('getlocal',4),('getproperty',q('index')),
        ('pushbyte',0),('ifne','NEXT'),('getlocal',4),('getproperty',q('params')),
        ('pushbyte',0),('getproperty',h['mnl']),('getlocal_2',),('setproperty',q('ownerElement')),
        ('label','NEXT'),('inclocal_i',3),('jump','LOOP'),
        ('label','DONE'),('getlocal_1',),('returnvalue',)
    ],5)
    e.insert('BattleCharacterLogic/getSelfAbilitySlots',8,[('getlocal_0',),('swap',),('callproperty',slots,1)])
