package cn.optimize.tests {
 import haxe.ds.Option;
 import pinball.common.data.character.repository.OwnedCharacterRepository;
 public class RepositoryProbe {
  public var previousFilterSetting:Option;public var previousCharacterIds:Array=[];public var characterRepository:Object;
  public var globalLogic:Object={logicStatus:{cachedCharacterListCharacterIds:Option.None}};
  public function RepositoryProbe(chars:Array,setting:Object){var map:Object={};for each(var c:Object in chars){map[c.id]=c;previousCharacterIds.push(c.id);}previousFilterSetting=Option.Some(setting);characterRepository={"get":function(id:int):*{return map[id];},find:function(...args):Array{return chars.concat();}};}
  public function setPrevious(setting:Object,list:Array):void{previousCharacterIds=[];for each(var c:Object in list)previousCharacterIds.push(c.id);previousFilterSetting=Option.Some({filter:setting.filter,searchCharacterName:setting.searchCharacterName,orderCriteria:setting.orderCriteria,orderDirection:setting.orderDirection});}
  public function before(setting:Object):Array{return [];}
  public function after(setting:Object):Array{return [];}
  public function clearCache():void{}
 }
}
