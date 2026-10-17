package {
 import flash.display.Sprite;import flash.desktop.NativeApplication;import flash.filesystem.File;import flash.filesystem.FileMode;import flash.filesystem.FileStream;import flash.utils.getTimer;
 import cn.optimize.data.DataOptimization;import cn.optimize.tests.BadgeProbe;
 import pinball.common.ds.Lazy;import pinball.common.data.character.OwnedCharacterLogic;import pinball.common.data.player.PlayerLogic;import pinball.context.global.GlobalLogic;
 import pinball.common.data.quest.repository.QuestRepository;import pinball.common.data.quest.repository.CharacterQuestGroup;
 import pinball.master.generated.CharacterQuestValues;import pinball.master.generated.CharacterQuestTable;import pinball.master.runtime.MasterMap;
 import pinball.common.data.quest.normal.character.CharacterQuestLogic;import pinball.scene.character.translator.InventoryCharacterBadgeReason;import haxe.ds.Option;
 import pinball.common.tools._FunctionTools.BindImpl1_0;import pinball.common.tools._FunctionTools.BindImpl2_0;import pinball.common.time._AppTime.AppTime_Impl_;import flash.Boot;
 public class BadgeHarness extends Sprite {
  private var checks:int=0;private var cases:int=0;private var metrics:Object={};
  private function check(v:Boolean,s:String):void{checks++;if(!v)throw new Error(s);}
  public function BadgeHarness(){var report:Object;try{run();report={passed:true,checks:checks,cases:cases,metrics:metrics};}catch(e:*){report={passed:false,checks:checks,cases:cases,error:String(e),stack:e is Error?e.getStackTrace():null};}var fs:FileStream=new FileStream();fs.open(new File(File.applicationDirectory.nativePath).resolvePath('badge-tests.json'),FileMode.WRITE);fs.writeUTFBytes(JSON.stringify(report));fs.close();NativeApplication.nativeApplication.exit(report.passed?0:1);}
  private function map(n:int):MasterMap{var rows:Array=[];for(var i:int=0;i<n;i++)rows.push(new CharacterQuestValues(i+1,Option.None,Option.None));return new MasterMap(rows);}
  private function run():void {
   check(!Boot.skip_constructor&&AppTime_Impl_.getTime(1)==1,'dependencies');new CharacterQuestTable();new CharacterQuestLogic(0);new CharacterQuestGroup(0,[]);new BindImpl1_0(function(a:Object):Object{return a;},1).execute();new BindImpl2_0(function(a:Object,b:Object):Object{return a;},1,2).execute();
   var reason:InventoryCharacterBadgeReason=InventoryCharacterBadgeReason.NotClearedAndSelectableCharacterQuest;
   var ma:MasterMap=map(537),mb:MasterMap=map(537),ra:QuestRepository=new QuestRepository(ma),rb:QuestRepository=new QuestRepository(mb);
   var player:PlayerLogic=new PlayerLogic(),ga:GlobalLogic=new GlobalLogic(player,10),gb:GlobalLogic=new GlobalLogic(player,10),a:BadgeProbe=new BadgeProbe(ra,ga),b:BadgeProbe=new BadgeProbe(rb,gb);
   var oldRows:Array=[],newRows:Array=[],t:int=getTimer();
   for(var i:int=1;i<=537;i++){oldRows.push(new Lazy(a.before(reason,new OwnedCharacterLogic(i))));}var oldMs:int=getTimer()-t;t=getTimer();
   for(i=1;i<=537;i++)newRows.push(new Lazy(b.after(reason,new OwnedCharacterLogic(i))));var newMs:int=getTimer()-t;
   check(ra.calls==537&&ma.keysCalls==537&&ma.getCalls==537*537,'baseline eager full task-table scans');
   check(rb.calls==0&&mb.keysCalls==0&&mb.getCalls==0&&rb.questBuilds==0,'all callbacks remain lazy');
   check(ga.playerReads==537&&gb.playerReads==537&&ga.timeReads==537&&gb.timeReads==537,'creation-time player/time reads retained');
   for(i=0;i<537;i++)check(newRows[i].value.index==1&&oldRows[i].value.index==1,'no Lazy result before visible read');
   player.cleared[2]=true;player.selectable=true;
   t=getTimer();for(i=0;i<16;i++){check(oldRows[i].get()===newRows[i].get(),'visible result matches '+i);check(newRows[i].get()===oldRows[i].get(),'successful get memoized '+i);}var visibleMs:int=getTimer()-t;
   check(rb.calls==16&&mb.keysCalls==16&&mb.getCalls==16*537,'only visible task groups constructed once');
   for(i=16;i<537;i++)check(newRows[i].value.index==1,'offscreen rows remain unevaluated');
   check(newRows[2].get()===false&&newRows[0].get()===true,'true and false badge values');
   player.cleared[0]=true;player.selectable=false;check(newRows[0].get()===oldRows[0].get()&&newRows[0].get()===true,'successful Lazy value remains unchanged after state changes');
   metrics.cold={characters:537,visible:16,baselineLookupCalls:ra.calls,optimizedLookupCalls:rb.calls,baselineTableReads:ma.getCalls,optimizedTableReads:mb.getCalls,baselineCreateMs:oldMs,optimizedCreateMs:newMs,visibleBothMs:visibleMs};cases++;
   // Capture time/player/id at callback creation, keep live player-object state.
   var p1:PlayerLogic=new PlayerLogic(),p2:PlayerLogic=new PlayerLogic();p2.selectable=false;
   var mm1:MasterMap=map(1),mm2:MasterMap=map(1),r1:QuestRepository=new QuestRepository(mm1),r2:QuestRepository=new QuestRepository(mm2),g1:GlobalLogic=new GlobalLogic(p1,3),g2:GlobalLogic=new GlobalLogic(p1,3);
   var c1:OwnedCharacterLogic=new OwnedCharacterLogic(1),c2:OwnedCharacterLogic=new OwnedCharacterLogic(1),l1:Lazy=new Lazy(new BadgeProbe(r1,g1).before(reason,c1)),l2:Lazy=new Lazy(new BadgeProbe(r2,g2).after(reason,c2));
   c1.id=c2.id=99;g1.player=g2.player=p2;g1.time=g2.time=100;
   r1.quests[0].visibleAt=5;r2.getCharacterQuestByCharacterQuestId(0).visibleAt=5;
   check(l1.get()===l2.get()&&l2.get()===false,'captured original time/player/id');check(r2.characterQuestGroupMap.h[1]!=null&&r2.characterQuestGroupMap.h[99]==null,'character identity captured');cases++;
   p1=new PlayerLogic();r1=new QuestRepository(map(1));r2=new QuestRepository(map(1));g1=new GlobalLogic(p1,10);g2=new GlobalLogic(p1,10);
   l1=new Lazy(new BadgeProbe(r1,g1).before(reason,new OwnedCharacterLogic(1)));l2=new Lazy(new BadgeProbe(r2,g2).after(reason,new OwnedCharacterLogic(1)));p1.cleared[0]=true;
   check(l1.get()===false&&l2.get()===false,'player mutation before first evaluation visible to both');
   p1.cleared[0]=false;l1=new Lazy(new BadgeProbe(r1,g1).before(reason,new OwnedCharacterLogic(1)));l2=new Lazy(new BadgeProbe(r2,g2).after(reason,new OwnedCharacterLogic(1)));
   check(l1.get()===false&&l2.get()===false,'original same-time group cache semantics retained');g1.time=g2.time=11;
   l1=new Lazy(new BadgeProbe(r1,g1).before(reason,new OwnedCharacterLogic(1)));l2=new Lazy(new BadgeProbe(r2,g2).after(reason,new OwnedCharacterLogic(1)));
   check(l1.get()===true&&l2.get()===true,'fresh-time group recompute semantics retained');cases++;
   // Secondary/tertiary membership and missing groups run actual repository loop.
   var rows:Array=[new CharacterQuestValues(1,Option.Some(2),Option.Some(3))];r1=new QuestRepository(new MasterMap(rows));r2=new QuestRepository(new MasterMap(rows));p1=new PlayerLogic();g1=new GlobalLogic(p1,10);g2=new GlobalLogic(p1,10);
   for(i=1;i<=4;i++){l1=new Lazy(new BadgeProbe(r1,g1).before(reason,new OwnedCharacterLogic(i)));l2=new Lazy(new BadgeProbe(r2,g2).after(reason,new OwnedCharacterLogic(i)));check(l1.get()===l2.get()&&l2.get()===(i<=3),'membership/missing '+i);cases++;}
   // Other switch cases retain bound methods, argument binding and live character state.
   var reasons:Array=[InventoryCharacterBadgeReason.CanLearnManaNodeOrGetBondToken,InventoryCharacterBadgeReason.CanOverLimitByStack([1]),InventoryCharacterBadgeReason.CanOverLimitByStack([1,2]),InventoryCharacterBadgeReason.CanExBoost([1,2]),InventoryCharacterBadgeReason.CanExBoost([1,2,3])];
   for each(var other:InventoryCharacterBadgeReason in reasons){c1=new OwnedCharacterLogic(1);c2=new OwnedCharacterLogic(1);l1=new Lazy(new BadgeProbe(r1,g1).before(other,c1));l2=new Lazy(new BadgeProbe(r2,g2).after(other,c2));c1.mana=c2.mana=false;check(l1.get()===l2.get(),'unchanged other case '+other.index);cases++;}
   // Lookup errors now occur at first visible get, remain propagated and retryable.
   r1=new QuestRepository(map(1));r1.fails=1;var threw:Boolean=false;try{new BadgeProbe(r1,g1).before(reason,new OwnedCharacterLogic(1));}catch(e:*){threw=String(e).indexOf('lookup-fixture-failure')>=0;}check(threw,'baseline error at callback construction');
   r2=new QuestRepository(map(1));r2.fails=1;l2=new Lazy(new BadgeProbe(r2,g2).after(reason,new OwnedCharacterLogic(1)));check(r2.calls==0,'deferred lookup cannot fail during callback construction');threw=false;try{l2.get();}catch(e:*){threw=String(e).indexOf('lookup-fixture-failure')>=0;}check(threw&&l2.value.index==1,'lookup exception is not swallowed/cached');check(l2.get()===true&&r2.calls==2&&l2.value.index==0,'lookup retry succeeds');check(l2.get()===true&&r2.calls==2,'successful retry remains memoized');cases++;
   p1=new PlayerLogic();p1.fail=true;r1=new QuestRepository(map(1));r2=new QuestRepository(map(1));g1=new GlobalLogic(p1,10);g2=new GlobalLogic(p1,10);l1=new Lazy(new BadgeProbe(r1,g1).before(reason,new OwnedCharacterLogic(1)));l2=new Lazy(new BadgeProbe(r2,g2).after(reason,new OwnedCharacterLogic(1)));
   for each(var lazy:Lazy in [l1,l2]){threw=false;try{lazy.get();}catch(e:*){threw=String(e).indexOf('contains-fixture-failure')>=0;}check(threw&&lazy.value.index==1,'contains exception remains retryable');}
   p1.fail=false;check(l1.get()===true&&l2.get()===true,'both contain retries equal');cases++;
   for each(var unusual:Number in [NaN,Infinity,-Infinity,0,-0,0.0000001]){r1=new QuestRepository(map(1));r2=new QuestRepository(map(1));p1=new PlayerLogic();g1=new GlobalLogic(p1,unusual);g2=new GlobalLogic(p1,unusual);l1=new Lazy(new BadgeProbe(r1,g1).before(reason,new OwnedCharacterLogic(1)));l2=new Lazy(new BadgeProbe(r2,g2).after(reason,new OwnedCharacterLogic(1)));check(l1.get()===l2.get(),'Number time coercion preserved');cases++;}
  }
 }
}
