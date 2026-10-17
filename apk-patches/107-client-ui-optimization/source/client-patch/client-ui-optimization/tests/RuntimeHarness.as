package {
 import cn.optimize.ui.UiOptimization;
 import flash.desktop.NativeApplication;
 import flash.display.Sprite;
 import flash.filesystem.File;
 import flash.filesystem.FileMode;
 import flash.filesystem.FileStream;
 import flash.utils.Dictionary;
 import flash.utils.getTimer;
 import haxe.ds.Option;
 import haxe.ds.StringMap;
 import pinball.scene.character.cell.CharacterCellViewDataSourceKind;
 import pinball.scene.character.cell.CharacterCellViewDataSourceKindTools;

 public final class RuntimeHarness extends Sprite {
  private var count:int=0;
  private var labels:Array=[];
  private var metrics:Object={};
  private function check(ok:Boolean,label:String):void { count++;labels.push(label);if(!ok)throw new Error(label); }
  private function report(value:Object):void {
   var stream:FileStream=new FileStream();
   stream.open(new File(File.applicationDirectory.nativePath).resolvePath("runtime-tests.json"),FileMode.WRITE);
   stream.writeUTFBytes(JSON.stringify(value));stream.close();NativeApplication.nativeApplication.exit(value.passed?0:1);
  }
  public function RuntimeHarness() {
   try { UiOptimization.disposeList(this);CharacterCellViewDataSourceKindTools.clone(CharacterCellViewDataSourceKind.List(Option.None));poolTests();listTests();cellTests();listAnimationTests();pageTests();report({passed:true,assertions:count,labels:labels,metrics:metrics}); }
   catch(error:*) { report({passed:false,assertions:count,error:String(error),labels:labels,metrics:metrics}); }
  }
  private function poolTests():void {
   var old:TestAnimationPool=new TestAnimationPool();
   var a:TestAnimation=new TestAnimation(),b:TestAnimation=new TestAnimation();
   old.map.h["same"]=[a,b];check(old.getOld("same")===b,"old pool returns last object");
   check(!("same" in old.map.h),"old pool loses remaining bucket index");
   old.disposeReal();check(a.disposes==0,"old pool cannot visit lost leftover during dispose");
   var fixed:TestAnimationPool=new TestAnimationPool();fixed.map.h["same"]=[a,b];
   check(fixed.getNew("same")===b && fixed.map.h["same"].length==1,"new pool retains nonempty bucket");
   check(fixed.getNew("same")===a && !("same" in fixed.map.h),"new pool reuses second object and removes empty bucket");
   check(fixed.viewAsset.creates==0,"two cached objects avoid factory fallback");
   var c:TestAnimation=new TestAnimation(),d:TestAnimation=new TestAnimation();
   fixed.map.rh["__proto__"]=[c,d];check(fixed.getNew("__proto__")===d,"reserved bucket pop");
   fixed.disposeNew();fixed.disposeNew();check(c.disposes==1 && d.disposes==0,"pooled remainder released once across repeated disposal; live returned object not released");
   fixed.map.h["parent"]=[new TestAnimation(true)];var owned:TestAnimation=fixed.map.h["parent"][0];
   fixed.disposeNew();fixed.disposeNew();check(owned.disposes==1 && owned.detachments==1,"parent-owned pooled animation detaches and releases once");
   fixed.getNew("missing");check(fixed.viewAsset.creates==1,"missing bucket keeps original resource fallback");
  }
  private function item(id:int):Object {return {key:id,kind:new TestEnum("Inventory",0,[id]),state:new TestEnum("Normal",0,null),
   accessory:new TestEnum("None",0,null),stack:1,pedestalImagePath:"pedestal/a",pixelArtCharacter:new TestEnum("Animation",0,["skin/a"]),
   thumbnail:{path:"face/a",rarity:5,element:1},showsBadge:Option.None,showsLeaderIcon:false};}
  private function totalApplies(v:TestListView):int {var n:int=0;for each(var c:TestCellView in v.cells.h)n+=c.applies;return n;}
  private function listTests():void {
   var baseline:TestListView=new TestListView(),v:TestListView=new TestListView();
   var data:Array=[item(1),item(2),item(3)];baseline.presentOld(data);v.presentNew(data);
   var first:TestCellView=v.cells.h[1];check(v.cellPool.creates==3 && totalApplies(v)==3,"initial present binds each item once");
   v.presentNew(data);check(v.cells.h[1]===first && totalApplies(v)==3 && v.cellPool.pools==0,"stable present retains views and avoids repeated apply");
   baseline.presentOld(data);check(baseline.cellPool.pools==3 && totalApplies(baseline)==6,"old present recycles and rebinds complete list");
   data[0].stack++;v.presentNew(data);check(first.applies==2,"same key stack update invalidates");
   data[0].pixelArtCharacter.params[0]="skin/b";v.presentNew(data);check(first.applies==3,"in-place nested skin parameter update invalidates");
   data[0].state=new TestEnum("Participating",1,[7]);v.presentNew(data);check(first.applies==4,"participant enum update invalidates");
   data[0].thumbnail.element=2;v.presentNew(data);check(first.applies==5,"thumbnail field update invalidates");
   data[0].showsBadge=Option.Some(1);v.presentNew(data);check(first.applies==6,"badge update invalidates");
   data[0].showsLeaderIcon=true;v.presentNew(data);check(first.applies==7,"leader marker update invalidates");
   data[0].accessory.params=["accessory/b"];v.presentNew(data);check(first.applies==8,"accessory parameter update invalidates");
   data[0].pedestalImagePath="pedestal/b";v.presentNew(data);check(first.applies==9,"pedestal update invalidates");
   data[0].extraField={value:1};v.presentNew(data);check(first.applies==10,"new extra input field conservatively invalidates");
   data[0].extraField.value=2;v.presentNew(data);check(first.applies==11,"extra nested input change invalidates");
   delete data[0].extraField;v.presentNew(data);check(first.applies==12,"removed field invalidates");
   v.presentNew([data[2],data[0],data[1]]);check(v.cells.h[1]===first && first.applies==12,"sort keeps item view binding");
   v.presentNew([data[0],data[2]]);check(v.cellPool.pools==1 && !(2 in v.cells.h),"filter returns only removed view");
   v.presentNew(data);check(v.cells.h[1]===first && v.cellPool.creates==3,"unfilter reuses pool without recreating retained views");
   var before:int=first.applies;v.applyPatchNew([data[0]]);v.presentNew(data);
   check(first.applies==before+2,"patch invalidates cache before original apply and following present");
   data[0].stack++;data[1].thumbnail.path="face/error";v.cells.h[2].fail=true;
   var failed:Boolean=false;try{v.presentNew(data);}catch(error:*){failed=true;}
   check(failed,"binding errors propagate without fallback or fake success");
   data[0].stack--;v.cells.h[2].fail=false;before=first.applies;v.presentNew(data);
   check(first.applies==before+1 && first.lazyAppliedData.params[0].params[0].params[0].stack==data[0].stack,
      "retry after partial binding discards old cache and restores complete data");
   var opaque:Object=item(7);opaque.other=new TestAnimation();v.presentNew([opaque]);
   check(7 in v.cells.h,"opaque input preserves the original row binding path");
   var evaluations:int=0;var lazy:TestLazy=new TestLazy(function():Object{evaluations++;return {badge:true};});
   var lazyItem:Object=item(8);lazyItem.showsBadge=Option.Some(lazy);var known:Object=item(9);v.presentNew([opaque,lazyItem,known]);
   var opaqueView:TestCellView=v.cells.h[7],lazyView:TestCellView=v.cells.h[8];
   var knownView:TestCellView=v.cells.h[9],knownApplies:int=knownView.applies;
   var poolCount:int=v.cellPool.pools,createCount:int=v.cellPool.creates,applyCount:int=lazyView.applies;
   v.presentNew([opaque,lazyItem,known]);
   check(v.cells.h[8]===lazyView && lazyView.applies==applyCount+1,"actual Lazy-containing rows stay dirty and retain their physical view");
   check(evaluations==0 && v.cellPool.pools==poolCount && v.cellPool.creates==createCount,"opaque per-row handling never evaluates badge or recycles the complete list");
   check(v.cells.h[9]===knownView && knownView.applies==knownApplies,"one opaque row does not invalidate an unchanged comparable neighbor");
   var bound:TestLazy=lazyView.last.showsBadge.params[0];
   check(bound===lazy && bound.get().badge && bound.get().badge && evaluations==1,"real clone/apply preserves original Lazy identity and deferred cached get");
   lazyItem.stack++;v.applyPatchNew([lazyItem]);check(lazyView.last.stack==lazyItem.stack && evaluations==1,"patch preserves complete opaque row data without early badge evaluation");
   v.presentNew(data);v.disposeNew();check(v.disposed==0 && first.disposes==1,"original list dispose releases views; helper only clears state");
   v.presentNew(data);check(totalApplies(v)>0,"state cleared on disposal allows future full binding");
   var drag:TestCellView=v.cellPool.getOrCreate(0,0);drag.apply(CharacterCellViewDataSourceKind.List(Option.Some(data[0])));
   v.cellPool.pool(drag);check(drag.applies==1,"drag view stays under original pool ownership");
   var start:int=getTimer();for(var i:int=0;i<300;i++)v.presentNew(data);metrics.stablePresentFixtureMs=getTimer()-start;
   metrics.stableViewApplies=totalApplies(v);metrics.stableViewCount=3;
  }
  private function cellTests():void {
   var old:TestTable=new TestTable(),fixed:TestTable=new TestTable();
   for(var i:int=0;i<40;i++){old.add(i,new TestCell());fixed.add(i,new TestCell());}
   for(i=0;i<20;i++){old.updateOld();fixed.updateNew();}
   check(old.total()==800 && fixed.total()==0,"stable invisible cells avoid logic updates");
   var visible:TestCell=fixed.characterCells.map.h[1];visible.visible=true;fixed.updateNew();check(visible.updates==1,"visible viewport cell still updates");
   visible.x=1000;fixed.updateNew();check(visible.updates==1,"stable offscreen cell stops updating");
   var falling:TestCell=fixed.characterCells.map.h[2];falling.fall=3;falling.motionPlayhead.sequence="fall";
   var victory:TestCell=fixed.characterCells.map.h[3];victory.victory=3;
   for(i=0;i<4;i++)fixed.updateNew();check(falling.fall==0 && victory.victory==0,"hidden fall and kachidoki finish");
   var hover:TestCell=fixed.characterCells.map.h[4];hover.motionPlayhead.sequence="hover";fixed.updateNew();check(hover.updates==1,"hidden hover is conservatively kept alive");
   var delayed:TestCell=fixed.characterCells.map.h[5];delayed.motionPlayhead.delayFrame=Option.Some(2);fixed.updateNew();check(delayed.updates==1,"delayed motion continues");
   var dark:TestCell=fixed.characterCells.map.h[6];dark.darkenTween={index:1};fixed.updateNew();check(dark.updates==1,"darken tween continues");
   var balloon:TestCell=fixed.characterCells.map.h[7];balloon.thumbnailBalloonPlayhead.isPlaying=true;fixed.updateNew();check(balloon.updates==1,"remove/join balloon continues");
   var joinFlag:TestCell=fixed.characterCells.map.h[8];joinFlag.playKachidokiAfterFall=true;fixed.updateNew();check(joinFlag.updates==1,"pending fall-to-victory handoff cannot freeze");
   fixed.wholeAlpha=0;visible.x=0;var was:int=visible.updates;fixed.updateNew();check(visible.updates==was && visible.alpha==0,"stable zero-alpha cell pauses only after original alpha synchronization");
   fixed.wholeAlpha=1;fixed.updateNew();check(visible.updates==was+1 && visible.alpha==1,"restore/cancel reactivates before draw");
   var broken:TestTable=new TestTable();broken.characterCells._keys=[99];var raised:Boolean=false;
   try{broken.updateNew();}catch(error:*){raised=true;}check(raised,"original missing-key error remains observable");
   metrics.baselineHiddenUpdates=old.total();metrics.optimizedStableHiddenUpdates=0;
  }
  private function listAnimationTests():void {
   var old:TestTable=new TestTable(),fixed:TestTable=new TestTable();
   var positions:Array=[-10,0,12,37,168,190,216];
   var probe:TestCellView=new TestCellView();
   for(var i:int=0;i<positions.length;i++) {
    var a:TestCell=new TestCell(),b:TestCell=new TestCell();
    a.visible=b.visible=true;a.x=b.x=positions[i];a.realLifecycle=b.realLifecycle=true;
    a.characterPlayhead.loadTimeline();b.characterPlayhead.loadTimeline();old.add(i,a);fixed.add(i,b);
   }
   var edge:TestCell=fixed.characterCells.map.h[0];
   check(!edge.isWithInScreen(0) && probe.isWithinScreen(edge.x),"actual focus predicate rejects a rendered list edge");
   for(i=0;i<20;i++){old.updateOld();fixed.updateNew();}
   for(i=0;i<positions.length;i++) {
    a=old.characterCells.map.h[i];b=fixed.characterCells.map.h[i];
    var drawn:Boolean=probe.isWithinScreen(b.x);
    check(a.characterPlayhead.timeline.currentFrame==20,"baseline actual character frame advances");
    check(b.characterPlayhead.timeline.currentFrame==(drawn?20:0),"actual draw-visible list animation follows every frame");
   }
   b=fixed.characterCells.map.h[6];var initial:int=b.characterPlayhead.timeline.currentFrame;
   fixed.scrollX=600;fixed.updateNew();check(b.characterPlayhead.timeline.currentFrame==initial+1,"scrolling a cell into draw viewport resumes its animation immediately");
   fixed.scrollX=0;fixed.updateNew();check(b.characterPlayhead.timeline.currentFrame==initial+1,"fully clipped stable cell can pause");
   fixed.scrollX=600;fixed.updateNew();check(b.characterPlayhead.timeline.currentFrame==initial+2,"scroll away and return keeps the existing animation timeline");
   fixed.wholeAlpha=0;var paused:int=b.characterPlayhead.timeline.currentFrame;fixed.updateNew();
   check(b.alpha==0 && b.characterPlayhead.timeline.currentFrame==paused,"hidden table clears draw alpha without advancing stable playheads");
   fixed.wholeAlpha=1;fixed.updateNew();check(b.alpha==1 && b.characterPlayhead.timeline.currentFrame==paused+1,"reopening restores alpha and animation in the same frame");
   var late:TestCell=new TestCell();late.visible=true;late.x=37;late.realLifecycle=true;fixed.add(99,late);
   fixed.scrollX=0;fixed.updateNew();check(late.characterPlayhead.playhead.index==1 && late.characterPlayhead.elapsedFrame==1,"visible cell advances lifecycle while async timeline is pending");
   late.characterPlayhead.timelineLoadHandler(new TestLoadInput("character/late"));
   check(late.characterPlayhead.playhead.index==0,"actual timeline completion binds the pending playhead");
   fixed.updateNew();fixed.updateNew();check(late.characterPlayhead.timeline.currentFrame==2,"async completion preserves continuous visible character animation");
   var inset:TestCell=new TestCell();inset.visible=true;inset.x=205;inset.safeArea.x=120;inset.realLifecycle=true;inset.characterPlayhead.loadTimeline();
   probe.safeArea=inset.safeArea;check(!inset.isWithInScreen(0)&&probe.isWithinScreen(inset.x),"real draw boundary includes nonzero safe-area origin");
   fixed.add(100,inset);fixed.updateNew();check(inset.characterPlayhead.timeline.currentFrame==1,"inset visible edge updates with the renderer boundary");
   metrics.listAnimation={frames:20,positions:positions,scope:"actual updateCells, cell update/updatePlayheads, character advanceFrame/advanceFrameUsually and timelineLoadHandler; controlled timeline and resource completion"};
  }
  private function pageTests():void {
   var page:TestPage=new TestPage();page.thumbnailLayer.visible=false;page.thumbnailLayer.x=1000;
   page.mainCharacterCells[0].visible=true;page.abilitySouls[0].abilitySoul.visible=true;
   page.drawNew(1);check(page.members()==1 && !page.mainCharacterCells[0].visible,"first hidden draw clears old shared cell state");
   check(!page.abilitySouls[0].abilitySoul.visible && !page.abilitySouls[0].hitQuad.visible,"first hidden draw explicitly hides shared soul/hit layers");
   for(var i:int=0;i<30;i++)page.drawNew(1);check(page.members()==1,"stable hidden page skips peripheral draws");
   page.thumbnailLayer.x=1100;page.drawNew(1);check(page.members()==1,"moving a still hidden page preserves cleared shared layers");
   page.thumbnailLayer.visible=true;page.thumbnailLayer.x=0;page.drawNew(1);
   check(page.members()==2 && page.mainCharacterCells[0].visible && page.abilitySouls[0].abilitySoul.visible,"visible transition neighbor restores shared layers");
   page.thumbnailLayer.visible=false;page.thumbnailLayer.x=1000;page.drawNew(1);
   page.mainCharacterCells[0].visible=true;page.drawNew(1);check(!page.mainCharacterCells[0].visible,"external visibility change forces cleanup rather than stale skip");
   page.carouselPeek.fade=0;page.drawNew(1);check(!page.abilitySouls[0].pedestal.visible,"fade/selection/cancel state changes remain synchronized");
   page.disposeNew();check(page.mainCharacterCells[0].disposes==1,"page disposal retains original shared-view release");
   var draws:int=page.members();page.drawNew(1);check(page.members()==draws+1,"disposed helper state does not survive re-use");
   var baseline:TestPage=new TestPage();baseline.thumbnailLayer.visible=false;baseline.thumbnailLayer.x=1000;
   for(i=0;i<31;i++)baseline.drawOld(1);check(baseline.members()==31,"baseline hidden page still dispatches each frame");
   metrics.baselineHiddenPageDraws=31;metrics.optimizedHiddenPageDraws=1;
   var moving:TestPage=new TestPage();moving.thumbnailLayer.visible=false;moving.thumbnailLayer.x=2000;moving.drawNew(1);
   for(i=0;i<120;i++){moving.thumbnailLayer.x=2000+i;moving.thumbnailLayer.y=i;moving.positionRate=3+i/120;moving.drawNew(i);}
   check(moving.members()==1,"120 scroll frames do not redraw a continuously hidden page");
   moving.abilitySouls[0].hitQuad.visible=true;moving.drawNew(1);
   check(moving.members()==2&&!moving.abilitySouls[0].hitQuad.visible,"external shared soul visibility forces original cleanup");
   moving.thumbnailLayer.visible=true;moving.thumbnailLayer.x=0;moving.drawNew(1);
   check(moving.members()==3&&moving.mainCharacterCells[0].visible,"moving hidden page restores animation layers on first visible draw");
  }
 }
}

