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
exports.handleFiveBossAbort = exports.handleFiveBossFinish = exports.handleFiveBossStart = exports.shouldHandleFiveBossMemberRequest = exports.shouldHandleFiveBossStart = exports.isFiveBossBattleRequestError = exports.isStaleFiveBossMemberRequestError = exports.logFiveBossRequestFailure = void 0;
const player_time_compat_1 = require("../../lib/player-time-compat");
const quest_active_1 = require("../../data/domains/quest_active");
const fiveBossGauntletRun_1 = require("../../data/domains/fiveBossGauntletRun");
const item_1 = require("../../data/domains/item");
const equipment_1 = require("../../data/domains/equipment");
const player_1 = require("../../data/domains/player");
const party_1 = require("../../data/domains/party");
const equipment_2 = require("../../lib/equipment");
const utils_1 = require("../../utils");
const singleBattleQuest_1 = require("../../routes/api/singleBattleQuest");
const default_runtime_1 = require("../coordinator/default-runtime");
const durable_owner_event_1 = require("../coordinator/durable-owner-event");
const command_protocol_1 = require("../coordinator/command-protocol");
const perf_hooks_1 = require("perf_hooks");
const battle_runtime_1 = require("../five-boss/battle-runtime");
const contract_1 = require("../five-boss/contract");
const rewards_1 = require("../five-boss/rewards");
const solo_runtime_1 = require("../five-boss/solo-runtime");
const db_1 = require("../../data/db");
const settlement_performance_1 = require("../../lib/settlement-performance");
const coalesced_diagnostics_1 = require("../../lib/coalesced-diagnostics");
const connection_diagnostic_1 = require("../five-boss/connection-diagnostic");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const settlement_response_1 = require("../../lib/weapon-riven/settlement-response");
const party_refresh_1 = require("../../lib/weapon-riven/party-refresh");
const battle_settlement_ledger_1 = require("../../data/domains/battle-settlement-ledger");
/** Small structured evidence, without logging tokens, party data or the full request. */
function logFiveBossRequestFailure(operation, body, playerId, error, acknowledged = false) {
    const code = error === null || error === void 0 ? void 0 : error.code;
    const message = error === null || error === void 0 ? void 0 : error.message;
    const key = JSON.stringify(["request", operation, playerId, acknowledged, String(body.play_id).slice(0, 255),
        body.category, body.quest_id, code, message === null || message === void 0 ? void 0 : message.slice(0, 160)]);
    coalesced_diagnostics_1.fiveBossDiagnostics.report(key, () => {
        const run = (0, fiveBossGauntletRun_1.getFiveBossRunByClientSync)({ playerId, clientPlayId: body.play_id });
        const member = run ? (0, db_1.getDb)().prepare(`SELECT started_at, battle_entered_at, aborted_at,
            level_next_at, finalized_at
            FROM five_boss_gauntlet_members WHERE run_id = ? AND player_id = ?`).get(run.runId, playerId) : null;
        const active = (0, quest_active_1.getPlayerActiveQuestSync)(playerId);
        if (run && operation === "finish" && !acknowledged) {
            connection_diagnostic_1.fiveBossConnectionDiagnostics.memberEvent(run.runId, playerId, "finish_rejected", code);
        }
        return `[${acknowledged ? "FIVE-BOSS-ACK" : "FIVE-BOSS-REJECT"}] ${JSON.stringify({ operation, player: playerId, play: body.play_id,
            category: body.category, quest: body.quest_id, run: run === null || run === void 0 ? void 0 : run.runId, room: run === null || run === void 0 ? void 0 : run.roomNumber,
            status: run === null || run === void 0 ? void 0 : run.status, code, message,
            proof: member, active: active ? {
                play: active.playId,
                category: active.category,
                quest: active.questId,
                multi: active.isMulti,
                room: active.roomNumber,
            } : null,
            transport: run ? connection_diagnostic_1.fiveBossConnectionDiagnostics.snapshot(run.runId, playerId) : { available: false, reason: "run_not_found" } })}`;
    });
}
exports.logFiveBossRequestFailure = logFiveBossRequestFailure;
/**
 * Codes that mean this client is closing out a run the server already ended
 * (settled/aborted) or a play id that is no longer bound to any run. The CN
 * client turns any HTTP 400 on finish/abort into a fatal H400 dialog and
 * drops to login, so these stale requests are acknowledged as a terminal,
 * reward-less outcome instead of an error.
 */
