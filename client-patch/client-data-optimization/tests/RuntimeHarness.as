package {
 import flash.display.Sprite;import flash.desktop.NativeApplication;import flash.filesystem.File;import flash.filesystem.FileMode;import flash.filesystem.FileStream;import flash.utils.getTimer;
 import cn.optimize.data.DataOptimization;import cn.optimize.tests.TableProbe;import cn.optimize.tests.RepositoryProbe;import cn.optimize.tests.CarouselProbe;import cn.optimize.tests.GaugeProbe;import cn.optimize.tests.ScopeProbe;
 import pinball.common.data.character.BattleCharacterLogic;import pinball.common.data.character.OwnedCharacterLogic;import pinball.common.data.character.repository.OwnedCharacterRepository;
 import pinball.common.data.ability.GeneralManaNodeLogic;import pinball.common.data.ability.summary.AbilityContentSummary;import pinball.common.data.ability.summary.AbilityTotalizedSummary;
 import pinball.common.data.general.ElementKindTools;import pinball.common.time._AppTime.AppTime_Impl_;import pinball.common.math._Decimal.Decimal_Impl_;
 import pinball.common.data.ability.summary._AbilitySummarizeThresholdMode.AbilitySummarizeThresholdMode_Impl_;import pinball.online.battle.impact.attack.NormalAttackCalculator;
 import haxe.ds._IntMap.IntMapKeysIterator;import flash.Boot;import pinball.error.ClientError;
 import pinball.common.tools._FunctionTools.BindImpl3_2;
 import pinball.context.character.CharacterListSettingTools;
 import cn.optimize.tests.CarouselViewProbe;import cn.optimize.tests.PageProbe;
 import pinball.scene.character.viewOrder.CharacterSceneViewOrderCommand;
 import pinball.scene.character.cell.CharacterCellViewDataSourceKind;
 import flash.utils.getDefinitionByName;
 import pinball.common.data.party._PartyIndex.PartyIndex_Impl_;
 public class RuntimeHarness extends Sprite {
  private var checks:int=0;private var cases:int=0;private var metrics:Object={};
  private function check(ok:Boolean,label:String):void{checks++;if(!ok)throw new Error(label);}
  public function RuntimeHarness(){var report:Object;try{run();report={passed:true,checks:checks,cases:cases,metrics:metrics,scope:'actual game method bodies/segments plus production helper ABC in desktop AIR; bounded source fixtures; no device acceptance'};}catch(e:*){report={passed:false,checks:checks,cases:cases,error:String(e),stack:e is Error?e.getStackTrace():null};}
   var stream:FileStream=new FileStream();stream.open(new File(File.applicationDirectory.nativePath).resolvePath('runtime-tests.json'),FileMode.WRITE);stream.writeUTFBytes(JSON.stringify(report));stream.close();NativeApplication.nativeApplication.exit(report.passed?0:1);
  }
  private function run():void {
   Array.prototype.copy=function():Array{return this.concat();};
   Array.prototype.setPropertyIsEnumerable('copy',false);
   // Ensure source-side symbols referenced by transplanted AVM2 are present.
   check(Std.string(1)=='1'&&Reflect.compare(1,2)==-1,'support symbols');FileUtilCommon.deleteFile([]);new ClientError(1,'fixture');
   check(!Boot.skip_constructor&&ElementKindTools.getIndex(1)>=0&&AppTime_Impl_.getTime(1)==1,'game dependencies');
   check(Decimal_Impl_.fromInt(1)==100000&&AbilitySummarizeThresholdMode_Impl_.isAll(1)&&NormalAttackCalculator.STAT_MODIFIER_ATTACK_POINT_MIN<0,'numeric dependencies');
   var iterator:IntMapKeysIterator=new IntMapKeysIterator({});check(!iterator.hasNext(),'iterator');
   new AbilityTotalizedSummary(new BattleCharacterLogic(0,{attack:1}),new AbilityContentSummary({gauge:0,fixed:0,second:0}),0);
   new BindImpl3_2(function(p:*,a:*,b:*):int{return 0;},null).execute(0,0);
   OwnedCharacterRepository.getCharacterComparatorBy(0,0);
   CharacterListSettingTools.equalsFilterAndKeyword({},{ });
   CharacterCellViewDataSourceKind.Carousel(null);
   PartyIndex_Impl_.fromPartyId(1004,{findPartyIndexFromPartyId:function(id:int):int{return id%1000;}});
   table();gauges();sorting();carousel();reentry();translation();nodes();
  }
  private function table():void {
   var keys:Array=[-1,0,1,2,3,9,100,2147483647];
   var orders:Array=[[],[3,1,9],[0,-1,3],[2,2,1,0],[9,3,2,1,0,-1,100,2147483647],keys.concat()];
   for each(var order:Array in orders){var data:Array=[];for each(var k:int in order)data.push({key:k,state:k%3});var a:TableProbe=new TableProbe(keys),b:TableProbe=new TableProbe(keys);a.before(data);b.after(data);check(a.snapshot()==b.snapshot(),'rank order/visibility');a.before(data);b.after(data);check(a.snapshot()==b.snapshot(),'unchanged layout');cases++;}
   var ranks:Object=DataOptimization.ranks([0,2,2,-1]);check(DataOptimization.rank(ranks,2)==1&&DataOptimization.rank(ranks,99)==-1&&DataOptimization.rank(ranks,0)==0,'first duplicate/missing/zero');
   var missing:Boolean=false;try{new TableProbe([1]).after([{key:999,state:0}]);}catch(e:*){missing=true;}check(missing,'missing map key still throws');
   metrics.ranks={cases:orders.length,scope:'exact current applyCharacters AVM2 before/after'};
  }
  private function gauges():void {
   var probe:GaugeProbe=new GaugeProbe();var scenarios:int=0;
   for(var main:int=0;main<4;main++)for(var unison:int=0;unison<3;unison++)for(var equipment:int=0;equipment<3;equipment++)for(var soul:int=0;soul<2;soul++)for(var ex:int=0;ex<2;ex++)for(var awake:int=0;awake<3;awake++)for each(var hp:int in [0,50,100])for each(var mode:int in [0,1]){
    var total:Number=main*10000+unison*5000+equipment*3000+soul*7000+ex*11000+awake*1000;
    var values:Object={gauge:total,fixed:int(total/1000),second:total+hp*1000-50000};
    for each(var g:String in ['getStatModifierAttackPoint','getStatModifierSkillDamage','getStatModifierDirectAttackDamage','getStatModifierAbilityDamage','getStatModifierPowerFlipDamage','getStatModifierMultiballAttackPoint','getStatModifierMultiballDirectDamage'])values[g]=mode?total:total*hp/100;
    var s:AbilityContentSummary=new AbilityContentSummary(values);var c:BattleCharacterLogic=new BattleCharacterLogic(1,{attack:100+total});
    AbilityContentSummary.getterCalls=0;BattleCharacterLogic.attackCalls=0;var old:Array=probe.before(s,c,mode);var oldGetters:int=AbilityContentSummary.getterCalls;
    check(oldGetters==10&&BattleCharacterLogic.attackCalls==1,'original ten getters/attack');
    AbilityContentSummary.getterCalls=0;BattleCharacterLogic.attackCalls=0;var fresh:Array=probe.after(s,c,mode);
    check(JSON.stringify(old)==JSON.stringify(fresh),'gauge exact output');check(AbilityContentSummary.getterCalls==3&&BattleCharacterLogic.attackCalls==0,'only three getters');scenarios++;cases++;
   }
   for each(var unusual:Number in [-Infinity,-1,0,100000,100001,Infinity,NaN]){var u:AbilityContentSummary=new AbilityContentSummary({gauge:unusual,fixed:4,second:unusual});var uc:BattleCharacterLogic=new BattleCharacterLogic(1,{attack:100});check(JSON.stringify(probe.before(u,uc,0))==JSON.stringify(probe.after(u,uc,0)),'clamp nonfinite');}
   metrics.gauges={scenarios:scenarios,gettersBefore:10,gettersAfter:3,attackReadsBefore:1,attackReadsAfter:0};
  }
  private function makeCharacters(n:int):Array {var list:Array=[];for(var i:int=0;i<n;i++)list.push(new OwnedCharacterLogic(i+1,{used:i%23,join:i%19,rarity:i%5+1,level:i%120+1,hp:i%71*37,attack:i%83*19,skill:i%5,element:i%6,stack:i%7}));return list;}
  private function ids(list:Array):String{var r:Array=[];for each(var c:Object in list)r.push(c.id);return r.join(',');}
  private function sorting():void {
   var list:Array=makeCharacters(127);var comparisons:int=0;
   for(var criteria:int=0;criteria<9;criteria++)for(var direction:int=0;direction<2;direction++){
    var setting:Object={filter:'all',searchCharacterName:'',orderCriteria:criteria,orderDirection:direction};
    var a:RepositoryProbe=new RepositoryProbe(list.concat().reverse(),setting),b:RepositoryProbe=new RepositoryProbe(list.concat().reverse(),setting);
    check(ids(a.before(setting))==ids(b.after(setting)),'initial sort '+criteria+':'+direction);
    var hits:int=DataOptimization.sortHits;check(ids(a.before(setting))==ids(b.after(setting)),'same-key sort output');check(DataOptimization.sortHits==hits+1,'same sort data version hit');
    var changed:OwnedCharacterLogic=list[17];changed.values.used+=100;changed.values.join+=100;changed.values.rarity+=1;changed.values.level+=500;changed.values.hp+=7000;changed.values.attack+=5000;changed.values.skill+=10;changed.values.element=(changed.values.element+1)%6;changed.values.stack+=20;
    var misses:int=DataOptimization.sortMisses;check(ids(a.before(setting))==ids(b.after(setting)),'sort mutation output');check(DataOptimization.sortMisses==misses+1,'sort mutation invalidates');b.clearCache();check(DataOptimization.scopeDepth()==0,'independent scopes');cases++;
   }
   // Original real comparator methods validate precomputed keys, including ties,
   // descending primary-only behavior and wrapping integer subtraction.
   list.push(new OwnedCharacterLogic(2147483647,{used:0,join:0,rarity:2,level:-2147483648,hp:2147483647,attack:-2147483648,skill:1,element:2,stack:0}));
   var settings:Object={filter:'all',searchCharacterName:'',orderCriteria:4,orderDirection:1};var x:RepositoryProbe=new RepositoryProbe(list,settings),y:RepositoryProbe=new RepositoryProbe(list,settings);check(ids(x.before(settings))==ids(y.after(settings)),'integer overflow comparator');
   var big:Array=makeCharacters(2048).reverse();settings={filter:'all',searchCharacterName:'',orderCriteria:4,orderDirection:0};
   var orig:RepositoryProbe=new RepositoryProbe(big,settings),opt:RepositoryProbe=new RepositoryProbe(big,settings);
   OwnedCharacterLogic.getterCalls=0;var t:int=getTimer();var out1:Array=orig.before(settings);var beforeMs:int=getTimer()-t;var originalGetters:int=OwnedCharacterLogic.getterCalls;
   OwnedCharacterLogic.getterCalls=0;t=getTimer();var out2:Array=opt.after(settings);var missMs:int=getTimer()-t;var missGetters:int=OwnedCharacterLogic.getterCalls;check(ids(out1)==ids(out2),'large miss exact output');
   OwnedCharacterLogic.getterCalls=0;t=getTimer();opt.after(settings);var hitMs:int=getTimer()-t;var hitGetters:int=OwnedCharacterLogic.getterCalls;
   check(missGetters<originalGetters&&hitGetters<originalGetters,'large list getter work decreases');
   metrics.sorting={characters:big.length,originalMs:beforeMs,missMs:missMs,hitMs:hitMs,originalGetterCalls:originalGetters,missGetterCalls:missGetters,hitGetterCalls:hitGetters,scope:'desktop AIR fixture; no game frame-rate claim'};
  }
  private function carousel():void {
   var a:CarouselProbe=new CarouselProbe(12),b:CarouselProbe=new CarouselProbe(12);
   var cfg:Object={thresholdHp:50,abilityAllActive:true};a.beforeDetails(cfg);b.afterDetails(cfg);check(a.calls==12&&b.calls==3,'current and neighbors eager only');
   check(JSON.stringify(a.partiesData[4])==JSON.stringify(b.partiesData[4]),'current immediate');check(JSON.stringify(a.partiesData[3])==JSON.stringify(b.partiesData[3]),'neighbor immediate');
   for(var i:int=0;i<12;i++){check(JSON.stringify(a.beforeData(i))==JSON.stringify(b.afterData(i)),'lazy visit exact');}check(b.calls==12,'each visited party recomputed once');
   b.tracker={current:4.3,destination:8};a.beforeDetails({thresholdHp:20,abilityAllActive:false});b.afterDetails({thresholdHp:20,abilityAllActive:false});check(JSON.stringify(a.partiesData[8])==JSON.stringify(b.partiesData[8]),'scroll destination immediate');
   b.applyParty(10,{group:1,index:10,hp:20,all:false,edited:true});check(b.afterData(10).edited===true,'party edit accepted at current revision');
   b.store.partyGroupId=2;check(b.afterData(10).group==2,'group switch invalidates');b.partiesData=[];b.partiesData.length=12;check(b.afterData(4).group==2,'restoration after data replacement');
   b.failIndex=4;var threw:Boolean=false;try{b.afterDetails({thresholdHp:75,abilityAllActive:false});}catch(e:*){threw=true;}check(threw,'detail error propagated');b.failIndex=-1;check(b.afterData(4).hp==75,'failed party remains dirty and retryable');
   metrics.details={cachedParties:12,eagerBefore:12,eagerAfter:3,eventualVisited:12};cases+=5;
  }
  private function nodeJSON(list:Array):String {var r:Array=[];for each(var n:Object in list)r.push([n.id,n.awakeLevel]);return JSON.stringify(r);}
  private function reentry():void {
   var available:Boolean=true;try{getDefinitionByName('cn.optimize.data.r2.DataOptimization');}catch(absent:*){available=false;}
   if(available){var bad:CarouselProbe=new CarouselProbe(6);bad.useOldHelper=true;bad.store.partyGroupId=2;var oldView:CarouselViewProbe=new CarouselViewProbe(bad);var rejected:Boolean=false;
    var oldError:String='none';try{oldView.dispatch(CharacterSceneViewOrderCommand.ApplyCarouselData(4,bad.partiesData[4],true));}catch(error:*){oldError=String(error);rejected=oldError.indexOf('G1002')>=0;}
    check(rejected,'R2 helper reproduces synchronous notifyCommand G1002; observed='+oldError);}
   var fixed:CarouselProbe=new CarouselProbe(6);fixed.store.partyGroupId=2;var view:CarouselViewProbe=new CarouselViewProbe(fixed);
   view.dispatch(CharacterSceneViewOrderCommand.ApplyCarouselData(4,fixed.partiesData[4],true));
   check(view.commandCount==1&&view.maxDepth==1,'SET switch getter sends no nested command');
   var current:PageProbe=view.pages[4];check(current.initialized&&current.memberViews[0].data.group==2,'real page present/apply reads new SET members');
   check(current.mainCharacterCells[0].applied.params[0].params[0].group==2,'real page apply reads new SET cells');
   var commands:int=view.commandCount;fixed.afterDetails({thresholdHp:45,abilityAllActive:true});
   check(view.commandCount==commands,'detail recalculation remains silent like baseline');
   view.dispatch(CharacterSceneViewOrderCommand.ApplyCarouselData(4,fixed.afterData(4),true));
   check(view.commandCount==commands+1&&current.memberViews[0].data.hp==45,'existing detail notification refreshes current page');
   check(!view.pages[3].initialized&&!view.pages[5].initialized,'existing reset invalidates neighbor views');
   view.pages[3].initialize();view.pages[5].initialize();
   check(view.pages[3].memberViews[0].data.hp==45&&view.pages[5].memberViews[0].data.hp==45,'neighbor initialize renders current details');
   view.pages[0].initialize();check(view.pages[0].memberViews[0].data.group==2&&view.pages[0].memberViews[0].data.hp==45,'stale offscreen page restores new SET and details');
   check(view.commandCount==commands+1,'all page getters avoid dispatcher calls');
   check(current.setupCalls==0&&view.pages[3].setupCalls==0&&view.pages[5].setupCalls==0,'real page apply retains initialized arrays without repeated setup');
   metrics.reentry={oldR2G1002Reproduced:available,commandsAfterSwitchAndDetail:view.commandCount,maxDispatcherDepth:view.maxDepth,actualPagePresentApply:true};cases+=3;
  }
  private function nodes():void {
   var c:BattleCharacterLogic=new BattleCharacterLogic(1,{attack:1});c.abilities.h={100:0,200:1,333:4};
   var outside:Array=c.optimizedNodes();check(nodeJSON(c.originalNodes())==nodeJSON(outside),'outside exact nodes');check(outside[0]!==c.optimizedNodes()[0],'outside no cache');
   var scope:ScopeProbe=new ScopeProbe();var allocationStart:int=GeneralManaNodeLogic.allocations;
   scope.execute(function():Object {var first:Array=c.optimizedNodes();for(var i:int=0;i<10;i++){var again:Array=c.optimizedNodes();check(nodeJSON(first)==nodeJSON(again)&&first!==again&&first[0]===again[0],'scoped node reuse/copy');}return {};});
   check(GeneralManaNodeLogic.allocations-allocationStart==3,'one node build in repeated scope');check(DataOptimization.scopeDepth()==0,'normal cleanup');
   scope.execute(function():Object {var outer:Array=c.optimizedNodes();scope.execute(function():Object{check(DataOptimization.scopeDepth()==2,'nested scope depth');c.optimizedNodes();return {};});check(DataOptimization.scopeDepth()==1&&c.optimizedNodes()[0]===outer[0],'outer cache survives nested scope');return {};});
   scope.execute(function():Object {var first:Array=c.optimizedNodes();c.abilities.h[100]=7;check(c.optimizedNodes()[0]!==first[0]&&nodeJSON(c.optimizedNodes())==nodeJSON(c.originalNodes()),'in-place learned/awake mutation');var old:Array=c.optimizedNodes();c.logicAssets={};check(c.optimizedNodes()[0]!==old[0],'asset identity invalidation');old=c.optimizedNodes();old[0].awakeLevel=99;check(nodeJSON(c.optimizedNodes())==nodeJSON(c.originalNodes()),'exposed node corruption rebuilds');return {};});
   var failed:Boolean=false;c.logicAssets={failNode:200};try{scope.execute(function():Object{c.optimizedNodes();return {};});}catch(e:*){failed=true;}check(failed&&DataOptimization.scopeDepth()==0,'factory exception cleanup');
   c.logicAssets={};var marker:Error=new Error('original error');try{scope.execute(function():Object{scope.execute(function():Object{throw marker;});return {};});}catch(error:*){check(error===marker,'exception identity preserved');}check(DataOptimization.scopeDepth()==0,'nested throw cleanup');
   metrics.nodes={repeatedReads:11,nodeAllocationsWithinScope:3,nodeHits:DataOptimization.nodeHits,scopeDepthAfter:DataOptimization.scopeDepth()};cases+=6;
  }
  private function translation():void {
   var outputs:Array=[];var counts:Array=[];var notifications:Array=[];
   for(var mode:int=0;mode<3;mode++){
    var c:CarouselProbe=new CarouselProbe(6);c.buildContainers();c.store.partyGroupId=2;c.useBaselineGetter=mode==0;
    var view:CarouselViewProbe=new CarouselViewProbe(c);
    if(mode==0)c.partyChangedBaseline(1004,2004);else if(mode==1)c.partyChangedR3(1004,2004);else c.partyChangedFixed(1004,2004);
    counts.push(c.calls);notifications.push(view.commandCount);
    outputs.push(JSON.stringify({data:c.partiesData[4],member:view.pages[4].memberViews[0].data,cell:view.pages[4].mainCharacterCells[0].applied}));
    check(view.commandCount==1&&view.maxDepth==1&&c.falls==1,'cross SET keeps one notify and fall startup');
    var beforeCalls:int=c.calls;for(var frame:int=0;frame<120;frame++){c.initialzeAt(4);c.getCurrentPartyData();}
    check(c.calls==beforeCalls,'warm initialization/current getters do not translate');
    c.partyChangedFixed(2004,2005);check(c.calls==beforeCalls,'same-group change remains an early return');cases++;
   }
   check(counts.join(',')=='1,2,1','baseline/R3/fixed cross SET getPartyAt counts');
   check(outputs[0]==outputs[1]&&outputs[1]==outputs[2],'cross SET complete page output unchanged');
   metrics.translation={actualPartyChanged:true,actualInitialzeAtAndCurrentGetter:true,baselineGetPartyAtCalls:counts[0],r3GetPartyAtCalls:counts[1],fixedGetPartyAtCalls:counts[2],notifications:notifications,warmFrames:120};
  }
 }
}
