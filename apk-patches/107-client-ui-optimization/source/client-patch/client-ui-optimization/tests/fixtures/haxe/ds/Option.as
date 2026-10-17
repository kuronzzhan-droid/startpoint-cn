package haxe.ds { public final class Option {
    public var index:int; public var params:Array; public const __enum__:Boolean=true; public var tag:String;
    public static const None:Option=new Option(1,null);
    public static function Some(v:*):Option { return new Option(0,[v]); }
    public function Option(i:int,p:Array) { index=i;params=p;tag=i==0?"Some":"None"; }
} }
