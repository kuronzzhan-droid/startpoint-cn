package {
    import flash.display.Sprite;
    import flash.desktop.NativeApplication;
    import flash.filesystem.*;
    import flash.events.*;
    import flash.utils.*;
    import haxe.ds.Option;
    import pinball.context.remote.*;
    import cn.optimize.network.*;
    public class RuntimeHarness extends Sprite {
        private var checks:int=0;
        private var problems:Array=[];
        private var timers:Array=[];
        private var started:int;
        private var zero:int=0, negative:int=0, positive:int=0, cancelled:int=0, chained:int=0;
        private var elapsed:int=0;
        private var expired:RemoteEventListenerManager;
        private var success:RemoteEventListenerManager;
        private var failed:RemoteEventListenerManager;
        private var none:RemoteEventListenerManager;
        public function RuntimeHarness() {
            try { run(); } catch(e:*) { problems.push(String(e)+" "+(e is Error ? e.getStackTrace():"")); finish(); }
        }
        private function check(value:Boolean,name:String):void { checks++;if(!value)problems.push(name); }
        private function run():void {
            // Keep classes referenced through reflection in the production helper linked in.
            check(RemoteErrorKind.Timeout!=null && RemoteError!=null && NetworkBudget!=null,"helper linkage");
            stage.frameRate=2;
            var q:QueueProbe=new QueueProbe();
            var setting:Object={basePath:"local",endPoint:"probe"};
            q.startProbe(setting,0,0);
            check(q.timeLeft==100 && q.sends==1 && q.actualStarted>=0,"first request receives fresh budget");
            q.timeLeft=-2147483648;
            var before:int=getTimer();q.startProbe(setting,0,0);
            check(q.timeLeft==100 && q.sends==2 && q.actualStarted>=before,"admission restart ignores stale deadline");
            var old:int=getTimer()-30;q.startProbe(setting,1,old);
            check(q.actualStarted==old && q.timeLeft<=70 && q.timeLeft>0 && q.sends==3,"retry shares existing request deadline");
            q.startProbe(setting,1,getTimer()-120);
            check(q.sends==3 && q.errors==1 && q.lastError.kind==RemoteErrorKind.Timeout,"exhausted retry does not send");
            q.devConfig.connectionTotalTimeout=0;q.startProbe(setting,0,0);
            check(q.sends==3 && q.errors==2,"zero budget handled as timeout");
            q.devConfig.connectionTotalTimeout=-5;q.startProbe(setting,0,0);
            check(q.sends==3 && q.errors==3,"negative budget handled as timeout");
            q.devConfig.connectionTotalTimeout=100;q.errorProbe(setting,2,getTimer()-35);
            check(q.timeLeft<=65 && q.timeLeft>0,"error insertion recomputes remaining time");
            q.timeLeft=-999;q.startProbe(setting,0,0);
            check(q.timeLeft==100 && q.sends==4,"next independent request refills after failure");
            started=getTimer();
            timers.push(new RequestTimer(function():void{zero++;},0));
            timers.push(new RequestTimer(function():void{negative++;},-10));
            timers.push(new RequestTimer(function():void{positive++;elapsed=getTimer()-started;
                timers.push(new RequestTimer(function():void{chained++;},1));},40));
            var stopped:RequestTimer=new RequestTimer(function():void{cancelled++;},20);
            stopped.stop();stopped.stop();timers.push(stopped);
            expired=new RemoteEventListenerManager(Option.Some(-1));
            success=new RemoteEventListenerManager(Option.Some(30));
            failed=new RemoteEventListenerManager(Option.Some(30));
            none=new RemoteEventListenerManager(Option.None);
            check(success.target.hasEventListener(Event.COMPLETE) && success.target.hasEventListener(ProgressEvent.PROGRESS),"real manager listeners installed");
            success.target.dispatchEvent(new Event(Event.COMPLETE));
            failed.target.dispatchEvent(new IOErrorEvent(IOErrorEvent.IO_ERROR));
            check(!success.target.hasEventListener(Event.COMPLETE) && !success.target.hasEventListener(ProgressEvent.PROGRESS),"real manager removes event handlers");
            check(none.timeoutTimer==Option.None,"no timeout remains unarmed");
            var finishTimer:Timer=new Timer(1300,1);timers.push(finishTimer);
            finishTimer.addEventListener(TimerEvent.TIMER_COMPLETE,function(e:TimerEvent):void {
                check(zero==1 && negative==1 && positive==1 && chained==1,"zero negative positive reentrant timers each fire once");
                check(elapsed>=40 && elapsed<1200,"deadline uses elapsed milliseconds at 2 FPS");
                check(cancelled==0,"idempotent stop cancels callback");
                check(expired.failures==1 && expired.successes==0,"negative manager deadline completes once");
                check(success.successes==1 && success.failures==0,"success cancels deadline");
                check(failed.failures==1 && failed.successes==0,"IO error cancels deadline");
                check(!expired.target.hasEventListener(Event.COMPLETE),"timeout removes listeners");
                none.removeListeners();finish();
            });finishTimer.start();
        }
        private function finish():void {
            var f:FileStream=new FileStream();
            f.open(new File(File.applicationDirectory.nativePath+"/runtime-tests.json"),FileMode.WRITE);
            f.writeUTFBytes(JSON.stringify({passed:problems.length==0,assertions:checks,problems:problems,positive_timer_elapsed_ms:elapsed,fixture_fps:2}));f.close();
            NativeApplication.nativeApplication.exit(problems.length==0?0:1);
        }
    }
}
