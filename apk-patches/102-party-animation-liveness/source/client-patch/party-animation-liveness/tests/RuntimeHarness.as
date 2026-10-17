package {
    import flash.desktop.NativeApplication;
    import flash.display.Sprite;
    import flash.filesystem.File;
    import flash.filesystem.FileMode;
    import flash.filesystem.FileStream;

    /** The empty pumpOffscreen body receives the same AVM2 insertion as the game.
     * Fixtures model container animation state; this is not a device/game test. */
    public final class RuntimeHarness extends Sprite {
        public var characterContainers:Array = [];
        public var currentIndex:int = 0;
        public var joinAndRemoveAnimationWaitState:Object = {index:0};
        private var assertions:int = 0;
        private var checks:Array = [];
        private var callbacks:int = 0;

        public function pumpOffscreen():void {}
        private function check(ok:Boolean, label:String):void {
            assertions++; checks.push(label);
            if (!ok) throw new Error(label);
        }
        private function write(report:Object):void {
            var stream:FileStream = new FileStream();
            stream.open(new File(File.applicationDirectory.nativePath).resolvePath("runtime-tests.json"), FileMode.WRITE);
            stream.writeUTFBytes(JSON.stringify(report)); stream.close();
            NativeApplication.nativeApplication.exit(report.passed ? 0 : 1);
        }
        public function RuntimeHarness() {
            try {
                run();
                write({passed:true,assertions:assertions,checks:checks,
                    scope:"actual inserted AVM2 runs on AIR fixture; not full game/device reproduction"});
            } catch(error:*) { write({passed:false,assertions:assertions,error:String(error),checks:checks}); }
        }
        private function container(motion:int=0, victory:int=0, second:Boolean=false):TestContainer {
            var cells:Array = [new TestCell(motion,victory)];
            if(second) cells.push(new TestCell(motion,victory));
            return new TestContainer(true,cells);
        }
        private function beginWait(callback:Function):void {
            joinAndRemoveAnimationWaitState = {index:1,params:[callback,20]};
        }
        private function allFinished():Boolean {
            for each(var c:TestContainer in characterContainers)
                if(c.initialized) for each(var cell:TestCell in c.allCells)
                    if(cell.isJoinOrRemoving()) return false;
            return true;
        }
        private function frame(usePatch:Boolean=true):void {
            var current:TestContainer = characterContainers[currentIndex];
            if(current.initialized) current.update();
            if(usePatch) pumpOffscreen();
            var state:Object = joinAndRemoveAnimationWaitState;
            if(state.index==1 && allFinished()) {
                if(state.params[1]>0) {
                    joinAndRemoveAnimationWaitState={index:1,params:[state.params[0],state.params[1]-1]};
                } else {
                    joinAndRemoveAnimationWaitState={index:0};
                    state.params[0]();
                }
            }
        }
        private function done():void { callbacks++; }
        private function run():void {
            var stale:TestContainer=container(2,3,true);
            var current:TestContainer=container(1,2,true);
            var idle:TestContainer=container();
            var uninitialized:TestContainer=new TestContainer(false,null);
            characterContainers=[stale,current,idle,uninitialized]; currentIndex=1;
            beginWait(done);
            for(var i:int=0;i<100;i++) frame(false);
            check(callbacks==0 && stale.updates==0,"unpatched current-only control retains stalled offscreen animation");
            check(joinAndRemoveAnimationWaitState.params[1]==20,"20 frames are completion delay, not timeout");
            for(i=0;i<100;i++) frame();
            check(callbacks==1,"offscreen fall and victory complete and release original callback");
            check(stale.updates==6,"two pending cells update one container at most once per frame");
            check(idle.updates==0 && uninitialized.updates==0,"idle and uninitialized containers never updated");
            check(current.updates==200,"current container never double-updated by insertion");
            check(joinAndRemoveAnimationWaitState.index==0,"wait state cleared before callback");
            for(i=0;i<100;i++) frame();
            check(callbacks==1,"completed callback only runs once");

            stale=container(4,4); current=container(1,1);
            characterContainers=[stale,current,container()]; currentIndex=1;
            joinAndRemoveAnimationWaitState={index:0};
            for(i=0;i<30;i++) pumpOffscreen();
            check(stale.updates==0 && stale.allCells[0].queries==0,"no waiting preserves zero offscreen updates and scans");
            check(current.updates==0,"insertion does not replace normal current update");

            var empty:TestContainer=new TestContainer(true,[]);
            characterContainers=[empty,container(),new TestContainer(false,null)]; currentIndex=1;
            beginWait(done);
            for(i=0;i<21;i++) frame();
            check(callbacks==2,"empty initialized and uninitialized queues preserve normal wait completion");

            characterContainers=[container(4,0),container(0,5),container(2,2)];
            currentIndex=0; beginWait(done);
            for(i=0;i<50;i++) { currentIndex=i%3; frame(); }
            check(callbacks==3 && allFinished(),"rapid multi-party switches while waiting still finish");
            var total:int=0;
            for each(var c:TestContainer in characterContainers) total+=c.updates;
            check(total<=64,"only current and pending offscreen containers advance");

            characterContainers=[container(2,2),container()]; currentIndex=1;
            beginWait(function():void {
                callbacks++;
                check(joinAndRemoveAnimationWaitState.index==0,"reentrant callback sees cleared old waiter");
                characterContainers=[container(0,3),container()]; currentIndex=1;
                beginWait(done);
            });
            for(i=0;i<100;i++) frame();
            check(callbacks==5,"callback may enqueue a new wait without duplication or lost wait");

            stale=container(2,3); characterContainers=[stale,container()]; currentIndex=1;
            beginWait(done); pumpOffscreen();
            var before:int=stale.updates;
            joinAndRemoveAnimationWaitState={index:0}; characterContainers=[];
            for(i=0;i<10;i++) pumpOffscreen();
            check(stale.updates==before && callbacks==5,"cancel/dispose state has no retained async work or callback");

            characterContainers=[container(),container()]; currentIndex=1; beginWait(done);
            characterContainers[0].allCells[0].fail=true;
            var surfaced:Boolean=false;
            try { pumpOffscreen(); } catch(error:*) { surfaced=true; }
            check(surfaced,"animation inspection errors propagate instead of fake completion");

            characterContainers=[container(3,2)]; currentIndex=0; beginWait(done);
            for(i=0;i<50;i++) frame();
            check(callbacks==6 && characterContainers[0].updates==50,
                "normal single-party replacement keeps original completion and one current update per frame");
        }
    }
}

