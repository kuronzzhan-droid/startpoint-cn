package cn.loading {
    import flash.events.TimerEvent;
    import flash.utils.Dictionary;
    import flash.utils.Timer;
    import flash.utils.getDefinitionByName;
    import flash.utils.getQualifiedClassName;
    import flash.utils.getTimer;

    /** One loading transaction. Only calculated source data is reused, never live battle state. */
    public final class PartyDerivedCache {
        private static var entries:Array = [];
        private static var jobs:Array = [];
        private static var active:Boolean = false;
        private static var ownerScene:Object;
        private static var targetScene:Object;
        private static var ready:Boolean = false;
        private static var timer:Timer;
        private static var stats:Object;
        private static var nodes:int;
        private static const MAX_ENTRIES:int = 32;

        // Include the enum class and all nested arguments, not just its index or quest number.
        // Unknown objects and oversized/cyclic input conservatively use the original calculation.
        private static function snapshot(value:*, depth:int = 0):* {
            if (++nodes > 16000 || depth > 24) throw new Error("cache key limit");
            if (value === null) return ["null"];
            if (value === undefined) return ["undefined"];
            if (value is String || value is Boolean) return [typeof value, value];
            if (value is Number) {
                if (!isFinite(Number(value))) throw new Error("non-finite key");
                return ["number", value];
            }
            var result:Array = [];
            var item:*;
            if (value is Array) {
                for each (item in value) result.push(snapshot(item, depth + 1));
                return ["array", result];
            }
            var type:String = getQualifiedClassName(value);
            if (value is Dictionary) {
                for (var mapKey:* in value) {
                    if (!(mapKey is String || mapKey is Number || mapKey is Boolean)) throw new Error("object dictionary key");
                    result.push(JSON.stringify([snapshot(mapKey,depth+1),snapshot(value[mapKey],depth+1)]));
                }
                result.sort();
                return ["dictionary",result];
            }
            if (type == "haxe.ds::IntMap") return [type,snapshot(value.h,depth+1)];
            if (type == "haxe.ds::StringMap") return [type,snapshot(value.h,depth+1),snapshot(value.rh,depth+1)];
            if ("__enum__" in value && value.__enum__ === true) {
                return ["enum", type, value.tag, value.index, snapshot(value.params, depth + 1)];
            }
            if (type != "Object") throw new Error("unsupported cache key");
            var names:Array = [];
            for (var name:String in value) names.push(name);
            names.sort();
            for each (name in names) result.push([name, snapshot(value[name], depth + 1)]);
            return ["object", result];
        }
        private static function key(value:*):String {
            try { nodes = 0; return JSON.stringify(snapshot(value)); }
            catch (ignored:*) { if (active && stats != null) stats.keyBypasses++; return null; }
        }
        public static function begin():void {
            reset();
            active = true;
            stats = {revision:"r10", hits:0, misses:0, calculatedCharacters:0,
                queuedParties:0, batches:0, longestBatchMs:0, batchTotalMs:0, fallbacks:0,keyBypasses:0};
        }
        public static function reset():void {
            if (timer != null) { timer.stop(); timer.removeEventListener(TimerEvent.TIMER, tick); timer = null; }
            entries = []; jobs = []; active = false;
            ownerScene = null; targetScene = null; ready = false;
        }
        public static function metrics():Object {
            return stats == null ? {} : JSON.parse(JSON.stringify(stats));
        }
        private static function checkpoint(phase:String):void {
            try {
                var traceClass:Object = getDefinitionByName("cn.diagnostics.LoadingTrace");
                traceClass.mark(phase,"point",null,metrics());
            } catch (ignored:*) {}
        }
        public static function finish():void {
            if (!active) return;
            checkpoint("party.cache.summary");
            reset();
        }
        private static function find(party:Object, group:Object, debug:Array, enable:Boolean):Object {
            if (!active) return null;
            var groupKey:String = key(group);
            var debugKey:String = key(debug);
            var valuesKey:String = key(party.values);
            if (groupKey == null || debugKey == null || valuesKey == null) return null;
            for each (var entry:Object in entries) {
                if (entry.values === party.values && entry.assets === party.logicAssets &&
                    entry.groupKey == groupKey && entry.debugKey == debugKey &&
                    entry.valuesKey == valuesKey && entry.enable === enable) return entry;
            }
            return null;
        }
        private static function createEntry(party:Object, group:Object, debug:Array, enable:Boolean):Object {
            if (!active || entries.length >= MAX_ENTRIES) return null;
            var groupKey:String = key(group), debugKey:String = key(debug), valuesKey:String = key(party.values);
            if (groupKey == null || debugKey == null || valuesKey == null) return null;
            var entry:Object = {values:party.values, assets:party.logicAssets, groupKey:groupKey,
                debugKey:debugKey, valuesKey:valuesKey, enable:enable, result:null, pending:0, complete:false};
            entries.push(entry);
            return entry;
        }
        public static function get(party:Object, group:Object, debug:Array, enable:Boolean):Array {
            var entry:Object = find(party,group,debug,enable);
            if (entry != null && entry.complete) { stats.hits++; return entry.result; }
            if (active) stats.misses++;
            var callback:Function = function(character:Object, slot:int, quest:Object, debugIds:Array, enabled:Boolean):Object {
                if (active) stats.calculatedCharacters++;
                return party._createCalculatedBattleCharacterLogic(character,slot,quest,debugIds,enabled);
            };
            var result:Array = party._getUnitedCharactersWithQuestId(callback,group,debug,enable);
            if (entry == null) entry = createEntry(party,group,debug,enable);
            if (entry != null && entry.pending == 0) { entry.result = result; entry.complete = true; }
            return result;
        }
        public static function enqueue(party:Object, group:Object, debug:Array, enable:Boolean):void {
            if (find(party,group,debug,enable) != null) return;
            var entry:Object = createEntry(party,group,debug,enable);
            if (entry == null) return;
            // Preserve the original five-argument callback and Option/empty-slot layout.
            var callback:Function = function(character:Object, slot:int, quest:Object, debugIds:Array, enabled:Boolean):Object {
                entry.pending++;
                jobs.push({entry:entry,party:party,character:character,slot:slot,quest:quest,debug:debugIds,enable:enabled});
                return null;
            };
            entry.result = party._getUnitedCharactersWithQuestId(callback,group,debug,enable);
            entry.complete = entry.pending == 0;
            stats.queuedParties++;
        }
        /** At most one occupied character per event-loop turn. No partial array is a cache hit. */
        public static function runOne():Boolean {
            if (!active || jobs.length == 0) return false;
            var started:int = getTimer();
            var job:Object = jobs.shift();
            var value:Object = job.party._createCalculatedBattleCharacterLogic(job.character,job.slot,job.quest,job.debug,job.enable);
            job.entry.result[job.slot].params[0] = value;
            job.entry.pending--;
            job.entry.complete = job.entry.pending == 0;
            stats.calculatedCharacters++; stats.batches++;
            var elapsed:int = getTimer() - started;
            stats.batchTotalMs += elapsed;
            stats.longestBatchMs = Math.max(stats.longestBatchMs,elapsed);
            return jobs.length != 0;
        }
        /** Called before LoadingSceneBase.gotoNextScene's original body. */
        public static function defer(scene:Object):Boolean {
            if (ownerScene === scene && targetScene === scene.nextScene) {
                if (!ready) return true;
                ownerScene = null; targetScene = null; ready = false;
                return false;
            }
            begin();
            var next:Object = scene.nextScene;
            if (next == null || next.tag != "Battle" || !scene.isAliveScene()) { reset(); return false; }
            try {
                var kind:Object = next.params[0];
                var kindTools:Object = getDefinitionByName("pinball.scene.battle.data.BattleSceneKindTools");
                var questTools:Object = getDefinitionByName("pinball.common.data.quest.id.QuestIdBattleKindTools");
                var bossTools:Object = getDefinitionByName("pinball.scene.battle.battle.BothBossTool");
                var permitTools:Object = getDefinitionByName("pinball.scene.battle.battle.feature.BattleFeaturePermitTools");
                var optionClass:Object = getDefinitionByName("haxe.ds.Option");
                var partyClass:Class = getDefinitionByName("pinball.common.data.party.BattlePartyLogic") as Class;
                var quest:Object = kindTools.toQuestIdBattle(kind);
                var permit:Object = permitTools.questIdGroupKind2BattleFeaturePermitKind(quest);
                var enabled:Boolean = permit.index <= 1 ? Boolean(permit.params[0]) : true;
                var sources:Array = kind.index == 0 ? [kind.params[0].values.source] : kind.params[0].source.sources;
                // Exact restored/replay state remains on the original synchronous path.
                if (kind.index == 1 && kind.params[1].index != 0) { reset(); return false; }
                var both:Boolean = bossTools.isBothBossByQuestId(quest);
                for each (var source:Object in sources) {
                    var actualQuest:Object = quest;
                    if (both) {
                        var viewer:Object = kind.index == 0 ? optionClass.Some(bossTools.DEFAULT_VIEWERID) : source.viewerId;
                        var resolved:Object = bossTools.getBothBossQuestId(quest,viewer);
                        if (resolved.index != 0) continue;
                        actualQuest = resolved.params[0];
                    }
                    var group:Object = questTools.toQuestIdGroupKind(actualQuest);
                    for each (var member:Object in sources)
                        enqueue(new partyClass(member.party,scene.logic.asset),group,scene.devConfig.debugAbilitySoulIds,enabled);
                }
                if (jobs.length == 0) return false;
                ownerScene = scene; targetScene = next;
                checkpoint("party.prewarm.begin");
                timer = new Timer(16);
                timer.addEventListener(TimerEvent.TIMER,tick);
                timer.start();
                return true;
            } catch (ignored:*) {
                stats.fallbacks++; checkpoint("party.prewarm.fallback"); reset(); return false;
            }
        }
        private static function tick(event:TimerEvent):void {
            var scene:Object = ownerScene;
            if (scene == null || scene.nextScene !== targetScene || !scene.isAliveScene()) { reset(); return; }
            try { if (runOne()) return; }
            catch (ignored:*) {
                stats.fallbacks++; entries = []; jobs = [];
                checkpoint("party.prewarm.fallback");
            }
            timer.stop(); timer.removeEventListener(TimerEvent.TIMER,tick); timer = null;
            ready = true;
            checkpoint("party.prewarm.end");
            scene.gotoNextScene();
        }
    }
}
