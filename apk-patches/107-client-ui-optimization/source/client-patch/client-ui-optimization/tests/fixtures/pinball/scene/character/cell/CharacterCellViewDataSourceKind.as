package pinball.scene.character.cell {
    public final class CharacterCellViewDataSourceKind {
        public var tag:String; public var index:int; public var params:Array;
        public const __enum__:Boolean=true;
        public function CharacterCellViewDataSourceKind(tag:String,i:int,p:Array) {this.tag=tag;index=i;params=p;}
        public static function List(v:*):CharacterCellViewDataSourceKind {return new CharacterCellViewDataSourceKind("List",2,[v]);}
        public static function DragTarget(v:*):CharacterCellViewDataSourceKind {return new CharacterCellViewDataSourceKind("DragTarget",0,[v]);}
        public static function Carousel(v:*):CharacterCellViewDataSourceKind {return new CharacterCellViewDataSourceKind("Carousel",1,[v]);}
    }
}