import flash.utils.Dictionary;
import flash.geom.Rectangle;
import haxe.ds.Option;
import haxe.ds.StringMap;
import pinball.scene.character.cell.CharacterCellViewDataSourceKind;

internal final class TestEnum {public var tag:String;public var index:int;public var params:Array;public const __enum__:Boolean=true;
 public function TestEnum(t:String,i:int,p:Array){tag=t;index=i;params=p;}}
internal final class TestAnimation {public var visible:Boolean=false;public var parent:Object;public var disposes:int=0;public var detachments:int=0;
 public function TestAnimation(parented:Boolean=false){parent=parented?{}:null;}public function dispose():void{disposes++;}
 public function removeFromParent(disposeIt:Boolean):void{detachments++;parent=null;if(disposeIt)dispose();}}
internal final class TestAnimationPool {public var map:StringMap=new StringMap();public var viewAsset:TestAsset=new TestAsset();
 public function getOld(path:String):TestAnimation{return null;}public function getNew(path:String):TestAnimation{return null;}public function disposeReal():void{}public function disposeNew():void{}}
internal final class TestAsset {public var creates:int=0;public function getAnimation(path:String):TestAnimation{creates++;return new TestAnimation();}}
internal final class TestIntMap {public var h:Dictionary=new Dictionary();public function remove(k:int):Boolean{var yes:Boolean=k in h;delete h[k];return yes;}}
internal final class TestKeysIterator {private var keys:Array=[];private var n:int=0;public function TestKeysIterator(h:Object){for(var k:* in h)keys.push(k);}
 public function hasNext():Boolean{return n<keys.length;}public function next():*{return keys[n++];}}
