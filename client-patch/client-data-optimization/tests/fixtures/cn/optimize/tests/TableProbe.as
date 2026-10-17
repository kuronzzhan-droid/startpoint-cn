package cn.optimize.tests {
 import pinball.common.ds.OrderedMap;
 import pinball.scene.character.cell.CharacterCell;
 public class TableProbe {
  public var characterCells:OrderedMap=new OrderedMap();public var visibleCharacterKeys:Array=[];
  public var viewOrder:Object;public var layouts:int=0;public var presentation:String;
  public function TableProbe(keys:Array){characterCells._keys=keys.concat();for each(var k:int in keys)Object(characterCells.map).h[k]=new CharacterCell();viewOrder=new TableOrderProbe(this);}
  public function applyCharactersParticipant(data:Array):void{for each(var row:Object in data)Object(characterCells.map).h[int(row.key)].state=row.state;}
  public function layoutCells():void{layouts++;}
  public function sortByCharacterCellKey(order:Array,a:int,b:int):int{return order.indexOf(a)-order.indexOf(b);}
  public function before(data:Array):void{}
  public function after(data:Array):void{}
  public function snapshot():String{var rows:Array=[];for each(var key:int in characterCells._keys){var c:CharacterCell=Object(characterCells.map).h[key];rows.push({key:key,visible:c.visible,state:c.state});}return JSON.stringify({keys:characterCells._keys,visible:visibleCharacterKeys,rows:rows,layouts:layouts,presentation:presentation});}
 }
}
