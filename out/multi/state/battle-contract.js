"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findBattlePlayBinding = exports.markBattleMemberPhase = exports.beginBattleSceneEpoch = exports.battleMemberCanPlay = exports.battleConnectionMatches = exports.bindBattleConnection = exports.releaseBattlePlayClaim = exports.bindBattlePlay = exports.claimBattlePlay = exports.retainBattleSessionContract = exports.getBattleSessionContract = exports.ensureBattleSessionContract = exports.roomCommandIdentityMatches = exports.captureRoomCommandIdentity = void 0;
const node_perf_hooks_1 = require("node:perf_hooks");
// No persisted schema or player progress is changed. Old runs are retained
// separately from the lobby, with the same finite lifetime as finish snapshots.
const contracts = new WeakMap();
const RETENTION_MS = 15 * 60000;
const MAX_RETAINED_RUNS = 8;
function captureRoomCommandIdentity(room) {
    var _a;
    return {
        instanceId: room.lifecycle.instanceId,
        generation: room.lobby_generation,
        battleSessionId: room.lifecycle.battleSessionId,
        sceneEpoch: (_a = room.lifecycle.sceneEpoch) !== null && _a !== void 0 ? _a : 0,
    };
}
exports.captureRoomCommandIdentity = captureRoomCommandIdentity;
function roomCommandIdentityMatches(room, expected) {
    var _a;
    return !!room && room.lifecycle.phase !== "DISBANDED"
        && room.lifecycle.instanceId === expected.instanceId
        && room.lobby_generation === expected.generation
        && room.lifecycle.battleSessionId === expected.battleSessionId
        && ((_a = room.lifecycle.sceneEpoch) !== null && _a !== void 0 ? _a : 0) === expected.sceneEpoch
        && (expected.version === undefined || expected.version === room.lifecycle.version);
}
exports.roomCommandIdentityMatches = roomCommandIdentityMatches;
function ensureBattleSessionContract(room) {
    var _a;
    const id = room.lifecycle.battleSessionId;
    if (!id)
        return undefined;
    let runs = contracts.get(room);
    if (!runs)
        contracts.set(room, runs = new Map());
    const existing = runs.get(id);
    if (existing)
        return existing;
    const now = node_perf_hooks_1.performance.now();
    for (const [key, run] of runs) {
        if (run.retainedAt !== undefined && now - run.retainedAt > RETENTION_MS)
            runs.delete(key);
    }
    while (runs.size >= MAX_RETAINED_RUNS)
        runs.delete(runs.keys().next().value);
    const ids = [...new Set(room.expected_real_viewer_ids.length > 0
            ? room.expected_real_viewer_ids : room.member_viewer_ids)];
    const run = {
        roomInstanceId: room.lifecycle.instanceId, battleSessionId: id,
        generation: room.lobby_generation, category: Number(room.category), questId: room.quest_id,
        viewerIds: Object.freeze(ids), createdAt: now, sceneEpoch: (_a = room.lifecycle.sceneEpoch) !== null && _a !== void 0 ? _a : 0,
        members: new Map(ids.map(viewerId => {
            var _a, _b, _c;
            return [viewerId, {
                    viewerId, playerId: (_b = (_a = room.member_player_ids) === null || _a === void 0 ? void 0 : _a[viewerId]) !== null && _b !== void 0 ? _b : null,
                    connectionId: "", connectionEpoch: 0, phase: "LOADING",
                    sceneEpoch: (_c = room.lifecycle.sceneEpoch) !== null && _c !== void 0 ? _c : 0,
                }];
        })),
    };
    runs.set(id, run);
    return run;
}
exports.ensureBattleSessionContract = ensureBattleSessionContract;
function getBattleSessionContract(room, id = room.lifecycle.battleSessionId) {
    var _a;
    return id ? (_a = contracts.get(room)) === null || _a === void 0 ? void 0 : _a.get(id) : undefined;
}
exports.getBattleSessionContract = getBattleSessionContract;
function retainBattleSessionContract(room) {
    const run = getBattleSessionContract(room);
    if (run && run.retainedAt === undefined)
        run.retainedAt = node_perf_hooks_1.performance.now();
}
exports.retainBattleSessionContract = retainBattleSessionContract;
function assignBattlePlay(room, viewerId, playerId, playId, battleSessionId = room.lifecycle.battleSessionId) {
    const run = battleSessionId === room.lifecycle.battleSessionId
        ? ensureBattleSessionContract(room) : getBattleSessionContract(room, battleSessionId);
    const member = run === null || run === void 0 ? void 0 : run.members.get(viewerId);
    if (!member || !playId || (member.playerId !== null && member.playerId !== playerId)
        || (member.playId !== undefined && member.playId !== playId))
        return false;
    member.playerId = playerId;
    member.playId = playId;
    return true;
}
function claimBattlePlay(room, viewerId, playerId, playId, battleSessionId = room.lifecycle.battleSessionId) {
    var _a;
    if (!assignBattlePlay(room, viewerId, playerId, playId, battleSessionId))
        return false;
    const member = getBattleSessionContract(room, battleSessionId).members.get(viewerId);
    member.playClaims = ((_a = member.playClaims) !== null && _a !== void 0 ? _a : 0) + 1;
    return true;
}
exports.claimBattlePlay = claimBattlePlay;
function bindBattlePlay(room, viewerId, playerId, playId, battleSessionId = room.lifecycle.battleSessionId) {
    if (!assignBattlePlay(room, viewerId, playerId, playId, battleSessionId))
        return false;
    getBattleSessionContract(room, battleSessionId).members.get(viewerId).playCommitted = true;
    return true;
}
exports.bindBattlePlay = bindBattlePlay;
function releaseBattlePlayClaim(room, viewerId, playId, battleSessionId) {
    var _a, _b;
    const member = (_a = getBattleSessionContract(room, battleSessionId)) === null || _a === void 0 ? void 0 : _a.members.get(viewerId);
    if ((member === null || member === void 0 ? void 0 : member.playId) !== playId)
        return;
    member.playClaims = Math.max(0, ((_b = member.playClaims) !== null && _b !== void 0 ? _b : 0) - 1);
    if (!member.playCommitted && member.playClaims === 0)
        delete member.playId;
}
exports.releaseBattlePlayClaim = releaseBattlePlayClaim;
function bindBattleConnection(room, client) {
    const run = ensureBattleSessionContract(room);
    if (!run)
        return true; // Compatibility for explicitly constructed legacy test rooms.
    const member = run.members.get(client.viewerId);
    if (!member || member.phase === "RETIRED" || member.phase === "FINALIZED"
        || member.phase === "SETTLED" || member.phase === "RETURNED"
        || (member.playerId !== null && client.playerId !== member.playerId))
        return false;
    member.connectionId = client.connectionId;
    member.connectionEpoch++;
    client.roomInstanceId = run.roomInstanceId;
    client.battleSessionId = run.battleSessionId;
    client.connectionGeneration = member.connectionEpoch;
    client.sceneEpoch = run.sceneEpoch;
    return true;
}
exports.bindBattleConnection = bindBattleConnection;
function battleConnectionMatches(room, client) {
    var _a;
    if (client.superseded)
        return false;
    // Older focused fixtures have no captured binding; production binds before indexing.
    if (!client.roomInstanceId)
        return true;
    if (client.roomInstanceId !== room.lifecycle.instanceId
        || client.battleSessionId !== room.lifecycle.battleSessionId)
        return false;
    const member = (_a = getBattleSessionContract(room)) === null || _a === void 0 ? void 0 : _a.members.get(client.viewerId);
    return !!member && member.phase !== "RETIRED"
        && member.connectionId === client.connectionId
        && member.connectionEpoch === client.connectionGeneration;
}
exports.battleConnectionMatches = battleConnectionMatches;
function battleMemberCanPlay(room, viewerId) {
    var _a;
    const run = getBattleSessionContract(room);
    if (!run)
        return true;
    const phase = (_a = run.members.get(viewerId)) === null || _a === void 0 ? void 0 : _a.phase;
    return phase === "LOADING" || phase === "READY" || phase === "ACTIVE";
}
exports.battleMemberCanPlay = battleMemberCanPlay;
function beginBattleSceneEpoch(room) {
    var _a;
    if (require("../coordinator/room-start-claims").hasRoomStartClaims(room))
        throw new Error("START_CLAIM_PENDING");
    const run = ensureBattleSessionContract(room);
    const epoch = ((_a = room.lifecycle.sceneEpoch) !== null && _a !== void 0 ? _a : 0) + 1;
    room.lifecycle.sceneEpoch = epoch;
    room.lifecycle.version++;
    if (run) {
        run.sceneEpoch = epoch;
        for (const member of run.members.values()) {
            if (member.phase === "ACTIVE" || member.phase === "READY" || member.phase === "LOADING") {
                member.phase = "LOADING";
                member.sceneEpoch = epoch;
            }
        }
    }
    return epoch;
}
exports.beginBattleSceneEpoch = beginBattleSceneEpoch;
function markBattleMemberPhase(room, viewerId, phase, battleSessionId = room.lifecycle.battleSessionId) {
    var _a;
    const member = (_a = getBattleSessionContract(room, battleSessionId)) === null || _a === void 0 ? void 0 : _a.members.get(viewerId);
    if (!member || member.phase === "RETIRED")
        return false;
    if ((phase === "LOADING" || phase === "READY" || phase === "ACTIVE")
        && (member.phase === "FINALIZED" || member.phase === "SETTLED" || member.phase === "RETURNED"))
        return false;
    if (phase === "SETTLED" && member.phase === "RETURNED")
        return true;
    const terminalRank = { FINALIZED: 1, SETTLED: 2, RETURNED: 3, RETIRED: 4 };
    if (terminalRank[member.phase] !== undefined && terminalRank[phase] !== undefined
        && terminalRank[phase] < terminalRank[member.phase])
        return false;
    member.phase = phase;
    return true;
}
exports.markBattleMemberPhase = markBattleMemberPhase;
function findBattlePlayBinding(room, viewerId, playerId, playId) {
    const runs = contracts.get(room);
    if (!runs)
        return undefined;
    const now = node_perf_hooks_1.performance.now();
    for (const run of runs.values()) {
        if (run.retainedAt !== undefined && now - run.retainedAt > RETENTION_MS)
            continue;
        const member = run.members.get(viewerId);
        if ((member === null || member === void 0 ? void 0 : member.playerId) !== playerId || member.playId !== playId)
            continue;
        return {
            roomInstanceId: run.roomInstanceId, battleSessionId: run.battleSessionId,
            generation: run.generation, playId, category: run.category, questId: run.questId,
            phase: member.phase, current: room.lifecycle.battleSessionId === run.battleSessionId,
        };
    }
    return undefined;
}
exports.findBattlePlayBinding = findBattlePlayBinding;