internal final class TestValuesIterator {private var values:Array=[];private var n:int=0;public function TestValuesIterator(h:Object,rh:Object=null){for each(var v:* in h)values.push(v);if(rh!=null)for each(v in rh)values.push(v);}
 public function hasNext():Boolean{return n<values.length;}public function next():*{return values[n++];}}
internal final class TestNote {public function log(...args):void{}}
internal final class TestStd {public static function string(v:*):String{return String(v);}}
internal final class TestMaybe {public static var tmp:*;}
internal final class TestReflect {public static function copy(v:Object):Object{var result:Object={};for(var k:String in v)result[k]=v[k];return result;}}
internal final class TestBoot {public static var lastError:Error;public static var skip_constructor:Boolean=false;}
internal final class TestLazy {public var value:Option;public var getter:Function;public function TestLazy(fn:Function){}public function get():Object{return null;}}
internal final class TestFiles {public static function deleteFile(v:*):void{}}
internal final class TestClientError extends Error {public function TestClientError(code:int,text:String){super(String(code)+":"+text);}}
internal final class TestCellView {public var applies:int=0;public var disposes:int=0;public var visible:Boolean=false;public var showsPedestalShadow:Boolean=false;public var last:Object;
 public var safeArea:Rectangle=new Rectangle(0,0,1080,1920);public function isWithinScreen(x:Number):Boolean{return false;}
 public var fail:Boolean=false;
 public var lazyAppliedData:Option=Option.None;
 public function apply(data:CharacterCellViewDataSourceKind):void{if(fail)throw new Error("fixture binding error");applies++;applyReal(data);last=data.params[0].params[0];}
 public function applyReal(data:CharacterCellViewDataSourceKind):void{}
 public function draw(peek:TestCell,x:Number,y:int):void{visible=Math.abs(x)<400;}
 public function dispose():void{disposes++;}public function prepareForPool():void{last=null;visible=false;}}
