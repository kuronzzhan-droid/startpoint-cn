package {
    public class QueueProbe {
        public var devConfig:Object={connectionTotalTimeout:100};
        public var timeLeft:int=-999;
        public var actualStarted:int;
        public var sends:int=0;
        public var errors:int=0;
        public var lastError:Object;
        public function startProbe(setting:Object,retry:int,started:int):void {}
        public function errorProbe(setting:Object,retry:int,started:int):void {}
        public function requestErrorHandler(setting:Object,retry:int,started:int,error:Object):void {
            errors++;lastError=error;
        }
    }
}