internal final class TestContainer {
    public var initialized:Boolean;
    public var allCells:Array;
    public var updates:int=0;
    public var elapsedFrame:int=0;
    public var walkingSynchronizeFrame:int=0;
    public var mainCharacterCells:Array;
    public var unisonCharacterCells:Array=[];
    public function TestContainer(initialized:Boolean, cells:Array) { this.initialized=initialized; allCells=cells; mainCharacterCells=cells; }
    public function update():void { updates++; realUpdate(); }
    public function realUpdate():void {}
}

internal final class TestCell {
    public var motion:int;
    public var victory:int;
    public var queries:int=0;
    public var fail:Boolean=false;
    private var victoryFinished:Boolean=false;
    public var motionPlayhead:TestMotionHead;
    public var characterPlayhead:TestCharacterHead;
    public function TestCell(motion:int,victory:int) {
        this.motion=motion; this.victory=victory;
        motionPlayhead=new TestMotionHead(this); characterPlayhead=new TestCharacterHead(this);
    }
    public function isJoinOrRemoving():Boolean {
        queries++; if(fail) throw new Error("fixture animation error");
        return motion>0 || victory>0 || victoryFinished;
    }
    public function isFalling():Boolean { return false; }
    public function victoryFinishedForFixture():Boolean { return victoryFinished; }
    public function update():void {
        if(motion>0) { motion--; return; }
        if(victory>0) { victory--; if(victory==0) victoryFinished=true; return; }
        victoryFinished=false;
    }
}

internal final class TestMotionHead {
    private var owner:TestCell;
    public function TestMotionHead(owner:TestCell) { this.owner=owner; }
    public function isInSequence(sequence:String):Boolean {
        owner.queries++; if(owner.fail) throw new Error("fixture animation error");
        return sequence=="fall" && owner.motion>0;
    }
}

internal final class TestCharacterHead {
    private var owner:TestCell;
    public function TestCharacterHead(owner:TestCell) { this.owner=owner; }
    public function get state():int { return owner.victory>0 || owner.victoryFinishedForFixture() ? 0 : 2; }
    public function get_isPlayingKachidokiOnce():Boolean { return false; }
}
