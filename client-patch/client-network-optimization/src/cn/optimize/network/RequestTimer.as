package cn.optimize.network {
    import flash.events.TimerEvent;
    import flash.utils.Timer;
    import flash.utils.getTimer;
    public final class RequestTimer {
        private var timer:Timer;
        private var callback:Function;
        private var started:uint;
        private var duration:Number;
        public function RequestTimer(done:Function, milliseconds:int) {
            callback = done;
            started = uint(getTimer());
            duration = Math.max(0, milliseconds);
            timer = new Timer(Math.max(1, duration), 1);
            timer.addEventListener(TimerEvent.TIMER_COMPLETE, tick);
            timer.start();
        }
        private function tick(event:TimerEvent):void {
            if (callback == null) return;
            var left:Number = duration - Number(uint(uint(getTimer()) - started));
            if (left > 0) {
                timer.reset();
                timer.delay = Math.max(1, left);
                timer.start();
                return;
            }
            var done:Function = callback;
            stop();
            done();
        }
        public function stop():void {
            callback = null;
            if (timer != null) {
                timer.stop();
                timer.removeEventListener(TimerEvent.TIMER_COMPLETE, tick);
                timer = null;
            }
        }
    }
}
