package cn.content {
    import flash.utils.getDefinitionByName;
    import flash.utils.getQualifiedClassName;
    import flash.utils.getTimer;
    import flash.utils.Dictionary;

    /** Independent class: never append slots to an existing iOS AOT class. */
    public final class ContentOperationsState {
        /** Reserved exact protocol message; ordinary maintenance errors keep their native route. */
        public static const CONTENT_CLIENT_RELOAD_MESSAGE:String = "活动与卡池配置已更新，请重新登录。";
        // Only concrete native contracts (gacha asset planning, Ranking ctor and
        // Number-valued getters) use this value. Ordinary Option/TimeRange consumers
        // retain native None for infinity. Decisions stay authoritative.
        public static const OPEN_END_MS:Number = 8640000000000000;
        private static var states:Object = {};
        private static var defaultStates:Object = {};
        private static var legacyStates:Object = {};
        private static var hasDefaults:Boolean = false;
        private static var catalog:Array = [];
        private static var generation:uint = 0;
        private static var globalVersions:Dictionary = new Dictionary(true);
        private static const EVENT_TYPES:Object = {
            AdventEvent:"advent_event", RankingEvent:"ranking_event", StoryEvent:"story_event",
            DailyWeekEvent:"daily_week_event", ChallengeDungeonEvent:"challenge_dungeon_event",
            DailyExpManaEvent:"daily_exp_mana_event", WorldStoryEvent:"world_story_event",
            TowerDungeonEvent:"tower_dungeon_event", ExpertSingleEvent:"expert_single_event",
            CarnivalEvent:"carnival_event", RaidEvent:"raid_event", RushEvent:"rush_event",
            SoloTimeAttackEvent:"solo_time_attack_event", HardMultiEvent:"hard_multi_event", ScoreAttackEvent:"score_attack_event"
        };
        private static var managed:Object = {};
        private static var managedQuests:Object = {};
        private static var managedMissions:Object = {};
        private static var expired:Object = {};
        private static var nextExpiry:Number = Number.POSITIVE_INFINITY;
        private static var revision:Number = -1;
        private static var digest:String = "";
        private static var receivedAt:uint = 0;
        private static var serverTime:Number = 0;
        private static var valid:Boolean = false;
        private static var hasSnapshot:Boolean = false;
        private static var requestIdentities:Dictionary = new Dictionary(true);
        private static var retainedStarCrumb:Object = {};
        private static var hasRetainedStarCrumb:Boolean = false;

        public static function frozenLoginToken(setting:Object, value:String):String {
            var identity:Object = requestIdentities[setting];
            if (identity == null) requestIdentities[setting] = identity = {};
            if (!identity.hasOwnProperty("token")) identity.token = value;
            return identity.token;
        }

        public static function frozenApiCount(setting:Object, value:int):int {
            var identity:Object = requestIdentities[setting];
            if (identity == null) requestIdentities[setting] = identity = {};
            if (!identity.hasOwnProperty("count")) identity.count = value;
            return identity.count;
        }

        public static function bossBattleHeaderIds(ids:Array):Array {
            if (decision("advent_event:300098", "visible") != 1 || decision("advent_event:300098", "enter") != 1) return ids;
            for each (var existing:Object in ids) {
                if (existing.tag == "AdventEvent" && int(existing.params[0]) == 300098) return ids;
            }
            var kinds:Class = getDefinitionByName("pinball.common.data.quest.event::EventIdKind") as Class;
            var result:Array = ids.concat();
            result.push(kinds.AdventEvent(300098));
            return result;
        }

        public static function restoreRushEventList(list:Object):void {
            if (decision("rush_event:700017", "visible") != 1 || decision("rush_event:700017", "enter") != 1) return;
            for each (var member:Object in list.eventListValuesArray) {
                var existing:Object = member.values.event;
                if (existing.tag == "RushEvent" && int(existing.params[0]) == 700017) return;
            }
            var values:Class = getDefinitionByName("pinball.master.generated::EventListValues") as Class;
            // This controlled family-template row has no recovered official order.
            list.eventListValuesArray.push({id:700017, values:new values(["11", "700017", "0"])});
            list.eventListValuesArray.sort(list.sortByDisplayOrder);
        }

        public static function routeAssociatedBoxQuest(scene:Object):Boolean {
            var associated:Object = {108:200100, 120:200101, 1000:200102, 1001:200103, 1003:200104,
                1004:200106, 8002:200107, 8003:200108, 8004:200109};
            var box:String = String(scene.boxGachaId);
            if (!associated.hasOwnProperty(box)) return false;
            var eventId:int = int(associated[box]);
            var key:String = "world_story_event:" + eventId;
            if (decision(key, "visible") != 1 || decision(key, "enter") != 1) return false;
            var kinds:Class = getDefinitionByName("pinball.common.data.quest.event::EventIdKind") as Class;
            var flow:Class = getDefinitionByName("pinball.scene.event::EventSelectFlow") as Class;
            var event:Object = scene.globalLogic.getEventRepository().getEvent(kinds.WorldStoryEvent(eventId));
            scene.addFlow(new flow(event, optionClass().None));
            return true;
        }

        public static function captureResponse(raw:Object):void {
            if (raw == null || raw.data == null) return;
            if (raw.data.hasOwnProperty("star_crumb_exchange_retained_ids")) {
                retainedStarCrumb = {};
                var ids:Object = raw.data.star_crumb_exchange_retained_ids;
                hasRetainedStarCrumb = ids is Array;
                if (hasRetainedStarCrumb) for each (var id:Object in ids) {
                    if (id is Number && isFinite(Number(id)) && Number(id) > 0
                        && Number(id) == int(id)) retainedStarCrumb[String(int(id))] = true;
                }
            }
            if (!raw.data.hasOwnProperty("content_operations")) return;
            applySnapshot(raw.data.content_operations);
        }
        public static function starCrumbDecision(logic:Object):int {
            if (!hasRetainedStarCrumb) return -1;
            // Retaining ordinary products must never grant a personal gacha window.
            if (logic.get_comebackGachaId().index == 0 || logic.get_starsGachaId().index == 0) return -1;
            return retainedStarCrumb.hasOwnProperty(String(logic.id)) ? 1 : -1;
        }
        public static function isContentReload(error:Object):Boolean {
            if (error == null || error.kind == null) return false;
            var kind:Object = error.kind;
            return kind.tag === "WholeMaintenanceError" && kind.index === 9
                && kind.params is Array && kind.params.length == 1
                && kind.params[0] === CONTENT_CLIENT_RELOAD_MESSAGE;
        }
        /** Local clock/cache/expiry maintenance only; new operator settings arrive at login. */
        public static function tick(scene:Object):void {
            if (scene == null || scene.globalLogic == null) return;
            var global:Object = scene.globalLogic;
            syncGlobalTime(global);
            invalidateGlobal(global);
            var now:uint = uint(getTimer());
            var realNow:Number = serverTime + uint(now - receivedAt);
            if (realNow >= nextExpiry) {
                nextExpiry = Number.POSITIVE_INFINITY;
                for (var controlled:String in states) {
                    for (var controlledAction:String in states[controlled].actions) {
                        decision(controlled,controlledAction);
                        var deadline:Object = states[controlled].actions[controlledAction].ends_at_ms;
                        if (deadline !== null && Number(deadline) >= realNow) nextExpiry = Math.min(nextExpiry,Number(deadline));
                    }
                }
            }
        }
        /** Preserve the existing ComplexTime object and elapsed duration while rebasing its epoch. */
        public static function syncGlobalTime(global:Object):void {
            if (!valid || global == null || global.logicStatus == null) return;
            var current:Object = global.logicStatus.currentTime;
            if (current != null && current.index == 0 && current.params[0] != null) {
                var clock:Object = current.params[0];
                clock.serverTime = serverTime + uint(uint(getTimer()) - receivedAt) - Number(clock.elapsedTime);
            }
        }
        public static function invalidateGlobal(global:Object):void {
            if (globalVersions[global] == generation) return;
            var none:Object = optionClass().None;
            global.gachaRepositoryCache = none;
            global.questRepositoryCache = none;
            global.specialExchangeCampaignRepositoryCache = none;
            global.shopProductRepositoryCache = none;
            global.collectItemEventRepositoryCache = none;
            global.scoreAttackBorderRewardRepositoryCache = none;
            globalVersions[global] = generation;
        }
        public static function eventIds(list:Object):Array {
            var result:Array = [];
            var event:Object;
            for each (var existing:Object in list.eventListValuesArray) {
                event = existing.values.event;
                var key:String = EVENT_TYPES[event.tag] + ":" + event.params[0];
                if (decision(key,"visible") != 0) result.push(event);
            }
            // EventListTable, EventFolderEventsTable and SideStoryEventListTable
            // own native routing and order. The operations catalog is not a UI list.
            return result;
        }
        public static function contentKey(logic:Object):String {
            var name:String = getQualifiedClassName(logic).split("::").pop();
            var mission:String = missionKey(logic);
            if (mission != "" && managedMissions.hasOwnProperty(mission)) return managedMissions[mission];
            if (name == "BoxGachaLogic") return "box_gacha:" + logic.id;
            if (name == "BoxLogic") return "box_gacha:" + logic.boxGacha.id;
            if (name == "ActiveMissionEventLogic") return "active_mission_event:" + logic.id;
            if (name == "ActiveMissionLogic") return "active_mission_event:" + logic.eventId;
            if (name == "CollectItemEventLogic") return "collect_item_event:" + logic.id;
            if (name == "SpecialExchangeCampaignLogic") return "special_exchange_campaign:" + logic.id;
            if (name == "StartDashExchangeCampaignLogic") return "start_dash_exchange_campaign:" + logic.id;
            if (name == "MultiSpecialExchangeCampaignLogic") return "multi_special_exchange_campaign:" + logic.id;
            if (logic.hasOwnProperty("idKind") && logic.hasOwnProperty("missionValues")) {
                var direct:Object = {Regular:"mission_regular",Daily:"mission_daily",Event:"mission_event"};
                if (direct.hasOwnProperty(logic.idKind.tag)) return direct[logic.idKind.tag] + ":" + logic.idKind.params[0];
                if (logic.idKind.tag == "PassCardDaily" || logic.idKind.tag == "PassCardWeek" || logic.idKind.tag == "PassCardEvent")
                    return "pass_card_event:" + logic.missionValues.event_id;
                if (logic.idKind.tag == "CollectItemEvent") return "collect_item_event:" + logic.missionValues.event_id;
            }
            if (logic.hasOwnProperty("id") && logic.id != null && logic.id.hasOwnProperty("tag")) {
                var products:Object = {GeneralShopProduct:"general_shop",Treasure:"treasure_shop",StarGrainShopProduct:"star_grain_shop",BossCoin:"boss_coin_shop",EventItem:"event_item_shop"};
                if (products.hasOwnProperty(logic.id.tag)) return products[logic.id.tag] + ":" + logic.id.params[0];
            }
            return towerKey(logic);
        }
        public static function parentKey(logic:Object):String {
            if (logic.hasOwnProperty("eventItemValues")) {
                var event:Object = logic.eventItemValues.event;
                if (event.tag == "CollectItemEvent") return "collect_item_event:" + event.params[0];
                return EVENT_TYPES.hasOwnProperty(event.tag) ? EVENT_TYPES[event.tag] + ":" + event.params[0] : "";
            }
            return "";
        }
        public static function contentDecision(logic:Object,action:String):int {
            var key:String = contentKey(logic);
            var own:int = decision(key,action);
            var parent:int = decision(parentKey(logic),action);
            if (own == 0 || parent == 0) return 0;
            // A verified parent does not authorize an unverified product. Keep
            // that product's original dates, stock and purchase restrictions.
            if (key.indexOf("general_shop:") == 0 || key.indexOf("treasure_shop:") == 0
                || key.indexOf("star_grain_shop:") == 0 || key.indexOf("boss_coin_shop:") == 0
                || key.indexOf("event_item_shop:") == 0) return own;
            var mission:String = missionKey(logic);
            var missionScope:Object = scopeFor(key,action,"mission_keys");
            if (own == 1 && mission != "" && missionScope is Array
                && missionScope.indexOf(mission) < 0) return 0;
            return own == 1 || parent == 1 ? 1 : -1;
        }
        public static function shopBuyGate(logic:Object):Object {
            if (contentDecision(logic,"exchange") != 0) return null;
            var kind:Class = getDefinitionByName("pinball.common.data.player::ShopProductBuyableState") as Class;
            return kind.OutOfStock;
        }
        public static function shopSharedEnd(logic:Object):Object {
            var key:String = contentKey(logic);
            // The original visible predicate consumes this getter as well.
            // A single action cannot replace the other action's old dates.
            if (decision(key,"visible") < 0 || decision(key,"exchange") < 0) return null;
            return contentEnd(logic,"exchange");
        }
        public static function missionKey(logic:Object):String {
            if (logic.hasOwnProperty("missionId") && logic.hasOwnProperty("eventId")) return "0:" + logic.missionId;
            if (logic.hasOwnProperty("idKind")) {
                var types:Object = {Regular:1,Daily:2,Event:3,PassCardDaily:6,PassCardWeek:7,PassCardEvent:8,CollectItemEvent:4};
                if (types.hasOwnProperty(logic.idKind.tag)) return types[logic.idKind.tag] + ":" + logic.idKind.params[0];
            }
            return "";
        }
        public static function contentEnd(logic:Object,action:String):Object {
            var key:String = contentKey(logic);
            if (contentDecision(logic,action) < 0) return null;
            if (contentDecision(logic,action) != 1) return optionClass().Some(0);
            var end:Number = Number.POSITIVE_INFINITY;
            for each (var candidate:String in [key,parentKey(logic)]) {
                var candidateAction:Object = actionFor(candidate,action);
                if (candidateAction != null && candidateAction.ends_at_ms !== null)
                    end = Math.min(end,Number(candidateAction.ends_at_ms));
            }
            return isFinite(end) ? optionClass().Some(end) : optionClass().None;
        }
        public static function contentPeriod(logic:Object,action:String):Object {
            var result:int = contentDecision(logic,action);
            if (result < 0) return null;
            var range:Class = getDefinitionByName("pinball.common.time::TimeRange") as Class;
            // The decision uses server sampling and monotonic elapsed time, rather than a legacy calendar argument.
            return new range(0,contentEnd(logic,action));
        }
        public static function contentStart(logic:Object,action:String):Object {
            return contentDecision(logic,action) < 0 ? null : serverTime;
        }
        /** Native fallback ranges need their native start, not another action's managed getter. */
        public static function nativeEventPeriodStart(logic:Object):Number {
            if (getQualifiedClassName(logic).split("::").pop() == "CampaignAppliedChallengeDungeonEventLogic")
                return Number(logic.campaign.get_startTime());
            return Number(logic.commonValues.start_time);
        }
        /** Boxed Number keeps null available as the native-body fallback sentinel. */
        public static function contentNumericEnd(logic:Object,action:String):Object {
            var end:Object = contentEnd(logic,action);
            return end == null ? null : (end.index == 0 ? Number(end.params[0]) : OPEN_END_MS);
        }
        public static function eventPlayableEnd(logic:Object):Object {
            var end:Object = contentEnd(logic,"enter");
            if (end != null && end.index != 0
                && getQualifiedClassName(logic).split("::").pop() == "RankingEventLogic") return optionClass().Some(OPEN_END_MS);
            return end;
        }
        public static function campaignDecision(logic:Object,action:String):int {
            var result:int = contentDecision(logic,action);
            if (action == "exchange" && getQualifiedClassName(logic).split("::").pop() == "StartDashExchangeCampaignLogic"
                && !logic.get_hasCampaignData()) return 0;
            return result;
        }
        public static function nativeComparableEnd(logic:Object,end:Object):Object {
            // These two assistant routes extract a concrete value before making
            // a numeric comparison. Keep infinity local to those consumers.
            if (end == null || end.index == 0) return end;
            var controlled:Object = contentEnd(logic,"enter");
            if (controlled == null || controlled.index == 0) return end;
            return optionClass().Some(OPEN_END_MS);
        }
        public static function campaignOver(logic:Object):int {
            var result:int = campaignDecision(logic,"exchange");
            return result < 0 ? -1 : (result == 0 ? 1 : 0);
        }
        public static function campaignEnd(logic:Object):Object {
            // The StartDash getter must retain its original None -> 2562 contract.
            if (getQualifiedClassName(logic).split("::").pop() == "StartDashExchangeCampaignLogic"
                && !logic.get_hasCampaignData()) return null;
            return contentNumericEnd(logic,"exchange");
        }
        public static function startDashBuyEnd(logic:Object):Object {
            var data:Object = logic.startDashExchangeCampaignData;
            return data.index == 0 ? Number(data.params[0].period_end_time) * 1000 : null;
        }
        public static function campaignExchangeText(logic:Object):Object {
            var permission:int = campaignDecision(logic,"exchange");
            if (permission < 0) return null;
            if (getQualifiedClassName(logic).split("::").pop() == "StartDashExchangeCampaignLogic" && !logic.get_hasCampaignData()) return null;
            if (permission == 0) return "已关闭";
            var end:Object = contentEnd(logic,"exchange");
            return end == null ? null : formatActionLabel(end.index == 0 ? Number(end.params[0]) : OPEN_END_MS,"exchange","兑换");
        }
        public static function specialExchangeDateText(scene:Object):Object {
            var logic:Object = scene.campaignLogic, status:Object = logic.get_status();
            // Sale/qualification states keep their original, independent sale dates.
            if (status.index != 0 || (int(status.params[0]) != 2 && int(status.params[0]) != 3)) return null;
            return campaignExchangeText(logic);
        }
        public static function startDashDateText(view:Object,logic:Object,sale:Boolean):Object {
            if (campaignDecision(logic,"exchange") < 0 || !logic.get_hasCampaignData()) return null;
            if (!sale) return campaignExchangeText(logic);
            // Buying remains bounded by the original personal period, independently
            // of a longer operator-authorized exchange window.
            var dates:Class = getDefinitionByName("pinball.common.time._AppTime::AppTime_Impl_") as Class;
            return view.view.asset.getUiStringWithContext("event_sell_dates",{
                start_date:dates.toStandardDateFormatString(logic.get_periodStartTime()),
                end_date:dates.toStandardDateFormatString(Number(startDashBuyEnd(logic)))});
        }
        public static function collectExchangeDecision(logic:Object):int {
            var result:int = contentDecision(logic,"exchange");
            return result < 0 ? -1 : (logic.get_kind().index == 1 ? result : 0);
        }
        public static function collectExchangeLabel(logic:Object):Object {
            if (contentDecision(logic,"exchange") < 0) return null;
            if (collectExchangeDecision(logic) != 1) return optionClass().Some("已关闭");
            return operationLabel(logic,"exchange","兑换");
        }
        public static function rankingTimeKind(logic:Object):Object {
            var enter:int = contentDecision(logic,"enter"), claim:int = contentDecision(logic,"claim");
            if (enter < 0 && claim < 0) return null;
            var kind:Class = getDefinitionByName("pinball.common.data.quest.event.ranking::RankingEventTimeKind") as Class;
            if (enter == 1 || (enter < 0 && logic.isWithinPeriod(serverTime + uint(uint(getTimer())-receivedAt)))) return kind.Playable;
            if (claim == 1) return kind.RewardReceive;
            return claim == 0 ? kind.OutOfPeriod : null;
        }
        public static function activeLotteryPeriod(logic:Object):Object {
            if (contentDecision(logic,"enter") < 0 && contentDecision(logic,"claim") < 0) return null;
            var range:Class = getDefinitionByName("pinball.common.time::TimeRange") as Class;
            // Operations exposes participation and earned claims, not a synthetic draw phase.
            return new range(0,optionClass().Some(0));
        }
        public static function activeTimeKind(logic:Object):Object {
            var enter:int = contentDecision(logic,"enter"), claim:int = contentDecision(logic,"claim");
            if (enter < 0 && claim < 0) return null;
            var kind:Class = getDefinitionByName("pinball.common.data.mission.activeMission::RealIncentiveMissionEventTimeKind") as Class;
            if (enter == 1 || (enter < 0 && logic.getPlayablePeriod().isWithin(serverTime + uint(uint(getTimer())-receivedAt)))) return kind.Playable;
            if (claim == 1) return kind.RewardReceive;
            return claim == 0 ? kind.OutOfPeriod : null;
        }
        /** The native current-pass route follows operator visibility, never earned claim history. */
        public static function selectPass(repository:Object,mode:String):Object {
            if (!hasSnapshot) return null;
            if (!valid) return optionClass().None;
            var selected:int = 0;
            for (var key:String in managed) if (key.indexOf("pass_card_event:") == 0 && decision(key,"visible") == 1) {
                if (selected != 0) return optionClass().None;
                selected = int(key.substr(16));
            }
            var table:Class = getDefinitionByName("pinball.master.generated::PassCardEventTable") as Class;
            var data:Object = repository.logicAssets.getMasterTable(table).get_data();
            if (selected == 0) {
                var timeRange:Class = getDefinitionByName("pinball.common.time::TimeRange") as Class;
                var now:Number = repository.globalLogic.getTime();
                for each (var originalId:int in data.keys()) {
                    var legacyKey:String = "pass_card_event:" + originalId;
                    // Only the reviewed legacy whitelist may use original calendar eligibility.
                    if (!legacyStates.hasOwnProperty(legacyKey) || legacyStates[legacyKey].visible !== true
                        || decision(legacyKey,"visible") != -1) continue;
                    var original:Object = data.get(originalId);
                    var originalRange:Object = new timeRange(original.start_time,optionClass().Some(original.end_time));
                    if (originalRange.isWithin(now)) { selected = originalId; break; }
                }
            }
            if (selected == 0 || !data.exists(selected)) return optionClass().None;
            return optionClass().Some(mode == "id" ? selected : data.get(selected));
        }
        public static function missionRemaining(logic:Object,cycle:String):Object {
            var key:String = contentKey(logic);
            var permission:int = contentDecision(logic,"enter");
            if (permission < 0) return null;
            if (permission != 1) return optionClass().Some(0);
            var now:Number = serverTime + uint(uint(getTimer()) - receivedAt);
            var timing:Object = actionFor(key,"enter");
            var end:Number = timing == null || timing.ends_at_ms === null ? Number.POSITIVE_INFINITY : Number(timing.ends_at_ms);
            if (cycle == "daily" || cycle == "week") {
                var dates:Class = getDefinitionByName("pinball.common.tools::DateUtil") as Class;
                end = Math.min(end,Number(cycle == "daily" ? dates.getTomorrowStartDateTime(now) : dates.getNextWeekStartDateTime(now)));
            }
            return isFinite(end) ? optionClass().Some(Math.max(0,end-now)) : optionClass().None;
        }
        public static function updatePassView(view:Object):void {
            if (view.templateView == null || view.peek == null) return;
            var key:String = "pass_card_event:" + view.peek.passCardId;
            if (decision(key,"visible") < 0 && decision(key,"claim") != 1) return;
            var range:Object = view.templateView.timeRangeText;
            if (range == null || range.index != 0) return;
            var texts:Array = range.params[0].texts;
            var label:String = keyLabel(key);
            for (var i:int = 0; i < texts.length; i++) {
                fitPeriodText(texts[i]);
                // The original date field extends below the banner's black strip.
                // Keep its native anchor and font, fitting only this existing field.
                texts[i].rawTextField.format.horizontalAlign = "center";
                texts[i].set_textHeight(Math.min(Number(texts[i].get_textHeight()),43));
                texts[i].set_text(label); texts[i].visible = i == 0;
            }
        }
        public static function updateBoxPeriod(view:Object):Boolean {
            if(view==null || view.peek==null || view.layout==null)return false;
            var id:int=int(view.peek.boxGachaId), key:String="box_gacha:"+id;
            var permission:int=decision(key,"visible");if(permission<0)return false;
            // This getter still reads the original BoxGacha.endTime slot. Native
            // setupPeriod leaves its text empty when the original end is None.
            if (view.peek.getEndDate().index != 0) return false;
            var label:String=keyLabel(key);
            view.layout.getImage("date_background",{}).visible=false;
            var text:Object = view.layout.getText("date_text",{});
            fitPeriodText(text); text.set_text(label);
            return true;
        }
        public static function boxActionGate(scene:Object,action:String):int {
            return decision("box_gacha:"+scene.boxGachaId,action)==0 ? 0 : -1;
        }
        public static function applySnapshot(value:Object):void {
            hasSnapshot = true;
            if (value == null || (value.schema_version !== 1 && value.schema_version !== 2) || value.full_snapshot !== true
                || !(value.states is Array) || value.states.length > 50000
                || !(value.catalog_digest is String) || value.catalog_digest.length != 64
                || !isFinite(Number(value.revision)) || Number(value.revision) < 0
                || Number(value.revision) != Math.floor(Number(value.revision))
                || !isFinite(Number(value.server_time_ms)) || Number(value.server_time_ms) <= 0) {
                valid = false; generation++; return;
            }
            if (Number(value.revision) < revision) return;
            if (Number(value.revision) == revision && Number(value.server_time_ms) < serverTime) return;
            if (Number(value.revision) == revision && value.catalog_digest != digest) {
                valid = false; generation++; return;
            }
            var nextDefaults:Object = {};
            var nextLegacy:Object = {};
            var defaultsPresent:Boolean = value.hasOwnProperty("default_policy");
            if (defaultsPresent) {
                var policy:Object = value.default_policy;
                if (policy == null || policy.version !== 1 || policy.explicit_actions_override_defaults !== true || policy.actions == null) {
                    valid = false; generation++; return;
                }
                for each (var defaultAction:String in ["visible","enter","claim","exchange"]) {
                    var defaults:Object = policy.actions[defaultAction];
                    if (defaults == null || !(defaults.closed_keys is Array) || !(defaults.qualified_rights_keys is Array)
                        || defaults.closed_keys.length > 50000 || defaults.qualified_rights_keys.length > 50000) {
                        valid = false; generation++; return;
                    }
                    if (defaults.legacy_keys !== undefined) {
                        if (!(defaults.legacy_keys is Array) || defaults.legacy_keys.length>50000) { valid=false;generation++;return; }
                        for each(var legacyKey:Object in defaults.legacy_keys) {
                            if(!(legacyKey is String) || !/^[a-z_]+:[0-9]+$/.test(String(legacyKey))) {valid=false;generation++;return;}
                            if(!nextLegacy.hasOwnProperty(legacyKey))nextLegacy[legacyKey]={};
                            if(nextLegacy[legacyKey].hasOwnProperty(defaultAction)){valid=false;generation++;return;}
                            nextLegacy[legacyKey][defaultAction]=true;
                        }
                    }
                    for each (var grant:Boolean in [false,true]) {
                        for each (var defaultKey:Object in (grant ? defaults.qualified_rights_keys : defaults.closed_keys)) {
                            if (!(defaultKey is String) || !/^[a-z_]+:[0-9]+$/.test(String(defaultKey))) { valid=false; generation++; return; }
                            if (!nextDefaults.hasOwnProperty(defaultKey)) nextDefaults[defaultKey] = {};
                            if (nextDefaults[defaultKey].hasOwnProperty(defaultAction) || (nextLegacy.hasOwnProperty(defaultKey) && nextLegacy[defaultKey].hasOwnProperty(defaultAction))) { valid=false; generation++; return; }
                            nextDefaults[defaultKey][defaultAction] = grant;
                        }
                    }
                }
            }
            var next:Object = {};
            for each (var row:Object in value.states) {
                if (row == null || !(row.key is String) || !/^[a-z_]+:[0-9]+$/.test(row.key)
                    || next.hasOwnProperty(row.key)
                    || !(row.instance_id is String) || row.instance_id != row.key + ":original"
                    ) {
                    valid = false; generation++; return;
                }
                var normalized:Object = {};
                var action:String;
                if (value.schema_version === 1) {
                    if (!(row.visible is Boolean) || !(row.enter is Boolean) || !(row.claim is Boolean)
                        || !(row.exchange is Boolean) || !(row.permanent is Boolean)
                        || row.permanent !== (row.ends_at_ms === null)) { valid = false; generation++; return; }
                    for each (action in ["visible","enter","claim","exchange"])
                        normalized[action] = {enabled:row[action],ends_at_ms:row.ends_at_ms,quest_keys:row.quest_keys,mission_keys:row.mission_keys};
                } else {
                    if (row.actions == null || row.actions is Array || typeof row.actions != "object") {
                        valid = false; generation++; return;
                    }
                    for (action in row.actions) {
                        if (["visible","enter","claim","exchange"].indexOf(action) < 0) { valid = false; generation++; return; }
                        normalized[action] = row.actions[action];
                    }
                }
                var actionCount:int = 0;
                for (action in normalized) {
                    actionCount++;
                    var setting:Object = normalized[action];
                    if (setting == null || !(setting.enabled is Boolean)
                        || (setting.ends_at_ms !== null && (!isFinite(Number(setting.ends_at_ms))
                            || Number(setting.ends_at_ms) < 0 || Number(setting.ends_at_ms) != Math.floor(Number(setting.ends_at_ms))))) {
                        valid = false; generation++; return;
                    }
                    for each (var scope:Object in [setting.quest_keys,setting.mission_keys]) {
                        if (scope === undefined || scope === null) continue;
                        if (!(scope is Array) || scope.length > 5000) { valid = false; generation++; return; }
                        var seen:Object = {};
                        for each (var scopeKey:Object in scope) {
                            if (!(scopeKey is String) || !/^[0-9]+:[0-9]+$/.test(String(scopeKey)) || seen.hasOwnProperty(String(scopeKey))) {
                                valid = false; generation++; return;
                            }
                            seen[scopeKey] = true;
                        }
                    }
                    normalized[action] = {enabled:setting.enabled,ends_at_ms:setting.ends_at_ms,
                        quest_keys:setting.quest_keys is Array ? setting.quest_keys.concat() : null,
                        mission_keys:setting.mission_keys is Array ? setting.mission_keys.concat() : null};
                }
                if (!actionCount) { valid = false; generation++; return; }
                next[row.key] = { actions:normalized };
            }
            var nextCatalog:Array = value.catalog is Array ? value.catalog.concat() : [];
            if (nextCatalog.length > 50000) { valid = false; generation++; return; }
            var catalogKeys:Object = {};
            var catalogMembers:Object = {};
            // Catalog scopes enumerate every member. State scopes authorize only a subset.
            // Remember excluded members too so they cannot fall back to the legacy calendar.
            for each (var member:Object in nextCatalog) {
                if (member == null || !(member.key is String) || !next.hasOwnProperty(member.key)
                    || catalogKeys.hasOwnProperty(member.key)) {
                    valid = false; generation++; return;
                }
                catalogKeys[member.key] = true;
                if (value.schema_version === 2) for (action in next[member.key].actions) {
                    for each (var scopeKind:String in ["quest_keys","mission_keys"]) {
                        var approved:Object = next[member.key].actions[action][scopeKind];
                        if (!(approved is Array)) continue;
                        if (!(member[scopeKind] is Array)) { valid = false; generation++; return; }
                        for each (scopeKey in approved) if (member[scopeKind].indexOf(scopeKey) < 0) {
                            valid = false; generation++; return;
                        }
                    }
                }
                for each (scope in [member.quest_keys,member.mission_keys]) {
                    if (scope === undefined || scope === null) continue;
                    if (!(scope is Array)) { valid = false; generation++; return; }
                    for each (scopeKey in scope) {
                        if (!(scopeKey is String) || !/^[0-9]+:[0-9]+$/.test(String(scopeKey))) {
                            valid = false; generation++; return;
                        }
                        var memberSlot:String = (scope === member.quest_keys ? "quest:" : "mission:") + scopeKey;
                        if (catalogMembers.hasOwnProperty(memberSlot)) { valid = false; generation++; return; }
                        catalogMembers[memberSlot] = member.key;
                    }
                }
            }
            if (value.schema_version === 2) for (var scopedKey:String in next) {
                for (action in next[scopedKey].actions) {
                    var scopedAction:Object = next[scopedKey].actions[action];
                    if ((scopedAction.quest_keys is Array || scopedAction.mission_keys is Array)
                        && !catalogKeys.hasOwnProperty(scopedKey)) { valid = false; generation++; return; }
                }
            }
            for (var key:String in next) {
                if (!managed.hasOwnProperty(key)) managed[key] = {};
                for (action in next[key].actions) managed[key][action] = true;
            }
            for each (member in nextCatalog) {
                if (member.quest_keys is Array) for each (qk in member.quest_keys) managedQuests[qk] = member.key;
                if (member.mission_keys is Array) for each (var allMission:String in member.mission_keys) managedMissions[allMission] = member.key;
            }
            for (key in next) {
                for (action in next[key].actions) {
                    if (next[key].actions[action].quest_keys is Array) for each (var qk:String in next[key].actions[action].quest_keys) managedQuests[qk] = key;
                    if (next[key].actions[action].mission_keys is Array) for each (var mk:String in next[key].actions[action].mission_keys) managedMissions[mk] = key;
                }
            }
            // Missing entries in a later FULL snapshot remain managed and closed.
            if (!valid || Number(value.revision) != revision || value.catalog_digest != digest
                || JSON.stringify(next) != JSON.stringify(states)) generation++;
            if (JSON.stringify(nextDefaults) != JSON.stringify(defaultStates) || JSON.stringify(nextLegacy) != JSON.stringify(legacyStates) || hasDefaults != defaultsPresent) generation++;
            defaultStates = nextDefaults; legacyStates=nextLegacy; hasDefaults = defaultsPresent;
            for (var defaultManaged:String in defaultStates) {
                if (!managed.hasOwnProperty(defaultManaged)) managed[defaultManaged] = {};
                for (var defaultManagedAction:String in defaultStates[defaultManaged]) managed[defaultManaged][defaultManagedAction] = true;
            }
            states = next; catalog = nextCatalog;
            nextExpiry = Number.POSITIVE_INFINITY;
            for each (var scheduled:Object in states) for each (var schedule:Object in scheduled.actions)
                if (schedule.ends_at_ms !== null && Number(schedule.ends_at_ms) >= Number(value.server_time_ms))
                    nextExpiry = Math.min(nextExpiry,Number(schedule.ends_at_ms));
            digest = value.catalog_digest; revision = Number(value.revision);
            serverTime = Number(value.server_time_ms); receivedAt = uint(getTimer()); valid = true;
        }
        public static function decision(key:String, action:String):int {
            if (key == "") return -1;
            if ((!managed.hasOwnProperty(key) || managed[key][action] !== true)) {
                if (valid && legacyStates.hasOwnProperty(key) && legacyStates[key][action]===true) return -1;
                if (hasDefaults && (action == "visible" || action == "enter" || action == "exchange")) {
                    var type:String = key.split(":")[0];
                    if (type.indexOf("mission_")==0) return 0;
                    if (type == "gacha" || type == "box_gacha" || type.indexOf("_event") >= 0
                        || type.indexOf("_campaign") >= 0 || type.indexOf("_shop") >= 0) return 0;
                }
                return -1;
            }
            if (hasSnapshot && !valid) return 0;
            var elapsed:uint = uint(getTimer()) - receivedAt;
            // Initial integration refreshes on normal load/reload. The server
            // remains authoritative while an already-open screen is stale.
            if (!valid) return 0;
            var row:Object = actionFor(key,action);
            if (row == null) return 0;
            if (row.ends_at_ms !== null && serverTime + elapsed > Number(row.ends_at_ms)) {
                if (expired[key + ":" + action] !== row.ends_at_ms) { expired[key + ":" + action] = row.ends_at_ms; generation++; }
                return 0;
            }
            return row.enabled === true ? 1 : 0;
        }
        private static function actionFor(key:String,action:String):Object {
            if (states.hasOwnProperty(key) && states[key].actions.hasOwnProperty(action)) return states[key].actions[action];
            if (defaultStates.hasOwnProperty(key) && defaultStates[key].hasOwnProperty(action))
                return {enabled:defaultStates[key][action],ends_at_ms:null,quest_keys:null,mission_keys:null};
            return null;
        }
        private static function scopeFor(key:String,action:String,kind:String):Object {
            var row:Object = actionFor(key,action);
            return row == null ? null : row[kind];
        }
        public static function gachaDecision(logic:Object, action:String):int {
            var result:int = decision("gacha:" + logic.id, action);
            // Personal comeback/stars periods remain account eligibility gates.
            if (result == 1 && (logic.isComeback() || logic.isStarsGacha())) return -1;
            return result;
        }
        public static function gachaEnterGate(logic:Object,player:Object,now:Number,extended:Boolean):int {
            var permission:int = gachaDecision(logic,"enter");
            if (permission >= 0 || decision("gacha:" + logic.id,"visible") < 0) return permission;
            if (logic.isComeback() || logic.isStarsGacha()) return -1;
            // isAvailable calls the shared visible predicate in its original
            // body. Recheck its original window before preserving the remaining
            // player/ticket/count rules, using the caller's time and extension.
            // These are the ordinary pool's native dates, not the published
            // getters used by asset planning. Personal pools take the old route.
            var end:Object = logic.period.endTime;
            if (extended) {
                var once:Object = logic.get_onceTicketItemId(), ten:Object = logic.get_tenTimesTicketItemId();
                if ((once.index == 0 && player.hasItem(int(once.params[0])))
                    || (ten.index == 0 && player.hasItem(int(ten.params[0])))) {
                    var ticketEnd:Object = logic.get_ticketExpiryTime();
                    if (ticketEnd.index == 0) end = ticketEnd;
                }
            }
            var range:Class = getDefinitionByName("pinball.common.time::TimeRange") as Class;
            return new range(Number(logic.period.startTime),end).isWithin(now) ? -1 : 0;
        }
        private static function gachaSharedDates(logic:Object):Boolean {
            return gachaDecision(logic,"visible") >= 0;
        }
        public static function gachaEnd(logic:Object):Object {
            var key:String = "gacha:" + logic.id;
            if (!gachaSharedDates(logic)) return null;
            return endOption(key);
        }
        public static function gachaStart(logic:Object):Object {
            if (!gachaSharedDates(logic)) return null;
            return optionClass().Some(0);
        }
        public static function gachaHasEnd(logic:Object):int {
            var key:String = "gacha:" + logic.id;
            if (!gachaSharedDates(logic)) return -1;
            var row:Object = actionFor(key,"visible");
            return decision(key,"visible") == 1 && row != null && row.ends_at_ms === null ? 0 : 1;
        }
        public static function gachaPeriod(logic:Object):Object {
            if (!gachaSharedDates(logic)) return null;
            var range:Class = getDefinitionByName("pinball.common.time::TimeRange") as Class;
            var key:String = "gacha:" + logic.id, row:Object = actionFor(key,"visible");
            return optionClass().Some(new range(0,decision(key,"visible") == 1 && row.ends_at_ms === null ? optionClass().None : endOption(key)));
        }
        public static function gachaDateText(view:Object):Boolean {
            var logic:Object = view.basePeek.getGacha();
            if (!gachaSharedDates(logic)) return false;
            if (!logic.get_showPeriod()) return false;
            view.periodLayout.visible = true;
            var text:Object = view.periodLayout.getText("label",{});
            fitPeriodText(text); text.set_text(keyLabel("gacha:" + logic.id));
            return true;
        }
        private static function optionClass():Class { return getDefinitionByName("haxe.ds::Option") as Class; }
        private static function endOption(key:String):Object {
            if (decision(key,"visible") != 1) return optionClass().Some(0);
            var row:Object = actionFor(key,"visible");
            return optionClass().Some(row.ends_at_ms === null ? OPEN_END_MS : Number(row.ends_at_ms));
        }
        public static function towerKey(logic:Object):String {
            // EventLogic implementations expose getEventId(); Score/Solo store eventId,
            // other families store id, and campaign variants inherit their accessor.
            if (logic == null || !("getEventId" in logic)) return "";
            var event:Object = logic.getEventId();
            return event != null && EVENT_TYPES.hasOwnProperty(event.tag)
                ? EVENT_TYPES[event.tag] + ":" + event.params[0] : "";
        }
        public static function towerDecision(logic:Object,action:String):int { return decision(towerKey(logic),action); }
        public static function questDecision(logic:Object,action:String):int {
            if (!logic.hasOwnProperty("id")) return -1;
            var category:int=int(logic.get_category().id);
            var questKey:String = category + ":" + logic.id;
            // Explicit permanent boss difficulties are not seasonal instances.
            var coreHard:Object={2080001:true,2081001:true,2082001:true,2083001:true,2084001:true,2085001:true,2086001:true,2087001:true,2088001:true,2035001:true,2037001:true,2038001:true,2039001:true,2040001:true,2041001:true,2025001:true,2026001:true,2027001:true,2028001:true,2029001:true,2030001:true,2051001:true,2052001:true,2053001:true,2054001:true,2055001:true,2056001:true};
            if(category==26 && coreHard.hasOwnProperty(logic.id) && !managedQuests.hasOwnProperty(questKey))return -1;
            var fields:Array = ["adventEvent","rankingEvent","storyEvent","dailyWeekEvent","challengeDungeonEvent",
                "dailyExpManaEvent","worldStoryEvent","towerDungeonEvent","expertSingleEvent","carnivalEvent",
                "raidEvent","rushEvent","soloTimeAttackEvent","hardMultiEvent","scoreAttackEvent"];
            var key:String = managedQuests.hasOwnProperty(questKey) ? managedQuests[questKey] : "";
            if (key == "") for each (var field:String in fields) {
                if (logic.hasOwnProperty(field) && logic[field] != null) { key = towerKey(logic[field]); break; }
            }
            var result:int = decision(key,action);
            if (result <= 0) return result;
            var scope:Object = scopeFor(key,action,"quest_keys");
            if (scope is Array && scope.indexOf(questKey) < 0) return 0;
            return result;
        }
        public static function gachaCache(repository:Object):void {
            // Rebuild on every lookup: personal Some-to-Some windows are not revisioned by operations.
            var map:Class = getDefinitionByName("haxe.ds::IntMap") as Class;
            repository.gachaLoicTable = new map();
            repository.gachaCombebackPeriod = new map();
            repository.gachaStarskPeriod = new map();
        }
        public static function gachaExchangeProducts(scene:Object):Object {
            return decision("gacha:" + scene.gachaId,"exchange") == 0 ? [] : null;
        }
        public static function towerEnd(logic:Object):Object {
            var key:String = towerKey(logic);
            return decision(key,"visible") < 0 ? null : endOption(key);
        }
        public static function towerPermanentLabel(logic:Object):Object {
            var key:String = towerKey(logic);
            var row:Object = actionFor(key,"visible");
            return decision(key,"visible") == 1 && row != null && row.ends_at_ms === null ? optionClass().Some("常驻开放") : null;
        }
        public static function contentLabel(logic:Object):Object {
            var key:String = contentKey(logic);
            if (decision(key,"visible") < 0 && decision(key,"claim") != 1 && decision(key,"exchange") != 1) return null;
            if (contentDecision(logic,"enter") == 1) return operationLabel(logic,"enter","参与");
            if (contentDecision(logic,"claim") == 1) return operationLabel(logic,"claim","领奖");
            if (contentDecision(logic,"exchange") == 1) return operationLabel(logic,"exchange","兑换");
            return optionClass().Some(decision(key,"visible") == 1 ? "仅可查看" : "已关闭");
        }
        private static function operationLabel(logic:Object,action:String,verb:String):Object {
            if (contentDecision(logic,action) != 1) return optionClass().Some("已关闭");
            var end:Object = contentEnd(logic,action);
            return optionClass().Some(formatActionLabel(end.index == 0 ? Number(end.params[0]) : OPEN_END_MS,action,verb));
        }
        private static function keyLabel(key:String):String {
            for each (var action:String in ["enter","claim","exchange"]) {
                if (decision(key,action) != 1) continue;
                var row:Object = actionFor(key,action);
                return formatActionLabel(row.ends_at_ms === null ? OPEN_END_MS : Number(row.ends_at_ms),
                    action,action == "claim" ? "领奖" : (action == "exchange" ? "兑换" : "参与"));
            }
            return decision(key,"visible") == 1 ? "仅可查看" : "已关闭";
        }
        private static function formatActionLabel(end:Number,action:String,verb:String):String {
            var prefix:String = action == "enter" ? "" : "仅可" + verb;
            if (end == OPEN_END_MS) return prefix == "" ? "常驻开放" : prefix;
            if (end <= 0) return "已关闭";
            return prefix == "" ? "开放至 " + formatDeadline(end) : prefix + "（至 " + formatDeadline(end) + "）";
        }
        /** Fixed CN calendar, independent of the desktop/device local timezone. */
        public static function formatDeadline(end:Number):String {
            var date:Date = new Date(end + 8 * 60 * 60 * 1000);
            return date.getUTCFullYear() + "." + twoDigits(date.getUTCMonth() + 1) + "/" + twoDigits(date.getUTCDate())
                + " " + twoDigits(date.getUTCHours()) + ":" + twoDigits(date.getUTCMinutes());
        }
        private static function twoDigits(value:int):String { return value < 10 ? "0" + value : String(value); }
        /** Reuse the native date-panel shape, with the controlled action's dates. */
        public static function eventDate(scene:Object):Object {
            var event:Object = "eventPeek" in scene && scene.eventPeek != null ? scene.eventPeek : ("event" in scene ? scene.event : ("getEventId" in scene ? scene : null));
            if (event == null || contentDecision(event,"enter") < 0) return null;
            // An existing frame alone is not an original date UI: permanent
            // native events can have a frame while their old end is None.
            if (getQualifiedClassName(event).split("::").pop() == "ExpertSingleEventLogic") return null;
            if (!("commonValues" in event) || event.commonValues == null) return null;
            if (event.commonValues.playable_end_time == null || event.commonValues.playable_end_time.index != 0) return optionClass().None;
            if (contentDecision(event,"enter") != 1) return optionClass().None;
            var frame:Object = event.getFlashFrameReference();
            if (frame.index != 0) return optionClass().None;
            return periodDateConfig(int(frame.params[0]),String(operationLabel(event,"enter","参与").params[0]));
        }
        /** Display-only payload. No synthetic epoch is passed to a calendar formatter. */
        private static function periodDateConfig(frame:int,label:String):Object {
            return optionClass().Some({frame:frame,timeRanges:[{contentDisplayText:label}],remaining:optionClass().None});
        }
        public static function dateRangeLabel(row:Object):Object {
            return row != null && row.hasOwnProperty("contentDisplayText") ? String(row.contentDisplayText) : null;
        }
        public static function realIncentiveManaged(logic:Object):Boolean {
            return contentDecision(logic,"enter") >= 0 || contentDecision(logic,"claim") >= 0;
        }
        /** Preserve the independent, original lottery calendar, including absence. */
        public static function realIncentiveLotteryDate(logic:Object,end:Boolean):String {
            var raw:Object = end ? logic.values.lottery_end_time : logic.values.playable_end_time;
            // Native getLotteryPeriod starts one second after playable_end_time.
            return raw != null && raw.index == 0 ? formatDeadline(Number(raw.params[0]) + (end ? 0 : 1000)) : "";
        }
        public static function realIncentiveText(logic:Object,phase:String):Object {
            if (!realIncentiveManaged(logic)) return null;
            if (phase == "lottery") {
                // Null preserves the original localized start/end template; an
                // absent raw endpoint has no reliable date to render.
                return realIncentiveLotteryDate(logic,false) == "" || realIncentiveLotteryDate(logic,true) == "" ? "" : null;
            }
            var action:String = phase == "playable" ? "enter" : "claim";
            if (contentDecision(logic,action) >= 0) return String(operationLabel(logic,action,action == "enter" ? "参与" : "领奖").params[0]);
            // A partially managed event retains the independent original end.
            var raw:Object = action == "enter" ? logic.values.playable_end_time : logic.values.end_time;
            return raw != null && raw.index == 0 ? "截至 " + formatDeadline(Number(raw.params[0])) : "";
        }
        /** Keep the actual Flatomo text field bounds; do not scale its parent container. */
        public static function fitPeriodText(text:Object):void {
            var width:Number = Number(text.get_textWidth()), height:Number = Number(text.get_textHeight());
            text.set_autoSize("none");
            text.set_textWidth(width); text.set_textHeight(height); text.set_autoScale(true);
            text.rawTextField.wordWrap = false;
        }
        public static function preparePeriodConfig(view:Object,config:Object):Object {
            if (view == null || view.peek == null || config == null) return config;
            var peek:Object = view.peek, key:String = "", logic:Object = null;
            if ("passCardId" in peek) key = "pass_card_event:" + peek.passCardId;
            else if ("getActiveMissionEvent" in peek) {
                logic = peek.getActiveMissionEvent(); key = contentKey(logic);
                if (logic.values.end_time == null || logic.values.end_time.index != 0) { config.date = optionClass().None; return config; }
                if (config.date.index != 0) {
                    var frame:Object = logic.getFlashFrameReference();
                    if (frame.index != 0 || decision(key,"visible") < 0) return config;
                    config.date = periodDateConfig(int(frame.params[0]),keyLabel(key));
                }
            } else if ("getCollectItemEvent" in peek) { logic = peek.getCollectItemEvent(); key = contentKey(logic); }
            else if ("event" in peek && peek.event != null) { logic = peek.event; key = contentKey(logic); }
            if (key == "" || (decision(key,"visible") < 0 && decision(key,"claim") != 1 && decision(key,"exchange") != 1)
                || config.date == null || config.date.index != 0) return config;
            for each (var row:Object in config.date.params[0].timeRanges) row.contentDisplayText = keyLabel(key);
            return config;
        }
        public static function sanitizeDateConfig(config:Object):void {
            if (config == null || !config.hasOwnProperty("date") || config.date == null || config.date.index != 0) return;
            var date:Object = config.date.params[0];
            if (date == null || !(date.timeRanges is Array)) return;
            var ranges:Array = [];
            for each (var row:Object in date.timeRanges) {
                var controlledClosed:Boolean = row != null && Number(row.end) == 0
                    && hasSnapshot && Number(row.start) == serverTime;
                if (row == null || row.hasOwnProperty("contentDisplayText") || (Number(row.end) != OPEN_END_MS && !controlledClosed)) ranges.push(row);
            }
            if (ranges.length == date.timeRanges.length) return;
            if (ranges.length == 0) config.date = optionClass().None;
            else date.timeRanges = ranges;
        }
        public static function rankingPeriodInfo(scene:Object):Object {
            var logic:Object = scene.event;
            if (contentDecision(logic,"enter") < 0 && contentDecision(logic,"claim") < 0) return null;
            var action:String = contentDecision(logic,"enter") == 1 ? "enter" : "claim";
            if (contentDecision(logic,action) != 1) return optionClass().None;
            var original:Object = action == "enter" ? logic.commonValues.playable_end_time : logic.rewardReceiveTimeRange.endTime;
            if (original == null || original.index != 0) return optionClass().None;
            var range:Class = getDefinitionByName("pinball.common.time::TimeRange") as Class;
            return optionClass().Some({uiStringKey:action == "enter" ? "event_quest_dates" : "event_reward_receive_dates",
                timeRange:new range(action == "enter" ? Number(logic.commonValues.start_time) : Number(logic.rewardReceiveTimeRange.startTime),original)});
        }
        public static function scoreRemaining(logic:Object):Object {
            var permission:int = contentDecision(logic,"enter");
            if (permission < 0) return null;
            if (permission != 1) return optionClass().Some(0);
            var end:Number = Number.POSITIVE_INFINITY;
            var now:Number = serverTime + uint(uint(getTimer())-receivedAt);
            for each (var quest:Object in logic.getQuests()) {
                if (questDecision(quest,"enter") != 1) continue;
                // Every eligible quest uses the same controlled parent interval;
                // raw quest.period contains the retired master calendar.
                var controlled:Object = contentEnd(logic,"enter");
                if (controlled.index == 0) end = Math.min(end,Number(controlled.params[0]));
            }
            if (!isFinite(end) || end == OPEN_END_MS) return optionClass().None;
            return optionClass().Some(Math.max(0,end-now));
        }
        public static function contentRemaining(logic:Object,action:String):Object {
            var key:String = contentKey(logic);
            if (contentDecision(logic,action) < 0) return null;
            if (contentDecision(logic,action) != 1) return optionClass().Some(0);
            var end:Object = contentEnd(logic,action);
            return end.index != 0 || Number(end.params[0]) == OPEN_END_MS ? optionClass().None : optionClass().Some(Math.max(0,
                Number(end.params[0])-serverTime-uint(uint(getTimer())-receivedAt)));
        }
        public static function currentRevision():Number { return revision; }
    }
}