internal final class TestViewPool {public var pools:int=0;public var creates:int=0;private var list:Array=[];
 public function pool(v:TestCellView):void{pools++;v.prepareForPool();list.push(v);}public function getOrCreate(a:int,b:int):TestCellView{if(list.length>0)return list.pop();creates++;return new TestCellView();}}
internal final class TestListView {public var cells:TestIntMap=new TestIntMap();public var cellPool:TestViewPool=new TestViewPool();public var note:TestNote=new TestNote();public var disposed:int=0;
 public function presentOld(data:Array):void{}public function presentNew(data:Array):void{}public function applyPatchNew(data:Array):void{}public function disposeNew():void{}}
internal final class TestOrderedMap {public var _keys:Array=[];public var map:TestIntMap=new TestIntMap();public var extraInfo:String="test";}
internal final class TestMotion {public var sequence:String="usual";public var delayFrame:Option=Option.None;public var isPlaying:Boolean=false;
 public function isInSequence(s:String):Boolean{return sequence==s;}public function isSequenceEndFrame(s:String):Boolean{return false;}public function advanceFrame():void{}}
internal final class TestTimeline {public var currentFrame:int=0;public var sequence:String="walk_front";
 public function advanceFrame():void{currentFrame++;}public function isSequenceEndFrame(s:String):Boolean{return false;}
 public function gotoAndPlay(s:String):void{sequence=s;}public function gotoAndPlayComplex(s:String):void{sequence=s;}}
