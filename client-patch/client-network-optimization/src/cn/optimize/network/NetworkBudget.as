package cn.optimize.network {
    import flash.utils.getTimer;
    import flash.utils.getDefinitionByName;
    public final class NetworkBudget {
        public static function remaining(queue:Object, started:int):int {
            var total:int = int(queue.devConfig.connectionTotalTimeout);
            var elapsed:Number = Number(uint(uint(getTimer()) - uint(started)));
            return int(Math.max(-2147483648, Math.min(2147483647, Number(total) - elapsed)));
        }
        public static function prepare(queue:Object, retry:int, started:int):int {
            // Admission can delay/restart an initial send. Its business deadline starts here.
            if (retry == 0) {
                started = getTimer();
                queue.timeLeft = int(queue.devConfig.connectionTotalTimeout);
            } else {
                queue.timeLeft = remaining(queue, started);
            }
            return started;
        }
        public static function allowSend(queue:Object, setting:Object, retry:int, started:int):Boolean {
            if (int(queue.timeLeft) > 0) return true;
            var kind:Object = getDefinitionByName("pinball.context.remote.RemoteErrorKind");
            var errorClass:Class = getDefinitionByName("pinball.context.remote.RemoteError") as Class;
            queue.requestErrorHandler(setting, retry, started,
                new errorClass(kind.Timeout, String(setting.basePath) + "/" + String(setting.endPoint)));
            return false;
        }
        public static function install(manager:Object):void {
            var option:Object = getDefinitionByName("haxe.ds.Option");
            if (int(manager.timeoutMilSec.index) == 0) {
                manager.timeoutTimer = option.Some(new RequestTimer(manager.onTimeout, int(manager.timeoutMilSec.params[0])));
            } else {
                manager.timeoutTimer = option.None;
            }
        }
    }
}
