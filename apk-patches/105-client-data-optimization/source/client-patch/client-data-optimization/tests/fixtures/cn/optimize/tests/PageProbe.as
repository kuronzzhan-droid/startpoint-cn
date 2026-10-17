package cn.optimize.tests {
 import pinball.scene.character.cell.CharacterCellView;
 public class PageProbe {
  public var initialized:Boolean=false;public var pageIndex:int;public var carouselPeek:Object;public var thumbnailLayout:Object={};
  public var mainCharacterCells:Array=[];public var unisonCharacterCells:Array=[];public var memberViews:Array=[];public var abilitySouls:Array=[];
  public var note:Object={log:function(...args):void{}};
  public var setupCalls:int=0;
  public function PageProbe(carousel:Object,index:int){carouselPeek=carousel;pageIndex=index;for(var i:int=0;i<3;i++){mainCharacterCells.push(new CharacterCellView());memberViews.push({data:null,present:function(d:Object):void{this.data=d;}});abilitySouls.push({data:null,present:function(d:Object):void{this.data=d;}});}}
  public function setupPixelArtCharacters(d:Object):void{setupCalls++;}
  public function setupThumbnails(d:Object):void{setupCalls++;}
  public function setupAbilitySoul(d:Object):void{setupCalls++;}
  public function present(reset:Boolean):void{}
  public function apply(d:Object):void{}
  public function initialize():void{apply(carouselPeek.getPartyData(pageIndex));}
 }
}