internal final class TestLoadInput {public var params:Array;public function TestLoadInput(path:String){params=[path];}}
internal final class TestLogicAsset {public var timeline:TestTimeline=new TestTimeline();public function hasTimeline(path:String):Boolean{return true;}public function getPlayhead(path:String):TestTimeline{return timeline;}}
internal final class TestHead {private var cell:TestCell;public var timeline:TestTimeline=new TestTimeline();public var playhead:Option=Option.None;
 public var elapsedFrame:int=0;public var needsPlayDefaultSequence:Boolean=false;public var synchronizedFrameProvider:StringMap=new StringMap();
 public var currentTimeline:Option=Option.Some("character/late");public var bookedPlayMethod:Object=0;public var bookedSequence:String="walk_front";public var logicAsset:TestLogicAsset=new TestLogicAsset();
 public function TestHead(c:TestCell){cell=c;logicAsset.timeline=timeline;}public function get state():int{return cell.victory>0||cell.victoryEnding?0:2;}
 public function set state(value:int):void{}public function get_isPlayingKachidokiOnce():Boolean{return cell.victory>0;}
 public function loadTimeline():void{playhead=Option.Some(timeline);}public function advanceFrame():void{}public function advanceFrameUsually(p:TestTimeline):void{}
 public function advanceFrameRandomly(p:TestTimeline):void{p.advanceFrame();}public function getSequenceNameAsCharacterSequence(p:TestTimeline):String{return p.sequence;}
 public function synchronizeSequenceFrame():void{}public function playDefaultSequence():void{}public function playKachidokiOnce():void{}
 public function isInSequence(s:String):Boolean{return timeline.sequence==s;}public function timelineLoadHandler(input:TestLoadInput):void{}}
