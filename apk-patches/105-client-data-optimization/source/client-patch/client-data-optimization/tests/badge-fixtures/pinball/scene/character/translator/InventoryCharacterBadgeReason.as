package pinball.scene.character.translator
{
   import flash.Boot;

   public final class InventoryCharacterBadgeReason
   {

      public static const __isenum:Boolean = true;

      public static var CanLearnManaNodeOrGetBondToken:InventoryCharacterBadgeReason = new InventoryCharacterBadgeReason("CanLearnManaNodeOrGetBondToken",1,null);

      public static var NotClearedAndSelectableCharacterQuest:InventoryCharacterBadgeReason = new InventoryCharacterBadgeReason("NotClearedAndSelectableCharacterQuest",0,null);

      public static var __constructs__:Array = ["NotClearedAndSelectableCharacterQuest","CanLearnManaNodeOrGetBondToken","CanOverLimitByStack","CanExBoost"];

      public var tag:String;

      public var index:int;

      public var params:Array;

      public const __enum__:Boolean = true;

      public function InventoryCharacterBadgeReason(param1:String, param2:int, param3:Array)
      {
         tag = param1;
         index = param2;
         params = param3;
      }

      public static function CanExBoost(param1:Array) : InventoryCharacterBadgeReason
      {
         return new InventoryCharacterBadgeReason("CanExBoost",3,[param1]);
      }

      public static function CanOverLimitByStack(param1:Array) : InventoryCharacterBadgeReason
      {
         return new InventoryCharacterBadgeReason("CanOverLimitByStack",2,[param1]);
      }

      final public function toString() : String
      {
         return tag;
      }
   }
}
