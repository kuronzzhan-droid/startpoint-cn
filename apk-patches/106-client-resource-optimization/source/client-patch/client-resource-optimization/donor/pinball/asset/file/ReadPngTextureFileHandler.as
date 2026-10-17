package pinball.asset.file {
 import flash.display.BitmapData; import flash.utils.ByteArray; import cn.optimize.resources.ResourceRuntime;
 public class ReadPngTextureFileHandler {
  public var reader:FileReader; public var path:String; public var completeHandler:Function; public var bitmapData:BitmapData;
  public function ReadPngTextureFileHandler(reader:FileReader,path:String,callback:Function) { this.reader=reader;this.path=path;completeHandler=callback;ResourceRuntime.attachPng(this); }
  public function _uploadPng():void { ResourceRuntime.uploadPng(this); }
  public function uploadPng(bitmap:BitmapData):void { bitmapData=bitmap;_uploadPng(); }
  public function pngReadHandler(bytes:ByteArray):void { }
 }
}
