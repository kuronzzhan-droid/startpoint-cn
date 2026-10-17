package pinball.asset { public class WaitInOrderImpl {
 public var disposed:Boolean=false; public var completed:Boolean=false; private var callbacks:Array=[];
 public function dispose():void { disposed=true;callbacks=[]; }
 public function executeComplete():void { completed=true;for each(var fn:Function in callbacks)fn();callbacks=[]; }
 public function addCompleteHandler(fn:Function):void {if(disposed)throw new Error("disposed wait");if(completed)fn();else callbacks.push(fn);}
} }
