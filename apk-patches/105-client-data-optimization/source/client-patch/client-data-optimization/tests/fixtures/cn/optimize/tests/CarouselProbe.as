package cn.optimize.tests {
 import cn.optimize.data.DataOptimization;
 import haxe.ds.Option;
 public class CarouselProbe {
  public var store:Object={partyGroupId:1};public var currentIndex:int=4;public var tracker:Object={current:4,destination:4};
  public var detailSetting:Object={thresholdHp:100,abilityAllActive:false};public var partiesData:Array=[];
  public var useCase:Object;public var calls:int=0;public var commands:Array=[];public var failIndex:int=-1;
  public var viewOrder:Object={sendCommand:function(command:Object):void{}};public var useOldHelper:Boolean=false;
  public var useBaselineGetter:Boolean=false;public var initialIndex:int=-1;public var characterContainers:Array=[];public var falls:int=0;
  public var buttonProcessor:Object={addPartyCells:function(...args):void{}};
  public var partyGroupHolder:Object={getPartyGroupFromPartyId:function(id:int):Object{return {id:int(id/1000),getPartyLength:function():int{return 6;}};},findPartyIndexFromPartyId:function(id:int):int{return id%1000;}};
  public function CarouselProbe(length:int){var self:CarouselProbe=this;useCase={getPartyAt:function(group:int,index:int,cfg:Object):Object{self.calls++;if(index==self.failIndex)throw new Error('party failure');var data:Object={group:group,index:index,hp:int(cfg.thresholdHp),all:Boolean(cfg.abilityAllActive),name:'party'+index,color:index,members:[],cell:{mainCharacters:[],unisonCharacters:[]}};for(var i:int=0;i<3;i++){data.members.push({abilitySoul:null,hp:data.hp,group:group});data.cell.mainCharacters.push(Option.Some({hp:data.hp,group:group}));}return data;}};for(var i:int=0;i<length;i++){partiesData.push(useCase.getPartyAt(1,i,detailSetting));DataOptimization.acceptParty(this,i);}calls=0;
  }
  public function buildContainers():void{for(var i:int=0;i<6;i++)characterContainers.push({initialized:true,requiresReset:false,mainCharacterCells:[],unisonCharacterCells:[],requireReset:function():void{this.requiresReset=true;},apply:function(data:Object):void{this.requiresReset=false;this.initialized=true;}});}
  public function beforeDetails(setting:Object):void{}
  public function afterDetails(setting:Object):void{}
  public function beforeData(index:int):Object{return null;}
  public function afterData(index:int):Object{return null;}
  public function getPartyData(index:int):Object{return useBaselineGetter?beforeData(index):useOldHelper?oldOptimizedData(index):afterData(index);}
  public function oldOptimizedData(index:int):Object{return null;}
  public function dispatchApplyParty(index:int,data:Object):void{}
  public function applyParty(index:int,data:Object):void{partiesData[index]=data;DataOptimization.acceptParty(this,index);commands.push(index);}
  public function initialzeAt(index:int):void{}
  public function getCurrentPartyData():Object{return null;}
  public function gotoPage(index:int):void{currentIndex=index;tracker={current:-index,destination:-index};}
  public function startFallAnimation(index:int):void{falls++;}
  public function partyChangedBaseline(oldId:int,newId:int):void{}
  public function partyChangedR3(oldId:int,newId:int):void{}
  public function partyChangedFixed(oldId:int,newId:int):void{}
 }
}