internal final class TestCell {public var x:Number=0;public var z:Number=0;public var alpha:Number=1;public var visible:Boolean=false;public var onScreen:Boolean=true;public var updates:int=0;
 public var safeArea:Rectangle=new Rectangle(0,0,1080,1920);public var realLifecycle:Boolean=false;
 public var fall:int=0;public var victory:int=0;public var victoryEnding:Boolean=false;public var playKachidokiAfterFall:Boolean=false;public var darkenTween:Object={index:0};
 public var motionPlayhead:TestMotion=new TestMotion();public var thumbnailBalloonPlayhead:TestMotion=new TestMotion();public var characterPlayhead:TestHead;
 public function TestCell(){characterPlayhead=new TestHead(this);}public function isWithInScreen(scroll:Number):Boolean{return false;}
 public function isFalling():Boolean{return fall>0;}public function isJoinOrRemoving():Boolean{return fall>0||victory>0;}
 public function updateReal():void{}public function updatePlayheads():void{}public function updateDarkenTween():void{}
 public function update():void{updates++;if(realLifecycle){updateReal();return;}if(fall>0){fall--;if(fall==0)motionPlayhead.sequence="usual";}if(victory>0){victory--;if(victory==0)victoryEnding=true;}else victoryEnding=false;}}
internal final class TestScroll {public function get_floatingAmount():Number{return 0;}}
internal final class TestTable {public var characterCells:TestOrderedMap=new TestOrderedMap();public var scroll:TestScroll=new TestScroll();public var wholeAlpha:Number=1;
 public var scrollX:Number=0;public function getScrollX():Number{return scrollX;}public function add(k:int,c:TestCell):void{characterCells._keys.push(k);characterCells.map.h[k]=c;}
 public function total():int{var n:int=0;for each(var c:TestCell in characterCells.map.h)n+=c.updates;return n;}
 public function updateOld():void{}public function updateNew():void{}}
