package pinball.scene.character.viewOrder {
 public class CharacterSceneViewOrderCommand {
  public var index:int;public var data:Object;public var reset:Boolean;
  public function CharacterSceneViewOrderCommand(i:int,d:Object,r:Boolean){index=i;data=d;reset=r;}
  public static function ApplyCarouselData(i:int,d:Object,r:Boolean):CharacterSceneViewOrderCommand{return new CharacterSceneViewOrderCommand(i,d,r);}
 }
}
