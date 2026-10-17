package haxe.ds { public final class StringMap {
    public static var reserved:Object={"__proto__":true,"hasOwnProperty":true};
    public var h:Object={}; public var rh:Object={};
    public function getReserved(k:String):* { return rh[k]; }
    public function existsReserved(k:String):Boolean { return k in rh; }
    public function remove(k:String):Boolean { var had:Boolean=k in h || k in rh; delete h[k];delete rh[k];return had; }
} }
