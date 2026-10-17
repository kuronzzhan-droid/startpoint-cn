package pinball.asset.file._FileReader {
 import flash.events.Event; import pinball.asset.file.FileStreamWithCounter; import cn.optimize.resources.ResourceRuntime;
 public class OpenHandler {
  public var fileStream:FileStreamWithCounter; public var convert:Function; public var completeHandler:Function;
  public function OpenHandler(stream:FileStreamWithCounter,convert:Function,callback:Function) { this.fileStream=stream;this.convert=convert;completeHandler=callback;ResourceRuntime.attachOpen(this); }
  public function execute(event:Event):void { ResourceRuntime.completeRead(this); }
 }
}
