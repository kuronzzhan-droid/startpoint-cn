package pinball.asset.file {
 import flash.utils.ByteArray;import cn.optimize.resources.ResourceRuntime;import starling.textures.Texture;import starling.core.Starling;
 public class ReadAtfTextureFileHandler {
  public var reader:FileReader;public var path:String;public var completeHandler:Function;public var byteArray:ByteArray;
  public function ReadAtfTextureFileHandler(reader:FileReader,path:String,callback:Function){this.reader=reader;this.path=path;completeHandler=callback;ResourceRuntime.attachAtf(this);}
  public function uploadAtf():void {if(!ResourceRuntime.allow(this)){byteArray.clear();return;}Texture.fromAtfData(byteArray,1,false,completeHandler);byteArray.clear();}
  public function atfReadHandler(bytes:ByteArray):void {byteArray=bytes;uploadAtf();}
 }
}
