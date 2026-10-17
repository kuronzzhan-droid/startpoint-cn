package pinball.asset.file {
 import flash.display.Loader;import flash.display.Bitmap;import flash.events.Event;import flash.utils.ByteArray;import flash.system.LoaderContext;import flash.system.ImageDecodingPolicy;import flash.Boot;
 public class PngLoadHandler {
  public var loader:Loader;public var completeHandler:Function;public var byteArray:ByteArray;
  public function PngLoadHandler(bytes:ByteArray,callback:Function){byteArray=bytes;completeHandler=callback;loader=new Loader();var context:LoaderContext=new LoaderContext(false);context.imageDecodingPolicy=ImageDecodingPolicy.ON_LOAD;loader.contentLoaderInfo.addEventListener(Event.COMPLETE,pngLoadedHandler);loader.loadBytes(bytes,context);}
  public function pngLoadedHandler(event:Event):void {byteArray.clear();var bitmap:Bitmap=loader.content as Bitmap;completeHandler(bitmap.bitmapData);loader.contentLoaderInfo.removeEventListener(Event.COMPLETE,pngLoadedHandler);}
 }
}
