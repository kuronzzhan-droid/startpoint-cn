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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.insertActiveQuest = exports.activeQuests = void 0;
const contract_1 = require("../../multi/five-boss/contract");
const continue_runtime_1 = require("../../multi/five-boss/continue-runtime");
const entry_response_1 = require("../../multi/five-boss/entry-response");
const solo_runtime_1 = require("../../multi/five-boss/solo-runtime");
const quest_1 = require("../../data/domains/quest");
const quest_active_1 = require("../../data/domains/quest_active");
const date_1 = require("../../data/utils/date");
const battle_clock_compatibility_1 = require("../../lib/battle-clock-compatibility");
const battle_settlement_ledger_1 = require("../../data/domains/battle-settlement-ledger");
const single_finish_identity_1 = require("../../lib/quest/finish/single-finish-identity");
const party_refresh_1 = require("../../lib/weapon-riven/party-refresh");
const player_1 = require("../../data/domains/player");
const item_1 = require("../../data/domains/item");
const equipment_1 = require("../../data/domains/equipment");
const practice_battle_history_1 = require("../../data/domains/practice-battle-history");
const assets_1 = require("../../lib/assets");
const types_1 = require("../../lib/types");
const utils_1 = require("../../utils");
const types_2 = require("../../data/types");
const stamina_1 = require("../../lib/stamina");
const stamina_cost_1 = require("../../lib/stamina-cost");
const quest_calc_1 = require("../../lib/quest/finish/quest-calc");
const session_validator_1 = require("../../lib/quest/finish/session-validator");
const active_quest_resolver_1 = require("../../lib/quest/finish/active-quest-resolver");
const abyss_time_revision_1 = require("../../lib/abyss-time-revision");
const score_attack_handler_1 = require("../../lib/quest/finish/score-attack-handler");
const steam_robot_challenge_1 = require("../../lib/mission/steam-robot-challenge");
const mission_1 = require("../../lib/mission");
const active_entry_facts_1 = require("../../lib/mission/active-entry-facts");
const mail_1 = require("../../data/domains/mail");
const quest_entry_costs_json_1 = __importDefault(require("../../../assets/quest_entry_costs.json"));
const score_attack_border_reward_json_1 = __importDefault(require("../../../assets/score_attack_border_reward.json"));
const game_logging_1 = require("../../lib/game-logging");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const command_names_1 = require("../../lib/persistence/command-names");
const settlement_performance_1 = require("../../lib/settlement-performance");
const single_settlement_diagnostics_1 = require("../../lib/single-settlement-diagnostics");
const finish_response_cache_1 = require("../../lib/finish-response-cache");
const practice_battle_history_2 = require("../../lib/quest/practice-battle-history");
const abyss_tower_progress_1 = require("../../data/domains/abyss-tower-progress");
const abyss_modes_1 = require("../../lib/abyss-modes");
const party_1 = require("../../data/domains/party");
const party_current_slot_1 = require("../../lib/party-current-slot");
const mode15_optional_1 = require("../../lib/mode15-optional");
const rush_party_categories_1 = require("../../lib/rush-party-categories");
const weapon_riven_party_1 = require("../../data/domains/weapon-riven-party");
const special_event_parties_1 = require("../../lib/special-event-parties");
const client_admission_1 = require("../../lib/client-admission");
const client_1 = require("../../lib/weapon-riven/client");
const constants_1 = require("../../lib/weapon-riven/constants");
const continueVmoneyCost = 50;
exports.activeQuests = {};
function insertActiveQuest(playerId, quest) {
    var _a, _b, _c, _d, _e, _f;
    const startedAtMs = (_a = quest.startedAtMs) !== null && _a !== void 0 ? _a : (0, utils_1.getRealServerDate)().getTime();
    const questTimeRevision = (0, abyss_time_revision_1.isAbyssFiniteQuest)(quest.category, quest.questId)
        ? (0, abyss_time_revision_1.getAbyssTimeRevision)(Math.floor(quest.questId / 1000)) : null;
    // The caller may freeze this same object for a delayed multiplayer finish.
    // Its clock identity must match the committed registration, not only cache.
    quest.startedAtMs = startedAtMs;
    quest.questTimeRevision = questTimeRevision;
    quest.clockVersion = 1;
    // Persist to DB for battle recovery across server restarts
    (0, quest_active_1.insertPlayerActiveQuestSync)(playerId, {
        playerId,
        playId: quest.playId,
        questId: quest.questId,
        category: quest.category,
        useBossBoostPoint: quest.useBossBoostPoint,
        useBoostPoint: quest.useBoostPoint,
        isAutoStartMode: quest.isAutoStartMode,
        isMulti: quest.isMulti,
        isMultiHost: (_b = quest.isMultiHost) !== null && _b !== void 0 ? _b : false,
        roomNumber: (_c = quest.roomNumber) !== null && _c !== void 0 ? _c : null,
        entryItemId: (_d = quest.entryItemId) !== null && _d !== void 0 ? _d : null,
        eventId: (_e = quest.eventId) !== null && _e !== void 0 ? _e : null,
        continueCount: quest.continueCount,
        startedAtMs,
        partySlot: (_f = quest.partySlot) !== null && _f !== void 0 ? _f : null,
        questTimeRevision,
    });
    exports.activeQuests[playerId] = Object.assign({}, quest);
}
exports.insertActiveQuest = insertActiveQuest;
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.post("/finish", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        if (!viewerId || isNaN(viewerId))
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        const sessionResult = yield (0, session_validator_1.validateSessionAndPlayer)(viewerId);
        if (!sessionResult)
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid viewer id."
            });
        const { playerId } = sessionResult;
        const legacyFinishCacheKey = (0, finish_response_cache_1.buildFinishResponseCacheKey)("single", viewerId, body);
        const releaseFinishExecution = yield (0, finish_response_cache_1.acquireFinishExecution)(`single:${playerId}`);
        try {
            const requestPlayId = (0, single_finish_identity_1.singleFinishPlayId)(body.play_id);
            const replayReceipt = (playId) => __awaiter(void 0, void 0, void 0, function* () {
                if (playId === null)
                    return false;
                const replay = (0, battle_settlement_ledger_1.getBattleReplaySync)(playerId, "single", playId);
                if (replay.kind === "missing")
                    return false;
                if (replay.kind !== "available" || !(0, single_finish_identity_1.isSingleFinishResponse)(replay.response)) {
                    reply.status(400).send({ error: "Bad Request", message: "Battle result cannot be replayed. Please reload." });
                }
                else {
                    reply.header("content-type", "application/x-msgpack");
                    reply.status(200).send(yield (0, party_refresh_1.refreshWeaponRivenSettlementResponseAfterCommit)(playerId, replay.response));
                }
                return true;
            });
            // An old explicit play can replay its receipt even while a new battle is active.
            if (yield replayReceipt(requestPlayId))
                return reply;
            // Runs settled before generic solo receipts were introduced still
            // have their dedicated five-boss receipt. Replay it before a newer
            // active battle is checked, without consuming the newer registration.
            if (requestPlayId !== null) {
                const legacySoloResponse = (0, solo_runtime_1.getFiveBossSoloReceiptSync)(playerId, legacyFinishCacheKey);
                if (legacySoloResponse !== undefined) {
                    if (!(0, single_finish_identity_1.isSingleFinishResponse)(legacySoloResponse)) {
                        return reply.status(400).send({ error: "Bad Request", message: "Invalid single finish receipt." });
                    }
                    reply.header("content-type", "application/x-msgpack");
                    return reply.status(200).send(yield (0, party_refresh_1.refreshWeaponRivenSettlementResponseAfterCommit)(playerId, legacySoloResponse));
                }
            }
            const persistedQuest = (0, quest_active_1.getPlayerActiveQuestSync)(playerId);
            const memoryQuest = exports.activeQuests[playerId];
            const currentRegistration = persistedQuest !== null && persistedQuest !== void 0 ? persistedQuest : memoryQuest;
            if (currentRegistration === null || currentRegistration === void 0 ? void 0 : currentRegistration.isMulti) {
                return reply.status(400).send({ error: "Bad Request", message: "Multiplayer play cannot settle as single." });
            }
            if (currentRegistration !== undefined && currentRegistration !== null && (Number(body.quest_id) !== currentRegistration.questId
                || (requestPlayId !== null && (0, single_finish_identity_1.singleFinishPlayId)(currentRegistration.playId) !== null
                    && requestPlayId !== currentRegistration.playId))) {
                return reply.status(400).send({ error: "Bad Request", message: "Finish does not match the active quest." });
            }
            // A queued /start can replace the database row before this handler resumes.
            if (persistedQuest && memoryQuest && persistedQuest.playId !== memoryQuest.playId) {
                delete exports.activeQuests[playerId];
            }
            if (!currentRegistration) {
                // api_count is only an alias. Its cached payload cannot bypass
                // an expired or pruned durable replay, even with a long cache TTL.
                const aliasPlayId = (0, finish_response_cache_1.getCachedFinishPlayId)(legacyFinishCacheKey);
                if (aliasPlayId && (yield replayReceipt(aliasPlayId)))
                    return reply;
                const legacySolo = (0, solo_runtime_1.getFiveBossSoloReceiptSync)(playerId, legacyFinishCacheKey);
                if (legacySolo !== undefined) {
                    if (!(0, single_finish_identity_1.isSingleFinishResponse)(legacySolo))
                        return reply.status(400).send({
                            error: "Bad Request", message: "Invalid single finish receipt.",
                        });
                    reply.header("content-type", "application/x-msgpack");
                    return reply.status(200).send(yield (0, party_refresh_1.refreshWeaponRivenSettlementResponseAfterCommit)(playerId, legacySolo));
                }
            }
            // Resolve the active quest from memory, persisted recovery state, or
            // (for patched clients that skipped /start) a validated request hint.
            const resolvedActiveQuest = (0, active_quest_resolver_1.resolveActiveQuest)({
                playerId,
                hint: body,
                memory: exports.activeQuests,
            });
            const activeQuestData = resolvedActiveQuest === null || resolvedActiveQuest === void 0 ? void 0 : resolvedActiveQuest.quest;
            (0, game_logging_1.gameVerboseLog)(() => { var _a, _b; return `[FINISH] req: playerId=${playerId} questId=${body.quest_id} category=${body.category} activeExists=${activeQuestData !== undefined} source=${(_a = resolvedActiveQuest === null || resolvedActiveQuest === void 0 ? void 0 : resolvedActiveQuest.source) !== null && _a !== void 0 ? _a : "none"} multi=${(_b = activeQuestData === null || activeQuestData === void 0 ? void 0 : activeQuestData.isMulti) !== null && _b !== void 0 ? _b : false}`; });
            if (activeQuestData === undefined)
                return reply.status(400).send({
                    "error": "Bad Request",
                    "message": "No active quest to finish."
                });
            if ((resolvedActiveQuest === null || resolvedActiveQuest === void 0 ? void 0 : resolvedActiveQuest.source) !== "memory") {
                console.warn(`[FINISH] recovered active quest from ${resolvedActiveQuest === null || resolvedActiveQuest === void 0 ? void 0 : resolvedActiveQuest.source}: playerId=${playerId} questId=${activeQuestData.questId} category=${activeQuestData.category}`);
            }
            const registered = (resolvedActiveQuest === null || resolvedActiveQuest === void 0 ? void 0 : resolvedActiveQuest.source) !== "rebuilt";
            const receiptPlayId = requestPlayId !== null && requestPlayId !== void 0 ? requestPlayId : (registered ? (0, single_finish_identity_1.singleFinishPlayId)(activeQuestData.playId) : null);
            if (yield replayReceipt(receiptPlayId))
                return reply;
            // Bind a legacy api_count request to its registered play while that play exists.
            // The unscoped key remains only a short-lived retry alias after consumption.
            const finishCacheKey = (0, finish_response_cache_1.buildFinishResponseCacheKey)("single", viewerId, receiptPlayId === null ? body
                : Object.assign(Object.assign({}, body), { play_id: receiptPlayId }));
            const cachedFinishResponse = (0, solo_runtime_1.getFiveBossSoloReceiptSync)(playerId, finishCacheKey);
            if (cachedFinishResponse !== undefined) {
                reply.header("content-type", "application/x-msgpack");
                return reply.status(200).send(yield (0, party_refresh_1.refreshWeaponRivenSettlementResponseAfterCommit)(playerId, cachedFinishResponse));
            }
            const questCategory = activeQuestData.category;
            const questId = activeQuestData.questId;
            if ((0, contract_1.isFiveBossHiddenQuest)(questCategory, questId)) {
                return reply.status(400).send({ error: "Bad Request", message: "Internal five-boss scene cannot settle separately." });
            }
            const fiveBossSoloQuest = (0, contract_1.isFiveBossGauntletQuest)(questCategory, questId);
            if (fiveBossSoloQuest && (activeQuestData.isMulti || (resolvedActiveQuest === null || resolvedActiveQuest === void 0 ? void 0 : resolvedActiveQuest.source) === "rebuilt"
                || !finishCacheKey || !(0, solo_runtime_1.isActiveFiveBossSoloSync)(playerId, activeQuestData.playId))) {
                return reply.status(400).send({ error: "Bad Request", message: "No registered five-boss solo run." });
            }
            if ((resolvedActiveQuest === null || resolvedActiveQuest === void 0 ? void 0 : resolvedActiveQuest.source) === "rebuilt" && (0, abyss_time_revision_1.isAbyssFiniteQuest)(questCategory, questId)) {
                // Preserve the patched client's no-/start recovery, but never
                // assume a missing registration belongs to the newly published tower.
                activeQuestData.questTimeRevision = (0, abyss_time_revision_1.getAbyssTimeRevisionAtVersion)(request.headers.res_ver, Math.floor(questId / 1000));
            }
            // A restored/late finish from the old tower cannot seed the new record.
            if ((0, abyss_time_revision_1.isStaleAbyssBattle)(activeQuestData) || (0, abyss_time_revision_1.isStaleAbyssClient)(questCategory, questId, request.headers.res_ver)
                || !(0, abyss_tower_progress_1.canStartAbyssQuestSync)(playerId, questCategory, questId)) {
                if (registered)
                    (0, quest_active_1.deletePlayerActiveQuestIfPlayIdSync)(playerId, activeQuestData.playId);
                if (exports.activeQuests[playerId] === activeQuestData)
                    delete exports.activeQuests[playerId];
                reply.header("content-type", "application/x-msgpack");
                return reply.status(200).send({
                    data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId, asset_update: true, result_code: 4050 }),
                    data: {},
                });
            }
            (0, game_logging_1.gameVerboseLog)(() => `[FINISH] active: category=${questCategory} questId=${questId}`);
            const questData = (0, assets_1.getQuestFromCategorySync)(questCategory, questId);
            if (questData === null || !('rankPointReward' in questData)) {
                console.warn(`[BATTLE] finish failed: category=${questCategory} questId=${questId} found=${!!questData} hasRankReward=${questData ? ('rankPointReward' in questData) : 'N/A'}`);
                return reply.status(400).send({
                    "error": "Bad Request",
                    "message": "Quest doesn't exist."
                });
            }
            // calculate clear rank
            const clearTime = body.elapsed_time_ms;
            const isScoreAttackEvent = questCategory === types_1.QuestCategory.SCORE_ATTACK_EVENT;
            if (isScoreAttackEvent && (questData.bRankScore === undefined
                || questData.aRankScore === undefined
                || questData.sRankScore === undefined
                || questData.ssRankScore === undefined)) {
                return reply.status(500).send({
                    "error": "Internal Server Error",
                    "message": "Score attack rank thresholds are missing."
                });
            }
            const clearRank = isScoreAttackEvent
                ? (0, score_attack_handler_1.calculateScoreAttackClearRank)(body.score, {
                    bRankScore: questData.bRankScore,
                    aRankScore: questData.aRankScore,
                    sRankScore: questData.sRankScore,
                    ssRankScore: questData.ssRankScore,
                })
                : (0, quest_calc_1.calculateClearRank)(clearTime, questData);
            // State-dependent totals and first-clear progress are resolved by the transaction.
            const displayMode15ManaAsFieldDrop = (0, mode15_optional_1.isMode15Quest)(questCategory, questId);
            const manaObtained = (0, abyss_modes_1.isAbyssExEndlessQuest)(questCategory, questId) ? 0 : questData.manaReward + body.add_mana;
            let questAccomplished = body.is_accomplished;
            let scoreAttackBorderTiers = [];
            if (isScoreAttackEvent) {
                try {
                    scoreAttackBorderTiers = (0, score_attack_handler_1.resolveScoreAttackBorderTiers)(questData.eventId, questData.scoreAttackQuestId, score_attack_border_reward_json_1.default);
                }
                catch (error) {
                    console.error(`[SCORE_ATTACK] invalid configuration: ${error.message}`);
                    return reply.status(500).send({
                        "error": "Internal Server Error",
                        "message": "Score attack reward configuration is missing."
                    });
                }
                questAccomplished = body.score >= scoreAttackBorderTiers[0].score;
            }
            const finishResponse = yield (0, settlement_performance_1.measureSettlementPhaseAsync)("single", "transaction", () => ((0, persistence_coordinator_1.runWriterCommand)(command_names_1.SINGLE_SETTLE_FINISH, {
                playerId, viewerId, questCategory, questId, questData, activeQuestData, body,
                clearTime, clearRank, questAccomplished,
                // The patched client may skip /start; a rebuilt active quest must
                // not seed Abyss records as a registered run.
                fiveBossSoloQuest, registered,
                scoreAttackBorderTiers, manaObtained, displayMode15ManaAsFieldDrop,
                finishCacheKey, receiptPlayId,
            }, { domain: "single-quest", playerId, operation: "finish" })));
            if (finishResponse.timing !== null)
                (0, single_settlement_diagnostics_1.recordSingleSettlementBodyTiming)(finishResponse.timing);
            if (exports.activeQuests[playerId] === activeQuestData)
                delete exports.activeQuests[playerId];
            if (finishResponse.response === null) {
                return reply.status(400).send({ error: "Bad Request", message: "No active quest to finish." });
            }
            if (fiveBossSoloQuest)
                yield (0, party_refresh_1.refreshWeaponRivenPartiesAfterCommit)(playerId, finishResponse.response.data.party_info_list);
            (0, finish_response_cache_1.cacheFinishResponse)(finishCacheKey, finishResponse.response, receiptPlayId !== null && receiptPlayId !== void 0 ? receiptPlayId : undefined);
            (0, finish_response_cache_1.cacheFinishResponse)(legacyFinishCacheKey, finishResponse.response, receiptPlayId !== null && receiptPlayId !== void 0 ? receiptPlayId : undefined);
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send(finishResponse.response);
        }
        finally {
            releaseFinishExecution();
        }
    }));
    fastify.post("/abort", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        const body = request.body;
        const viewerId = body.viewer_id;
        if (isNaN(viewerId))
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        const sessionResult = yield (0, session_validator_1.validateSessionAndPlayer)(viewerId);
        if (!sessionResult)
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid viewer id."
            });
        const { playerId } = sessionResult;
        const headers = (0, utils_1.generateDataHeaders)({ viewer_id: body.viewer_id });
        // A defeated/abandoned single battle reaches /abort rather than
        // /finish(is_accomplished=false) on the legacy client. Resolve the
        // authoritative active quest before deleting it so Fantasy Rush can
        // apply the same fail-and-reset transition on both paths.
        const resolvedAbortQuest = (0, active_quest_resolver_1.resolveActiveQuest)({
            playerId,
            hint: body,
            memory: exports.activeQuests,
            allowRebuild: false,
        });
        const abortQuest = resolvedAbortQuest === null || resolvedAbortQuest === void 0 ? void 0 : resolvedAbortQuest.quest;
        if (abortQuest && ((body.play_id && body.play_id !== abortQuest.playId)
            || (body.category !== undefined && body.category !== abortQuest.category)
            || (body.quest_id !== undefined && body.quest_id !== abortQuest.questId)))
            return reply.status(400).send({ error: "Bad Request", message: "Active quest does not match abort request." });
        let practiceHistoryRecord = null;
        if ((abortQuest === null || abortQuest === void 0 ? void 0 : abortQuest.category) === types_1.QuestCategory.PRACTICE) {
            const requestedPlayId = typeof body.play_id === "string" ? body.play_id.trim() : "";
            const categoryMatches = body.category === undefined || body.category === abortQuest.category;
            const questMatches = body.quest_id === undefined || body.quest_id === abortQuest.questId;
            const playMatches = requestedPlayId.length === 0 || requestedPlayId === abortQuest.playId;
            if (!categoryMatches
                || !questMatches
                || !playMatches) {
                // Keep the diagnostic bounded to identifiers; never log
                // statistics or session material. This distinguishes a real
                // stale quest from the legacy empty-play-id abort shape.
                console.warn(`[PRACTICE-ABORT] request does not match active quest: `
                    + `player=${playerId} request=${body.category}/${body.quest_id}/${requestedPlayId || "(empty)"} `
                    + `active=${abortQuest.category}/${abortQuest.questId}/${abortQuest.playId}`);
                return reply.status(400).send({
                    "error": "Bad Request",
                    "message": "Active practice quest does not match abort request.",
                });
            }
            if (body.statistics == null) {
                // QuestAbortRealRemote omits playStatistics when the player
                // declines recovery after a crash. History is optional here:
                // rejecting abandonment leaves the persisted quest active and
                // traps every later login in the same H400 recovery loop.
                console.warn(`[PRACTICE-HISTORY] abort history skipped because statistics are unavailable: `
                    + `player=${playerId} quest=${abortQuest.questId}`);
            }
            else if (abortQuest.startedAtMs === undefined) {
                console.warn(`[PRACTICE-HISTORY] abort history skipped because start time is unavailable: `
                    + `player=${playerId} quest=${abortQuest.questId} play=${abortQuest.playId}`);
            }
            else {
                const abortedAtMs = (0, battle_clock_compatibility_1.getBattleClockDate)((_a = abortQuest.clockVersion) !== null && _a !== void 0 ? _a : 0).getTime();
                try {
                    practiceHistoryRecord = (0, practice_battle_history_2.buildPracticeBattleHistoryRecord)({
                        playerId,
                        playId: abortQuest.playId,
                        categoryId: abortQuest.category,
                        questId: abortQuest.questId,
                        finishKind: body.finish_kind,
                        createdAt: new Date(),
                        elapsedTimeMs: Math.max(0, abortedAtMs - abortQuest.startedAtMs),
                        score: null,
                        clearRank: null,
                        party: body.statistics.party,
                        statistics: body.statistics,
                        equipmentList: (0, equipment_1.getPlayerEquipmentListSync)(playerId),
                    });
                }
                catch (error) {
                    console.warn(`[PRACTICE-HISTORY] invalid abort history payload: player=${playerId} `
                        + `quest=${abortQuest.questId} error=${error.message}`);
                    // Invalid optional telemetry must not prevent leaving a
                    // matched battle. Keep strict history validation and omit
                    // the row instead of inventing damage/party data.
                }
            }
        }
        // Keep the failure transition, history row, and active-quest deletion
        // atomic so a partial settlement cannot erase the recoverable battle.
        const aborted = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "single-quest", playerId, operation: "abort",
        }, () => {
            var _a;
            const current = (0, quest_active_1.getPlayerActiveQuestSync)(playerId);
            if (!abortQuest || !current || current.playId !== abortQuest.playId || !(0, battle_clock_compatibility_1.isSupportedBattleClockVersion)(current.clockVersion))
                return false;
            if (abortQuest && !abortQuest.isMulti && (0, contract_1.isFiveBossGauntletQuest)(abortQuest.category, abortQuest.questId)) {
                (0, solo_runtime_1.abortFiveBossSoloSync)(playerId, abortQuest.playId);
            }
            if (abortQuest && (0, mode15_optional_1.isMode15Quest)(abortQuest.category, abortQuest.questId)) {
                (0, mode15_optional_1.settleMode15BattleSync)(playerId, abortQuest.category, abortQuest.questId, false);
            }
            if (practiceHistoryRecord !== null) {
                const now = (0, utils_1.getRealServerDate)();
                (0, practice_battle_history_1.insertPlayerPracticeBattleHistorySync)(Object.assign(Object.assign({}, practiceHistoryRecord), { create_time: (0, date_1.clientSerializeDate)(new Date(now.getTime() + 8 * 3600000)), elapsed_time_ms: Math.max(0, (0, battle_clock_compatibility_1.getBattleClockDate)((_a = current.clockVersion) !== null && _a !== void 0 ? _a : 0).getTime() - current.startedAtMs) }));
            }
            return (0, quest_active_1.deletePlayerActiveQuestIfPlayIdSync)(playerId, abortQuest.playId);
        });
        if (aborted && ((_b = exports.activeQuests[playerId]) === null || _b === void 0 ? void 0 : _b.playId) === (abortQuest === null || abortQuest === void 0 ? void 0 : abortQuest.playId))
            delete exports.activeQuests[playerId];
        if (aborted && abortQuest && (0, mode15_optional_1.isMode15Quest)(abortQuest.category, abortQuest.questId)) {
            console.log(`[MODE15] single battle aborted; run reset: player=${playerId} category=${abortQuest.category} quest=${abortQuest.questId}`);
        }
        return reply.status(200).send({
            "data_headers": headers,
            "data": {
                "user_info": {},
                "category_id": body.category,
                "is_multi": "single",
                "start_time": headers['servertime'],
                "quest_name": ""
            }
        });
    }));
    fastify.post("/start", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _c, _d;
        const body = request.body;
        const viewerId = body.viewer_id;
        const partyId = body.party_id;
        const questId = body.quest_id;
        const category = body.category;
        const useBoostPoint = body.use_boost_point;
        const useBossBoostPoint = body.use_boss_boost_point;
        const isAutoStartMode = body.is_auto_start_mode;
        if (isNaN(viewerId) || isNaN(partyId) || isNaN(questId) || isNaN(category) || (0, single_finish_identity_1.singleFinishPlayId)(body.play_id) === null || useBoostPoint === undefined || useBossBoostPoint === undefined || isAutoStartMode === undefined)
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        const sessionResult = yield (0, session_validator_1.validateSessionAndPlayer)(viewerId);
        if (!sessionResult)
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid viewer id."
            });
        const { playerId, playerData: player } = sessionResult;
        const rivenPartyCategory = category === types_1.QuestCategory.CARNIVAL_EVENT ? types_2.PartyCategory.CARNIVAL
            : category === types_1.QuestCategory.RAID_EVENT ? types_2.PartyCategory.RAID
                : category === types_1.QuestCategory.RUSH_EVENT ? (0, rush_party_categories_1.partyCategoryForRushEvent)(Math.floor(Number(questId) / 1000))
                    : types_2.PartyCategory.NORMAL;
        if ((0, abyss_time_revision_1.isStaleAbyssClient)(category, questId, request.headers.res_ver)
            || !(0, abyss_tower_progress_1.canStartAbyssQuestSync)(playerId, category, questId)) {
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId, asset_update: true, result_code: 4050 }),
                data: {},
            });
        }
        if (!(0, mode15_optional_1.isMode15EquipmentAllowedQuest)(category, questId)) {
            // Carnival quests use their own saved party category.  Looking up
            // NORMAL here allowed Mode15-exclusive equipment in Carnival even
            // though the selected Carnival party actually contained it.
            const partyCategory = category === types_1.QuestCategory.CARNIVAL_EVENT
                ? types_2.PartyCategory.CARNIVAL
                : category === types_1.QuestCategory.RUSH_EVENT
                    ? (0, rush_party_categories_1.partyCategoryForRushEvent)(Math.floor(Number(questId) / 1000))
                    : types_2.PartyCategory.NORMAL;
            const restricted = (0, mode15_optional_1.getMode15ExclusiveGlobalPartyItemsSync)(playerId, partyCategory, partyId);
            if (restricted.length > 0) {
                console.log(`[MODE15] exclusive equipment denied in single battle: player=${playerId} quest=${questId} questCategory=${category} partyCategory=${partyCategory} party=${partyId} items=${restricted.join(",")}`);
                reply.header("content-type", "application/x-msgpack");
                return reply.status(200).send({
                    // Quest-start clients natively map 4050 to their normal
                    // "out of period" rejection dialog.  4507 belongs to
                    // create-room failure and causes a fatal client error
                    // when returned from questStart.
                    data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId, result_code: 4050 }),
                    data: {},
                });
            }
        }
        if ((0, contract_1.isFiveBossHiddenQuest)(category, questId)) {
            return reply.status(400).send({ error: "Bad Request", message: "Internal five-boss scene is not an entry quest." });
        }
        // get quest data
        const questData = (0, assets_1.getQuestFromCategorySync)(category, questId);
        if (questData === null || !('rankPointReward' in questData)) {
            console.warn(`[BATTLE] start failed: category=${category} questId=${questId} found=${!!questData} hasRankReward=${questData ? ('rankPointReward' in questData) : 'N/A'}`);
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Quest doesn't exist."
            });
        }
        const checkTowerDungeonStartEligibilitySync = (nowDate) => {
            const startTimeMs = typeof questData.startTime === "string"
                ? Date.parse(`${questData.startTime.replace(" ", "T")}+08:00`)
                : NaN;
            const endTimeMs = typeof questData.endTime === "string"
                ? Date.parse(`${questData.endTime.replace(" ", "T")}+08:00`)
                : NaN;
            const nowMs = Math.floor(nowDate.getTime() / 1000) * 1000;
            if (!Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs) || nowMs < startTimeMs || nowMs > endTimeMs) {
                return false;
            }
            const selfProgress = (0, quest_1.getPlayerSingleQuestProgressSync)(playerId, category, questId);
            if ((selfProgress === null || selfProgress === void 0 ? void 0 : selfProgress.finished) === true) {
                return false;
            }
            const stage = typeof questData.stage === "number"
                ? questData.stage
                : (((questId - 1) % 10) + 1);
            if (stage > 1) {
                const prevProgress = (0, quest_1.getPlayerSingleQuestProgressSync)(playerId, category, questId - 1);
                if ((prevProgress === null || prevProgress === void 0 ? void 0 : prevProgress.finished) !== true) {
                    return false;
                }
            }
            return true;
        };
        const sendTowerDungeonStartUnavailable = () => {
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                data_headers: (0, utils_1.generateDataHeaders)({
                    viewer_id: viewerId,
                    result_code: 4050,
                }),
                data: {},
            });
        };
        if (category === types_1.QuestCategory.TOWER_DUNGEON_EVENT
            && !checkTowerDungeonStartEligibilitySync(new Date((0, utils_1.getServerTime)() * 1000))) {
            return sendTowerDungeonStartUnavailable();
        }
        if ((0, contract_1.isFiveBossGauntletQuest)(category, questId)) {
            const previousMemory = exports.activeQuests[playerId];
            let insertedMemory;
            let mission;
            try {
                yield (0, persistence_coordinator_1.runPersistenceTransaction)({ domain: "single-quest", playerId, operation: "five_boss_solo_start" }, () => {
                    (0, battle_settlement_ledger_1.assertBattleCanStartSync)(playerId, body.play_id);
                    return (0, solo_runtime_1.startFiveBossSoloSync)(playerId, body.play_id, () => {
                        insertActiveQuest(playerId, {
                            questId, category, useBoostPoint: false, useBossBoostPoint: false,
                            isAutoStartMode, isMulti: false,
                            entryItemId: contract_1.FIVE_BOSS_GAUNTLET.ticketItemId,
                            partySlot: partyId,
                            playId: body.play_id, continueCount: 0,
                        });
                        insertedMemory = exports.activeQuests[playerId];
                        if ((0, party_current_slot_1.usesNormalCurrentPartySlot)(category)
                            && (0, party_1.isValidNormalPartySlotSync)(playerId, partyId)) {
                            (0, player_1.updatePlayerSync)({ id: playerId, partySlot: partyId });
                        }
                        (0, active_entry_facts_1.recordActiveMissionQuestChallengeFactSync)(playerId, category);
                        mission = (0, mission_1.settleMissionCategories)(playerId, [1, 2, 10], new Date((0, utils_1.getServerTime)() * 1000));
                        return true;
                    }, partyId);
                });
            }
            catch (error) {
                if (insertedMemory && exports.activeQuests[playerId] === insertedMemory) {
                    if (previousMemory)
                        exports.activeQuests[playerId] = previousMemory;
                    else
                        delete exports.activeQuests[playerId];
                }
                if ((0, entry_response_1.isFiveBossTicketShortage)(error))
                    return (0, entry_response_1.sendFiveBossTicketShortage)(reply, viewerId);
                return reply.status(400).send({ error: "Bad Request", message: error.message });
            }
            const latest = (0, player_1.getPlayerSync)(playerId);
            const headers = (0, utils_1.generateDataHeaders)({ viewer_id: viewerId });
            const data = {
                user_info: { last_main_quest_id: questId, stamina: latest.stamina,
                    stamina_heal_time: (0, utils_1.realToVirtual)(latest.staminaHealTime) },
                item_list: { [contract_1.FIVE_BOSS_GAUNTLET.ticketItemId]: (_c = (0, item_1.getPlayerItemSync)(playerId, contract_1.FIVE_BOSS_GAUNTLET.ticketItemId)) !== null && _c !== void 0 ? _c : 0 },
                category_id: category, is_multi: "single", start_time: headers.servertime,
                quest_name: "", client_checks: (0, steam_robot_challenge_1.getSteamRobotMissionClientChecks)(category, questId),
                mail_arrived: (0, mail_1.getPlayerMailCountSync)(playerId, true) > 0,
            };
            // The five-boss transaction rechecks before freezing. Return the saved
            // selection too, so historical multi-riven parties refresh on the client.
            const parsedParty = (0, special_event_parties_1.parseGlobalPartyId)(partyId);
            if (parsedParty)
                data.party_info_list = (0, weapon_riven_party_1.getWeaponRivenPartyInfoListSync)(playerId, [{ category: types_2.PartyCategory.NORMAL, group_id: parsedParty.groupId, slot: parsedParty.slot }]);
            yield (0, party_refresh_1.refreshWeaponRivenPartiesAfterCommit)(playerId, data.party_info_list);
            data.party_info_list = (0, client_1.projectWeaponRivenClientResponse)(data.party_info_list, (0, client_admission_1.hasWeaponRivenCapability)(request));
            if (mission)
                (0, mission_1.mergeMissionSettlementResponse)(data, mission, viewerId);
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({ data_headers: headers, data });
        }
        // Deduct entry cost (ticket/item)
        const questKey = `${category}_${questId}`;
        const configuredEntryCost = quest_entry_costs_json_1.default[questKey];
        let entryCost;
        const staminaInfo = (0, stamina_cost_1.getStaminaCost)(questKey);
        const towerNominalStamina = (category === types_1.QuestCategory.TOWER_DUNGEON_EVENT && typeof questData.staminaCost === "number")
            ? questData.staminaCost
            : 0;
        const nominalStaminaCost = Math.max(0, staminaInfo.cost > 0 ? staminaInfo.cost : towerNominalStamina);
        (0, game_logging_1.gameVerboseLog)(() => `[BATTLE] start free-entry: questId=${questId} questKey=${questKey} nominalEntryCost=${JSON.stringify(configuredEntryCost)} nominalStamina=${nominalStaminaCost}`);
        if (entryCost && entryCost.itemId > 0) {
            const playerItemCount = (_d = (0, item_1.getPlayerItemSync)(playerId, entryCost.itemId)) !== null && _d !== void 0 ? _d : 0;
            (0, game_logging_1.gameVerboseLog)(() => `[BATTLE] start deduct: itemId=${entryCost.itemId} playerHas=${playerItemCount} need=${entryCost.itemCount}`);
            if (playerItemCount < entryCost.itemCount) {
                return reply.status(400).send({
                    "error": "Bad Request",
                    "message": `Not enough entry items (need ${entryCost.itemCount} of ${entryCost.itemId}, have ${playerItemCount}).`
                });
            }
        }
        // Deduct stamina cost
        const staminaCost = 0;
        if (staminaCost > 0) {
            const currentStamina = (0, stamina_1.computeRealTimeStamina)(player);
            if (currentStamina < staminaCost) {
                console.warn(`[BATTLE-START] player ${playerId} stamina insufficient: ${currentStamina} < ${staminaCost}`);
                return reply.status(400).send({
                    "error": "Bad Request",
                    "message": "Insufficient stamina."
                });
            }
        }
        const previousMemory = exports.activeQuests[playerId];
        const activeQuest = {
            questId: questId,
            category: category,
            useBoostPoint: useBoostPoint,
            useBossBoostPoint: useBossBoostPoint,
            isAutoStartMode: isAutoStartMode,
            isMulti: false,
            entryItemId: entryCost === null || entryCost === void 0 ? void 0 : entryCost.itemId,
            partySlot: questData.fixedParty === undefined ? partyId : undefined,
            playId: body.play_id,
            continueCount: 0,
            startedAtMs: (0, utils_1.getRealServerDate)().getTime(),
            clockVersion: 1,
        };
        let afterStamina = 0;
        let registeredMemory;
        let missionSettlement;
        let correctedRivenParties = [];
        try {
            yield (0, persistence_coordinator_1.runPersistenceTransaction)({
                domain: "single-quest", playerId, operation: "start",
            }, () => {
                var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
                (0, battle_settlement_ledger_1.assertBattleCanStartSync)(playerId, body.play_id);
                const currentPlayer = (_a = (0, player_1.getPlayerSync)(playerId)) !== null && _a !== void 0 ? _a : player;
                if (questData.fixedParty === undefined) {
                    correctedRivenParties = (0, weapon_riven_party_1.enforceWeaponRivenPartyLimitSync)(playerId, partyId, rivenPartyCategory);
                    const parsed = (0, special_event_parties_1.parseGlobalPartyId)(partyId);
                    if (correctedRivenParties.length === 0 && parsed) {
                        const current = (0, weapon_riven_party_1.getWeaponRivenPartyInfoListSync)(playerId,
                            [{ category: rivenPartyCategory, group_id: parsed.groupId, slot: parsed.slot }]);
                        // Over-limit repairs strip every revealed card, so a stale cache may still hold two.
                        if (current.some(party => party.ability_soul_ids.some(constants_1.isWeaponRivenItemId))
                            || (0, weapon_riven_party_1.playerHasWeaponRivensSync)(playerId))
                            correctedRivenParties = current;
                    }
                }
                const pending = (0, quest_active_1.getPlayerActiveQuestSync)(playerId);
                if ((pending === null || pending === void 0 ? void 0 : pending.playId) === body.play_id) {
                    if (pending.isMulti || pending.category !== category || pending.questId !== questId
                        || pending.useBoostPoint !== useBoostPoint || pending.useBossBoostPoint !== useBossBoostPoint
                        || pending.isAutoStartMode !== isAutoStartMode
                        || (questData.fixedParty === undefined && pending.partySlot !== partyId)) {
                        throw new Error("Battle start does not match the pending play.");
                    }
                    // Same-play HTTP retries keep their original clock, fees,
                    // challenge facts and continuation counters unchanged.
                    afterStamina = currentPlayer.stamina;
                    return;
                }
                if (category === types_1.QuestCategory.TOWER_DUNGEON_EVENT
                    && !checkTowerDungeonStartEligibilitySync(new Date((0, utils_1.getServerTime)() * 1000))) {
                    const deniedError = new Error("Tower dungeon quest is not available.");
                    deniedError.code = "TOWER_DUNGEON_START_DENIED";
                    throw deniedError;
                }
                const startedAtMs = (0, utils_1.getRealServerDate)().getTime();
                activeQuest.startedAtMs = startedAtMs;
                if (entryCost && entryCost.itemId > 0) {
                    const playerItemCount = (_b = (0, item_1.getPlayerItemSync)(playerId, entryCost.itemId)) !== null && _b !== void 0 ? _b : 0;
                    if (playerItemCount < entryCost.itemCount) {
                        throw new Error(`Not enough entry items (need ${entryCost.itemCount} of ${entryCost.itemId}, have ${playerItemCount}).`);
                    }
                    (0, item_1.updatePlayerItemSync)(playerId, entryCost.itemId, playerItemCount - entryCost.itemCount);
                }
                const playerUpdate = {
                    id: playerId,
                    totalStaminaUsed: ((_c = currentPlayer.totalStaminaUsed) !== null && _c !== void 0 ? _c : 0) + nominalStaminaCost,
                };
                if (staminaCost > 0) {
                    const currentStamina = (0, stamina_1.computeRealTimeStamina)(currentPlayer);
                    if (currentStamina < staminaCost) {
                        throw new Error("Insufficient stamina.");
                    }
                    const newStamina = Math.max(0, currentStamina - staminaCost);
                    playerUpdate.stamina = newStamina;
                    playerUpdate.staminaHealTime = new Date();
                    playerUpdate.totalStaminaUsed = ((_d = currentPlayer.totalStaminaUsed) !== null && _d !== void 0 ? _d : 0) + staminaCost;
                    afterStamina = newStamina;
                    (0, game_logging_1.gameVerboseLog)(() => `[BATTLE-START] stamina: ${currentStamina} -> ${newStamina} (cost: ${staminaCost}, rate: ${staminaInfo.rate})`);
                }
                else {
                    afterStamina = (_e = currentPlayer.stamina) !== null && _e !== void 0 ? _e : 0;
                }
                if (questData.fixedParty === undefined
                    && (0, party_current_slot_1.usesNormalCurrentPartySlot)(category)
                    && (0, party_1.isValidNormalPartySlotSync)(playerId, partyId)) {
                    playerUpdate.partySlot = partyId;
                }
                (0, player_1.updatePlayerSync)(playerUpdate);
                exports.activeQuests[playerId] = activeQuest;
                registeredMemory = activeQuest;
                (0, quest_active_1.insertPlayerActiveQuestSync)(playerId, {
                    playerId,
                    playId: activeQuest.playId,
                    questId: activeQuest.questId,
                    category: activeQuest.category,
                    useBossBoostPoint: activeQuest.useBossBoostPoint,
                    useBoostPoint: activeQuest.useBoostPoint,
                    isAutoStartMode: activeQuest.isAutoStartMode,
                    isMulti: activeQuest.isMulti,
                    isMultiHost: (_f = activeQuest.isMultiHost) !== null && _f !== void 0 ? _f : false,
                    roomNumber: (_g = activeQuest.roomNumber) !== null && _g !== void 0 ? _g : null,
                    entryItemId: null,
                    eventId: (_h = activeQuest.eventId) !== null && _h !== void 0 ? _h : null,
                    continueCount: activeQuest.continueCount,
                    startedAtMs: (_j = activeQuest.startedAtMs) !== null && _j !== void 0 ? _j : null,
                    partySlot: (_k = activeQuest.partySlot) !== null && _k !== void 0 ? _k : null,
                });
                (0, active_entry_facts_1.recordActiveMissionQuestChallengeFactSync)(playerId, category);
                missionSettlement = (0, mission_1.settleMissionCategories)(playerId, [1, 2, 10], new Date((0, utils_1.getServerTime)() * 1000));
            });
        }
        catch (error) {
            if (registeredMemory && exports.activeQuests[playerId] === registeredMemory) {
                if (previousMemory)
                    exports.activeQuests[playerId] = previousMemory;
                else
                    delete exports.activeQuests[playerId];
            }
            const message = error instanceof Error ? error.message : String(error);
            const code = error === null || error === void 0 ? void 0 : error.code;
            if (code === "TOWER_DUNGEON_START_DENIED") {
                return sendTowerDungeonStartUnavailable();
            }
            if (code === "BATTLE_ALREADY_SETTLED" || code === "BATTLE_CLOCK_ABORTED"
                || message === "Battle start does not match the pending play."
                || message === "Insufficient stamina." || message.startsWith("Not enough entry items")) {
                return reply.status(400).send({ error: "Bad Request", message });
            }
            throw error;
        }
        const dataHeaders = (0, utils_1.generateDataHeaders)({
            viewer_id: viewerId
        });
        reply.header("content-type", "application/x-msgpack");
        const responseData = {
            "user_info": {
                "last_main_quest_id": body.quest_id,
                "stamina": afterStamina,
                "stamina_heal_time": (0, utils_1.realToVirtual)(new Date())
            },
            "item_list": {},
            "category_id": body.category,
            "is_multi": "single",
            "start_time": dataHeaders['servertime'],
            "quest_name": "",
            "client_checks": (0, steam_robot_challenge_1.getSteamRobotMissionClientChecks)(category, questId)
        };
        if (correctedRivenParties.length > 0) {
            responseData.party_info_list = (0, client_1.projectWeaponRivenClientResponse)(correctedRivenParties, (0, client_admission_1.hasWeaponRivenCapability)(request));
            yield (0, party_refresh_1.refreshWeaponRivenPartiesAfterCommit)(playerId, correctedRivenParties);
        }
        if (missionSettlement) {
            (0, mission_1.mergeMissionSettlementResponse)(responseData, missionSettlement, viewerId);
        }
        responseData.mail_arrived = (0, mail_1.getPlayerMailCountSync)(playerId, true) > 0;
        return reply.status(200).send({
            "data_headers": dataHeaders,
            "data": responseData,
        });
    }));
    fastify.route({
        method: ["GET", "POST"],
        url: "/play_continue",
        handler: (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
            var _e, _f, _g;
            // Some legacy builds submit this endpoint as GET, while newer builds
            // use POST. Normalize both forms so a revive is not treated as an
            // unknown route by the client.
            const raw = ((_e = (request.method === "GET" ? request.query : request.body)) !== null && _e !== void 0 ? _e : {});
            const viewerId = Number(raw.viewer_id);
            const questId = Number(raw.quest_id);
            const category = Number(raw.category);
            const playId = (_f = raw.play_id) !== null && _f !== void 0 ? _f : raw.paly_id;
            if (!Number.isSafeInteger(viewerId)
                || !Number.isSafeInteger(questId)
                || !Number.isSafeInteger(category))
                return reply.status(400).send({
                    "error": "Bad Request", "message": "Invalid request body."
                });
            const sessionResult = yield (0, session_validator_1.validateSessionAndPlayer)(viewerId);
            if (!sessionResult)
                return reply.status(400).send({
                    "error": "Bad Request", "message": "Invalid viewer id."
                });
            const { playerId, playerData: player } = sessionResult;
            if ((0, continue_runtime_1.isFiveBossContinueRequest)(playerId, category, questId, playId)) {
                try {
                    const data = yield (0, continue_runtime_1.continueFiveBoss)({ playerId, category, questId, playId,
                        isMulti: false, apiCount: raw.api_count, statistics: raw.statistics });
                    const recovered = (0, active_quest_resolver_1.resolveActiveQuest)({ playerId, hint: { category, quest_id: questId, play_id: playId },
                        memory: exports.activeQuests, allowRebuild: false });
                    if (recovered && recovered.quest.playId === playId)
                        recovered.quest.continueCount = data.continue_count;
                    reply.header("content-type", "application/x-msgpack");
                    return reply.status(200).send({ data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }), data });
                }
                catch (error) {
                    if (!(error instanceof continue_runtime_1.FiveBossContinueError))
                        throw error;
                    if (error.stale) {
                        // The solo run already ended; a 400 here makes the CN
                        // client show a fatal H400 and drop to login. Acknowledge
                        // without charging so the client can leave the battle.
                        (0, game_logging_1.gameVerboseLog)(() => `[MULTI] play_continue: stale ack viewer=${viewerId}`
                            + ` quest=${questId} reason=${error.message}`);
                        reply.header("content-type", "application/x-msgpack");
                        return reply.status(200).send({
                            data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
                            data: (0, continue_runtime_1.fiveBossContinueAcknowledgement)(playerId),
                        });
                    }
                    return reply.status(400).send({ error: "Bad Request", message: error.message });
                }
            }
            const configured_continue_runtime = require("../../lib/continue-runtime");
            let configured_continue_active_quest;
            if ((0, configured_continue_runtime.isConfiguredContinueRequest)(playerId, questId)) {
                try {
                    const data = yield (0, configured_continue_runtime.continueConfiguredQuest)({ playerId, isMulti: false,
                        category, questId, playId, apiCount: raw.api_count, statistics: raw.statistics });
                    if (((configured_continue_active_quest = exports.activeQuests[playerId]) === null || configured_continue_active_quest === void 0 ? void 0 : configured_continue_active_quest.playId) === playId)
                        exports.activeQuests[playerId].continueCount = data.continue_count;
                    reply.header("content-type", "application/x-msgpack");
                    return reply.status(200).send({ data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }), data });
                }
                catch (error) {
                    if (!(error instanceof configured_continue_runtime.ContinuePaymentError))
                        throw error;
                    return reply.status(400).send({ error: "Bad Request", message: error.message });
                }
            }
            // Continue may recover a persisted battle after a restart, but never
            // rebuild one from request data: doing so would create a new revive path.
            const resolvedContinueQuest = (0, active_quest_resolver_1.resolveActiveQuest)({
                playerId,
                hint: {
                    quest_id: questId,
                    category,
                    play_id: playId,
                },
                memory: exports.activeQuests,
                allowRebuild: false,
            });
            const activeQuestData = resolvedContinueQuest === null || resolvedContinueQuest === void 0 ? void 0 : resolvedContinueQuest.quest;
            if (activeQuestData === undefined)
                return reply.status(400).send({
                    "error": "Bad Request",
                    "message": "No active quest to continue."
                });
            const continued = yield (0, persistence_coordinator_1.runPersistenceTransaction)({ domain: "single-quest", playerId, operation: "continue" }, () => {
                const current = (0, quest_active_1.getPlayerActiveQuestSync)(playerId);
                const freshPlayer = (0, player_1.getPlayerSync)(playerId);
                if (!current || !freshPlayer || !(0, battle_clock_compatibility_1.isSupportedBattleClockVersion)(current.clockVersion) || current.isMulti
                    || current.playId !== activeQuestData.playId || (playId && playId !== current.playId)
                    || current.questId !== questId || current.category !== category) {
                    return { ok: false, message: "No matching active quest to continue." };
                }
                if (category === types_1.QuestCategory.TOWER_DUNGEON_EVENT) {
                    const continueQuestData = (0, assets_1.getQuestFromCategorySync)(category, questId);
                    const maxContinueCount = typeof (continueQuestData === null || continueQuestData === void 0 ? void 0 : continueQuestData.maxContinueCount) === "number"
                        ? continueQuestData.maxContinueCount
                        : 1;
                    if (current.continueCount >= maxContinueCount) {
                        return { ok: false, message: "Battle continue limit reached." };
                    }
                }
                const freeCost = Math.min(freshPlayer.freeVmoney, continueVmoneyCost);
                const paidCost = continueVmoneyCost - freeCost;
                if (freshPlayer.vmoney < paidCost)
                    return { ok: false, message: "Not enough vmoney to continue" };
                const newFreeVmoney = freshPlayer.freeVmoney - freeCost;
                const newVmoney = freshPlayer.vmoney - paidCost;
                const continueCount = current.continueCount + 1;
                (0, player_1.updatePlayerSync)({ id: playerId, freeVmoney: newFreeVmoney, vmoney: newVmoney });
                if (!(0, quest_active_1.updatePlayerActiveQuestContinueCountIfPlayIdSync)(playerId, current.playId, continueCount))
                    throw new Error("Active play changed during continue.");
                return { ok: true, newFreeVmoney, newVmoney, continueCount };
            });
            if (!continued.ok)
                return reply.status(400).send({ error: "Bad Request", message: continued.message });
            const { newFreeVmoney, newVmoney } = continued;
            if (((_g = exports.activeQuests[playerId]) === null || _g === void 0 ? void 0 : _g.playId) === activeQuestData.playId)
                exports.activeQuests[playerId].continueCount = continued.continueCount;
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                "data_headers": (0, utils_1.generateDataHeaders)({
                    viewer_id: viewerId
                }),
                "data": {
                    "user_info": {
                        "free_vmoney": newFreeVmoney,
                        "vmoney": newVmoney
                    },
                    "mail_arrived": false
                }
            });
        })
    });
});
exports.default = routes;