const STALE_MEMBER_REQUEST_CODES = new Set([
    "run_not_active",
    "member_not_active",
    "client_play_not_found",
    "active_quest_mismatch",
    "battle_proof_missing",
]);
function isStaleFiveBossMemberRequestError(error) {
    const code = error === null || error === void 0 ? void 0 : error.code;
    return typeof code === "string" && STALE_MEMBER_REQUEST_CODES.has(code);
}
exports.isStaleFiveBossMemberRequestError = isStaleFiveBossMemberRequestError;
function isFiveBossBattleRequestError(error) {
    return error instanceof battle_runtime_1.FiveBossBattleRuntimeError
        || error instanceof fiveBossGauntletRun_1.FiveBossGauntletRunError
        || (error === null || error === void 0 ? void 0 : error.code) === "BATTLE_ALREADY_SETTLED"
        || (error === null || error === void 0 ? void 0 : error.code) === "BATTLE_CLOCK_ABORTED";
}
exports.isFiveBossBattleRequestError = isFiveBossBattleRequestError;
function shouldHandleFiveBossStart(body) {
    return (0, contract_1.isFiveBossGauntletQuest)(body.category, body.quest_id);
}
exports.shouldHandleFiveBossStart = shouldHandleFiveBossStart;
function shouldHandleFiveBossMemberRequest(body, playerId) {
    if ((0, contract_1.isFiveBossGauntletQuest)(body.category, body.quest_id))
        return true;
    if ((0, fiveBossGauntletRun_1.getFiveBossRunByClientSync)({ playerId, clientPlayId: body.play_id }))
        return true;
    const memory = singleBattleQuest_1.activeQuests[playerId];
    if ((memory === null || memory === void 0 ? void 0 : memory.playId) === body.play_id
        && (0, contract_1.isFiveBossGauntletQuest)(memory.category, memory.questId))
        return true;
    const persistent = (0, quest_active_1.getPlayerActiveQuestSync)(playerId);
    return persistent !== null
        && persistent.playId === body.play_id
        && (0, contract_1.isFiveBossGauntletQuest)(persistent.category, persistent.questId);
}
exports.shouldHandleFiveBossMemberRequest = shouldHandleFiveBossMemberRequest;
function clearMatchingMemoryActive(playerId, playId) {
    const active = singleBattleQuest_1.activeQuests[playerId];
    if ((active === null || active === void 0 ? void 0 : active.playId) === playId
        && (0, contract_1.isFiveBossGauntletQuest)(active.category, active.questId)) {
        delete singleBattleQuest_1.activeQuests[playerId];
    }
}
function terminalRoomTransition(roomNumber, runId, runStatus) {
    return __awaiter(this, void 0, void 0, function* () {
        if (runStatus === "active")
            return;
        yield (0, durable_owner_event_1.publishDurableOwnerDecision)("fiveBoss.terminal", { roomNumber, runId, runStatus });
    });
}
function afterResponse(reply, operation) {
    let completed = false;
    const run = () => {
        if (completed)
            return;
        completed = true;
        try {
            void Promise.resolve(operation()).catch(error => console.error("[MULTI] five-boss post-response cleanup failed", error));
        }
        catch (error) {
            console.error(`[MULTI] five-boss post-response cleanup failed: ${error.message}`);
        }
    };
    reply.raw.once("finish", run);
    reply.raw.once("close", run);
}
/**
 * CN 客户端的 multi finish / abort 请求体**不带 room_number**(官方
 * BattleQuestFinishRealRemote / QuestAbortRealRemote 都没有这个字段),原生多人路径
 * 一直是靠服务端 activeQuests 记住房号。五重 runtime 的冻结契约要求 requestRoomNumber
 * 非空,真机首战(2026-09-04)就因此在结算时连吃 6 个 H400。这里按
 * 请求体 → 此玩家/对局的不可变账本 → 内存 activeQuests → 持久化活动记录补房号;
 * 全都没有才让 runtime 用原来的 invalid_argument 拒绝。
 */
function resolveFiveBossRoomNumber(bodyRoomNumber, playerId, playId, boundRun) {
    if (typeof bodyRoomNumber === "string" && bodyRoomNumber.length > 0)
        return bodyRoomNumber;
    const run = boundRun === undefined ? (0, fiveBossGauntletRun_1.getFiveBossRunByClientSync)({ playerId, clientPlayId: playId }) : boundRun;
    if (run)
        return run.roomNumber;
    const memory = singleBattleQuest_1.activeQuests[playerId];
    if (memory && (0, contract_1.isFiveBossGauntletQuest)(memory.category, memory.questId) && memory.roomNumber) {
        return memory.roomNumber;
    }
    const persistent = (0, quest_active_1.getPlayerActiveQuestSync)(playerId);
    if (persistent
        && (0, contract_1.isFiveBossGauntletQuest)(persistent.category, persistent.questId)
        && persistent.roomNumber) {
        return persistent.roomNumber;
    }
    return "";
}
/**
 * 上一局没结算干净(客户端半路报错退出、房间早已解散)时,玩家身上还挂着旧的
 * 五重持久化 active quest,新一局 start 会被 runtime 以 active_quest_mismatch 拒绝,
 * 玩家从此进不了五重。开新局前把这条"房间已不存在"的旧局按 abort 收掉。
 * 按整轮身份区别同房号的新旧局；活动房间仍属于旧局时不清理。
 * 此函数与新局 start 同处一个事务，开新局失败时旧局保持原状。
 */
