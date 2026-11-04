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
exports.registerBattleRoutes = void 0;
const player_time_compat_1 = require("../../lib/player-time-compat");
const entry_response_1 = require("../five-boss/entry-response");
const continue_runtime_1 = require("../five-boss/continue-runtime");
const active_quest_resolver_1 = require("../../lib/quest/finish/active-quest-resolver");
const contract_1 = require("../five-boss/contract");
const five_boss_battle_1 = require("./five-boss-battle");
const utils_1 = require("../../utils");
const singleBattleQuest_1 = require("../../routes/api/singleBattleQuest");
const quest_active_1 = require("../../data/domains/quest_active");
const player_1 = require("../../data/domains/player");
const stamina_1 = require("../../lib/stamina");
const stamina_cost_1 = require("../../lib/stamina-cost");
const assets_1 = require("../../lib/assets");
const steam_robot_challenge_1 = require("../../lib/mission/steam-robot-challenge");
const game_logging_1 = require("../../lib/game-logging");
const mail_1 = require("../../data/domains/mail");
const follow_1 = require("../../lib/follow");
const settlement_1 = require("../settlement");
const settlement_performance_1 = require("../../lib/settlement-performance");
const finish_response_cache_1 = require("../../lib/finish-response-cache");
const mode15_optional_1 = require("../../lib/mode15-optional");
const player_party_pool_1 = require("../npc/player-party-pool");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const command_names_1 = require("../../lib/persistence/command-names");
const battle_settlement_ledger_1 = require("../../data/domains/battle-settlement-ledger");
const multi_finish_identity_1 = require("../../lib/quest/finish/multi-finish-identity");
const settlement_snapshot_1 = require("../settlement-snapshot");
const default_runtime_1 = require("../coordinator/default-runtime");
const node_perf_hooks_1 = require("node:perf_hooks");
const durable_owner_event_1 = require("../coordinator/durable-owner-event");
const player_context_1 = require("../player-context");
const command_protocol_1 = require("../coordinator/command-protocol");
const party_1 = require("../../data/domains/party");
const party_current_slot_1 = require("../../lib/party-current-slot");
function buildFinishFollowInfo(requesterPlayerId_1, viewerId_1, mateResults_1) {
    return __awaiter(this, arguments, void 0, function* (requesterPlayerId, viewerId, mateResults, fallbackMateIds = []) {
        const ids = new Set();
        for (const result of mateResults) {
            const mateViewerId = Number(result === null || result === void 0 ? void 0 : result.viewer_id);
            if (Number.isFinite(mateViewerId))
                ids.add(mateViewerId);
        }
        for (const mateViewerId of fallbackMateIds) {
            if (Number.isFinite(mateViewerId))
                ids.add(Number(mateViewerId));
        }
        const followInfo = [];
        for (const mateViewerId of ids) {
            if (mateViewerId === viewerId || mateViewerId >= 900000000)
                continue;
            const mateCtx = yield (0, player_context_1.resolveMultiPlayerContext)(mateViewerId);
            if (!mateCtx)
                continue;
            const info = (0, follow_1.buildFollowUserInfoSync)(requesterPlayerId, mateCtx.playerId);
            if (info)
                followInfo.push(info);
        }
        return followInfo;
    });
}
function sendMultiStartUnavailable(reply, viewerId, reason) {
    console.warn(`[MULTI] start acknowledged as unavailable: viewer=${viewerId} reason=${reason}`);
    reply.header("content-type", "application/x-msgpack");
    return reply.status(200).send({
        data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId, result_code: 4050 }),
        data: {},
    });
}
function buildTerminalMultiFinishAcknowledgement(player, body) {
    var _a, _b;
    const dataHeaders = (0, utils_1.generateDataHeaders)({ viewer_id: body.viewer_id });
    return {
        data_headers: dataHeaders,
        data: {
            user_info: {
                free_mana: player.freeMana,
                exp_pool: player.expPool,
                exp_pooled_time: (0, player_time_compat_1.getPlayerClientExpTime)(player),
                free_vmoney: player.freeVmoney,
                rank_point: player.rankPoint,
                degree_id: (_a = player.degreeId) !== null && _a !== void 0 ? _a : 1,
                stamina: player.stamina,
                stamina_heal_time: (0, utils_1.realToVirtual)(player.staminaHealTime),
                boost_point: player.boostPoint,
                boss_boost_point: player.bossBoostPoint,
            },
            add_exp_list: [],
            character_list: [],
            bond_token_status_list: [],
            rewards: {
                overflow_pool_exp: 0,
                converted_pool_exp: 0,
                reward_pool_exp: 0,
                reward_mana: 0,
                field_mana: 0,
            },
            old_high_score: 0,
            joined_character_id_list: [],
            before_rank_point: player.rankPoint,
            clear_rank: 0,
            drop_score_reward_ids: [],
            drop_rare_reward_ids: [],
            drop_additional_reward_ids: [],
            drop_periodic_reward_ids: [],
            equipment_list: [],
            category_id: Number(body.category) || 0,
            start_time: dataHeaders.servertime,
            is_multi: "multi",
            quest_name: "",
            item_list: {},
            presigned_quest_category: [],
            mate_player_result: (_b = body.mate_player_result) !== null && _b !== void 0 ? _b : [],
            follow_info: [],
            contribution_score: Number(body.contribution_score) || 0,
            host_finished: false,
            aborted_play_id: null,
            unfinished_play_id: null,
            mail_arrived: (0, mail_1.getPlayerMailCountSync)(player.id, true) > 0,
        },
    };
}
function activeQuestFromPersistent(quest) {
    var _a, _b, _c, _d, _e, _f;
    return {
        questId: quest.questId,
        category: quest.category,
        useBossBoostPoint: quest.useBossBoostPoint,
        useBoostPoint: quest.useBoostPoint,
        isAutoStartMode: quest.isAutoStartMode,
        isMulti: quest.isMulti,
        isMultiHost: quest.isMultiHost,
        roomNumber: (_a = quest.roomNumber) !== null && _a !== void 0 ? _a : undefined,
        entryItemId: (_b = quest.entryItemId) !== null && _b !== void 0 ? _b : undefined,
        eventId: (_c = quest.eventId) !== null && _c !== void 0 ? _c : undefined,
        partySlot: (_d = quest.partySlot) !== null && _d !== void 0 ? _d : undefined,
        playId: quest.playId,
        continueCount: quest.continueCount,
        startedAtMs: (_e = quest.startedAtMs) !== null && _e !== void 0 ? _e : undefined,
        questTimeRevision: (_f = quest.questTimeRevision) !== null && _f !== void 0 ? _f : null,
        clockVersion: quest.clockVersion,
    };
}
function clearMatchingMultiActiveQuest(playerId, playId, operation) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        if (typeof playId !== "string" || playId.length === 0)
            return false;
        let deleted = false;
        yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "multi-settlement",
            playerId,
            operation,
        }, () => {
            const persisted = (0, quest_active_1.getPlayerActiveQuestSync)(playerId);
            if ((persisted === null || persisted === void 0 ? void 0 : persisted.isMulti) && persisted.playId === playId) {
                deleted = (0, quest_active_1.deletePlayerActiveQuestIfPlayIdSync)(playerId, playId);
            }
        });
        if (((_a = singleBattleQuest_1.activeQuests[playerId]) === null || _a === void 0 ? void 0 : _a.isMulti) && ((_b = singleBattleQuest_1.activeQuests[playerId]) === null || _b === void 0 ? void 0 : _b.playId) === playId) {
            delete singleBattleQuest_1.activeQuests[playerId];
            deleted = true;
        }
        return deleted;
    });
}
function registerBattleRoutes(fastify) {
    // ---- start ----
    fastify.post("/start", (request, reply) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const body = request.body;
        const { viewer_id, quest_id, category, party_id, use_boost_point, use_boss_boost_point, is_auto_start_mode, room_number, mate_player_ids, play_id } = body;
        (0, game_logging_1.gameVerboseLog)(() => `[MULTI] start: viewer=${viewer_id} quest=${quest_id} category=${category} party=${party_id} room=${room_number}`);
        if (isNaN(viewer_id) || isNaN(party_id) || isNaN(quest_id) || isNaN(category) || (0, multi_finish_identity_1.multiFinishPlayId)(play_id) === null || use_boost_point === undefined || use_boss_boost_point === undefined || is_auto_start_mode === undefined) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        }
        const ctx = yield (0, player_context_1.resolveMultiPlayerContext)(viewer_id);
        if (!ctx) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid viewer id or no player bound."
            });
        }
        // A rescue guest who already entered the room keeps the client-side
        // attention key, but the key's stopped-notice grace can expire during
        // a long lobby wait. Room membership is the stronger proof at this
        // point, so only validate the key for viewers who are not members yet.
        const attentionProjection = room_number ? yield (0, default_runtime_1.getRoomCommandGateway)().execute("battle.query", Object.assign({ roomNumber: room_number, viewerId: viewer_id }, (body.attention_key ? { attentionKey: body.attention_key } : {}))) : undefined;
        const alreadyRoomMember = (attentionProjection === null || attentionProjection === void 0 ? void 0 : attentionProjection.member) === true;
        if (body.attention_key
            && !alreadyRoomMember
            && !(attentionProjection === null || attentionProjection === void 0 ? void 0 : attentionProjection.attentionValid)) {
            return sendMultiStartUnavailable(reply, viewer_id, "attention_expired");
        }
        if ((0, contract_1.isFiveBossHiddenQuest)(category, quest_id)) {
            return reply.status(400).send({ error: "Bad Request", message: "Internal five-boss scene is not an entry quest." });
        }
        const questData = (0, assets_1.getQuestFromCategorySync)(category, quest_id);
        if (Number(category) === 20 || questData === null || !('rankPointReward' in questData)) {
            return sendMultiStartUnavailable(reply, viewer_id, Number(category) === 20 ? "tower_dungeon_single_only" : "quest_missing");
        }
        const prepareId = (0, command_protocol_1.createRoomCommandId)();
        const durableQuest = (0, quest_active_1.getPlayerActiveQuestSync)(ctx.playerId), durableSnapshot = (0, settlement_snapshot_1.getMultiSettlementSnapshot)(ctx.playerId, play_id);
        const durableStart = (durableQuest === null || durableQuest === void 0 ? void 0 : durableQuest.isMulti) && durableQuest.playId === play_id && durableQuest.roomNumber === room_number
            && durableQuest.category === category && durableQuest.questId === quest_id
            && (durableSnapshot === null || durableSnapshot === void 0 ? void 0 : durableSnapshot.lifecycle) === "BATTLE" && durableSnapshot.roomInstanceId
            && durableSnapshot.viewerId === viewer_id && durableSnapshot.roomNumber === room_number
            ? { roomInstanceId: durableSnapshot.roomInstanceId, battleSessionId: durableSnapshot.battleInstanceId,
                playId: play_id, playerId: ctx.playerId, viewerId: viewer_id } : undefined;
        let roomStart;
        try {
            roomStart = (yield (0, default_runtime_1.getRoomCommandGateway)().execute("battle.start.prepare", Object.assign({ body, playerId: ctx.playerId, fixedParty: questData.fixedParty !== undefined }, (durableStart ? { durableStart } : {})), { commandId: prepareId }));
        }
        catch (error) {
            // No persistence callback has run. Cancel this exact attempt, including a delayed Prepare.
            try {
                yield (0, default_runtime_1.getRoomCommandGateway)().execute("battle.start.cancelAttempt", {
                    prepareId, roomNumber: room_number, viewerId: viewer_id, playerId: ctx.playerId, playId: play_id,
                });
            }
            catch (cancelError) {
                console.error("[MULTI] prepare cancellation unresolved", cancelError);
            }
            throw error;
        }
        if (roomStart.status === "forbidden") {
            return reply.status(403).send({
                error: "Forbidden",
                message: "Room permission denied.",
            });
        }
        if (roomStart.status === "player_mismatch") {
            return reply.status(400).send({
                error: "Bad Request",
                message: "Room player mismatch.",
            });
        }
        if (roomStart.status === "missing"
            || roomStart.status === "unavailable"
            || roomStart.status === "quest_mismatch") {
            return sendMultiStartUnavailable(reply, viewer_id, roomStart.status);
        }
        // The host's first successful settlement advances Mode15 immediately.
        // A legacy client may keep the old room and request another battle, so
        // validate the room owner again at the final HTTP start boundary.
        if (roomStart.status === "mode15_closed") {
            console.log(`[MODE15] multi start denied: completed host room=${room_number} host=${roomStart.room.host_player_id}`);
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id, result_code: 4507 }),
                "data": {},
            });
        }
        if ((0, five_boss_battle_1.shouldHandleFiveBossStart)(body)) {
            try {
                return yield (0, five_boss_battle_1.handleFiveBossStart)(body, ctx.playerId, reply);
            }
            catch (error) {
                if (!(0, five_boss_battle_1.isFiveBossBattleRequestError)(error))
                    throw error;
                (0, five_boss_battle_1.logFiveBossRequestFailure)("start", body, ctx.playerId, error);
                if ((0, entry_response_1.isFiveBossTicketShortage)(error))
                    return (0, entry_response_1.sendFiveBossTicketShortage)(reply, viewer_id);
                return sendMultiStartUnavailable(reply, viewer_id, `five_boss_${(_a = error.code) !== null && _a !== void 0 ? _a : "rejected"}`);
            }
        }
        const mateComIds = roomStart.mateComIds;
        const activeQuest = {
            questId: quest_id,
            category,
            useBoostPoint: use_boost_point,
            useBossBoostPoint: use_boss_boost_point,
            isAutoStartMode: is_auto_start_mode,
            isMulti: true,
            isMultiHost: roomStart.isHost,
            roomNumber: room_number,
            matePlayerIds: mate_player_ids,
            mateComIds,
            partySlot: party_id,
            playId: play_id,
            continueCount: 0,
        };
        // The active quest is part of the same durable start command as the
        // selected party. Keeping this write outside the coordinator lets a
        // busy settlement or checkpoint race it and surface SQLITE_BUSY on
        // /multi_battle_quest/start.
        let previousActiveQuest, insertedActiveQuest;
        let repeatedPendingStart = false;
        // 作者 1104：协力开战扣体力。房主全扣；协力者看和房主的关注关系：互相关注不扣，单向关注扣一半（向上取整），没关注全扣
        const fullStaminaCost = (0, stamina_cost_1.getStaminaCost)(`${category}_${quest_id}`).cost;
        let hostStaminaCost = fullStaminaCost;
        if (!roomStart.isHost && fullStaminaCost > 0) {
            const hostPlayerId = roomStart.room === null || roomStart.room === void 0 ? void 0 : roomStart.room.host_player_id;
            const relation = hostPlayerId ? require("../../data/domains/follow").getFollowRelationSync(ctx.playerId, Number(hostPlayerId)).state : 0;
            hostStaminaCost = relation === 1 ? 0 : (relation === 2 || relation === 3) ? Math.ceil(fullStaminaCost / 2) : fullStaminaCost;
        }
        let hostStaminaAfter;
        let rivenParties = [];
        const startDeadline = node_perf_hooks_1.performance.now() + Math.max(0, roomStart.remainingMs - 100);
        try {
            yield (0, persistence_coordinator_1.runPersistenceTransaction)({
                domain: "multi-settlement", playerId: ctx.playerId, operation: "start",
            }, () => {
                var _a;
                if (node_perf_hooks_1.performance.now() >= startDeadline)
                    throw new Error("START_CLAIM_EXPIRED");
                (0, default_runtime_1.assertRealtimeOwnerEpoch)(roomStart.ownerEpoch, (_a = roomStart.claimToken) !== null && _a !== void 0 ? _a : undefined, true);
                (0, battle_settlement_ledger_1.assertBattleCanStartSync)(ctx.playerId, play_id);
                previousActiveQuest = singleBattleQuest_1.activeQuests[ctx.playerId];
                const pending = (0, quest_active_1.getPlayerActiveQuestSync)(ctx.playerId);
                if ((pending === null || pending === void 0 ? void 0 : pending.playId) === play_id) {
                    if (!pending.isMulti || pending.category !== category || pending.questId !== quest_id
                        || pending.roomNumber !== room_number || pending.useBoostPoint !== use_boost_point
                        || pending.useBossBoostPoint !== use_boss_boost_point || pending.isAutoStartMode !== is_auto_start_mode
                        || (questData.fixedParty === undefined && pending.partySlot !== party_id)) {
                        throw new Error("Battle start does not match the pending play.");
                    }
                    Object.assign(activeQuest, activeQuestFromPersistent(pending));
                    repeatedPendingStart = true;
                    return;
                }
                if (hostStaminaCost > 0) {
                    const hostPlayer = (0, player_1.getPlayerSync)(ctx.playerId);
                    const currentStamina = (0, stamina_1.computeRealTimeStamina)(hostPlayer);
                    if (currentStamina < hostStaminaCost)
                        throw new Error("Insufficient stamina.");
                    hostStaminaAfter = currentStamina - hostStaminaCost;
                    (0, player_1.updatePlayerSync)({ id: ctx.playerId, stamina: hostStaminaAfter, staminaHealTime: new Date(),
                        totalStaminaUsed: (hostPlayer.totalStaminaUsed || 0) + hostStaminaCost });
                }
                (0, singleBattleQuest_1.insertActiveQuest)(ctx.playerId, activeQuest);
                insertedActiveQuest = singleBattleQuest_1.activeQuests[ctx.playerId];
                if (questData.fixedParty === undefined
                    && (0, party_current_slot_1.usesNormalCurrentPartySlot)(category)
                    && (0, party_1.isValidNormalPartySlotSync)(ctx.playerId, party_id)) {
                    (0, player_1.updatePlayerSync)({ id: ctx.playerId, partySlot: party_id });
                }
                // Room readiness already repaired the saved party; return it so the client's
                // own party cache drops cards that the over-limit rule stripped.
                if (questData.fixedParty === undefined && (0, party_current_slot_1.usesNormalCurrentPartySlot)(category)) {
                    rivenParties = require("../../data/domains/weapon-riven-party")
                        .enforceWeaponRivenStartPartiesSync(ctx.playerId, require("../../data/types").PartyCategory.NORMAL, [party_id]);
                }
            });
        }
        catch (error) {
            if (insertedActiveQuest && singleBattleQuest_1.activeQuests[ctx.playerId] === insertedActiveQuest) {
                if (previousActiveQuest)
                    singleBattleQuest_1.activeQuests[ctx.playerId] = previousActiveQuest;
                else
                    delete singleBattleQuest_1.activeQuests[ctx.playerId];
            }
            try {
                yield (0, default_runtime_1.getRoomCommandGateway)().execute("battle.play.cancel", {
                    roomNumber: room_number, roomInstanceId: roomStart.roomInstanceId,
                    battleSessionId: roomStart.battleSessionId, viewerId: viewer_id,
                    playerId: ctx.playerId, playId: play_id,
                    claimToken: roomStart.claimToken,
                });
            }
            catch (cancelError) {
                console.error(`[MULTI] failed start claim cancellation: play=${play_id}`, cancelError);
            }
            const code = error === null || error === void 0 ? void 0 : error.code;
            if (code === "BATTLE_ALREADY_SETTLED" || code === "BATTLE_CLOCK_ABORTED"
                || error.message === "Battle start does not match the pending play."
                || error.message === "Insufficient stamina.") {
                return reply.status(400).send({ error: "Bad Request", message: error.message });
            }
            throw error;
        }
        if (!repeatedPendingStart || !(0, settlement_snapshot_1.getMultiSettlementSnapshot)(ctx.playerId, play_id))
            (0, settlement_snapshot_1.registerMultiSettlementSnapshot)({
                battleInstanceId: roomStart.battleSessionId,
                roomInstanceId: roomStart.roomInstanceId,
                playerId: ctx.playerId,
                viewerId: viewer_id,
                playId: play_id,
                roomNumber: room_number,
                roomGeneration: roomStart.roomGeneration,
                activeQuest,
                participants: roomStart.participants,
                expectedRealViewerIds: roomStart.expectedRealViewerIds,
                npcPartySnapshot: roomStart.npcPartySnapshot,
                isHost: roomStart.isHost,
                isRescueGuest: roomStart.isRescueGuest,
                isRescueFragmentEligible: roomStart.isRescueFragmentEligible,
                isNewbieRescueGuest: roomStart.isNewbieRescueGuest,
            });
        try {
            yield (0, durable_owner_event_1.publishDurableOwnerDecision)("battle.play.commit", {
                roomNumber: room_number, roomInstanceId: roomStart.roomInstanceId,
                battleSessionId: roomStart.battleSessionId, viewerId: viewer_id,
                playerId: ctx.playerId, playId: play_id,
                claimToken: roomStart.claimToken,
            });
        }
        catch (commitError) {
            // The active play already committed. Keep its durable identity and
            // reply; failure to publish state must not reclassify that write.
            console.error(`[MULTI] room play commit confirmation failed: play=${play_id}`, commitError);
        }
        const rivenPartyData = {};
        if (rivenParties.length > 0) {
            yield require("../../lib/weapon-riven/party-refresh").refreshWeaponRivenPartiesAfterCommit(ctx.playerId, rivenParties);
            rivenPartyData.party_info_list = require("../../lib/weapon-riven/client").projectWeaponRivenClientResponse(rivenParties, require("../../lib/client-admission").hasWeaponRivenCapability(request));
        }
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id }),
            "data": Object.assign({ "is_multi": "multi", "play_id": play_id, "client_checks": (0, steam_robot_challenge_1.getSteamRobotMissionClientChecks)(category, quest_id) }, rivenPartyData,
                hostStaminaAfter === undefined ? {} : { "user_info": { "stamina": hostStaminaAfter, "stamina_heal_time": (0, utils_1.realToVirtual)(new Date()) } })
        });
    }));
    // ---- finish ----
    fastify.post("/finish", (request, reply) => __awaiter(this, void 0, void 0, function* () {
        var _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x;
        const finishHandlerStartedAt = process.hrtime.bigint();
        const body = request.body;
        const viewerId = body.viewer_id;
        (0, game_logging_1.gameVerboseLog)(() => `[MULTI] finish: viewer=${viewerId} quest=${body.quest_id} category=${body.category} room=${body.room_number}`);
        if (!viewerId || isNaN(viewerId)) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        }
        const ctx = yield (0, player_context_1.resolveMultiPlayerContext)(viewerId);
        if (!ctx || !ctx.player) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid viewer id."
            });
        }
        const { playerId, player } = ctx;
        const playId = (0, multi_finish_identity_1.multiFinishPlayId)(body.play_id);
        if (playId === null)
            return reply.status(400).send({
                error: "Bad Request", message: "A multiplayer play id is required.",
            });
        // Check before the special-mode dispatch as well: changing the quest
        // category cannot route a generic settled play around its ledger.
        const initialReplay = (0, battle_settlement_ledger_1.getBattleReplaySync)(playerId, "multi", playId);
        if (initialReplay.kind !== "missing") {
            if (initialReplay.kind !== "available" || !(0, multi_finish_identity_1.isMultiFinishResponse)(initialReplay.response)) {
                return reply.status(400).send({ error: "Bad Request", message: "Battle result cannot be replayed. Please reload." });
            }
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send(initialReplay.response);
        }
        if ((0, five_boss_battle_1.shouldHandleFiveBossMemberRequest)(body, playerId)) {
            try {
                return yield (0, five_boss_battle_1.handleFiveBossFinish)(body, playerId, reply, (viewer, mates, fallback) => buildFinishFollowInfo(playerId, viewer, mates, fallback));
            }
            catch (error) {
                if (!(0, five_boss_battle_1.isFiveBossBattleRequestError)(error))
                    throw error;
                (0, five_boss_battle_1.logFiveBossRequestFailure)("finish", body, playerId, error);
                return reply.status(400).send({ error: "Bad Request", message: error.message });
            }
        }
        const finishCacheKey = (0, finish_response_cache_1.buildFinishResponseCacheKey)("multi", viewerId, body);
        const executionWaitStartedAt = process.hrtime.bigint();
        const releaseFinishExecution = yield (0, finish_response_cache_1.acquireFinishExecution)(`multi:${playerId}`);
        (0, settlement_performance_1.recordSettlementPhase)("multi", "finish_execution_wait", Number(process.hrtime.bigint() - executionWaitStartedAt) / 1000000);
        try {
            const replay = (0, battle_settlement_ledger_1.getBattleReplaySync)(playerId, "multi", playId);
            if (replay.kind !== "missing") {
                if (replay.kind !== "available" || !(0, multi_finish_identity_1.isMultiFinishResponse)(replay.response))
                    return reply.status(400).send({
                        error: "Bad Request", message: "Battle result cannot be replayed. Please reload.",
                    });
                reply.header("content-type", "application/x-msgpack");
                return reply.status(200).send(replay.response);
            }
            const settlementSnapshot = (0, settlement_snapshot_1.getMultiSettlementSnapshot)(playerId, body.play_id);
            const currentActiveQuest = singleBattleQuest_1.activeQuests[playerId];
            const persistentActiveQuest = (0, quest_active_1.getPlayerActiveQuestSync)(playerId);
            // A delayed finish from the previous generation must use its frozen
            // snapshot. Taking the current active quest first can settle or clear a
            // rematch that merely happens to belong to the same player.
            const persistentMatches = (persistentActiveQuest === null || persistentActiveQuest === void 0 ? void 0 : persistentActiveQuest.isMulti)
                && persistentActiveQuest.playId === body.play_id;
            const activeQuestData = (_b = settlementSnapshot === null || settlementSnapshot === void 0 ? void 0 : settlementSnapshot.activeQuest) !== null && _b !== void 0 ? _b : (persistentMatches
                ? activeQuestFromPersistent(persistentActiveQuest)
                : persistentActiveQuest === null
                    && (currentActiveQuest === null || currentActiveQuest === void 0 ? void 0 : currentActiveQuest.playId) === body.play_id
                    ? currentActiveQuest
                    : undefined);
            if (activeQuestData === undefined) {
                const terminal = buildTerminalMultiFinishAcknowledgement(player, body);
                (0, finish_response_cache_1.cacheFinishResponse)(finishCacheKey, terminal);
                console.warn(`[MULTI] stale finish acknowledged: viewer=${viewerId}`
                    + ` play=${body.play_id} reason=active_quest_missing`);
                reply.header("content-type", "application/x-msgpack");
                return reply.status(200).send(terminal);
            }
            if (!activeQuestData.isMulti || activeQuestData.playId !== playId
                || Number(body.quest_id) !== Number(activeQuestData.questId)
                || Number(body.category) !== Number(activeQuestData.category)) {
                return reply.status(400).send({ error: "Bad Request", message: "Finish does not match the multiplayer play." });
            }
            const finishProjection = activeQuestData.roomNumber ? yield (0, default_runtime_1.getRoomCommandGateway)().execute("battle.query", {
                roomNumber: activeQuestData.roomNumber, viewerId, playerId, playId,
            }) : undefined;
            const finishRoom = finishProjection === null || finishProjection === void 0 ? void 0 : finishProjection.room;
            const settlementGeneration = (_e = (_c = settlementSnapshot === null || settlementSnapshot === void 0 ? void 0 : settlementSnapshot.roomGeneration) !== null && _c !== void 0 ? _c : (_d = finishProjection === null || finishProjection === void 0 ? void 0 : finishProjection.binding) === null || _d === void 0 ? void 0 : _d.generation) !== null && _e !== void 0 ? _e : 0;
            const settlementKey = (_h = (_f = settlementSnapshot === null || settlementSnapshot === void 0 ? void 0 : settlementSnapshot.battleInstanceId) !== null && _f !== void 0 ? _f : (_g = finishProjection === null || finishProjection === void 0 ? void 0 : finishProjection.binding) === null || _g === void 0 ? void 0 : _g.battleSessionId) !== null && _h !== void 0 ? _h : `${activeQuestData.roomNumber || body.room_number || "missing"}:${settlementGeneration}:${body.play_id}`;
            const settlementParticipants = (_j = settlementSnapshot === null || settlementSnapshot === void 0 ? void 0 : settlementSnapshot.participants) !== null && _j !== void 0 ? _j : ((finishRoom === null || finishRoom === void 0 ? void 0 : finishRoom.mates) || [])
                .map(mate => ({
                viewerId: Number(mate.viewer_id),
                comId: Number(mate.com_id || 0),
            }))
                .filter(mate => Number.isFinite(mate.viewerId) && mate.viewerId > 0);
            const expectedRealViewerIds = (_k = settlementSnapshot === null || settlementSnapshot === void 0 ? void 0 : settlementSnapshot.expectedRealViewerIds) !== null && _k !== void 0 ? _k : ((finishRoom === null || finishRoom === void 0 ? void 0 : finishRoom.expected_real_viewer_ids) || [])
                .map(Number)
                .filter(expectedViewerId => Number.isFinite(expectedViewerId) && expectedViewerId > 0);
            const finishedAsRescueGuest = (_l = settlementSnapshot === null || settlementSnapshot === void 0 ? void 0 : settlementSnapshot.isRescueGuest) !== null && _l !== void 0 ? _l : (activeQuestData.roomNumber
                ? Boolean(finishProjection === null || finishProjection === void 0 ? void 0 : finishProjection.isRescueGuest)
                : false);
            const finishedAsRescueFragmentEligible = (_m = settlementSnapshot === null || settlementSnapshot === void 0 ? void 0 : settlementSnapshot.isRescueFragmentEligible) !== null && _m !== void 0 ? _m : (activeQuestData.roomNumber
                ? Boolean(finishProjection === null || finishProjection === void 0 ? void 0 : finishProjection.isRescueFragmentEligible)
                : false);
            const finishedAsNewbieRescueGuest = (_o = settlementSnapshot === null || settlementSnapshot === void 0 ? void 0 : settlementSnapshot.isNewbieRescueGuest) !== null && _o !== void 0 ? _o : (activeQuestData.roomNumber
                ? Boolean(finishProjection === null || finishProjection === void 0 ? void 0 : finishProjection.isNewbieRescueGuest)
                : false);
            const questCategory = activeQuestData.category;
            const questId = activeQuestData.questId;
            const questData = (0, assets_1.getQuestFromCategorySync)(questCategory, questId);
            const isTowerDungeonFinish = Number(questCategory) === 20 || Number(body.category) === 20;
            if (isTowerDungeonFinish || questData === null || !('rankPointReward' in questData)) {
                yield clearMatchingMultiActiveQuest(playerId, body.play_id, isTowerDungeonFinish ? "stale_finish_tower_dungeon_single_only" : "stale_finish_unknown_quest");
                const terminal = buildTerminalMultiFinishAcknowledgement(player, body);
                (0, finish_response_cache_1.cacheFinishResponse)(finishCacheKey, terminal);
                console.warn(`[MULTI] stale finish acknowledged: viewer=${viewerId}`
                    + ` play=${body.play_id} reason=${isTowerDungeonFinish ? "tower_dungeon_single_only" : "quest_missing"} category=${questCategory} quest=${questId}`);
                reply.header("content-type", "application/x-msgpack");
                return reply.status(200).send(terminal);
            }
            (0, settlement_performance_1.recordSettlementPhase)("multi", "preflight", Number(process.hrtime.bigint() - finishHandlerStartedAt) / 1000000);
            const coreStartedAt = process.hrtime.bigint();
            const finishedAsHost = (_p = settlementSnapshot === null || settlementSnapshot === void 0 ? void 0 : settlementSnapshot.isHost) !== null && _p !== void 0 ? _p : (activeQuestData.roomNumber
                ? (finishRoom === null || finishRoom === void 0 ? void 0 : finishRoom.host_player_id) === playerId
                : false);
            const questAccomplished = Boolean(body.is_accomplished);
            const rawMatePlayerResult = (body.mate_player_result || []);
            (0, settlement_performance_1.recordSettlementPhase)("multi", "core", Number(process.hrtime.bigint() - coreStartedAt) / 1000000);
            const settlementResult = yield (0, settlement_performance_1.measureSettlementPhaseAsync)("multi", "barrier", () => (0, settlement_1.mergeMultiSettlementResults)({
                key: settlementKey,
                viewerId,
                participants: settlementParticipants,
                expectedRealViewerIds,
                ownScore: body.score || 0,
                ownContributionScore: body.contribution_score || 0,
                mateResults: rawMatePlayerResult,
                // Preserve the original repaired 1.2-second compatibility
                // barrier.  mergeMultiSettlementResults still returns early as
                // soon as every real participant has submitted.
                waitMs: parseInt(process.env.MULTI_SETTLEMENT_BARRIER_MS || "1200", 10),
            }));
            const postBarrierStartedAt = process.hrtime.bigint();
            const matePlayerResult = settlementResult.mateResults;
            (0, game_logging_1.gameVerboseLog)(() => `[MULTI] settlement roster: room=${activeQuestData.roomNumber || body.room_number || "missing"} `
                + `generation=${settlementGeneration} viewer=${viewerId} `
                + `submitted=${settlementResult.submittedCount}/${settlementResult.expectedCount} `
                + `returned=${matePlayerResult.length} synthesized=${settlementResult.synthesizedViewerIds.join(",") || "none"}`);
            const followInfo = yield buildFinishFollowInfo(playerId, viewerId, matePlayerResult, activeQuestData.matePlayerIds || []);
            const settled = yield (0, settlement_performance_1.measureSettlementPhaseAsync)("multi", "transaction", () => ((0, persistence_coordinator_1.runWriterCommand)(command_names_1.MULTI_SETTLE_FINISH, {
                playerId, viewerId, body, questCategory, questId, questData, activeQuestData,
                allowFrozenSnapshot: settlementSnapshot !== undefined,
                playId, finishedAsHost, finishedAsRescueGuest, finishedAsRescueFragmentEligible,
                finishedAsNewbieRescueGuest, matePlayerResult, followInfo,
                // 开荒编排 19：房主奖励按房间里除房主外的真人数发紫碎
                hostRealMateCount: expectedRealViewerIds.filter(id => id !== Number(viewerId)).length,
                evaluationTimeMs: (0, utils_1.getServerTime)() * 1000,
            }, { domain: "multi-settlement", playerId, operation: "finish" })));
            if (settled.response === null) {
                return reply.status(400).send({ error: "Bad Request", message: "No unsettled multiplayer play." });
            }
            const finishResponse = settled.response;
            (0, finish_response_cache_1.cacheFinishResponse)(finishCacheKey, finishResponse);
            if (settled.applied) {
                const stillOwnSnapshot = (0, settlement_snapshot_1.getMultiSettlementSnapshot)(playerId, playId) === settlementSnapshot;
                if (stillOwnSnapshot)
                    (0, settlement_snapshot_1.transitionMultiSettlementSnapshot)(playerId, playId, "SETTLING");
                const committedRunId = (_q = settlementSnapshot === null || settlementSnapshot === void 0 ? void 0 : settlementSnapshot.battleInstanceId) !== null && _q !== void 0 ? _q : (_r = finishProjection === null || finishProjection === void 0 ? void 0 : finishProjection.binding) === null || _r === void 0 ? void 0 : _r.battleSessionId;
                const committedInstanceId = (_s = settlementSnapshot === null || settlementSnapshot === void 0 ? void 0 : settlementSnapshot.roomInstanceId) !== null && _s !== void 0 ? _s : (_t = finishProjection === null || finishProjection === void 0 ? void 0 : finishProjection.binding) === null || _t === void 0 ? void 0 : _t.roomInstanceId;
                if (activeQuestData.roomNumber && stillOwnSnapshot && committedRunId && committedInstanceId) {
                    try {
                        const roomResult = yield (0, durable_owner_event_1.publishDurableOwnerDecision)("battle.settlement.committed", {
                            roomNumber: activeQuestData.roomNumber,
                            roomInstanceId: committedInstanceId,
                            battleSessionId: committedRunId,
                            generation: settlementGeneration, viewerId, playerId, playId,
                            accomplished: questAccomplished,
                        });
                        if ((roomResult === null || roomResult === void 0 ? void 0 : roomResult.applied) && roomResult.snapshotPhase) {
                            (0, settlement_snapshot_1.transitionMultiSettlementSnapshot)(playerId, playId, roomResult.snapshotPhase);
                        }
                    }
                    catch (error) {
                        // Payment and its replayable response already committed.
                        console.error(`[MULTI] settlement return failed after commit: player=${playerId} play=${playId}`, error);
                    }
                }
            }
            if (settled.applied && questAccomplished) {
                try {
                    (0, player_party_pool_1.recordSuccessfulQuestNpcParty)(settlementSnapshot === null || settlementSnapshot === void 0 ? void 0 : settlementSnapshot.npcPartySnapshot);
                }
                catch (error) {
                    console.error(`[MULTI] NPC clear record failed after commit: player=${playerId} play=${playId}`, error);
                }
            }
            if ((0, settlement_snapshot_1.getMultiSettlementSnapshot)(playerId, playId) === settlementSnapshot) {
                (0, settlement_snapshot_1.transitionMultiSettlementSnapshot)(playerId, playId, "RETURN_PENDING");
            }
            // The database cleanup already committed with rewards and the receipt.
            if (((_u = singleBattleQuest_1.activeQuests[playerId]) === null || _u === void 0 ? void 0 : _u.isMulti) && ((_v = singleBattleQuest_1.activeQuests[playerId]) === null || _v === void 0 ? void 0 : _v.playId) === activeQuestData.playId
                && Number((_w = singleBattleQuest_1.activeQuests[playerId]) === null || _w === void 0 ? void 0 : _w.questId) === Number(questId)
                && Number((_x = singleBattleQuest_1.activeQuests[playerId]) === null || _x === void 0 ? void 0 : _x.category) === Number(questCategory)) {
                delete singleBattleQuest_1.activeQuests[playerId];
            }
            (0, settlement_performance_1.recordSettlementPhase)("multi", "post_barrier", Number(process.hrtime.bigint() - postBarrierStartedAt) / 1000000);
            const responseStartedAt = process.hrtime.bigint();
            let responseFlushRecorded = false;
            const recordResponseFlush = () => {
                if (responseFlushRecorded)
                    return;
                responseFlushRecorded = true;
                (0, settlement_performance_1.recordSettlementPhase)("multi", "response_flush", Number(process.hrtime.bigint() - responseStartedAt) / 1000000);
            };
            reply.raw.once("finish", recordResponseFlush);
            reply.raw.once("close", recordResponseFlush);
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send(finishResponse);
        }
        finally {
            releaseFinishExecution();
        }
    }));
    // ---- abort ----
    fastify.post("/abort", (request, reply) => __awaiter(this, void 0, void 0, function* () {
        var _y, _z, _0;
        const body = request.body;
        const viewerId = body.viewer_id;
        (0, game_logging_1.gameVerboseLog)(() => `[MULTI] abort: viewer=${viewerId} quest=${body.quest_id} category=${body.category}`);
        if (isNaN(viewerId)) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        }
        const ctx = yield (0, player_context_1.resolveMultiPlayerContext)(viewerId);
        if (!ctx) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid viewer id or no player bound."
            });
        }
        const { playerId, player } = ctx;
        if ((0, five_boss_battle_1.shouldHandleFiveBossMemberRequest)(body, playerId)) {
            try {
                return yield (0, five_boss_battle_1.handleFiveBossAbort)(body, playerId, reply);
            }
            catch (error) {
                if (!(0, five_boss_battle_1.isFiveBossBattleRequestError)(error))
                    throw error;
                (0, five_boss_battle_1.logFiveBossRequestFailure)("abort", body, playerId, error);
                return reply.status(400).send({ error: "Bad Request", message: error.message });
            }
        }
        const memoryActiveQuest = singleBattleQuest_1.activeQuests[playerId];
        const persistedActiveQuest = (0, quest_active_1.getPlayerActiveQuestSync)(playerId);
        const activeQuestData = (memoryActiveQuest === null || memoryActiveQuest === void 0 ? void 0 : memoryActiveQuest.isMulti)
            && memoryActiveQuest.playId === body.play_id
            ? memoryActiveQuest
            : (persistedActiveQuest === null || persistedActiveQuest === void 0 ? void 0 : persistedActiveQuest.isMulti)
                && persistedActiveQuest.playId === body.play_id
                ? activeQuestFromPersistent(persistedActiveQuest)
                : undefined;
        if (activeQuestData) {
            const abortRoomNumber = activeQuestData.roomNumber;
            const abortProjection = abortRoomNumber ? yield (0, default_runtime_1.getRoomCommandGateway)().execute("battle.query", {
                roomNumber: abortRoomNumber, viewerId, playerId, playId: activeQuestData.playId,
            }) : undefined;
            const abortRoom = abortProjection === null || abortProjection === void 0 ? void 0 : abortProjection.room;
            const hostAborted = (abortRoom === null || abortRoom === void 0 ? void 0 : abortRoom.host_player_id) === playerId;
            const abortedPlayId = activeQuestData.playId;
            let abortedCurrentPlay = false;
            yield (0, persistence_coordinator_1.runPersistenceTransaction)({
                domain: "multi-settlement", playerId, operation: "abort",
            }, () => {
                abortedCurrentPlay = (0, quest_active_1.deletePlayerActiveQuestIfPlayIdSync)(playerId, abortedPlayId);
                // A multiplayer defeat is reported by the legacy client
                // through /abort rather than /finish(is_accomplished=false).
                // Mode15 boundary aborts clear only this battle; the settlement
                // runtime preserves the current 5/10/15 stage without rewards.
                if (abortedCurrentPlay && hostAborted) {
                    (0, mode15_optional_1.settleMode15BattleSync)(playerId, activeQuestData.category, activeQuestData.questId, false);
                }
            });
            if (abortedCurrentPlay && ((_y = singleBattleQuest_1.activeQuests[playerId]) === null || _y === void 0 ? void 0 : _y.playId) === abortedPlayId) {
                delete singleBattleQuest_1.activeQuests[playerId];
            }
            if (abortedCurrentPlay && hostAborted && abortRoomNumber) {
                // Retiring as the host no longer dissolves the room. The host
                // is treated as a leaving member: closing its battle socket
                // retires the seat (publishing Leave to the peers), the
                // remaining members keep fighting and settle normally, and the
                // hostless room is dissolved by its own settlement-return or
                // abandoned-battle watchdog.
                (0, game_logging_1.gameVerboseLog)(() => `[MULTI] abort: host ${viewerId} left room ${abortRoomNumber};`
                    + ` remaining members continue`);
            }
            if (abortedCurrentPlay && activeQuestData.roomNumber) {
                if (abortProjection === null || abortProjection === void 0 ? void 0 : abortProjection.binding)
                    yield (0, durable_owner_event_1.publishDurableOwnerDecision)("battle.abort.committed", {
                        roomNumber: activeQuestData.roomNumber, roomInstanceId: abortProjection.binding.roomInstanceId,
                        battleSessionId: abortProjection.binding.battleSessionId, viewerId, playerId, playId: abortedPlayId,
                    });
            }
            if (!abortedCurrentPlay) {
                console.warn(`[MULTI] stale abort acknowledged: viewer=${viewerId}`
                    + ` play=${body.play_id} reason=persistent_play_replaced`);
            }
        }
        else {
            console.warn(`[MULTI] stale abort acknowledged: viewer=${viewerId}`
                + ` play=${body.play_id} reason=active_quest_missing_or_replaced`);
        }
        const headers = (0, utils_1.generateDataHeaders)({ viewer_id: viewerId });
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": headers,
            "data": {
                "user_info": {},
                "category_id": (_0 = (_z = activeQuestData === null || activeQuestData === void 0 ? void 0 : activeQuestData.category) !== null && _z !== void 0 ? _z : body.category) !== null && _0 !== void 0 ? _0 : 0,
                "is_multi": "multi",
                "start_time": headers['servertime'],
                "quest_name": "",
                "aborted_play_id": null,
                "unfinished_play_id": null,
                "drawn_quest": null,
                "party_info": null,
                "presigned_url": null
            }
        });
    }));
    // ---- play_continue ----
    fastify.post("/play_continue", (request, reply) => __awaiter(this, void 0, void 0, function* () {
        var _1, _2;
        const body = request.body;
        const viewerId = body.viewer_id;
        (0, game_logging_1.gameVerboseLog)(() => `[MULTI] play_continue: viewer=${viewerId} quest=${body.quest_id} category=${body.category}`);
        if (isNaN(viewerId)) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        }
        const ctx = yield (0, player_context_1.resolveMultiPlayerContext)(viewerId);
        if (!ctx || !ctx.player) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid viewer id or no player bound."
            });
        }
        const { playerId } = ctx;
        if ((0, continue_runtime_1.isFiveBossContinueRequest)(playerId, Number(body.category), Number(body.quest_id), body.play_id)) {
            try {
                const data = yield (0, continue_runtime_1.continueFiveBoss)({ playerId, category: Number(body.category), questId: Number(body.quest_id),
                    playId: body.play_id, isMulti: true, apiCount: body.api_count, statistics: body.statistics });
                const recovered = (0, active_quest_resolver_1.resolveActiveQuest)({ playerId, hint: body, memory: singleBattleQuest_1.activeQuests, allowRebuild: false });
                if ((recovered === null || recovered === void 0 ? void 0 : recovered.quest.playId) === body.play_id)
                    recovered.quest.continueCount = data.continue_count;
                reply.header("content-type", "application/x-msgpack");
                return reply.status(200).send({ data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }), data });
            }
            catch (error) {
                if (!(error instanceof continue_runtime_1.FiveBossContinueError))
                    throw error;
                if (error.stale) {
                    // The run ended before this client recovered it. The CN
                    // client treats a 400 here as a fatal H400 and logs out,
                    // so acknowledge without charging or reviving anything.
                    (0, game_logging_1.gameVerboseLog)(() => `[MULTI] play_continue: stale ack viewer=${viewerId}`
                        + ` quest=${body.quest_id} reason=${error.message}`);
                    reply.header("content-type", "application/x-msgpack");
                    return reply.status(200).send({
                        data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
                        data: (0, continue_runtime_1.fiveBossContinueAcknowledgement)(playerId),
                    });
                }
                (0, game_logging_1.gameVerboseLog)(() => `[MULTI] play_continue: rejected viewer=${viewerId}`
                    + ` quest=${body.quest_id} reason=${error.message}`);
                return reply.status(400).send({ error: "Bad Request", message: error.message });
            }
        }
        const persisted = (0, quest_active_1.getPlayerActiveQuestSync)(playerId);
        let activeData = (persisted === null || persisted === void 0 ? void 0 : persisted.isMulti)
            && persisted.playId === body.play_id
            ? ((_1 = singleBattleQuest_1.activeQuests[playerId]) === null || _1 === void 0 ? void 0 : _1.playId) === body.play_id
                ? singleBattleQuest_1.activeQuests[playerId]
                : activeQuestFromPersistent(persisted)
            : undefined;
        if (activeData)
            singleBattleQuest_1.activeQuests[playerId] = activeData;
        if (!activeData) {
            console.warn(`[MULTI] stale continue acknowledged: viewer=${viewerId}`
                + ` play=${body.play_id} reason=active_quest_missing_or_replaced`);
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
                data: { continue_count: 0 },
            });
        }
        const configured_continue_runtime = require("../../lib/continue-runtime");
        let configured_continue_active_quest;
        if ((0, configured_continue_runtime.isConfiguredContinueRequest)(playerId, Number(body.quest_id))) {
            try {
                const data = yield (0, configured_continue_runtime.continueConfiguredQuest)({ playerId, isMulti: true,
                    category: Number(body.category), questId: Number(body.quest_id),
                    playId: body.play_id, apiCount: body.api_count, statistics: body.statistics });
                if (((configured_continue_active_quest = singleBattleQuest_1.activeQuests[playerId]) === null || configured_continue_active_quest === void 0 ? void 0 : configured_continue_active_quest.playId) === body.play_id)
                    singleBattleQuest_1.activeQuests[playerId].continueCount = data.continue_count;
                reply.header("content-type", "application/x-msgpack");
                return reply.status(200).send({ data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }), data });
            }
            catch (error) {
                if (!(error instanceof configured_continue_runtime.ContinuePaymentError))
                    throw error;
                return reply.status(400).send({ error: "Bad Request", message: error.message });
            }
        }
        const nextContinueCount = activeData.continueCount + 1;
        const updated = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "multi-settlement", playerId, operation: "continue",
        }, () => (0, quest_active_1.updatePlayerActiveQuestContinueCountIfPlayIdSync)(playerId, activeData.playId, nextContinueCount));
        if (!updated) {
            if (((_2 = singleBattleQuest_1.activeQuests[playerId]) === null || _2 === void 0 ? void 0 : _2.playId) === body.play_id) {
                delete singleBattleQuest_1.activeQuests[playerId];
            }
            console.warn(`[MULTI] stale continue acknowledged after race: viewer=${viewerId}`
                + ` play=${body.play_id}`);
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
                data: { continue_count: 0 },
            });
        }
        activeData.continueCount = nextContinueCount;
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": {
                continue_count: nextContinueCount,
            }
        });
    }));
}
exports.registerBattleRoutes = registerBattleRoutes;
