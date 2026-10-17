package {
 import flash.display.Sprite;import flash.display.BitmapData;import flash.events.Event;import flash.events.IOErrorEvent;import flash.events.UncaughtErrorEvent;
 import flash.filesystem.File;import flash.filesystem.FileStream;import flash.filesystem.FileMode;import flash.desktop.NativeApplication;
 import flash.utils.ByteArray;import flash.utils.setTimeout;import flash.utils.getTimer;
 import cn.optimize.resources.ResourceRuntime;
 import pinball.asset.file.FileStreamWithCounter;import pinball.asset.file._FileReader.OpenHandler;
 import pinball.asset.file.ReadPngTextureFileHandler;import pinball.asset.file.BitmapTextureRestoreHandler;import pinball.asset.file.FileReader;
 import pinball.asset.file.ReadAtfTextureFileHandler;import starling.core.Starling;
 import pinball.asset.file.PngLoadHandler;
 import pinball.common.task.MultiTask;import pinball.context.activity.ActivityUtil;import starling.textures.Texture;
 import pinball.common.task.ProgressManager;
 import haxe.ds.IntMap;import FixtureClock;
 public class RuntimeHarness extends Sprite {
  private var assertions:Array=[];private var failures:Array=[];private var expectedErrors:int=0;private var observedErrors:int=0;
  private var fixture:File=File.applicationStorageDirectory.resolvePath("resource-runtime-fixture.bin");
  private var waiting:FileStreamWithCounter;private var keeper:FileStreamWithCounter;private var callbacks:Array=[];private var slow:MultiTask;
  private var completedSlow:int=0;private var peak:int=0;private var owner:Object={disposed:false};private var png:ReadPngTextureFileHandler;
  private var parsed:int=0;private var uploaded:int=0;private var restored:int=0;private var badParsed:int=0;
  private var nativeAsyncDeferred:Boolean=false;
  public function RuntimeHarness() {
   trace("resource harness constructor");
   var forceMap:IntMap=new IntMap();FixtureClock.now();
   loaderInfo.uncaughtErrorEvents.addEventListener(UncaughtErrorEvent.UNCAUGHT_ERROR,onError);
   setTimeout(start,1);setTimeout(function():void {finish("timeout");},12000);
  }
  private function check(condition:Boolean,name:String):void {assertions.push({name:name,passed:condition});if(!condition)failures.push(name);}
  private function drain():void {
   var deadline:int=getTimer()+2000;
   while(ResourceRuntime.snapshot().queuedPhases>0) {ResourceRuntime.pump();if(int(getTimer()-deadline)>0)throw new Error("active phase drain timeout");}
  }
  private function isDisposed(bitmap:BitmapData):Boolean {try {bitmap.getPixel(0,0);return false;}catch(error:*){return true;}}
  private function onError(event:UncaughtErrorEvent):void {
   event.preventDefault();observedErrors++;
   if(expectedErrors>0)expectedErrors--;else failures.push("unexpected error: "+event.error);
  }
  private function start():void {
   trace("resource harness start");
   try {
    var missing:File=fixture.parent.resolvePath("definitely-no-resource-file");
    for(var i:int=0;i<120;i++) {
     var bad:FileStreamWithCounter=new FileStreamWithCounter();var threw:Boolean=false;
     try {bad.open(missing,FileMode.READ);}catch(error:*){threw=true;}
     bad.close();bad.close();check(threw && FileStreamWithCounter.numberOfOpenFilesAtTheSameTime==0,"sync open exception rollback "+i);
    }
    var writer:FileStream=new FileStream();var bytes:ByteArray=new ByteArray();bytes.writeUTFBytes("{\"value\":17}");bytes.compress();
    writer.open(fixture,FileMode.WRITE);writer.writeBytes(bytes);writer.close();bytes.clear();
    var good:FileStreamWithCounter=new FileStreamWithCounter();good.open(fixture,FileMode.READ);
    check(FileStreamWithCounter.numberOfOpenFilesAtTheSameTime==1,"recover after 120 exceptions");good.close();good.close();check(FileStreamWithCounter.numberOfOpenFilesAtTheSameTime==0,"double close once");
    var asyncBad:FileStreamWithCounter=new FileStreamWithCounter();threw=false;
    try {asyncBad.openAsync(fixture,"invalid-mode");}catch(e:*){threw=true;}
    asyncBad.close();check(threw && FileStreamWithCounter.numberOfOpenFilesAtTheSameTime==0,"async immediate failure rollback");
    good=new FileStreamWithCounter();good.open(fixture,FileMode.READ);threw=false;
    expectedErrors++;
    good.dispatchEvent(new IOErrorEvent(IOErrorEvent.IO_ERROR,false,false,"controlled native IO_ERROR",2038));
    good.close();check(ResourceRuntime.snapshot().ioErrors==1 && FileStreamWithCounter.numberOfOpenFilesAtTheSameTime==0,"IO_ERROR listener rollback");
    FileStreamWithCounter.limitNumberOfOpenFilesAtTheSameTime=1;keeper=new FileStreamWithCounter();keeper.open(fixture,FileMode.READ);
    waiting=new FileStreamWithCounter();waiting.openAsync(fixture,FileMode.READ);waiting.close();waiting.close();keeper.close();
    ResourceRuntime.pump();check(FileStreamWithCounter.numberOfOpenFilesAtTheSameTime==0 && !ResourceRuntime.held(waiting),"queued close prevents late open");
    FileStreamWithCounter.limitNumberOfOpenFilesAtTheSameTime=100;
    var missingAsync:FileStreamWithCounter=new FileStreamWithCounter();expectedErrors++;
    try {missingAsync.openAsync(missing,FileMode.READ);nativeAsyncDeferred=true;}catch(nativeOpenError:*){expectedErrors--;missingAsync.close();}
    var sync:MultiTask=new MultiTask();
    for(i=0;i<200;i++)sync.add(function(done:Function):void {done();done();sync._startNextTask(0);});
    sync.run();while(sync.completedCount<200)sync._startNextTask(0);check(sync.completedCount==200 && sync.onProgressCount==0 && sync.progressManager.completeCount==1,"synchronous reentry and duplicate completion");
    var empty:MultiTask=new MultiTask();empty.run();check(empty.progressManager.completeCount==1,"empty queue");
    var bodyOwner:Object={disposed:false};var bodyCancel:MultiTask=new MultiTask();ResourceRuntime.ownTask(bodyCancel,bodyOwner);var bodyStarts:int=0;
    bodyCancel.add(function(done:Function):void{bodyStarts++;ResourceRuntime.cancelOwner(bodyOwner);done();});bodyCancel.add(function(done:Function):void{bodyStarts++;done();});bodyCancel.run();
    check(bodyStarts==1 && bodyCancel.completedCount==0 && bodyCancel.onProgressCount==0 && bodyCancel.progressManager.completeCount==0,"task body cancel prevents next launch and late completion");
    var progressOwner:Object={disposed:false};var progressCancel:MultiTask=new MultiTask();ResourceRuntime.ownTask(progressCancel,progressOwner);var progressStarts:int=0;
    ProgressManager.nextProgressHook=function(index:int,value:Number):void{ResourceRuntime.cancelOwner(progressOwner);};
    progressCancel.add(function(done:Function):void{progressStarts++;done();});progressCancel.add(function(done:Function):void{progressStarts++;done();});progressCancel.run();
    check(progressStarts==1 && progressCancel.completedCount==1 && progressCancel.onProgressCount==0 && progressCancel.progressManager.completeCount==0,"synchronous progress cancel prevents next launch");
    var lastOwner:Object={disposed:false};var lastCancel:MultiTask=new MultiTask();ResourceRuntime.ownTask(lastCancel,lastOwner);
    ProgressManager.nextProgressHook=function(index:int,value:Number):void{ResourceRuntime.cancelOwner(lastOwner);};lastCancel.add(function(done:Function):void{done();done();});lastCancel.run();
    check(lastCancel.completedCount==1 && lastCancel.onProgressCount==0 && lastCancel.progressManager.completeCount==0,"last progress cancel suppresses complete event");
    var throwing:MultiTask=new MultiTask();throwing.add(function(done:Function):void{throw new Error("controlled task throw");});threw=false;
    try {throwing.run();}catch(taskError:*){threw=true;}
    check(threw && throwing.onProgressCount==0 && throwing.completedCount==0,"task throw rolls back reservation");
    slow=new MultiTask();for(i=0;i<95;i++)slow.add(function(done:Function):void {callbacks.push(done);peak=Math.max(peak,slow.onProgressCount);});slow.run();
    check(callbacks.length==30 && slow.onProgressCount==30,"slow tasks initial launch cap");
    setTimeout(drainSlow,20);
   }catch(error:*){finish("start failure: "+error+" "+(error is Error?Error(error).getStackTrace():""));}
  }
  private function drainSlow():void {
   try {
    var batch:Array=callbacks;callbacks=[];for each(var fn:Function in batch){fn();fn();completedSlow++;}
    if(completedSlow<95){setTimeout(drainSlow,20);return;}
    check(peak<=30 && slow.completedCount==95 && slow.onProgressCount==0 && slow.progressManager.completeCount==1,"slow in-flight peak <= 30, exactly once complete");
    check(expectedErrors==0 && FileStreamWithCounter.numberOfOpenFilesAtTheSameTime==0,"native asynchronous missing-file error releases counter");
    phases();
   }catch(error:*){finish("slow failure: "+error);}
  }
  private function phases():void {
   try {
    ActivityUtil.active=false;var converted:int=0;
    var stream:FileStreamWithCounter=new FileStreamWithCounter();
    var done:Function=ResourceRuntime.register(function(value:Object):void{check(value.value==17,"real ByteArray inflate and JSON parse");parsed++;},owner);
    var handler:OpenHandler=new OpenHandler(stream,function(bytes:ByteArray):Object {converted++;bytes.uncompress();return JSON.parse(bytes.readUTFBytes(bytes.length));},done);
    stream.open(fixture,FileMode.READ);handler.execute(new Event(Event.COMPLETE));ResourceRuntime.pump();
    check(converted==1 && parsed==0 && FileStreamWithCounter.numberOfOpenFilesAtTheSameTime==0,"inactive permits decode, holds original callback, closes native stream");
    var reader:FileReader=new FileReader();png=new ReadPngTextureFileHandler(reader,"sample",ResourceRuntime.register(function(texture:Texture):void {uploaded++;},owner));
    png.uploadPng(new BitmapData(4,4,false,0));ResourceRuntime.pump();check(Texture.uploadCount==0,"inactive holds PNG upload");
    var deferredBytes:ByteArray;var deferOwner:Object={disposed:false};var deferCalls:int=0;var behind:FileStreamWithCounter=new FileStreamWithCounter();
    var behindHandler:OpenHandler=new OpenHandler(behind,function(bytes:ByteArray):ByteArray {deferredBytes=bytes;return bytes;},ResourceRuntime.register(function(bytes:ByteArray):void{deferCalls++;},deferOwner));
    behind.open(fixture,FileMode.READ);behindHandler.execute(new Event(Event.COMPLETE));ResourceRuntime.pump();
    check(deferredBytes!=null && deferredBytes.length>0 && deferCalls==0,"inactive GPU head cannot starve later decode");
    ResourceRuntime.cancelOwner(deferOwner);check(deferredBytes.length==0 && deferCalls==0,"cancel after decode clears pending delivery bytes");
    var cancelled:Object={disposed:false};var dropped:ReadPngTextureFileHandler=new ReadPngTextureFileHandler(reader,"cancelled",ResourceRuntime.register(function(texture:Texture):void {failures.push("late cancelled PNG callback");},cancelled));
    var discarded:BitmapData=new BitmapData(4,4);dropped.uploadPng(discarded);ResourceRuntime.cancelOwner(cancelled);
    check(isDisposed(discarded),"cancel releases queued bitmap");
    var texture:Texture=new Texture();ResourceRuntime.bindTexture(owner,texture);
    var restorer:BitmapTextureRestoreHandler=new BitmapTextureRestoreHandler(reader,"restore",texture,function(path:String,t:Texture):void{},function(path:String,t:Texture):void {restored++;});
    restorer.uploadPng(new BitmapData(4,4));
    var doomed:Object={disposed:false};var doomedTexture:Texture=new Texture();ResourceRuntime.bindTexture(doomed,doomedTexture);
    var doomedRestore:BitmapTextureRestoreHandler=new BitmapTextureRestoreHandler(reader,"dead",doomedTexture,function(path:String,t:Texture):void{},function(path:String,t:Texture):void{failures.push("late cancelled restore");});
    doomedRestore.uploadPng(new BitmapData(4,4));ResourceRuntime.cancelOwner(doomed);
    ActivityUtil.active=true;drain();
    check(parsed==1 && uploaded==1 && restored==1 && Texture.uploadCount==2,"resume parse/upload/restore; cancelled restore no upload");
    check(isDisposed(png.bitmapData),"successful upload releases bitmap after upload");
    var shared:Texture=new Texture();var a:Object={disposed:false};var b:Object={disposed:false};ResourceRuntime.bindTexture(a,shared);ResourceRuntime.bindTexture(b,shared);
    var sharedRestore:BitmapTextureRestoreHandler=new BitmapTextureRestoreHandler(reader,"shared",shared,function(path:String,t:Texture):void{},function(path:String,t:Texture):void{restored++;});
    ResourceRuntime.cancelOwner(a);sharedRestore.uploadPng(new BitmapData(4,4));drain();
    check(restored==2 && !shared.disposed,"shared root stays available to remaining known owner");
    ResourceRuntime.cancelOwner(b);sharedRestore.uploadPng(new BitmapData(4,4));drain();check(restored==2,"last owner cancel prevents late shared restore");
    var bad:FileStreamWithCounter=new FileStreamWithCounter();var broken:OpenHandler=new OpenHandler(bad,function(bytes:ByteArray):Object{bytes.uncompress();throw new Error("controlled parse failure");},function(value:Object):void{badParsed++;});
    bad.open(fixture,FileMode.READ);broken.execute(new Event(Event.COMPLETE));var threw:Boolean=false;
    try {drain();}catch(error:*){threw=true;}
    check(threw && badParsed==0 && FileStreamWithCounter.numberOfOpenFilesAtTheSameTime==0,"parse exception closes native stream, no callback");
    var ownedTask:MultiTask=new MultiTask();ResourceRuntime.ownTask(ownedTask,doomed);ownedTask.add(function(done:Function):void{failures.push("cancelled owner task launched");});ownedTask.run();check(ownedTask.onProgressCount==0,"cancelled owner cannot start task");
    var stat:Object=ResourceRuntime.snapshot();check(stat.samples.length<=32 && stat.taskPeak<=30 && stat.estimatedTextureBytes>=0,"bounded timings and texture estimates");
    var bulkOwner:Object={disposed:false};var bulkCount:int=0;var bulkBefore:int=Texture.uploadCount;
    for(var load:int=0;load<80;load++) {
     var bulk:ReadPngTextureFileHandler=new ReadPngTextureFileHandler(reader,"bulk",ResourceRuntime.register(function(t:Texture):void{bulkCount++;},bulkOwner));bulk.uploadPng(new BitmapData(4,4));
    }
    ResourceRuntime.pump();check(bulkCount<=8 && bulkCount<80,"per-turn PNG workload capped at 8");
    drain();check(bulkCount==80 && Texture.uploadCount==bulkBefore+80,"80-upload workload drains without lost completion");
    ResourceRuntime.cancelOwner(bulkOwner);
    var duplicate:ReadPngTextureFileHandler=new ReadPngTextureFileHandler(reader,"duplicate",ResourceRuntime.register(function(t:Texture):void{uploaded++;},owner));
    var first:BitmapData=new BitmapData(4,4);var second:BitmapData=new BitmapData(4,4);duplicate.uploadPng(first);duplicate.uploadPng(second);drain();
    check(isDisposed(first)&&isDisposed(second)&&uploaded==2,"duplicate PNG input releases both bitmaps, callback once");
    var forget:Texture=new Texture();ResourceRuntime.bindTexture(owner,forget);var beforeForget:Number=ResourceRuntime.snapshot().estimatedTextureBytes;ResourceRuntime.forgetTexture(forget);forget.dispose();
    check(ResourceRuntime.snapshot().estimatedTextureBytes==beforeForget-64,"known root dispose removes estimate");
    var post:MultiTask=new MultiTask();post.add(function(done:Function):void{done();throw new Error("throw after completion");});threw=false;try{post.run();}catch(after:*){threw=true;}
    check(threw&&post.completedCount==1&&post.onProgressCount==0&&post.progressManager.completeCount==1,"throw after synchronous completion keeps terminal counts");
    Starling.context.driverInfo="Controlled";
    var loaderType:Class=PngLoadHandler;
    var generationReader:FileReader=new FileReader();var generationTexture:Texture=new Texture();ResourceRuntime.bindTexture(owner,generationTexture);
    var starts:int=0;var generationHandler:BitmapTextureRestoreHandler=new BitmapTextureRestoreHandler(generationReader,"generation",generationTexture,function(path:String,t:Texture):void{starts++;},function(path:String,t:Texture):void{});
    ActivityUtil.active=false;generationHandler.restoreHandler();generationHandler.restoreHandler();ActivityUtil.active=true;drain();
    check(starts==1 && generationReader.pending.length==1,"new restore generation cancels obsolete queued read");
    generationHandler.restoreHandler();drain();var obsolete:ByteArray=new ByteArray();obsolete.writeByte(1);generationReader.pending[0](obsolete);check(obsolete.length==0,"obsolete in-flight restore bytes discarded before PNG decode");
    var atfOwner:Object={disposed:false};var atfDone:int=0;var atf:ReadAtfTextureFileHandler=new ReadAtfTextureFileHandler(reader,"atf",ResourceRuntime.register(function(t:Texture):void{atfDone++;},atfOwner));
    var data:ByteArray=new ByteArray();data.writeByte(1);atf.atfReadHandler(data);ResourceRuntime.cancelOwner(atfOwner);var late:Texture=Texture.lastAtf;
    var denied:ReadAtfTextureFileHandler=new ReadAtfTextureFileHandler(reader,"denied",ResourceRuntime.register(function(t:Texture):void{failures.push("cancelled ATF callback");},atfOwner));
    var beforeDenied:int=Texture.uploadCount;data=new ByteArray();data.writeByte(1);denied.atfReadHandler(data);check(Texture.uploadCount==beforeDenied && data.length==0,"cancelled ATF never starts native upload, clears bytes");
    var asyncRead:int=0;var nativeStream:FileStreamWithCounter=new FileStreamWithCounter();var nativeHandler:OpenHandler=new OpenHandler(nativeStream,function(bytes:ByteArray):Object{bytes.uncompress();return JSON.parse(bytes.readUTFBytes(bytes.length));},ResourceRuntime.register(function(value:Object):void{asyncRead++;},owner));
    nativeStream.addEventListener(Event.COMPLETE,nativeHandler.execute);nativeStream.openAsync(fixture,FileMode.READ);
    var cancelledReadOwner:Object={disposed:false};var cancelledRead:int=0;var closedStream:FileStreamWithCounter=new FileStreamWithCounter();var closedHandler:OpenHandler=new OpenHandler(closedStream,function(bytes:ByteArray):Object{return {};},ResourceRuntime.register(function(value:Object):void{cancelledRead++;},cancelledReadOwner));
    closedStream.open(fixture,FileMode.READ);ResourceRuntime.cancelOwner(cancelledReadOwner);closedHandler.execute(new Event(Event.COMPLETE));
    check(cancelledRead==0,"late COMPLETE after owner cancel does not read or callback");
    setTimeout(function():void {check(atfDone==0&&late.disposed,"ATF original async completion disposes late cancelled texture");check(asyncRead==1&&FileStreamWithCounter.numberOfOpenFilesAtTheSameTime==0,"native async COMPLETE through grafted OpenHandler");schedulerChecks();},60);
   }catch(error:*){finish("phase failure: "+error+" "+(error is Error?Error(error).getStackTrace():""));}
  }
  private function schedulerChecks():void {
   try {
    var stats:Object=ResourceRuntime.snapshot();check(stats.maxPumpSteps<=64,"scheduler pump bounded to 64 total steps");check(stats.budgetWindow.heavy<=8,"scheduler shared window bounded to 8 heavy phases");
    ActivityUtil.active=false;var heldOwner:Object={disposed:false};var calls:int=0;var conversions:int=0;
    var heldPng:ReadPngTextureFileHandler=new ReadPngTextureFileHandler(new FileReader(),"fairness",ResourceRuntime.register(function(t:Texture):void{calls+=100;},heldOwner));
    var bitmap:BitmapData=new BitmapData(4,4);heldPng.uploadPng(bitmap);
    var native:FileStreamWithCounter=new FileStreamWithCounter();var h:OpenHandler=new OpenHandler(native,function(bytes:ByteArray):Object{conversions++;bytes.uncompress();return JSON.parse(bytes.readUTFBytes(bytes.length));},ResourceRuntime.register(function(value:Object):void{calls++;},owner));
    native.addEventListener(Event.COMPLETE,h.execute);native.openAsync(fixture,FileMode.READ);
    setTimeout(function():void {
     try {
      check(conversions==1 && calls==0,"inactive queued GPU permits later real async IO decode but holds deliver");
      ResourceRuntime.cancelOwner(heldOwner);check(isDisposed(bitmap),"cancel inactive queued GPU releases bitmap");ActivityUtil.active=true;
      setTimeout(function():void {check(calls==1 && ResourceRuntime.snapshot().queuedPhases==0,"resume completes delivery once without cancelled GPU upload");finish(null);},60);
     }catch(error:*){finish("scheduler async failure: "+error);}
    },60);
   }catch(error:*){finish("scheduler failure: "+error);}
  }
  private function finish(error:String):void {
   trace("resource harness finish "+error);
   if(error!=null)failures.push(error);
   var target:File=new File(File.applicationDirectory.nativePath).resolvePath("runtime-tests.json");var out:FileStream=new FileStream();
   out.open(target,FileMode.WRITE);out.writeUTFBytes(JSON.stringify({passed:failures.length==0,assertions:assertions,failures:failures,controlledTextureFactory:true,nativeFileStream:true,nativeMissingErrorDeferred:nativeAsyncDeferred,statistics:ResourceRuntime.snapshot()}));out.close();
   NativeApplication.nativeApplication.exit(failures.length==0?0:1);
  }
 }
}
