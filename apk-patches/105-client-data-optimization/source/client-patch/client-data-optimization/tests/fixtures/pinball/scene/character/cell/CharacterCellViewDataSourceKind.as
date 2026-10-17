package pinball.scene.character.cell {
 public class CharacterCellViewDataSourceKind {
  public var params:Array;
  public function CharacterCellViewDataSourceKind(value:Object){params=[value];}
  public static function Carousel(value:Object):CharacterCellViewDataSourceKind{return new CharacterCellViewDataSourceKind(value);}
 }
}
