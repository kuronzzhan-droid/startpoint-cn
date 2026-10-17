package pinball.asset.file {
 import flash.filesystem.File;
 import flash.filesystem.FileStream;
 import flash.Boot;
 import pinball.asset.WaitInOrderImpl;
 import pinball.error.ClientError;
 import cn.optimize.resources.ResourceRuntime;
 public class FileStreamWithCounter extends FileStream {
  public static var numberOfOpenFilesAtTheSameTime:int=0;
  public static var limitNumberOfOpenFilesAtTheSameTime:int=100;
  public var openWait:WaitInOrderImpl;
  public function FileStreamWithCounter() { super(); openWait=new WaitInOrderImpl(); openWait.dispose(); }
  override public function openAsync(file:File, mode:String):void {
   ResourceRuntime.begin(this); openWait.dispose(); openWait=new WaitInOrderImpl(); _openAsync(file,mode);
  }
  override public function open(file:File, mode:String):void {
   ResourceRuntime.begin(this); openWait.dispose(); openWait=new WaitInOrderImpl();
   if(!ResourceRuntime.grant(this,false))return;
   try { super.open(file,mode); }
   catch(error:Error) {
    ResourceRuntime.failed(this); Boot.lastError=error;
    if(error.errorID==3001) { Boot.lastError=new Error(); throw new ClientError(8111,String(error.message)+" : "+mode+" : "+file.nativePath); }
    Boot.lastError=new Error(); throw error;
   }
   ResourceRuntime.opened(this); openWait.executeComplete();
  }
  public function _openAsync(file:File, mode:String):void {
   if(!ResourceRuntime.grant(this,true)) { ResourceRuntime.enqueueOpen(this,file,mode); return; }
   try { super.openAsync(file,mode); }
   catch(error:Error) {
    ResourceRuntime.failed(this); Boot.lastError=error;
    if(error.errorID==3001) { Boot.lastError=new Error(); throw new ClientError(8111,String(error.message)+" : "+mode+" : "+file.nativePath); }
    Boot.lastError=new Error(); throw error;
   }
   ResourceRuntime.opened(this); openWait.executeComplete();
  }
  override public function close():void {
   if(!ResourceRuntime.wantClose(this)) { openWait.dispose(); return; }
   _close();
  }
  public function _close():void {
   if(!ResourceRuntime.held(this))return;
   openWait.dispose();
   try { super.close(); }
   catch(error:*) { ResourceRuntime.closeError(); throw error; }
   finally { ResourceRuntime.release(this); }
  }
 }
}
