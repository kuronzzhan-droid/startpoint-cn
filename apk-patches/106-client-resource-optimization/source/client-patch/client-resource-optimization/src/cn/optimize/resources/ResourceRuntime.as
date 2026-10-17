package cn.optimize.resources {
    import flash.utils.Dictionary;
    import flash.utils.getDefinitionByName;
    import flash.utils.getTimer;
    import flash.utils.setTimeout;
    import flash.utils.clearTimeout;
    import flash.utils.ByteArray;
    import flash.events.IOErrorEvent;
    import flash.errors.IOError;

    /** Per-domain state; no game instance layouts or disk logging are changed. */
    public final class ResourceRuntime {
        private static var files:Dictionary = new Dictionary(true);
        private static var fileOwners:Dictionary = new Dictionary(true);
        private static var completions:Dictionary = new Dictionary(true);
        private static var handlers:Dictionary = new Dictionary(true);
        private static var owners:Dictionary = new Dictionary(true);
        private static var tasks:Dictionary = new Dictionary(true);
        private static var taskOwners:Dictionary = new Dictionary(true);
        private static var roots:Dictionary = new Dictionary(true);
        private static var rootOwners:Dictionary = new Dictionary(true);
        private static var waits:Array = [];
        private static var jobs:Array = [];
        private static var pumping:Boolean = false;
        private static var scheduled:Boolean = false;
        private static var timerId:uint=0;
        private static var timerDue:int=0;
        private static var notBefore:int=getTimer();
        private static var windowStart:int=getTimer();
        private static var windowMs:int=0;
        private static var windowHeavy:int=0;
        private static var currentOwner:Object;
        private static var ring:Array = [];
        private static var counters:Object = {openFailures:0,ioErrors:0,closeFailures:0,cancelledOpens:0,
            taskPeak:0,taskThrows:0,duplicateCallbacks:0,jobPeak:0,phaseFailures:0,cancelledJobs:0,
            decoded:0,uploads:0,restoreUploads:0,estimatedTextureBytes:0,textureRoots:0,
            pumpCount:0,maxPumpMs:0,maxPumpSteps:0,maxQueueWaitMs:0};
        public static const TASK_LIMIT:int = 30;
        public static const PHASE_BUDGET_MS:int = 4;
        public static const PHASE_LIMIT:int = 8;
        private static function counterClass():Object {
            return getDefinitionByName("pinball.asset.file.FileStreamWithCounter");
        }
        private static function live(owner:Object):Boolean {
            if(owner!=null && rootOwners[owner]!=null) {
                var record:Object=rootOwners[owner];
                if(!record.alive)return false;
                if(record.anonymous)return true;
                for(var known:Object in record.known)if(live(known))return true;
                return false;
            }
            return owner == null || (owners[owner] !== false && (!("disposed" in owner) || !Boolean(owner.disposed)));
        }
        public static function register(callback:Function, owner:Object):Function {
            if(callback != null) completions[callback] = owner;
            return callback;
        }
        private static function ownerOf(callback:Function):Object {
            return callback != null && completions[callback] != null ? completions[callback] : currentOwner;
        }
        public static function attachOpen(h:Object):void {
            var owner:Object=ownerOf(h.completeHandler);
            handlers[h] = {owner:owner,queued:false}; fileOwners[h.fileStream]=owner;
        }
        public static function attachPng(h:Object):void {
            var owner:Object = ownerOf(h.completeHandler);
            handlers[h] = {owner:owner,queued:false}; register(h.pngReadHandler,owner);
        }
        public static function attachAtf(h:Object):void {
            var owner:Object = ownerOf(h.completeHandler);
            var record:Object={owner:owner,queued:false,completed:false,texture:null};
            handlers[h] = record; register(h.atfReadHandler,owner);
            var original:Function=h.completeHandler;
            h.completeHandler=function(texture:Object):void {
                if(record.completed) {
                    counters.duplicateCallbacks++;
                    if(texture!==record.texture)texture.dispose();
                    return;
                }
                record.completed=true;record.texture=texture;
                if(!live(owner)) { texture.dispose(); return; }
                bindTexture(owner,texture);original(texture);
            };
        }
        public static function attachRestore(h:Object):void {
            var root:Object = h.texture.root;
            handlers[h] = {owner:roots[root] != null ? roots[root].proxy : currentOwner,queued:false,generation:0};
            register(h.pngReadHandler,handlers[h].owner);
        }
        public static function allow(h:Object):Boolean {
            var record:Object = handlers[h];
            return record == null || live(record.owner);
        }
        public static function bindTexture(owner:Object, texture:Object):void {
            if(texture == null || !live(owner)) return;
            var root:Object = texture.root;
            if(roots[root] == null) {
                var width:Number = Number(root.nativeWidth),height:Number = Number(root.nativeHeight);
                var format:String = String(root.format);
                var bytes:Number = width*height*(format=="compressed" ? .5 : format=="compressedAlpha" ? 1 : 4);
                if(Boolean(root.mipMapping)) bytes *= 4/3;
                var known:Dictionary=new Dictionary(true); if(owner!=null)known[owner]=true;
                var proxy:Object={};var state:Object={known:known,anonymous:owner==null,alive:true};rootOwners[proxy]=state;
                roots[root] = {state:state,bytes:bytes,proxy:proxy};
                counters.estimatedTextureBytes += bytes; counters.textureRoots++;
            } else if(owner!=null)roots[root].state.known[owner]=true;
        }
        public static function ownTask(task:Object, owner:Object):Object { taskOwners[task]=owner; return task; }
        public static function forgetTexture(texture:Object):void {
            if(texture==null || texture!==texture.root)return;
            var record:Object=roots[texture];if(record==null)return;
            record.state.alive=false;
            counters.estimatedTextureBytes-=record.bytes;counters.textureRoots--;delete roots[texture];
        }
        public static function begin(stream:Object):void {
            var previous:Object=files[stream];
            if(previous != null && previous.held) throw new IOError("stream already has an open reservation");
            if(previous != null) previous.cancelled=true;
            files[stream]={held:false,opened:false,cancelled:false,queued:false,owner:fileOwners[stream]!=null ? fileOwners[stream] : currentOwner};
        }
        public static function grant(stream:Object, asynchronous:Boolean):Boolean {
            var record:Object=files[stream];
            if(record==null) { begin(stream); record=files[stream]; }
            if(record.cancelled || !live(record.owner)) return false;
            if(record.held) return true;
            var cls:Object=counterClass();
            if(asynchronous && cls.numberOfOpenFilesAtTheSameTime>=cls.limitNumberOfOpenFilesAtTheSameTime) return false;
            record.held=true; cls.numberOfOpenFilesAtTheSameTime++;
            var listener:Function=function(event:IOErrorEvent):void {
                var target:Object=event.currentTarget;
                counters.ioErrors++;
                try { target.close(); } finally { failed(target,false); }
                throw new IOError(event.text,event.errorID);
            };
            record.listener=listener; stream.addEventListener(IOErrorEvent.IO_ERROR,listener,false,100,true);
            return true;
        }
        public static function opened(stream:Object):void {
            var record:Object=files[stream];
            if(record!=null && !record.cancelled) record.opened=true;
        }
        public static function enqueueOpen(stream:Object,file:Object,mode:String):void {
            var record:Object=files[stream];
            if(record==null || record.cancelled || !live(record.owner) || record.queued) return;
            record.queued=true; waits.push({stream:stream,record:record,file:file,mode:mode}); schedule();
        }
        public static function failed(stream:Object,count:Boolean=true):void {
            if(count) counters.openFailures++;
            release(stream);
        }
        public static function wantClose(stream:Object):Boolean {
            var record:Object=files[stream];
            if(record==null) return false;
            var wasCancelled:Boolean=record.cancelled;
            record.cancelled=true;
            if(!record.held) { if(!wasCancelled && record.queued)counters.cancelledOpens++; return false; }
            return true;
        }
        public static function held(stream:Object):Boolean { return files[stream]!=null && files[stream].held; }
        public static function release(stream:Object):void {
            var record:Object=files[stream];
            if(record==null) return;
            record.cancelled=true;
            if(record.listener!=null) stream.removeEventListener(IOErrorEvent.IO_ERROR,record.listener);
            if(record.held) { record.held=false; counterClass().numberOfOpenFilesAtTheSameTime--; }
            record.opened=false; schedule();
        }
        public static function closeError():void { counters.closeFailures++; }
        public static function cancelOwner(owner:Object):void {
            owners[owner]=false;
            for(var stream:Object in files) if(files[stream].owner===owner) {
                try { stream.close(); } catch(error:*) { counters.closeFailures++; release(stream); }
            }
            for(var task:Object in tasks) if(taskOwners[task]===owner) {
                tasks[task].cancelled=true; tasks[task].running=0; task.onProgressCount=0;
            }
            var pending:Array=jobs; jobs=[];
            for each(var job:Object in pending) {
                if(job.owner===owner) { counters.cancelledJobs++; if(job.cleanup!=null) job.cleanup(); }
                else jobs.push(job);
            }
            for(var root:Object in roots) {
                var rootRecord:Object=roots[root]; var hadOwner:Boolean=rootRecord.state.known[owner]===true;
                delete rootRecord.state.known[owner];
                var another:Object=null; for(var candidate:Object in rootRecord.state.known) { another=candidate; break; }
                if(hadOwner && another==null && owner!=null && !rootRecord.state.anonymous) {
                    rootRecord.state.alive=false;
                    counters.estimatedTextureBytes-=rootRecord.bytes; counters.textureRoots--; delete roots[root];
                }
            }
            for(stream in files)if(!live(files[stream].owner)) {
                try { stream.close(); } catch(cancelError:*) { counters.closeFailures++; release(stream); }
            }
            pending=jobs;jobs=[];
            for each(job in pending) {
                if(!live(job.owner)) { counters.cancelledJobs++;if(job.cleanup!=null)job.cleanup(); }
                else jobs.push(job);
            }
        }
        public static function startTasks(task:Object,index:int=0):void {
            var state:Object=tasks[task];
            if(state==null) {
                state={next:index,running:0,pumping:false,cancelled:false,failed:false}; tasks[task]=state;
            }
            if(state.pumping || state.cancelled || state.failed || !live(taskOwners[task])) return;
            state.pumping=true; var start:int=getTimer();
            try {
                while(!state.cancelled && !state.failed && live(taskOwners[task]) && state.next<task.tasks.length && state.running<TASK_LIMIT) {
                    var number:int=state.next++; state.running++; task.onProgressCount++;
                    counters.taskPeak=Math.max(counters.taskPeak,state.running);
                    launch(task,state,number);
                    if(getTimer()-start>=PHASE_BUDGET_MS) { setTimeout(startTasks,16,task,state.next); break; }
                }
            } finally { state.pumping=false; }
        }
        private static function launch(task:Object,state:Object,index:int):void {
            var completed:Boolean=false;
            var callback:Function=function():void {
                if(completed) { counters.duplicateCallbacks++; return; }
                completed=true;
                if(state.cancelled) return;
                state.running--; task.onProgressCount--;
                if(state.failed || !live(taskOwners[task])) return;
                task.completedCount++;
                task.progressManager.progress(0,task.completedCount/task.tasks.length);
                if(state.cancelled || state.failed || !live(taskOwners[task]))return;
                if(task.completedCount==task.tasks.length) task.progressManager.complete(0);
                else if(!state.pumping) setTimeout(startTasks,0,task,state.next);
            };
            register(callback,taskOwners[task]);
            var previous:Object=currentOwner; currentOwner=taskOwners[task];
            try { task.tasks[index](callback); }
            catch(error:*) {
                if(!completed) { completed=true; state.running--; task.onProgressCount--; }
                state.failed=true; counters.taskThrows++; throw error;
            } finally { currentOwner=previous; }
        }
        private static function enqueue(owner:Object,phase:String,execute:Function,cleanup:Function=null,requiresActive:Boolean=true):void {
            if(!live(owner)) { counters.cancelledJobs++; if(cleanup!=null)cleanup(); return; }
            if(jobs.length>=1024) { if(cleanup!=null)cleanup(); throw new Error("resource phase queue capacity exceeded"); }
            jobs.push({owner:owner,phase:phase,execute:execute,cleanup:cleanup,requiresActive:requiresActive,queuedAt:getTimer()});
            counters.jobPeak=Math.max(counters.jobPeak,jobs.length); schedule();
        }
        public static function completeRead(h:Object):void {
            var record:Object=handlers[h]; if(record==null) { attachOpen(h); record=handlers[h]; }
            if(record.queued) return; record.queued=true;
            if(!live(record.owner)) {
                h.fileStream.removeEventListener("complete",h.execute);h.fileStream.close();return;
            }
            var bytes:ByteArray=new ByteArray(); var failure:*=null;
            try { h.fileStream.readBytes(bytes); } catch(error:*) { failure=error; }
            try { h.fileStream.close(); } catch(closeFailure:*) { if(failure==null)failure=closeFailure; }
            h.fileStream.removeEventListener("complete",h.execute);
            if(failure!=null) { bytes.clear(); throw failure; }
            enqueue(record.owner,"decode",function():void {
                var value:*;
                try { value=h.convert(bytes); } catch(error:*) { bytes.clear(); throw error; }
                counters.decoded++;
                enqueue(record.owner,"deliver",function():void {
                    try { h.completeHandler(value); } catch(error:*) { bytes.clear();throw error; }
                },function():void {bytes.clear();if(value is ByteArray && value!==bytes)ByteArray(value).clear();});
            },function():void { bytes.clear(); },false);
        }
        public static function uploadPng(h:Object):void {
            var record:Object=handlers[h]; if(record==null) { attachPng(h); record=handlers[h]; }
            var bitmap:Object=h.bitmapData;
            if(record.queued) { if(bitmap!==record.bitmap)bitmap.dispose(); return; }
            record.queued=true;record.bitmap=bitmap;
            enqueue(record.owner,"png-upload",function():void {
                var texture:Object;
                try {
                    var cls:Object=getDefinitionByName("starling.textures.Texture");
                    texture=cls.fromBitmapData(bitmap,false,false,h.reader.getPngScale(h.path));
                    texture.root.onRestore=null; counters.uploads++;
                } finally { bitmap.dispose(); }
                if(!live(record.owner)) { texture.dispose(); return; }
                bindTexture(record.owner,texture); h.completeHandler(texture);
            },function():void { bitmap.dispose(); });
        }
        public static function restore(h:Object):void {
            var record:Object=handlers[h]; if(record==null) { attachRestore(h); record=handlers[h]; }
            var generation:int=++record.generation;
            enqueue(record.owner,"restore-read",function():void {
                if(generation!=record.generation)return;
                h.onStartHandler(h.path,h.texture);
                var callback:Function=function(bytes:ByteArray):void {
                    if(generation!=record.generation || !live(record.owner)) { bytes.clear();return; }
                    var cls:Object=getDefinitionByName("pinball.asset.file.PngLoadHandler");
                    var bitmapCallback:Function=function(bitmap:Object):void { uploadRestore(h,bitmap,generation); };
                    register(bitmapCallback,record.owner);
                    try { new cls(bytes,bitmapCallback); } catch(error:*) {bytes.clear();throw error;}
                };
                register(callback,record.owner);
                h.reader.readAssetFile(h.path,".png",h.reader.getPngConverter(h.path,".png"),callback);
            });
        }
        public static function uploadRestore(h:Object,bitmap:Object,generation:int=-1):void {
            var record:Object=handlers[h]; if(record==null) { attachRestore(h); record=handlers[h]; }
            if(generation<0)generation=record.generation;
            enqueue(record.owner,"restore-upload",function():void {
                if(generation!=record.generation) { bitmap.dispose();return; }
                try { h.texture.root.uploadBitmapData(bitmap); counters.restoreUploads++; }
                finally { bitmap.dispose(); }
                h.onCompleteHandler(h.path,h.texture);
            },function():void { bitmap.dispose(); });
        }
        private static function active():Boolean {
            try { return Boolean(getDefinitionByName("pinball.context.activity.ActivityUtil").isStarlingActive()); }
            catch(error:*) { return false; }
        }
        private static function schedule(delay:int=1):void {
            if(pumping)return;
            var now:int=getTimer();var wait:int=Math.max(delay,int(notBefore-now),1);var due:int=now+wait;
            if(!scheduled || int(due-timerDue)<0) {
                if(scheduled)clearTimeout(timerId);
                scheduled=true;timerDue=due;timerId=setTimeout(pump,wait);
            }
        }
        public static function pump():void {
            if(pumping)return;
            if(scheduled) {clearTimeout(timerId);scheduled=false;}
            if(int(getTimer()-notBefore)<0) {schedule();return;}
            if(int(getTimer()-windowStart)>=16) {windowStart=getTimer();windowMs=0;windowHeavy=0;}
            pumping=true;
            var error:*=null; var start:int=getTimer(); var consumed:int=0;var steps:int=0;
            try {
                var remaining:Array=[];
                for each(var waiting:Object in waits) {
                    var stream:Object=waiting.stream;
                    if(files[stream]!==waiting.record || waiting.record.cancelled || !live(waiting.record.owner)) continue;
                    var cls:Object=counterClass();
                    if(cls.numberOfOpenFilesAtTheSameTime>=cls.limitNumberOfOpenFilesAtTheSameTime) remaining.push(waiting);
                    else {
                        waiting.record.queued=false;
                        try { stream._openAsync(waiting.file,waiting.mode); }
                        catch(openFailure:*) { error=openFailure; }
                    }
                }
                waits=remaining;
                while(jobs.length>0 && steps<64 && windowMs+int(getTimer()-start)<PHASE_BUDGET_MS) {
                    var job:Object=null;var isActive:Boolean=active();
                    for(var position:int=0;position<jobs.length;position++) {
                        var candidateJob:Object=jobs[position];
                        if(!live(candidateJob.owner)) {jobs.splice(position--,1);counters.cancelledJobs++;if(candidateJob.cleanup!=null)candidateJob.cleanup();continue;}
                        if((!candidateJob.requiresActive || isActive) && (candidateJob.phase=="deliver" || windowHeavy+consumed<PHASE_LIMIT)) {job=candidateJob;jobs.splice(position,1);break;}
                    }
                    if(job==null)break;
                    var before:int=getTimer();
                    var previousOwner:Object=currentOwner;currentOwner=job.owner;
                    try { job.execute(); } catch(failure:*) { counters.phaseFailures++; error=failure; }
                    finally { currentOwner=previousOwner; }
                    var waitMs:int=int(before-job.queuedAt);counters.maxQueueWaitMs=Math.max(counters.maxQueueWaitMs,waitMs);
                    ring.push({phase:job.phase,ms:int(getTimer()-before),waitMs:waitMs}); if(ring.length>32)ring.shift();
                    steps++;if(job.phase!="deliver")consumed++;if(error!=null)break;
                }
            } finally {
                var pumpMs:int=int(getTimer()-start);counters.pumpCount++;counters.maxPumpMs=Math.max(counters.maxPumpMs,pumpMs);counters.maxPumpSteps=Math.max(counters.maxPumpSteps,steps);
                windowMs+=pumpMs;windowHeavy+=consumed;
                var exhausted:Boolean=windowMs>=PHASE_BUDGET_MS || windowHeavy>=PHASE_LIMIT || steps>=64;
                if(exhausted)notBefore=getTimer()+16;
                pumping=false;if(jobs.length>0 || waits.length>0)schedule(exhausted || steps==0 ? 16 : 1);
            }
            if(error!=null)throw error;
        }
        public static function snapshot():Object {
            var copy:Object={}; for(var name:String in counters)copy[name]=counters[name];
            copy.queuedOpens=waits.length; copy.queuedPhases=jobs.length; copy.samples=ring.concat();
            copy.budgetWindow={ms:windowMs,heavy:windowHeavy};copy.nextEligibleInMs=Math.max(0,int(notBefore-getTimer()));return copy;
        }
    }
}
