package starling.textures {import flash.utils.setTimeout;public class Texture {
 public static var uploadCount:int=0;public var root:Object;public var disposed:Boolean=false;
 public static var lastAtf:Texture;
 public var nativeWidth:int=4;public var nativeHeight:int=4;public var format:String="bgra";public var mipMapping:Boolean=false;public var onRestore:Function;
 public function Texture() {root=this;}
 public function uploadBitmapData(bitmap:Object):void {uploadCount++;}
 public static function fromBitmapData(bitmap:Object,mips:Boolean=false,optimize:Boolean=false,scale:Number=1):Texture {uploadCount++;return new Texture();}
 public static function fromAtfData(bytes:Object,scale:Number=1,mips:Boolean=false,complete:Function=null):Texture {var texture:Texture=new Texture();lastAtf=texture;uploadCount++;setTimeout(complete,1,texture);return texture;}
 public function dispose():void {disposed=true;}
}}
