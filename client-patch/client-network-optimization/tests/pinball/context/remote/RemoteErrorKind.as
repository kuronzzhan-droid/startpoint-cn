package pinball.context.remote {
    public class RemoteErrorKind {
        public var kind:String;
        public function RemoteErrorKind(name:String) { kind=name; }
        public static var Timeout:RemoteErrorKind = new RemoteErrorKind("timeout");
        public static function HttpStatusError(s:int, complete:Boolean):RemoteErrorKind { return new RemoteErrorKind("http"); }
        public static function IoError(id:int, message:String):RemoteErrorKind { return new RemoteErrorKind("io"); }
        public static function SecurityError(id:int, message:String):RemoteErrorKind { return new RemoteErrorKind("security"); }
    }
}
