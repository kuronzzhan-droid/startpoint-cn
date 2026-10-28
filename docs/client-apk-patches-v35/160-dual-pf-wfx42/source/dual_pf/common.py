"""Small P-code construction helpers; no game-specific actor IDs."""
MEMBER = 'pinball.scene.battle.battle.squad.member::MemberImpl'
SQUAD = 'pinball.scene.battle.battle.squad::SquadImpl'
CONDITION = 'pinball.scene.battle.battle.condition::ConditionSlot'
PF = 'pinball.common.data.skill.powerFlip::PowerFlipLogic'
TYPE = 'pinball.common.data.character::SpecialityTypeTools'
OPTION = 'haxe.ds::Option'


def local(index):
    return [('getlocal', index)]


def at(index, field, x):
    return local(index) + [('pushbyte', field), ('getproperty', x)]


def field(index, name, q):
    return local(index) + [('getproperty', q(name))]


HEAD = [('getlocal_0',), ('pushscope',)]
