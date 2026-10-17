package pinball.asset.file {
 import flash.display.BitmapData; import flash.utils.ByteArray; import starling.textures.Texture; import cn.optimize.resources.ResourceRuntime;
 public class BitmapTextureRestoreHandler {
  public var reader:FileReader; public var path:String;public var texture:Texture;public var onStartHandler:Function;public var onCompleteHandler:Function;
  public function BitmapTextureRestoreHandler(reader:FileReader,path:String,texture:Texture,start:Function,complete:Function) {this.reader=reader;this.path=path;this.texture=texture;onStartHandler=start;onCompleteHandler=complete;ResourceRuntime.attachRestore(this);}
  public function restoreHandler():void { ResourceRuntime.restore(this); }
  public function uploadPng(bitmap:BitmapData):void { ResourceRuntime.uploadRestore(this,bitmap); }
  public function pngReadHandler(bytes:ByteArray):void {}
 }
}