internal final class TestMember {public var draws:int=0;public function draw(frame:int):void{draws++;}}
internal final class TestSoul {public var abilitySoul:Object={visible:true};public var pedestal:Object={visible:true};public var hitQuad:Object={visible:true};public var draws:int=0;
 public function draw(frame:int,fade:Number,x:Number):void{draws++;abilitySoul.visible=pedestal.visible=hitQuad.visible=fade>0;}}
internal final class TestPeek {public var fade:Number=1;public var cells:Array=[new TestCell()];public function getLargeThumbnailFadingRate():Number{return fade;}
 public function getFloatingAmount():Number{return 0;}public function getMainCharacterCells(i:int):Array{return cells;}public function getUnisonCharacterCells(i:int):Array{return [];}}
internal final class TestBackground {public function getOffsetY():int{return 0;}}
internal final class TestPage {public var thumbnailLayer:Object={visible:true,x:0,y:0};public var thumbnailLayout:Object={visible:true,alpha:1,y:0};public var positionRate:Number=0;public var pageWidth:Number=200;public var pageIndex:int=0;
 public var carouselPeek:TestPeek=new TestPeek();public var memberViews:Array=[new TestMember()];public var mainCharacterCells:Array=[new TestCellView()];public var unisonCharacterCells:Array=[];public var abilitySouls:Array=[new TestSoul()];public var background:TestBackground=new TestBackground();
 public function get_x():Number{return thumbnailLayer.x;}public function drawCells(peeks:Array,views:Array):void{for(var i:int=0;i<peeks.length;i++)views[i].draw(peeks[i],pageIndex*pageWidth-get_x(),background.getOffsetY());}
 public function drawOld(frame:int):void{}public function drawNew(frame:int):void{}public function disposeNew():void{}
 public function members():int{return memberViews[0].draws;}}
