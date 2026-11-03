"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const player_time_compat_1 = require("../../lib/player-time-compat");
const utils_1 = require("../../utils");
const player_1 = require("../../data/domains/player");
const quest_active_1 = require("../../data/domains/quest_active");
const session_1 = require("../../data/domains/session");
const player_data_1 = require("../../data/utils/player-data");
const content_snapshot_1 = require("../../content/runtime/content-snapshot");
const active_reconciliation_1 = require("../../lib/mission/active-reconciliation");
const activeAccount_1 = require("../../data/activeAccount");
const serializer_1 = require("../../multi/room/serializer");
const validate_1 = require("../../lib/validate");
const singleBattleQuest_1 = require("../api/singleBattleQuest");
const profileFavorite_1 = require("../../lib/profileFavorite");
const game_logging_1 = require("../../lib/game-logging");
const mode15_active_quest_recovery_1 = require("../../lib/mode15-active-quest-recovery");
const default_runtime_1 = require("../../multi/coordinator/default-runtime");
const mode15_optional_1 = require("../../lib/mode15-optional");
const rushEvent_1 = require("../../data/domains/rushEvent");
const gauntlet_completion_classification_1 = require("../../lib/gauntlet-completion-classification");
const equipment_1 = require("../../data/domains/equipment");
const character_1 = require("../../data/domains/character");
const party_1 = require("../../data/domains/party");
const quest_1 = require("../../data/domains/quest");
const abyss_time_revision_1 = require("../../lib/abyss-time-revision");
const abyss_tower_progress_1 = require("../../data/domains/abyss-tower-progress");
const http_reply_1 = require("../../lib/http-reply");
const daily_vmoney_mail_1 = require("../../lib/daily-vmoney-mail");
const news_delivery_1 = require("../../lib/news-delivery");
const node_perf_hooks_1 = require("node:perf_hooks");
const server_work_performance_1 = require("../../lib/server-work-performance");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const persistence_admission_1 = require("../../lib/persistence-admission");
const client_player_snapshot_1 = require("../../data/utils/client-player-snapshot");
const client_display_time_1 = require("../../lib/client-display-time");
const shutdown_state_1 = require("../../lib/shutdown-state");
const client_admission_1 = require("../../lib/client-admission");
const client_1 = require("../../lib/weapon-riven/client");
const weaponRiven_1 = require("../../data/domains/weaponRiven");
function fillClientDefaults(d) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    var _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3;
    if (d.user_info) {
        if (typeof d.user_info.last_login_time === 'number') {
            const dt = new Date(d.user_info.last_login_time * 1000);
            d.user_info.last_login_time = (0, client_display_time_1.formatClientDisplayDateTime)(dt);
        }
        (_a = (_q = d.user_info).is_bought_fund_ex_quest) !== null && _a !== void 0 ? _a : (_q.is_bought_fund_ex_quest = false);
        (_b = (_r = d.user_info).is_bought_fund_main_quest) !== null && _b !== void 0 ? _b : (_r.is_bought_fund_main_quest = false);
        (_c = (_s = d.user_info).is_bought_fund_laite) !== null && _c !== void 0 ? _c : (_s.is_bought_fund_laite = false);
        (_d = (_t = d.user_info).is_bought_fund_laite2) !== null && _d !== void 0 ? _d : (_t.is_bought_fund_laite2 = false);
        (_e = (_u = d.user_info).is_bought_fund_laite3) !== null && _e !== void 0 ? _e : (_u.is_bought_fund_laite3 = false);
        (_f = (_v = d.user_info).is_newbie) !== null && _f !== void 0 ? _f : (_v.is_newbie = true);
        (_g = (_w = d.user_info).is_comeback) !== null && _g !== void 0 ? _g : (_w.is_comeback = false);
        (_h = (_x = d.user_info).month_card_remain_days) !== null && _h !== void 0 ? _h : (_x.month_card_remain_days = 0);
        (_j = (_y = d.user_info).weekly_bonus_remain_days) !== null && _j !== void 0 ? _j : (_y.weekly_bonus_remain_days = 0);
        (_k = (_z = d.user_info).monthly_payment_total) !== null && _k !== void 0 ? _k : (_z.monthly_payment_total = 0);
        (_l = (_0 = d.user_info).renewal_gift_remain_days) !== null && _l !== void 0 ? _l : (_0.renewal_gift_remain_days = 0);
    }
    if (d.user_option) {
        (_m = (_1 = d.user_option).episode_encyclopedia_suggest_show) !== null && _m !== void 0 ? _m : (_1.episode_encyclopedia_suggest_show = false);
        (_o = (_2 = d.user_option).server_push) !== null && _o !== void 0 ? _o : (_2.server_push = false);
        (_p = (_3 = d.user_option).stamina) !== null && _p !== void 0 ? _p : (_3.stamina = false);
    }
}
function wrapOptionFields(d, playerId, resVer) {
    var _a;
    const { getEffectiveVersion } = require("../../lib/version");
    d.available_asset_version = getEffectiveVersion();
    fillClientDefaults(d);
    d.cn_crash_url = `http://${(0, serializer_1.getDisplayHost)()}:${process.env.CN_LISTEN_PORT || "8001"}/crash`;
    d.survey_url = "";
    d.qq_group_url = "";
    d.bug_report_url = "";
    d.enable_gift = false;
    d.enable_customer_service = false;
    d.enable_rename = true;
    d.enable_delete_file = false;
    d.enable_newbie = false;
    d.enable_little_assistant = false;
    d.mission_tips = false;
    d.monthly_tip = false;
    d.simple_payment_item_list = [];
    d.ex_boost_draw_result = null;
    d.pass_force_reward = false;
    d.crazy_gacha_result_list = [];
    d.last_crazy_gacha_draw_result = [];
    require("../../lib/crazy-gacha").decorateLoadWithCrazyGacha(d, playerId);
    // 成长基金默认开通（测试服）；已领列表来自 players_growth_fund_rewards
    d.fund_receive_list = require("../../lib/growth-fund").getPlayerFundReceiveListSync(playerId);
    if (d.user_info) {
        d.user_info.is_bought_fund_ex_quest = true;
        d.user_info.is_bought_fund_main_quest = true;
        d.user_info.is_bought_fund_laite = true;
        d.user_info.is_bought_fund_laite2 = true;
        d.user_info.is_bought_fund_laite3 = true;
    }
    d.login_info = {};
    d.tower_dungeon_list = [];
    d.special_exchange_campaign_list = [];
    d.win_lottery_active_mission_list = [];
    d.stars_gacha_campaign_list = [];
    // Profile favorites are stored separately as party category 99.  Do not
    // rebuild them from the normal SET1 party, or the chosen favorite is lost
    // on every load.
    d.favorite_party_group_list = (0, profileFavorite_1.getFavoritePartyGroupListSync)(playerId, ((_a = d.user_info) === null || _a === void 0 ? void 0 : _a.leader_character_id) || 1);
    d.ranking_event_reward = [];
    d.party_list = [];
    d.payment_rebate_info = { expired_time: 0, status: 0, start_time: 0 };
    d.monthly_charge_bonus_info = { bonus_days: 0, expired_time: 0, init_time: 0, status: 0, start_time: 0 };
    d.comeback_campaign_boss_boost = { period_start_time: 0, period_end_time: 0 };
    return d;
}
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.post("/load", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            let phaseStartedAt = node_perf_hooks_1.performance.now();
            const markLoadPhase = (phase) => {
                const now = node_perf_hooks_1.performance.now();
                (0, server_work_performance_1.recordServerWork)(phase, now - phaseStartedAt);
                phaseStartedAt = now;
            };
            const body = request.body;
            const viewerId = body.viewer_id || body.keychain;
            const session = yield (0, session_1.getSession)(String(viewerId));
            markLoadPhase("load.session");
            if (!session || session.type !== 2) {
                reply.type("application/x-msgpack");
                return reply.send({ data_headers: (0, utils_1.generateDataHeaders)({ result_code: 516 }), data: {} });
            }
            const accountId = session.accountId;
            const playerId = (0, activeAccount_1.resolvePlayerIdSync)(accountId);
            if (!playerId) {
                return reply.status(400).send({ error: "Bad Request", message: "No player found" });
            }
            return yield (0, shutdown_state_1.withServerWorkAdmission)(() => __awaiter(void 0, void 0, void 0, function* () {
                var _a;
                // The load snapshot preparation also repairs old saves (including
                // mana boards and stamina). Admit the complete write unit before
                // queueing, read fresh state inside it, and commit it atomically.
                const { now, prepared } = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
                    domain: "player", playerId, operation: "load_maintenance",
                }, () => {
                    var _a;
                    const now = (0, utils_1.getServerDate)();
                    const current = (0, player_1.getPlayerSync)(playerId);
                    if (!current)
                        throw new Error("No player data.");
                    (0, daily_vmoney_mail_1.ensureDailyVmoneyMailForPlayerSync)(playerId, (0, utils_1.getRealServerDate)().getTime());
                    (0, player_1.dailyResetPlayerDataSync)(current, now);
                    (0, player_1.collectPlayerDataPooledExpSync)(current, now);
                    (0, player_1.updatePlayerSync)({ id: playerId, lastLoginTime: (0, player_time_compat_1.getPlayerBusinessDateSync)(playerId, now) });
                    markLoadPhase("load.maintenance");
                    // Maintenance can change the base row. Validators mutate these
                    // request-local snapshots; none escape if this transaction fails.
                    const currentPlayer = (0, player_1.getPlayerSync)(playerId);
                    if (!currentPlayer)
                        throw new Error("No player data.");
                    const equipmentList = (0, equipment_1.getPlayerEquipmentListSync)(playerId);
                    (0, validate_1.runPermanentValidators)(playerId, { player: currentPlayer, equipmentList }, { throwOnError: true });
                    markLoadPhase("load.player");
                    const characterList = (0, character_1.getPlayerCharactersSync)(playerId);
                    const characterManaNodeList = (0, character_1.getPlayerCharactersManaNodesSync)(playerId);
                    const partyGroupList = (0, party_1.getPlayerPartyGroupListSync)(playerId);
                    const questProgress = (0, quest_1.getPlayerQuestProgressSync)(playerId);
                    markLoadPhase("load.snapshot");
                    (0, active_reconciliation_1.reconcileActiveMissionFacts)({
                        playerId,
                        player: currentPlayer,
                        characterList,
                        characterManaNodeList,
                        equipmentList,
                        partyGroupList,
                        questProgress,
                        repository: (0, content_snapshot_1.getContentSnapshot)().repository,
                        now: now.getTime(),
                    });
                    const removedMode15RescueRows = (0, mode15_optional_1.cleanupLegacyMode15RescueProgressSync)(playerId);
                    if (removedMode15RescueRows > 0) {
                        console.log(`[MODE15] removed legacy rescue progress: player=${playerId} rows=${removedMode15RescueRows}`);
                    }
                    // Preserve the empty Rush shell required for cross-event visibility
                    // on a cold load, including after a completed or failed Mode15 run.
                    if ((0, mode15_optional_1.isMode15RuntimeLoaded)()
                        && (0, rushEvent_1.getPlayerRushEventSync)(playerId, mode15_optional_1.MODE15_RUSH_EVENT_ID) === null) {
                        (0, rushEvent_1.insertPlayerRushEventSync)(playerId, (0, rushEvent_1.getDefaultPlayerRushEventSync)(mode15_optional_1.MODE15_RUSH_EVENT_ID));
                        console.log(`[MODE15] initialized Rush state during load: player=${playerId}`);
                    }
                    const repairedGauntletCompletions = (0, gauntlet_completion_classification_1.repairAllGauntletCompletionClassificationsSync)(playerId);
                    if (repairedGauntletCompletions.length > 0) {
                        console.log(`[RUSH] repaired completed classification during load: `
                            + `player=${playerId} events=${repairedGauntletCompletions.join(",")}`);
                    }
                    const serializedQuestProgress = removedMode15RescueRows > 0
                        || repairedGauntletCompletions.length > 0
                        ? (0, quest_1.getPlayerQuestProgressSync)(playerId)
                        : questProgress;
                    markLoadPhase("load.reconcile");
                    (0, abyss_tower_progress_1.refreshPlayerAbyssTowersSync)(playerId);
                    const assemblyStartedAt = node_perf_hooks_1.performance.now();
                    const prepared = (0, utils_1.withServerClock)(now, () => (0, player_data_1.prepareClientSerializedData)(playerId, {
                        viewerId: accountId,
                        serializeRushEventData: true,
                        preloadedPlayer: currentPlayer,
                        preloadedCharacterList: characterList,
                        preloadedCharacterManaNodeList: characterManaNodeList,
                        preloadedEquipmentList: equipmentList,
                        preloadedPartyGroupList: partyGroupList,
                        preloadedQuestProgress: serializedQuestProgress,
                    }), (_a = (0, utils_1.getTimeOffset)()) !== null && _a !== void 0 ? _a : 0);
                    (0, server_work_performance_1.recordServerWork)("load.assemble", node_perf_hooks_1.performance.now() - assemblyStartedAt);
                    if (!prepared)
                        throw new Error("No player data.");
                    return { now, prepared };
                });
                // Pure response conversion runs after COMMIT. Saved optional party slots
                // still normalize to null before MessagePack encoding.
                const conversionStartedAt = node_perf_hooks_1.performance.now();
                let clientData = (0, client_player_snapshot_1.serializePlayerSnapshot)(prepared.data, prepared.context, prepared.options);
                (0, server_work_performance_1.recordServerWork)("load.convert", node_perf_hooks_1.performance.now() - conversionStartedAt);
                const resVer = request.headers['res_ver'];
                (0, game_logging_1.gameVerboseLog)(() => `[CN-LOAD] res_ver=${resVer || '(not sent)'} account=${accountId} player=${playerId} party_slot=${prepared.data.player.partySlot}`);
                wrapOptionFields(clientData, playerId, resVer);
                const rivenCapable = (0, client_admission_1.hasWeaponRivenCapability)(request);
                clientData = (0, client_1.projectWeaponRivenLoad)(clientData, rivenCapable ? (0, weaponRiven_1.getPlayerWeaponRivenListSync)(playerId) : {}, rivenCapable);
                const newsDelivery = (0, news_delivery_1.getNewsDeliveryState)(accountId, now);
                clientData.has_unread_news_item = newsDelivery.hasUnreadNews;
                markLoadPhase("load.serialize");
                // Inject unfinished quest lists for battle recovery
                const activeQuest = (0, quest_active_1.getPlayerActiveQuestSync)(playerId);
                if (activeQuest) {
                    const multiRecovery = yield (0, default_runtime_1.getRoomCommandGateway)().execute("battle.recovery", {
                        quest: activeQuest, viewerId, playerId,
                    });
                    if (multiRecovery.retained && !(0, abyss_time_revision_1.isStaleAbyssBattle)(activeQuest)) {
                        // A lobby can advance before another member posts its result.
                        // Keep that exact play for finish; legacy clients cannot resume
                        // gameplay after Finalize or rejoin it in a newer room battle.
                        clientData.unfinished_quest_list = [];
                        clientData.unfinished_multi_quest_list = [];
                        (0, game_logging_1.gameVerboseLog)(() => `[CN-LOAD] retained result play=${activeQuest.playId}`
                            + ` room=${activeQuest.roomNumber} reason=${multiRecovery.reason}`);
                    }
                    else if (!multiRecovery.recoverable || (0, abyss_time_revision_1.isStaleAbyssBattle)(activeQuest)) {
                        const mode15Quest = (0, mode15_optional_1.isMode15Quest)(activeQuest.category, activeQuest.questId);
                        // A stale multiplayer room cannot distinguish a defeat from a
                        // transport loss. Mode15 therefore clears this battle record
                        // without resetting the host's current 5/10/15 boundary.
                        const shouldResetMode15Run = (0, mode15_active_quest_recovery_1.shouldResetMode15RunForStaleActiveQuest)(mode15Quest, activeQuest);
                        (0, game_logging_1.gameVerboseLog)(() => {
                            var _a, _b;
                            return `[CN-LOAD] stale active quest cleared:`
                                + ` play=${activeQuest.playId} room=${(_a = activeQuest.roomNumber) !== null && _a !== void 0 ? _a : "missing"}`
                                + ` reason=${multiRecovery.reason}`
                                + ` state=${(_b = multiRecovery.roomPhase) !== null && _b !== void 0 ? _b : "missing"}`
                                + ` mode15=${mode15Quest} multiHost=${activeQuest.isMultiHost}`
                                + ` reset=${shouldResetMode15Run}`;
                        });
                        const deleted = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
                            domain: "multi-settlement",
                            playerId,
                            operation: "load_orphan_active_quest_cleanup",
                        }, () => {
                            const deletedCurrentPlay = (0, quest_active_1.deletePlayerActiveQuestIfPlayIdSync)(playerId, activeQuest.playId);
                            if (deletedCurrentPlay && shouldResetMode15Run) {
                                (0, mode15_optional_1.resetMode15RunSync)(playerId);
                            }
                            return deletedCurrentPlay;
                        });
                        if (deleted) {
                            if (((_a = singleBattleQuest_1.activeQuests[playerId]) === null || _a === void 0 ? void 0 : _a.playId) === activeQuest.playId) {
                                delete singleBattleQuest_1.activeQuests[playerId];
                            }
                            clientData.unfinished_quest_list = [];
                            clientData.unfinished_multi_quest_list = [];
                        }
                        else {
                            const replacement = (0, quest_active_1.getPlayerActiveQuestSync)(playerId);
                            const entry = replacement
                                ? { play_id: replacement.playId, continue_count: replacement.continueCount }
                                : null;
                            clientData.unfinished_quest_list = entry && !replacement.isMulti ? [entry] : [];
                            clientData.unfinished_multi_quest_list = entry && replacement.isMulti ? [entry] : [];
                        }
                    }
                    else {
                        const entry = { play_id: activeQuest.playId, continue_count: activeQuest.continueCount };
                        if (activeQuest.isMulti) {
                            clientData.unfinished_quest_list = [];
                            clientData.unfinished_multi_quest_list = [entry];
                        }
                        else {
                            clientData.unfinished_quest_list = [entry];
                            clientData.unfinished_multi_quest_list = [];
                        }
                    }
                }
                else {
                    clientData.unfinished_quest_list = [];
                    clientData.unfinished_multi_quest_list = [];
                }
                markLoadPhase("load.active");
                reply.header("content-type", "application/x-msgpack");
                return reply.status(200).send({
                    data_headers: (0, utils_1.generateDataHeaders)({
                        asset_update: true,
                        // The client treats 2 as "open the announcement list" and
                        // will run that dialog again on every return to the home
                        // scene. Use nil when there is no pending interrupt; unlike
                        // nil, 0 is stored by the client as Some(0) and can become
                        // stale state across navigation.
                        force_news: (0, news_delivery_1.getNewsInterruptFlag)(newsDelivery),
                        viewer_id: accountId,
                        servertime: (0, utils_1.getServerTime)(),
                    }),
                    data: clientData
                });
            }));
        }
        catch (e) {
            if ((0, http_reply_1.hijackUnavailableReply)(request, reply))
                return reply;
            // Preserve the game protocol's bounded-queue retry response.
            if ((0, persistence_admission_1.isPersistenceAdmissionError)(e))
                throw e;
            console.error(`[CN-LOAD] ERROR:`, e.message, e.stack);
            return reply.status(500).send({ error: "Internal Server Error", message: e.message });
        }
    }));
});
exports.default = routes;
