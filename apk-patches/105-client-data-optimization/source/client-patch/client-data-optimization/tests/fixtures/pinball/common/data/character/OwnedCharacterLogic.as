package pinball.common.data.character { public class OwnedCharacterLogic extends BattleCharacterLogic {
 public static var getterCalls:int=0;
 public function OwnedCharacterLogic(i:int,v:Object){super(i,v);}
 public function get_useDate():Number{getterCalls++;return Number(values.used);}
 public function get_joinDate():Number{getterCalls++;return Number(values.join);}
 public function get_rarity():int{getterCalls++;return int(values.rarity);}
 public function get_level():int{getterCalls++;return int(values.level);}
 public function get_hp():int{getterCalls++;return int(values.hp);}
 override public function get_atk():int{getterCalls++;return super.get_atk();}
 public function get_actionSkillLevel():int{getterCalls++;return int(values.skill);}
 public function get_element():int{getterCalls++;return int(values.element);}
 public function get_stack():int{getterCalls++;return int(values.stack);}
} }
