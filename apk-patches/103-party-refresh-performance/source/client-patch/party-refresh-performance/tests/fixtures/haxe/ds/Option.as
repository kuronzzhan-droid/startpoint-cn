package haxe.ds {
    public class Option {
        public var index:int;
        public var params:Array;
        public function Option(i:int, p:Array) { index=i;params=p; }
        public static var None:Option = new Option(1,[]);
        public static function Some(value:*):Option { return new Option(0,[value]); }
    }
}
