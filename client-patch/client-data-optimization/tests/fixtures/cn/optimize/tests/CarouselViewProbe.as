package cn.optimize.tests {
 public class CarouselViewProbe {
  public var peek:Object;public var pages:Array=[];
  public var partyNameLabel:Object={setName:function(name:String):void{},setLineColor:function(color:int):void{}};
  public function CarouselViewProbe(carousel:CarouselProbe){peek=carousel;for(var i:int=0;i<carousel.partiesData.length;i++)pages.push(new PageProbe(carousel,i));carousel.viewOrder={sendCommand:dispatch};}
  private var notifying:Boolean=false;public var commandCount:int=0;public var maxDepth:int=0;
  public function dispatch(command:Object):void{if(notifying)throw new Error('G1002 nested notifyCommand');notifying=true;commandCount++;maxDepth=1;try{onPresentCarouselPage(command.index,command.data,command.reset);}finally{notifying=false;}}
  public function onPresentCarouselPage(index:int,data:Object,reset:Boolean):void{}
  public function refreshElementRings(d:Object):void{}
  public function refreshIndicatorColor(d:Object):void{}
 }
}
