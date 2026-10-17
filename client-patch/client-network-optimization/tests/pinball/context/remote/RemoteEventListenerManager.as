package pinball.context.remote {
    import flash.events.*;
    import haxe.ds.Option;
    public class RemoteEventListenerManager {
        public var url:String="fixture";
        public var timeoutTimer:Option;
        public var timeoutMilSec:Option;
        public var target:EventDispatcher=new EventDispatcher();
        public var successHandler:Function;
        public var failureHandler:Function;
        public var progressHandler:Option=Option.None;
        public var completeEventType:String=Event.COMPLETE;
        public var httpStatus:int=200;
        public var responseHeaders:Array=[];
        public var failures:int=0;
        public var successes:int=0;
        public function RemoteEventListenerManager(ms:Option) {
            timeoutMilSec=ms;
            successHandler=function(value:*):void { successes++; };
            failureHandler=function(value:*):void { failures++; };
            addEventListeners();
        }
        // These methods are replaced by exact game bytecode by run_air_tests.py.
        public function addEventListeners():void {}
        public function removeListeners():void {}
        public function onTimeout():void {}
        public function close():void {}
        public function onProgress(e:ProgressEvent):void {}
        public function onHttpStatus(e:HTTPStatusEvent):void {}
        public function onIoError(e:IOErrorEvent):void {}
        public function onSecurityError(e:SecurityErrorEvent):void {}
        // The response parser is outside this timer fixture; cancellation is the real method.
        public function onComplete(e:Event):void { removeListeners();successHandler(e); }
    }
}
