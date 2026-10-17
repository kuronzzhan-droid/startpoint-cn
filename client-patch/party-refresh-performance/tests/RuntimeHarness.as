package {
    import flash.display.Sprite;
    import flash.desktop.NativeApplication;
    import flash.filesystem.File;
    import flash.filesystem.FileMode;
    import flash.filesystem.FileStream;
    import flash.utils.getTimer;
    import haxe.ds.Option;
    import pinball.common.data.character.BattleCharacterLogic;
    import pinball.common.data.ability.summary.AbilitySummarizer;
    import pinball.common.math._Decimal.Decimal_Impl_;
    public class RuntimeHarness extends Sprite {
        private var checks:int=0;
        private var savedCalls:int=0;
        private var cases:int=0;
        private function check(value:Boolean,label:String):void { checks++;if(!value)throw new Error(label); }
        public function RuntimeHarness() {
            var report:Object;
            try { report=run();report.passed=true; }
            catch(e:*) { report={passed:false,checks:checks,cases:cases,error:String(e),stack:e is Error?e.getStackTrace():null}; }
            var stream:FileStream=new FileStream();
            stream.open(new File(File.applicationDirectory.nativePath).resolvePath('runtime-tests.json'),FileMode.WRITE);
            stream.writeUTFBytes(JSON.stringify(report));stream.close();
            NativeApplication.nativeApplication.exit(report.passed?0:1);
        }
        private function source(p:Number,h:Number=0):Object { return {power:p,hpMin:h}; }
        private function character(id:int, level:int, awake:int, variant:int):BattleCharacterLogic {
            return new BattleCharacterLogic(id,level,awake,[source(1),source(3,100000)],variant%2?[source(2,50000)]:[],
                variant%3?[source(7)]:[],variant%4?[source(11,80000)]:[],variant%2?[source(13)]:[]);
        }
        private function run():Object {
            check(Decimal_Impl_.fromFloat(1)==100000,'fixture decimal scale');
            var p:SegmentProbe=new SegmentProbe();
            var matrix:Array=[{}, {thresholdHp:100}, {thresholdHp:'100'}, {thresholdHp:100.9},
                {thresholdHp:99}, {thresholdHp:50}, {thresholdHp:0}, {thresholdHp:null},
                {thresholdHp:undefined}, {thresholdHp:NaN}, {thresholdHp:Infinity}, {thresholdHp:-Infinity},
                {thresholdHp:'broken'}, {thresholdHp:'100.9'}, {thresholdHp:4294967396}, {thresholdHp:-100}];
            for(var variant:int=0;variant<12;variant++) {
                var chars:Array=[Option.Some(character(1,1+variant*10,variant%4,variant)),
                    variant%3?Option.Some(character(9,120,3,variant+1)):Option.None,
                    variant%2?Option.Some(character(23,80,2,variant+2)):Option.None];
                for each(var base:Object in matrix) for each(var mode:* in [false,true,0,1,'', 'yes',null,undefined]) {
                    var cfg:Object={thresholdHp:base.thresholdHp,abilityAllActive:mode};
                    AbilitySummarizer.reset();
                    var old:Array=p.before({},chars,cfg);var oldCalls:int=AbilitySummarizer.calls;
                    var oldVisited:int=AbilitySummarizer.visited;var oldIds:String=JSON.stringify(AbilitySummarizer.inputIds);
                    var oldJSON:String=JSON.stringify(old);
                    AbilitySummarizer.reset();
                    var fresh:Array=p.after({},chars,cfg);var newCalls:int=AbilitySummarizer.calls;
                    check(JSON.stringify(fresh)==oldJSON,'output equality '+variant+':'+cases);
                    var eligible:Boolean=!Boolean(mode)&&int(base.thresholdHp)==100;
                    check(oldCalls==2&&newCalls==(eligible?1:2),'call count '+cases);
                    check(AbilitySummarizer.visited==(eligible?oldVisited/2:oldVisited),'visited count '+cases);
                    check(JSON.stringify(AbilitySummarizer.inputIds[0])==JSON.stringify(chars.map(function(x:Option,...rest):*{return x.index==0?x.params[0].id:null;})),'slot identity '+cases);
                    check(eligible || JSON.stringify(AbilitySummarizer.inputIds)==oldIds,'fallback identity '+cases);
                    check(JSON.stringify(old)==oldJSON,'source remains unchanged '+cases);
                    if(eligible)savedCalls++;cases++;
                }
            }
            var benchChars:Array=[Option.Some(character(1,100,3,1)),Option.Some(character(9,120,3,2)),Option.Some(character(23,80,2,5))];
            var bench:Object={thresholdHp:100,abilityAllActive:false};
            var beforeMs:int=benchmark(p,benchChars,bench,false);
            var afterMs:int=benchmark(p,benchChars,bench,true);
            return {checks:checks,cases:cases,eligibleCases:savedCalls,callReduction:'2 to 1 for eligible cases',
                benchmark:{iterations:10000,beforeMs:beforeMs,afterMs:afterMs,scope:'desktop AIR fixture; not Android frame rate'},
                scope:'actual current AVM2 config + two-summary segment, deterministic source spy; no full game ability parsing'};
        }
        private function benchmark(p:SegmentProbe,chars:Array,cfg:Object,optimized:Boolean):int {
            var start:int=getTimer();for(var i:int=0;i<10000;i++){AbilitySummarizer.reset();if(optimized)p.after({},chars,cfg);else p.before({},chars,cfg);}return getTimer()-start;
        }
    }
}
