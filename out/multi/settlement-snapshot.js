"use strict";
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.transitionRoomSettlementSnapshots = exports.transitionMultiSettlementSnapshot = exports.getMultiSettlementSnapshot = exports.registerMultiSettlementSnapshot = exports.buildBattleInstanceId = void 0;
const routine_game_logging_1 = require("../lib/routine-game-logging");
const memory_diagnostics_1 = require("../lib/memory-diagnostics");
const quest_party_pool_shared_1 = require("./npc/quest-party-pool-shared");
const snapshots = new Map();
(0, memory_diagnostics_1.registerMemoryCounters)("battleSnapshots", () => ({ entries: snapshots.size }));
const LIFECYCLE_RANK = {
    BATTLE: 0,
    SETTLING: 1,
    RETURN_PENDING: 2,
    LOBBY: 3,
};
const START_TTL_MS = Math.max(120000, Number.parseInt((_a = process.env.MULTI_BATTLE_SNAPSHOT_TTL_MS) !== null && _a !== void 0 ? _a : "900000", 10) || 900000);
const COMPLETED_TTL_MS = Math.max(120000, Number.parseInt((_b = process.env.MULTI_SETTLEMENT_SNAPSHOT_TTL_MS) !== null && _b !== void 0 ? _b : "120000", 10) || 120000);
function key(playerId, playId) {
    return `${playerId}:${playId}`;
}
function cleanup(now = Date.now()) {
    for (const [entryKey, snapshot] of snapshots) {
        if (snapshot.expiresAt <= now)
            snapshots.delete(entryKey);
    }
}
function buildBattleInstanceId(roomNumber, roomGeneration, category, questId, roomInstanceId) {
    // The lobby generation increments for every rematch, while each client has
    // its own play_id.  Therefore generation (not play_id) is the shared battle
    // identity used by every participant's settlement barrier.
    return `${roomInstanceId !== null && roomInstanceId !== void 0 ? roomInstanceId : roomNumber}:${roomGeneration}:${category}:${questId}`;
}
exports.buildBattleInstanceId = buildBattleInstanceId;
function registerMultiSettlementSnapshot(input) {
    var _a, _b;
    cleanup();
    const now = Date.now();
    const snapshot = Object.assign(Object.assign({}, input), { activeQuest: Object.assign(Object.assign({}, input.activeQuest), { matePlayerIds: [...((_a = input.activeQuest.matePlayerIds) !== null && _a !== void 0 ? _a : [])], mateComIds: [...((_b = input.activeQuest.mateComIds) !== null && _b !== void 0 ? _b : [])] }), participants: input.participants.map(participant => (Object.assign({}, participant))), expectedRealViewerIds: [...input.expectedRealViewerIds], npcPartySnapshot: (0, quest_party_pool_shared_1.cloneQuestNpcPartySnapshot)(input.npcPartySnapshot), lifecycle: "BATTLE", createdAt: now, expiresAt: now + START_TTL_MS });
    snapshots.set(key(snapshot.playerId, snapshot.playId), snapshot);
    (0, routine_game_logging_1.routineGameLog)("multiSettlement", () => `[MULTI-SETTLEMENT] instance=${snapshot.battleInstanceId} player=${snapshot.playerId} state=BATTLE`);
    return snapshot;
}
exports.registerMultiSettlementSnapshot = registerMultiSettlementSnapshot;
function getMultiSettlementSnapshot(playerId, playId) {
    cleanup();
    return snapshots.get(key(playerId, playId));
}
exports.getMultiSettlementSnapshot = getMultiSettlementSnapshot;
function transitionMultiSettlementSnapshot(playerId, playId, lifecycle) {
    const snapshot = getMultiSettlementSnapshot(playerId, playId);
    if (!snapshot)
        return undefined;
    if (LIFECYCLE_RANK[lifecycle] < LIFECYCLE_RANK[snapshot.lifecycle]) {
        console.warn(`[MULTI-SETTLEMENT] ignored lifecycle regression instance=${snapshot.battleInstanceId}`
            + ` player=${playerId} current=${snapshot.lifecycle} requested=${lifecycle}`);
        return snapshot;
    }
    if (snapshot.lifecycle !== lifecycle) {
        snapshot.lifecycle = lifecycle;
        (0, routine_game_logging_1.routineGameLog)("multiSettlement", () => `[MULTI-SETTLEMENT] instance=${snapshot.battleInstanceId} player=${playerId} state=${lifecycle}`);
    }
    if (lifecycle === "RETURN_PENDING" || lifecycle === "LOBBY") {
        snapshot.expiresAt = Date.now() + COMPLETED_TTL_MS;
    }
    return snapshot;
}
exports.transitionMultiSettlementSnapshot = transitionMultiSettlementSnapshot;
function transitionRoomSettlementSnapshots(roomNumber, lifecycle, roomGeneration, roomInstanceId) {
    cleanup();
    let transitioned = 0;
    for (const snapshot of snapshots.values()) {
        if (snapshot.roomNumber !== roomNumber)
            continue;
        if (roomGeneration !== undefined && snapshot.roomGeneration !== roomGeneration)
            continue;
        if (roomInstanceId !== undefined && snapshot.roomInstanceId !== roomInstanceId)
            continue;
        // Host lobby return does not complete another member's unsettled play.
        if (lifecycle === "LOBBY" && snapshot.lifecycle === "BATTLE")
            continue;
        if (LIFECYCLE_RANK[lifecycle] < LIFECYCLE_RANK[snapshot.lifecycle]) {
            console.warn(`[MULTI-SETTLEMENT] ignored lifecycle regression instance=${snapshot.battleInstanceId}`
                + ` player=${snapshot.playerId} current=${snapshot.lifecycle} requested=${lifecycle}`);
            continue;
        }
        if (snapshot.lifecycle !== lifecycle) {
            snapshot.lifecycle = lifecycle;
            (0, routine_game_logging_1.routineGameLog)("multiSettlement", () => `[MULTI-SETTLEMENT] instance=${snapshot.battleInstanceId} player=${snapshot.playerId} state=${lifecycle}`);
            transitioned += 1;
        }
        if (lifecycle === "RETURN_PENDING" || lifecycle === "LOBBY") {
            snapshot.expiresAt = Date.now() + COMPLETED_TTL_MS;
        }
    }
    return transitioned;
}
exports.transitionRoomSettlementSnapshots = transitionRoomSettlementSnapshots;
