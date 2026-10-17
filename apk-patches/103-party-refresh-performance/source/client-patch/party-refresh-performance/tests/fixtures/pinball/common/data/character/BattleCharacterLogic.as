package pinball.common.data.character {
    public class BattleCharacterLogic {
        public var id:int;
        public var main:Array;
        public var unison:Array;
        public var equipment:Array;
        public var soul:Array;
        public var ex:Array;
        public var level:int;
        public var awake:int;
        public function BattleCharacterLogic(i:int, l:int, a:int, m:Array, u:Array, e:Array, s:Array, x:Array) {
            id=i;level=l;awake=a;main=m;unison=u;equipment=e;soul=s;ex=x;
        }
    }
}
