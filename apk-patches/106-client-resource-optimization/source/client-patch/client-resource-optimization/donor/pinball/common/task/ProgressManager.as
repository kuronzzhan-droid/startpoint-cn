package pinball.common.task { public class ProgressManager {
 public var completeCount:int=0;public var fraction:Number=0;
 public static var nextProgressHook:Function;public var progressHook:Function;
 public function ProgressManager(weights:Object=null){progressHook=nextProgressHook;nextProgressHook=null;}
 public function progress(index:int,value:Number):void {fraction=value;if(progressHook!=null)progressHook(index,value);}
 public function complete(index:int):void {completeCount++;}
} }
