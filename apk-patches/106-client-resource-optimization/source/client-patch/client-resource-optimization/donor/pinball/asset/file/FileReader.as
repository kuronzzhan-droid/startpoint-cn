package pinball.asset.file {public class FileReader {
 public var pending:Array=[];
 public function getPngScale(path:String):Number{return 1;}
 public function getPngConverter(path:String,extension:String):Function{return function(bytes:*):*{return bytes;};}
 public function readAssetFile(path:String,extension:String,convert:Function,callback:Function):void{pending.push(callback);}
}}
