"""能力视觉的主 ABC 助手；复用第一轮安全 custom_ability_string 读取。"""
import asm

BCL = 'pinball.common.data.character::BattleCharacterLogic'
MEMBER = 'pinball.scene.battle.battle.squad.member::MemberImpl'
BATTLE = 'pinball.scene.battle.battle::Battle'
LEGACY = [
    'battle/effect/ability_damage/inaho_midautumn_wip/moonlight_launch',
    'battle/effect/ability_damage/inaho_midautumn_wip/moonlight_shot_gold_jade',
    'battle/effect/ability_damage/inaho_midautumn_wip/moonlight_hit',
    'battle/effect/skill_unique/inaho_midautumn_wip/midautumn_native/effect',
    'battle/common/layer1/total_ability_damage_effect',
    'battle/common/layer1/total_powerflip_damage_effect',
]


def unique(e, name):
    hits = [i for i in range(1, len(e.abc.multinames))
            if e.abc.multinames[i][0] == 7 and e.abc.mn_name(i) == name]
    if len(hits) != 1:
        raise asm.AsmError(f'visual symbol {name}: {hits}')
    return hits[0]


def build(e):
    q = lambda n: unique(e, n)
    mnl = next(i for i in range(1, len(e.abc.multinames)) if e.abc.multinames[i][0] == 0x1b)
    read = e.newq('wfxVisualPaths')
    one = e.newq('wfxPreloadVisualFor')
    e.add_method(BCL, 'wfxVisualPaths', 'Array', ['Object', 'String'], [
        ('getlocal_0',), ('pushscope',),
        ('getlex', q(BATTLE)), ('getlocal_1',), e.string('ability_visual_'),
        ('getlocal_2',), ('add',), ('callproperty', q('wfxPfReadString'), 2), ('setlocal_3',),
        ('getlocal_3',), ('pushnull',), ('ifeq', 'NONE'),
        ('getlocal_3',), e.string('|'),
        ('callproperty', q('http://adobe.com/AS3/2006/builtin::split'), 1), ('returnvalue',),
        ('label', 'NONE'), ('pushnull',), ('returnvalue',),
    ], 4, static=True)
    # source.mainCharacterStringId 是 MemberImpl 实际伤害归属的主位 code_name。
    e.add_method(MEMBER, 'wfxAbilityVisualPaths', 'Array', [], [
        ('getlocal_0',), ('pushscope',), ('getlex', q(BCL)),
        ('getlocal_0',), ('getproperty', q('logicAssets')),
        ('getlocal_0',), ('callproperty', q('getCharacter'), 0),
        ('getproperty', q('mainCharacterStringId')), ('callproperty', read, 2), ('returnvalue',),
    ], 1)
    e.add_method(BCL, 'wfxPreloadVisualFor', 'void', ['Object', 'Object'], [
        ('getlocal_0',), ('pushscope',), ('getlocal_1',), ('iffalse', 'DONE'),
        ('getlex', q(BCL)), ('getlocal_1',), ('getproperty', q('logicAssets')),
        ('getlocal_1',), ('callproperty', q('get_stringId'), 0),
        ('callproperty', read, 2), ('setlocal_3',),
        ('getlocal_3',), ('pushnull',), ('ifne', 'LOOP_INIT'),
        ('getlocal_1',), ('callproperty', q('get_stringId'), 0),
        e.string('cnmod_inaho_midautumn'), ('ifeq', 'LEGACY'),
        ('getlocal_1',), ('callproperty', q('getPixelArtAnimationPath'), 0),
        e.string('inaho_midautumn'),
        ('callproperty', q('http://adobe.com/AS3/2006/builtin::indexOf'), 1),
        ('pushbyte', 0), ('iflt', 'DONE'),
        ('label', 'LEGACY'), *[e.string(p) for p in LEGACY], ('newarray', 6), ('setlocal_3',),
        ('label', 'LOOP_INIT'), ('pushbyte', 0), ('setlocal', 4),
        ('label', 'LOOP'), ('avm_label',),
        ('getlocal', 4), ('pushbyte', 6), ('ifge', 'DONE'),
        ('getlocal', 4), ('getlocal_3',), ('getproperty', q('length')), ('ifge', 'DONE'),
        ('getlocal_3',), ('getlocal', 4), ('getproperty', mnl), ('setlocal', 5),
        ('getlocal', 5), ('iffalse', 'NEXT'),
        ('getlocal_2',), ('getlocal', 5),
        ('callpropvoid', q('pinball.asset.logic:IAssetPathCollectionBuilder::addAnimationLayout'), 1),
        ('label', 'NEXT'), ('inclocal_i', 4), ('jump', 'LOOP'),
        ('label', 'DONE'), ('returnvoid',),
    ], 6, static=True)
    e.add_method(BCL, 'wfxPreloadAbilityVisuals', 'void', ['Object', 'Object'], [
        ('getlocal_0',), ('pushscope',),
        ('getlocal_2',), ('iffalse', 'DONE'),
        ('getlocal_2',), ('getproperty', q('index')), ('pushbyte', 0), ('ifeq', 'PARTY'),
        ('getlocal_2',), ('getproperty', q('index')), ('pushbyte', 1), ('ifne', 'DONE'),
        ('label', 'PARTY'),
        ('getlex', q(BCL)), ('getlocal_0',), ('getlocal_1',), ('callpropvoid', one, 2),
        ('getlocal_0',), ('callproperty', q('get_unisonCharacter'), 0), ('setlocal_3',),
        ('getlocal_3',), ('getproperty', q('index')), ('pushbyte', 0), ('ifne', 'DONE'),
        ('getlex', q(BCL)), ('getlocal_3',), ('getproperty', q('params')),
        ('pushbyte', 0), ('getproperty', mnl), ('getlocal_1',), ('callpropvoid', one, 2),
        ('label', 'DONE'), ('returnvoid',),
    ], 4)