function abandonStaleFiveBossRun(body, playerId, authorization) {
    var _a, _b, _c;
    const stale = (0, quest_active_1.getPlayerActiveQuestSync)(playerId);
    if (!stale || stale.playId === body.play_id)
        return;
    try {
        if (!stale.isMulti) {
            if (!(0, contract_1.isFiveBossGauntletQuest)(stale.category, stale.questId)) {
                if ((0, quest_active_1.deletePlayerActiveQuestIfPlayIdSync)(playerId, stale.playId)) {
                    if (((_a = singleBattleQuest_1.activeQuests[playerId]) === null || _a === void 0 ? void 0 : _a.playId) === stale.playId) {
                        delete singleBattleQuest_1.activeQuests[playerId];
                    }
                    console.log(`[MULTI] five-boss start: abandoned stale ordinary solo`
                        + ` player=${playerId} play=${stale.playId}`
                        + ` category=${stale.category} quest=${stale.questId}`);
                }
                return;
            }
            if ((0, solo_runtime_1.abandonFiveBossSoloForMultiSync)(playerId, stale.playId)) {
                clearMatchingMemoryActive(playerId, stale.playId);
                console.log(`[MULTI] five-boss start: abandoned previous solo player=${playerId} play=${stale.playId}`);
            }
            return;
        }
        const oldRun = (0, fiveBossGauntletRun_1.getFiveBossRunByClientSync)({ playerId, clientPlayId: stale.playId });
        const oldRoomNumber = (_b = oldRun === null || oldRun === void 0 ? void 0 : oldRun.roomNumber) !== null && _b !== void 0 ? _b : stale.roomNumber;
        if (!authorization || authorization.playId !== stale.playId || authorization.recoverable
            || ("retained" in authorization && authorization.retained))
            return;
        if (!oldRun || !oldRoomNumber || !(0, contract_1.isFiveBossGauntletQuest)(stale.category, stale.questId)) {
            if ((0, quest_active_1.deletePlayerActiveQuestIfPlayIdSync)(playerId, stale.playId)) {
                if (((_c = singleBattleQuest_1.activeQuests[playerId]) === null || _c === void 0 ? void 0 : _c.playId) === stale.playId) {
                    delete singleBattleQuest_1.activeQuests[playerId];
                }
                console.log(`[MULTI] five-boss start: abandoned orphan active quest`
                    + ` player=${playerId} play=${stale.playId}`
                    + ` reason=${authorization.reason}`);
            }
            return;
        }
        // Recover only a missing room field from this exact persisted player/play binding.
        if (!stale.roomNumber) {
            (0, db_1.getDb)().prepare(`UPDATE players_active_quests SET room_number = ?
                WHERE player_id = ? AND play_id = ? AND is_multi = 1 AND (room_number IS NULL OR room_number = '')`)
                .run(oldRoomNumber, playerId, stale.playId);
        }
        const aborted = (0, battle_runtime_1.abortFiveBossBattle)({
            playerId,
            clientPlayId: stale.playId,
            requestRoomNumber: oldRoomNumber,
            requestCategory: stale.category,
            requestQuestId: stale.questId,
        });
        clearMatchingMemoryActive(playerId, stale.playId);
        console.log(`[MULTI] five-boss start: abandoned stale run for player ${playerId}`
            + ` room=${stale.roomNumber} play=${stale.playId}`
            + ` status=${aborted.abortStatus}/${aborted.runStatus}`);
    }
    catch (error) {
        console.warn(`[MULTI] five-boss start: could not abandon stale run for player ${playerId}`
            + ` room=${stale.roomNumber}: ${error.message}`);
    }
}
function requirePlayer(playerId) {
    const player = (0, player_1.getPlayerSync)(playerId);
    if (!player)
        throw new Error(`five-boss player ${playerId} disappeared`);
    return player;
}
function finishItemList(result) {
    var _a;
    if (result.kind !== "success")
        return {};
    // These keys describe the settled reward; the response projection refreshes their balances.
    return (_a = result.reward.itemTotals) !== null && _a !== void 0 ? _a : Object.fromEntries(result.reward.grantedItems.map(item => [String(item.itemId), item.total]));
}
/** 旧 receipt 在武器掉落字段加入前已经落盘；缺失时按当年无武器处理。 */
function receiptGrantedEquipment(result) {
    if (result.kind !== "success")
        return [];
    const granted = result.reward.grantedEquipment;
    return Array.isArray(granted) ? granted : [];
}
/** 按 receipt 的命中顺序去重，回读当前持有状态，保证重放不重复发放。 */
function finishEquipmentList(result, playerId) {
    if (result.kind !== "success")
        return [];
    const seen = new Set();
    const list = [];
    for (const equipmentId of receiptGrantedEquipment(result)) {
        if (seen.has(equipmentId))
            continue;
        seen.add(equipmentId);
        const owned = (0, equipment_1.getPlayerEquipmentSync)(playerId, equipmentId);
        if (owned)
            list.push((0, equipment_2.clientSerializeEquipment)(equipmentId, owned));
    }
    return list;
}
function buildFinishData(player, body, result, dataHeaders, matePlayerResult, followInfo, exp) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    return Object.assign(Object.assign({ user_info: {
            free_mana: player.freeMana,
            exp_pool: player.expPool,
            exp_pooled_time: (0, player_time_compat_1.getPlayerClientExpTime)(player),
            free_vmoney: player.freeVmoney,
            rank_point: player.rankPoint,
            // getRankDegree 算出来的是玩家 **rank**(高 rank 号如 250),不是称号表 degree 的键;
            // 结算页 MVP 卡会拿 user_info.degree_id 去查 master/degree/degree,查不到就 C8601
            // 「指定的Key不存在 key=250」(真机 2026-09-04)。普通多人/关注列表都用玩家持久化的 degreeId。
            degree_id: player.degreeId || 1,
            stamina: player.stamina,
            stamina_heal_time: (0, utils_1.realToVirtual)(player.staminaHealTime),
            boost_point: player.boostPoint,
            boss_boost_point: player.bossBoostPoint,
        }, add_exp_list: (_a = exp === null || exp === void 0 ? void 0 : exp.add_exp_list) !== null && _a !== void 0 ? _a : [], character_list: (_b = exp === null || exp === void 0 ? void 0 : exp.character_list) !== null && _b !== void 0 ? _b : [], bond_token_status_list: (_c = exp === null || exp === void 0 ? void 0 : exp.bond_token_status_list) !== null && _c !== void 0 ? _c : [], rewards: {
            overflow_pool_exp: 0,
            converted_pool_exp: 0,
            reward_pool_exp: 0,
            reward_mana: 0,
            field_mana: 0,
        }, old_high_score: 0, joined_character_id_list: [], before_rank_point: player.rankPoint, clear_rank: result.kind === "success" ? 5 : 0, drop_score_reward_ids: [], drop_rare_reward_ids: [], drop_additional_reward_ids: result.kind === "success"
            ? [
                ...(0, rewards_1.buildFiveBossAdditionalRewardDrops)(result.reward.grantedItems),
                ...(0, rewards_1.buildFiveBossWeaponAdditionalRewardDrops)(receiptGrantedEquipment(result)),
            ]
            : [], drop_periodic_reward_ids: [], equipment_list: finishEquipmentList(result, player.id), category_id: body.category, start_time: dataHeaders.servertime, is_multi: "multi", quest_name: "" }, (result.kind === "success" ? (0, settlement_response_1.refreshWeaponRivenSettlementDataSync)(player.id, {
        item_list: finishItemList(result),
        weapon_riven_list: (_d = result.reward.weapon_riven_list) !== null && _d !== void 0 ? _d : {},
        weapon_riven_deleted: (_e = result.reward.weapon_riven_deleted) !== null && _e !== void 0 ? _e : [],
        weapon_riven_granted: result.reward.weapon_riven_granted,
        weapon_riven_auto_dismantled: (_f = result.reward.weapon_riven_auto_dismantled) !== null && _f !== void 0 ? _f : [],
        party_info_list: (_g = result.reward.party_info_list) !== null && _g !== void 0 ? _g : [],
    }) : { item_list: {} })), { presigned_quest_category: [], mate_player_result: matePlayerResult, follow_info: followInfo, contribution_score: (_h = body.contribution_score) !== null && _h !== void 0 ? _h : 0, host_finished: true, aborted_play_id: null });
}
/** A receipt/run alone does not prove this player's active original start. */
function readCurrentDurableFiveBossStart(body, playerId) {
    if ((0, db_1.getDb)().inTransaction)
        throw new Error("FIVE_BOSS_DURABILITY_UNRESOLVED");
    const run = (0, fiveBossGauntletRun_1.getFiveBossRunByClientSync)({ playerId, clientPlayId: body.play_id });
    const activeQuest = (0, quest_active_1.getPlayerActiveQuestSync)(playerId);
    if (!run || run.status !== "active" || run.roomNumber !== body.room_number
        || !(activeQuest === null || activeQuest === void 0 ? void 0 : activeQuest.isMulti) || activeQuest.playId !== body.play_id || activeQuest.roomNumber !== body.room_number
        || Number(activeQuest.category) !== Number(body.category) || Number(activeQuest.questId) !== Number(body.quest_id))
        return null;
    const member = (0, db_1.getDb)().prepare(`SELECT started_at, aborted_at FROM five_boss_gauntlet_members
        WHERE run_id = ? AND player_id = ? AND client_play_id = ?`).get(run.runId, playerId, body.play_id);
    return (member === null || member === void 0 ? void 0 : member.started_at) && !member.aborted_at ? { runId: run.runId, activeQuest } : null;
}
function handleFiveBossStart(body, playerId, reply) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        const staleQuest = (0, quest_active_1.getPlayerActiveQuestSync)(playerId);
        const staleRun = staleQuest ? (0, fiveBossGauntletRun_1.getFiveBossRunByClientSync)({ playerId, clientPlayId: staleQuest.playId }) : null;
        const durableStart = readCurrentDurableFiveBossStart(body, playerId);
        const prepareId = (0, command_protocol_1.createRoomCommandId)();
        let prepared;
        try {
            prepared = (yield (0, default_runtime_1.getRoomCommandGateway)().execute("fiveBoss.start.prepare", JSON.parse(JSON.stringify(Object.assign(Object.assign(Object.assign({ body, playerId }, (staleQuest ? { staleQuest } : {})), (staleRun ? { staleFrozenRunId: staleRun.runId } : {})), (durableStart ? { durableRunId: durableStart.runId } : {})))), { commandId: prepareId }));
        }
        catch (error) {
            // No SQL has started. A known per-attempt token can safely resolve a
            // late Prepare without releasing any concurrent request's claim.
            try {
                yield (0, default_runtime_1.getRoomCommandGateway)().execute("fiveBoss.start.cancel", {
                    token: prepareId, playerId, playId: body.play_id, roomNumber: body.room_number,
                });
            }
            catch (cancelError) {
                console.error("[FIVE-BOSS] prepare cancellation unresolved", cancelError);
            }
            throw error;
        }
        if (prepared.status !== "ready") {
            console.warn(`[MULTI] five-boss start acknowledged as unavailable:`
                + ` viewer=${body.viewer_id} room=${body.room_number} reason=room_missing_after_gate`);
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                data_headers: (0, utils_1.generateDataHeaders)({
                    viewer_id: body.viewer_id,
                    result_code: 4050,
                }),
                data: {},
            });
        }
        const claim = prepared;
        const room = claim.room;
        const claimDeadline = perf_hooks_1.performance.now() + claim.remainingMs;
        // 五重决战不消耗、不结算任何强化点:客户端在"降临讨伐"页签建房时会按官方 boss 战
        // 习惯默认勾上领主强化点(use_boss_boost_point=true),真机实测直接被 runtime 的
        // boost_not_allowed 拒成 H400 进不了战斗(2026-09-04)。这里把两个开关一律当 false
        // 交给 runtime(冻结契约不变:runtime 仍只接受 false),只留一行日志说明被忽略。
        if (body.use_boost_point === true || body.use_boss_boost_point === true) {
            console.log(`[MULTI] five-boss start: ignoring client boost flags`
                + ` viewer=${body.viewer_id} room=${body.room_number}`
                + ` boost=${body.use_boost_point}/${body.use_boss_boost_point}`);
        }
        let memoryBeforeCleanup = undefined;
        let memoryAfterCleanup = undefined;
        let cleanupChanged = false;
        let result;
        try {
            result = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
                domain: "multi-settlement", playerId, operation: "five_boss_start",
            }, () => {
                (0, battle_settlement_ledger_1.assertBattleCanStartSync)(playerId, body.play_id);
                // The copied room is input, not a live guard. The owner pins the
                // exact generation until this token is explicitly resolved.
                try {
                    (0, default_runtime_1.assertRealtimeOwnerEpoch)(claim.ownerEpoch, claim.token);
                    if (perf_hooks_1.performance.now() >= claimDeadline)
                        throw new Error("Claim deadline elapsed");
                }
                catch (_a) {
                    throw new battle_runtime_1.FiveBossBattleRuntimeError("run_identity_mismatch", "Realtime start claim is no longer valid");
                }
                memoryBeforeCleanup = singleBattleQuest_1.activeQuests[playerId];
                abandonStaleFiveBossRun(body, playerId, claim.oldPlayRecovery);
                memoryAfterCleanup = singleBattleQuest_1.activeQuests[playerId];
                cleanupChanged = memoryBeforeCleanup !== memoryAfterCleanup;
                const result = (0, battle_runtime_1.startFiveBossBattle)({
                    playerId,
                    clientPlayId: body.play_id,
                    room,
                    requestRoomNumber: body.room_number,
                    requestCategory: body.category,
                    requestQuestId: body.quest_id,
                    useBoostPoint: false,
                    useBossBoostPoint: false,
                    httpIsAutoStartMode: body.is_auto_start_mode,
                    matePlayerIds: body.mate_player_ids,
                    mateComIds: room.mates.map(mate => mate.com_id),
                });
                // Keep the selected party update inside the same persistence owner as
                // the run ledger and active quest writes.
                if ((0, party_1.isValidNormalPartySlotSync)(playerId, body.party_id)) {
                    (0, player_1.updatePlayerSync)({ id: playerId, partySlot: body.party_id });
                }
                return result;
            });
        }
        catch (error) {
            let durableAfterFailure = null;
            let readFailed = false;
            try {
                durableAfterFailure = readCurrentDurableFiveBossStart(body, playerId);
            }
            catch (_f) {
                readFailed = true;
            }
            if ((durableAfterFailure === null || durableAfterFailure === void 0 ? void 0 : durableAfterFailure.runId) === claim.frozenRunId) {
                // A committed original start can survive a lost result or a later
                // observer failure. Reconcile it without executing payment again.
                const persisted = durableAfterFailure.activeQuest;
                singleBattleQuest_1.activeQuests[playerId] = Object.assign(Object.assign({}, persisted), { roomNumber: body.room_number, entryItemId: (_a = persisted.entryItemId) !== null && _a !== void 0 ? _a : undefined, eventId: (_b = persisted.eventId) !== null && _b !== void 0 ? _b : undefined, partySlot: (_c = persisted.partySlot) !== null && _c !== void 0 ? _c : undefined, startedAtMs: (_d = persisted.startedAtMs) !== null && _d !== void 0 ? _d : undefined });
                try {
                    yield (0, durable_owner_event_1.publishDurableOwnerDecision)("fiveBoss.start.commit", {
                        token: claim.token, playerId, playId: body.play_id, runId: durableAfterFailure.runId,
                    });
                }
                catch (commitError) {
                    console.error("[FIVE-BOSS] durable start reconciliation unresolved", commitError);
                }
            }
            else if (readFailed || (error === null || error === void 0 ? void 0 : error.outcomeUnknown) === true) {
                // An ambiguous durable result is not permission to unlock lifecycle
                // or retry payment. Keep the original token for explicit reconciliation.
                console.error("[FIVE-BOSS] persistence outcome unknown; start remains pinned", error);
            }
            else {
                try {
                    yield (0, default_runtime_1.getRoomCommandGateway)().execute("fiveBoss.start.cancel", { token: claim.token, playerId, playId: body.play_id });
                }
                catch (cancelError) {
                    console.error("[FIVE-BOSS] start cancellation unresolved; owner remains pinned", cancelError);
                }
                // Restore only the stale cleanup performed by this transaction.
                // A concurrent successful same-play request may already own memory.
                if (cleanupChanged && singleBattleQuest_1.activeQuests[playerId] === memoryAfterCleanup) {
                    if (memoryBeforeCleanup)
                        singleBattleQuest_1.activeQuests[playerId] = memoryBeforeCleanup;
                    else
                        delete singleBattleQuest_1.activeQuests[playerId];
                }
            }
            throw error;
        }
        singleBattleQuest_1.activeQuests[playerId] = result.activeQuest;
        try {
            const committed = yield (0, durable_owner_event_1.publishDurableOwnerDecision)("fiveBoss.start.commit", {
                token: claim.token, playerId, playId: body.play_id, runId: result.runId,
            });
            if ((committed === null || committed === void 0 ? void 0 : committed.applied) === false)
                console.error("[FIVE-BOSS] paid start awaits owner reconciliation", { playerId, playId: body.play_id });
        }
        catch (error) {
            // The durable original run/play remains authoritative for payment.
            // Never cancel or rerun a paid decision because the owner ACK was lost.
            console.error("[FIVE-BOSS] paid start commit outcome unknown", error);
        }
        connection_diagnostic_1.fiveBossConnectionDiagnostics.memberEvent(result.runId, playerId, "http_start", result.startStatus);
        const player = requirePlayer(playerId);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: body.viewer_id }),
            data: {
                is_multi: "multi",
                play_id: body.play_id,
                user_info: { stamina: player.stamina, stamina_heal_time: (0, utils_1.realToVirtual)(player.staminaHealTime) },
                item_list: { [contract_1.FIVE_BOSS_GAUNTLET.ticketItemId]: (_e = (0, item_1.getPlayerItemSync)(playerId, contract_1.FIVE_BOSS_GAUNTLET.ticketItemId)) !== null && _e !== void 0 ? _e : 0 },
            },
        });
    });
}
exports.handleFiveBossStart = handleFiveBossStart;
function handleFiveBossFinish(body, playerId, reply, buildFollowInfo) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g;
        const memoryBeforeFinish = singleBattleQuest_1.activeQuests[playerId];
        const boundRun = (0, fiveBossGauntletRun_1.getFiveBossRunByClientSync)({ playerId, clientPlayId: body.play_id });
        const alreadyPaid = !!boundRun && !!(0, db_1.getDb)().prepare("SELECT 1 FROM five_boss_gauntlet_receipts WHERE run_id = ? AND player_id = ?")
            .get(boundRun.runId, playerId);
        if (boundRun)
            connection_diagnostic_1.fiveBossConnectionDiagnostics.memberEvent(boundRun.runId, playerId, "http_finish", body.is_accomplished === true ? "success_requested" : "failure_requested");
        const roomNumber = resolveFiveBossRoomNumber(body.room_number, playerId, body.play_id, boundRun);
        const party = (_b = (_a = body.statistics) === null || _a === void 0 ? void 0 : _a.party) !== null && _b !== void 0 ? _b : (_c = body.quest_statistics) === null || _c === void 0 ? void 0 : _c.party;
        let result;
        try {
            result = yield (0, settlement_performance_1.measureSettlementPhaseAsync)("multi", "five_boss_settlement", () => __awaiter(this, void 0, void 0, function* () {
                // Failed finishes become aborts and do not need successful battle
                // proof.  Waiting here would make an abort depend on an unrelated
                // proof write that may be queued behind a closing socket.
                if ((boundRun === null || boundRun === void 0 ? void 0 : boundRun.status) === "active" && !alreadyPaid && body.is_accomplished === true) {
                    const barrier = yield (0, default_runtime_1.getRoomCommandGateway)().execute("fiveBoss.proof.barrier", {
                        runId: boundRun.runId, playerId, roomNumber,
                    });
                    if (!barrier.ok)
                        throw new command_protocol_1.RoomCommandError("PROOF_PERSISTENCE_UNAVAILABLE", "Accepted proof is not durably acknowledged", body.play_id, true);
                }
                return (0, persistence_coordinator_1.runPersistenceTransaction)({
                    domain: "multi-settlement", playerId, operation: "five_boss_finish",
                }, () => {
                    var _a, _b, _c, _d, _e, _f;
                    // A generic settled identity may never be paid through the
                    // specialized runtime, even if its full payload has expired.
                    // Its own dedicated receipts retain their original replay path.
                    if ((0, battle_settlement_ledger_1.getBattleReplaySync)(playerId, "multi", body.play_id).kind !== "missing") {
                        throw new battle_runtime_1.FiveBossBattleRuntimeError("run_identity_mismatch", "Battle identity already settled.");
                    }
                    if (body.is_accomplished === true && (0, contract_1.isFiveBossGauntletQuest)(body.category, body.quest_id)
                        && (boundRun === null || boundRun === void 0 ? void 0 : boundRun.roomNumber) === roomNumber) {
                        const backfill = (0, fiveBossGauntletRun_1.backfillMissingFinalizeSync)({ playerId, clientPlayId: body.play_id });
                        if (backfill.backfilled) {
                            connection_diagnostic_1.fiveBossConnectionDiagnostics.memberEvent(boundRun.runId, playerId, "finalize_recorded", "http_backfill");
                            console.warn(`[MULTI] five-boss finish: finalize signal never reached the battle channel;`
                                + ` backfilled from HTTP finish player=${playerId} run=${backfill.runId} room=${backfill.roomNumber}`);
                        }
                    }
                    return (0, battle_runtime_1.finishFiveBossBattle)({
                        playerId,
                        clientPlayId: body.play_id,
                        requestRoomNumber: roomNumber,
                        requestCategory: body.category,
                        requestQuestId: body.quest_id,
                        accomplished: body.is_accomplished,
                        elapsedTimeMs: (_b = (_a = body.elapsed_time_ms) !== null && _a !== void 0 ? _a : body.battle_time) !== null && _b !== void 0 ? _b : 0,
                        highScore: (_c = body.score) !== null && _c !== void 0 ? _c : 0,
                        leaderCharacterId: (_f = (_e = (_d = party === null || party === void 0 ? void 0 : party.characters) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.id) !== null && _f !== void 0 ? _f : null,
                    });
                });
            }));
        }
        catch (error) {
            if (!isFiveBossBattleRequestError(error) || !isStaleFiveBossMemberRequestError(error))
                throw error;
            // The run settled or aborted while this client was still finishing its
            // local battle, or the authenticated battle proof never completed.
            // Answer with a reward-less failed finish instead of a 400: the CN
            // client renders that error as a fatal H400 and logs out.
            if (error.code === "battle_proof_missing" && boundRun) {
                try {
                    const aborted = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
                        domain: "multi-settlement",
                        playerId,
                        operation: "five_boss_missing_proof_abort",
                    }, () => (0, battle_runtime_1.abortFiveBossBattle)({
                        playerId,
                        clientPlayId: body.play_id,
                        requestRoomNumber: roomNumber,
                        requestCategory: contract_1.FIVE_BOSS_GAUNTLET.category,
                        requestQuestId: contract_1.FIVE_BOSS_GAUNTLET.visibleQuestId,
                    }));
                    afterResponse(reply, () => terminalRoomTransition(roomNumber, aborted.runId, aborted.runStatus));
                }
                catch (abortError) {
                    if (!isFiveBossBattleRequestError(abortError)
                        || !isStaleFiveBossMemberRequestError(abortError)) {
                        console.error(`[MULTI] five-boss missing-proof cleanup failed:`
                            + ` player=${playerId} play=${body.play_id}`, abortError);
                    }
                }
            }
            logFiveBossRequestFailure("finish", body, playerId, error, true);
            clearMatchingMemoryActive(playerId, body.play_id);
            if (boundRun && boundRun.status !== "active") {
                afterResponse(reply, () => terminalRoomTransition(roomNumber, boundRun.runId, boundRun.status));
            }
            const matePlayerResult = (_d = body.mate_player_result) !== null && _d !== void 0 ? _d : [];
            const followInfo = yield (0, settlement_performance_1.measureSettlementPhaseAsync)("multi", "five_boss_follow", () => {
                var _a, _b;
                return buildFollowInfo(body.viewer_id, matePlayerResult, (_b = (_a = memoryBeforeFinish === null || memoryBeforeFinish === void 0 ? void 0 : memoryBeforeFinish.matePlayerIds) !== null && _a !== void 0 ? _a : body.mate_player_ids) !== null && _b !== void 0 ? _b : []);
            });
            const dataHeaders = (0, utils_1.generateDataHeaders)({ viewer_id: body.viewer_id });
            const player = requirePlayer(playerId);
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                data_headers: dataHeaders,
                data: buildFinishData(player, body, {
                    kind: "failed",
                    abortStatus: "already_aborted",
                    runId: (_e = boundRun === null || boundRun === void 0 ? void 0 : boundRun.runId) !== null && _e !== void 0 ? _e : "",
                    runStatus: (_f = boundRun === null || boundRun === void 0 ? void 0 : boundRun.status) !== null && _f !== void 0 ? _f : "aborted",
                }, dataHeaders, matePlayerResult, followInfo, null),
            });
        }
        clearMatchingMemoryActive(playerId, body.play_id);
        if (result.kind === "success") {
            yield (0, party_refresh_1.refreshWeaponRivenPartiesAfterCommit)(playerId, result.reward.party_info_list);
            try {
                yield (0, durable_owner_event_1.publishDurableOwnerDecision)("fiveBoss.terminal", {
                    roomNumber, runId: result.runId, runStatus: "active", playerId, viewerId: body.viewer_id, playId: body.play_id,
                });
            }
            catch (error) {
                console.error("[FIVE-BOSS] durable settlement room event unresolved", error);
            }
        }
        if (result.runStatus !== "active") {
            afterResponse(reply, () => terminalRoomTransition(roomNumber, result.runId, result.runStatus));
        }
        const matePlayerResult = (_g = body.mate_player_result) !== null && _g !== void 0 ? _g : [];
        const followInfo = yield (0, settlement_performance_1.measureSettlementPhaseAsync)("multi", "five_boss_follow", () => {
            var _a, _b;
            return buildFollowInfo(body.viewer_id, matePlayerResult, (_b = (_a = memoryBeforeFinish === null || memoryBeforeFinish === void 0 ? void 0 : memoryBeforeFinish.matePlayerIds) !== null && _a !== void 0 ? _a : body.mate_player_ids) !== null && _b !== void 0 ? _b : []);
        });
        const dataHeaders = (0, utils_1.generateDataHeaders)({ viewer_id: body.viewer_id });
        const exp = result.kind === "success" ? result.reward.characterExp : null;
        const player = requirePlayer(playerId);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: dataHeaders,
            data: buildFinishData(player, body, result, dataHeaders, matePlayerResult, followInfo, exp),
        });
    });
}
exports.handleFiveBossFinish = handleFiveBossFinish;
function handleFiveBossAbort(body, playerId, reply) {
    return __awaiter(this, void 0, void 0, function* () {
        const boundRun = (0, fiveBossGauntletRun_1.getFiveBossRunByClientSync)({ playerId, clientPlayId: body.play_id });
        const roomNumber = resolveFiveBossRoomNumber(body.room_number, playerId, body.play_id, boundRun);
        // QuestAbortRealRemote builds a smaller payload than finish on some CN
        // clients. Recover only omitted route fields from this exact player/play
        // ledger binding; explicitly supplied wrong values must still be rejected.
        const requestCategory = body.category == null && boundRun
            ? contract_1.FIVE_BOSS_GAUNTLET.category
            : body.category;
        const requestQuestId = body.quest_id == null && boundRun
            ? contract_1.FIVE_BOSS_GAUNTLET.visibleQuestId
            : body.quest_id;
        let result;
        try {
            result = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
                domain: "multi-settlement", playerId, operation: "five_boss_abort",
            }, () => (0, battle_runtime_1.abortFiveBossBattle)({
                playerId,
                clientPlayId: body.play_id,
                requestRoomNumber: roomNumber,
                requestCategory,
                requestQuestId,
            }));
        }
        catch (error) {
            if (!isFiveBossBattleRequestError(error) || !isStaleFiveBossMemberRequestError(error))
                throw error;
            // Retiring a run the server no longer tracks (already settled/aborted,
            // or an unrecognized play id) must not 400: the CN client would show a
            // fatal H400. It is already gone, so answer with the empty terminal
            // payload the client expects from a successful abort.
            logFiveBossRequestFailure("abort", body, playerId, error, true);
            clearMatchingMemoryActive(playerId, body.play_id);
            const headers = (0, utils_1.generateDataHeaders)({ viewer_id: body.viewer_id });
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                data_headers: headers,
                data: {
                    user_info: {},
                    category_id: requestCategory,
                    is_multi: "multi",
                    start_time: headers.servertime,
                    quest_name: "",
                    aborted_play_id: null,
                    unfinished_play_id: null,
                    drawn_quest: null,
                    party_info: null,
                    presigned_url: null,
                },
            });
        }
        clearMatchingMemoryActive(playerId, body.play_id);
        if (result.runStatus !== "active") {
            afterResponse(reply, () => terminalRoomTransition(roomNumber, result.runId, result.runStatus));
        }
        const headers = (0, utils_1.generateDataHeaders)({ viewer_id: body.viewer_id });
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: headers,
            data: {
                user_info: {},
                category_id: requestCategory,
                is_multi: "multi",
                start_time: headers.servertime,
                quest_name: "",
                aborted_play_id: null,
                unfinished_play_id: null,
                drawn_quest: null,
                party_info: null,
                presigned_url: null,
            },
        });
    });
}
exports.handleFiveBossAbort = handleFiveBossAbort;
