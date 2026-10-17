package pinball.common.task {
 import cn.optimize.resources.ResourceRuntime;
 public class MultiTask {
  public var tasks:Array=[]; public var started:Boolean=false;
  public var progressManager:ProgressManager; public var onProgressCount:int=0; public var completedCount:int=0;
  public function startNextTask(index:int,time:Number):void { ResourceRuntime.startTasks(this,index); }
  public function _startNextTask(index:int):void { ResourceRuntime.startTasks(this,index); }
  public function run():Object { started=true; progressManager=new ProgressManager(); if(tasks.length==0)progressManager.complete(0); else startNextTask(0,0); return progressManager; }
  public function add(fn:Function):void { tasks.push(fn); }
 }
}
