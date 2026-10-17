package pinball.common.data.ability.summary {
    import pinball.common.data.character.BattleCharacterLogic;
    // A deterministic source spy, not a replacement for game ability semantics.
    public class AbilitySummarizer {
        public static var calls:int=0;
        public static var visited:int=0;
        public static var inputIds:Array=[];
        public static function reset():void { calls=0;visited=0;inputIds=[]; }
        public static function summaryAbilities(party:Object, characters:Array, cfg:Object, battle:Boolean):Array {
            calls++;
            var result:Array=[];
            var ids:Array=[];
            for each (var c:BattleCharacterLogic in characters) {
                if(c==null){result.push(null);ids.push(null);continue;}
                ids.push(c.id);
                var total:Number=0;
                var changes:Array=[];
                for each(var list:Array in [c.main,c.unison,c.equipment,c.soul,c.ex]) {
                    for each(var ability:Object in list) {
                        visited++;
                        var active:Boolean = cfg.thresholdMode==1 || cfg.hpForThreshold.params[0]>=ability.hpMin;
                        if(active){var value:Number=ability.power*(1+c.awake)*c.level;total+=value;changes.push(value);}
                    }
                }
                result.push({id:c.id,total:total,changes:changes});
            }
            inputIds.push(ids);
            return result;
        }
    }
}
