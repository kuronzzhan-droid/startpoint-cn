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
exports.recordFiveBossSignal = exports.isFrozenFiveBossBattleClient = exports.freezeFiveBossLobby = exports.drainFiveBossSignalPersistence = exports.waitForFiveBossSignalPersistence = exports.fiveBossProofBarrierStatus = exports.clearFiveBossProofStatus = void 0;
const crypto_1 = require("crypto");
const manager_1 = require("../room/manager");
const SessionManager_1 = require("../state/SessionManager");
const contract_1 = require("./contract");
const coalesced_diagnostics_1 = require("../../lib/coalesced-diagnostics");
const connection_diagnostic_1 = require("./connection-diagnostic");
const business_rpc_1 = require("../coordinator/business-rpc");
const runtime_role_1 = require("../coordinator/runtime-role");
const business_facts_1 = require("../coordinator/business-facts");
const loadout_1 = require("../../lib/weapon-riven/loadout");
const equipment_ready_1 = require("../room/equipment-ready");
// TCP proof notifications are acknowledged before their SQLite write has
// necessarily committed.  Keep the tail for each frozen member so HTTP
// settlement can wait for notifications that already reached this process.
const pendingFiveBossSignalWrites = new Map();
const failedFiveBossSignals = new Map();
const proofSequences = new WeakMap();
const terminalProofRuns = new Map();
/** Only a parent-confirmed terminal ledger event can forget an unresolved proof failure. */
function clearFiveBossProofStatus(runId) {
    terminalProofRuns.set(runId, Date.now());
    while (terminalProofRuns.size > 4096)
        terminalProofRuns.delete(terminalProofRuns.keys().next().value);
    for (const key of failedFiveBossSignals.keys())
        if (key.startsWith(`${runId}:`))
            failedFiveBossSignals.delete(key);
}
exports.clearFiveBossProofStatus = clearFiveBossProofStatus;
function fiveBossProofBarrierStatus(runId, playerId) {
    var _a;
    return { ok: !((_a = failedFiveBossSignals.get(fiveBossSignalKey(runId, playerId))) === null || _a === void 0 ? void 0 : _a.signals.size) };
}
exports.fiveBossProofBarrierStatus = fiveBossProofBarrierStatus;
function fiveBossSignalKey(runId, playerId) {
    return `${runId}:${playerId}`;
}
// level_next/finalize are first-write-wins (COALESCE) rows. Once a signal for
// a member is queued or recorded, repeated frames need no further write.
// Keyed by the frozen runtime object so entries vanish with the run.
const acceptedFiveBossSignals = new WeakMap();
function acceptedSignalsFor(runtime) {
    let accepted = acceptedFiveBossSignals.get(runtime);
    if (!accepted)
        acceptedFiveBossSignals.set(runtime, accepted = new Set());
    return accepted;
}
/** Wait for proof notifications already accepted from this member's socket. */
function waitForFiveBossSignalPersistence(runId, playerId) {
    var _a;
    return (_a = pendingFiveBossSignalWrites.get(fiveBossSignalKey(runId, playerId))) !== null && _a !== void 0 ? _a : Promise.resolve();
}
exports.waitForFiveBossSignalPersistence = waitForFiveBossSignalPersistence;
/** Includes detached proof tails accepted before TCP ingress was withdrawn. */
function drainFiveBossSignalPersistence() {
    return __awaiter(this, void 0, void 0, function* () {
        while (pendingFiveBossSignalWrites.size)
            yield Promise.allSettled([...pendingFiveBossSignalWrites.values()]);
    });
}
exports.drainFiveBossSignalPersistence = drainFiveBossSignalPersistence;
/** Freeze the canonical live lobby before either HTTP or TCP starts the battle. */
function freezeFiveBossLobby(room, members, conversionLoadouts) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    if (!(0, contract_1.isFiveBossGauntletQuest)(room.category, room.quest_id))
        return true;
    if (room.five_boss_runtime)
        return true;
    const generation = room.lifecycle.phase === "BATTLE"
        ? Math.max(0, room.lobby_generation - 1) : room.lobby_generation;
    const clients = SessionManager_1.sessionManager.getClientsInRoom(room.room_number, generation)
        .filter(client => !client.isBattle && !client.superseded);
    const host = clients.find(client => client.viewerId === room.host_viewer_id);
    const canonical = new Map();
    for (const mate of [...((_a = members !== null && members !== void 0 ? members : host === null || host === void 0 ? void 0 : host.mates) !== null && _a !== void 0 ? _a : []), ...clients.map(c => c.yourself)]) {
        if (mate)
            canonical.set(mate.comId ? `com:${mate.comId}` : `viewer:${mate.viewerId}`, mate);
    }
    const roster = [...canonical.values()];
    // A two-player room is valid. AI may fill the third slot, but it is not a
    // prerequisite for starting when two real players are ready.
    if (!host || roster.length < 2 || roster.length > contract_1.FIVE_BOSS_GAUNTLET.roomMemberLimit
        || !roster.every(mate => { var _a; return ((_a = mate.state) === null || _a === void 0 ? void 0 : _a[0]) === 1; }))
        return false;
    const frozen = {
        runId: (0, crypto_1.randomUUID)(), expectedRealPlayerIds: [], battleEnteredPlayerIds: [],
        autoplayModeByPlayerId: {},
        partyCharacterIdsByPlayerId: {}, battleIdentityByViewerId: {},
        weaponRivenLoadoutByPlayerId: {},
    };
    for (const mate of roster.filter(m => !m.comId)) {
        const live = clients.find(client => client.viewerId === Number(mate.viewerId));
        const playerId = (0, manager_1.getRoomMemberPlayerId)(room, Number(mate.viewerId));
        if (!live || !playerId || live.playerId !== playerId
            || typeof ((_b = live.yourself) === null || _b === void 0 ? void 0 : _b.autoplayMode) !== "boolean" || !live.socket.remoteAddress)
            return false;
        const party = (_d = (_c = members === null || members === void 0 ? void 0 : members.find(member => !member.comId && Number(member.viewerId) === live.viewerId)) === null || _c === void 0 ? void 0 : _c.party) !== null && _d !== void 0 ? _d : live.yourself.party;
        if (!Array.isArray(party === null || party === void 0 ? void 0 : party.characters) || !Array.isArray(party === null || party === void 0 ? void 0 : party.unison_characters)
            || party.characters.length > 3 || party.unison_characters.length > 3)
            return false;
        const ids = [...((_e = party === null || party === void 0 ? void 0 : party.characters) !== null && _e !== void 0 ? _e : []), ...((_f = party === null || party === void 0 ? void 0 : party.unison_characters) !== null && _f !== void 0 ? _f : [])]
            .filter(entry => Array.isArray(entry) && entry[0] === 0)
            .map(entry => { var _a; return Number((_a = entry[1]) === null || _a === void 0 ? void 0 : _a.id); })
            .filter(id => Number.isSafeInteger(id) && id > 0);
        const partyId = (_h = (_g = room.equipmentPartyIds) === null || _g === void 0 ? void 0 : _g[live.viewerId]) !== null && _h !== void 0 ? _h : (0, equipment_ready_1.selectedPartyId)(live);
        const facts = (0, business_facts_1.getPlayerBusinessFacts)(playerId, { category: Number(room.category), questId: room.quest_id, partyId });
        // Embedded tests still use the parent business reader. The child must
        // have an authenticated, refreshed ownership fact before freezing.
        const owns = (id) => (0, runtime_role_1.isRealtimeOwnerChild)()
            ? !!(facts === null || facts === void 0 ? void 0 : facts.ownedCharacterIds.includes(id))
            : !!require("../../data/domains/character").getPlayerCharacterSync(playerId, id);
        if (!ids.length || ids.some(id => !owns(id))
            || frozen.expectedRealPlayerIds.includes(playerId))
            return false;
        frozen.expectedRealPlayerIds.push(playerId);
        frozen.autoplayModeByPlayerId[String(playerId)] = live.yourself.autoplayMode;
        frozen.partyCharacterIdsByPlayerId[String(playerId)] = [...new Set(ids)];
        // Wire party fields are client assertions, even when character ownership passed.
        // Only the parent's saved-party projection authorizes unknown-riven conversion.
        const frozenLoadout = conversionLoadouts === null || conversionLoadouts === void 0 ? void 0 : conversionLoadouts.find(member => member.playerId === playerId);
        if (conversionLoadouts && !frozenLoadout)
            return false;
        frozen.weaponRivenLoadoutByPlayerId[String(playerId)] = frozenLoadout
            ? (0, loadout_1.normalizeWeaponRivenLoadout)(frozenLoadout.loadout) : (0, runtime_role_1.isRealtimeOwnerChild)()
            ? (0, loadout_1.normalizeWeaponRivenLoadout)(facts === null || facts === void 0 ? void 0 : facts.weaponRivenLoadout)
            : require("../../lib/weapon-riven/battle").getSoloWeaponRivenStartLoadoutSync(playerId, partyId);
        frozen.battleIdentityByViewerId[String(live.viewerId)] = {
            playerId, remoteAddress: live.socket.remoteAddress, connectionId: live.connectionId,
        };
    }
    if (!frozen.expectedRealPlayerIds.includes(room.host_player_id))
        return false;
    room.five_boss_runtime = frozen;
    connection_diagnostic_1.fiveBossConnectionDiagnostics.begin(room);
    return true;
}
exports.freezeFiveBossLobby = freezeFiveBossLobby;
function isFrozenFiveBossBattleClient(room, client) {
    var _a;
    const identity = (_a = room.five_boss_runtime) === null || _a === void 0 ? void 0 : _a.battleIdentityByViewerId[String(client.viewerId)];
    return !!identity && identity.playerId === client.playerId
        && identity.connectionId === client.connectionId && !client.superseded;
}
exports.isFrozenFiveBossBattleClient = isFrozenFiveBossBattleClient;
function recordFiveBossSignal(room, client, signal) {
    var _a, _b, _c, _d, _e, _f;
    if (!isFrozenFiveBossBattleClient(room, client)) {
        connection_diagnostic_1.fiveBossConnectionDiagnostics.socketEvent(client.socket, "signal_rejected", `${signal}:identity`);
        coalesced_diagnostics_1.fiveBossDiagnostics.report(JSON.stringify(["signal", (_a = room.five_boss_runtime) === null || _a === void 0 ? void 0 : _a.runId, room.room_number,
            client.playerId, signal, "identity"]), () => {
            var _a;
            return `[FIVE-BOSS-SIGNAL] rejected=identity room=${room.room_number}`
                + ` run=${(_a = room.five_boss_runtime) === null || _a === void 0 ? void 0 : _a.runId} player=${client.playerId} connection=${client.connectionId} signal=${signal}`;
        });
        return false;
    }
    if (signal === "scene_ready" && client.fiveBossBattleEntered)
        return true;
    const runtime = room.five_boss_runtime;
    const runId = runtime.runId;
    const playerId = client.playerId;
    const roomNumber = room.room_number;
    const dedupeKey = `${playerId}:${signal}`;
    if (signal !== "scene_ready") {
        const accepted = acceptedSignalsFor(runtime);
        if (accepted.has(dedupeKey))
            return true;
        accepted.add(dedupeKey);
    }
    if (signal === "scene_ready")
        client.fiveBossBattleEntered = true;
    // The TCP handler must only update the in-memory barrier and return. The
    // proof row is durable evidence, but it is not part of the realtime ACK.
    connection_diagnostic_1.fiveBossConnectionDiagnostics.socketEvent(client.socket, signal === "scene_ready" ? "battle_entry_queued"
        : signal === "level_next" ? "level_next_queued" : "finalize_queued", "tcp");
    const key = fiveBossSignalKey(runId, playerId);
    for (const [oldRun, at] of terminalProofRuns)
        if (Date.now() - at > 300000)
            terminalProofRuns.delete(oldRun);
    if (failedFiveBossSignals.size >= 4096 && !failedFiveBossSignals.has(key)) {
        if (signal === "scene_ready")
            client.fiveBossBattleEntered = false;
        else
            (_b = acceptedFiveBossSignals.get(runtime)) === null || _b === void 0 ? void 0 : _b.delete(dedupeKey);
        connection_diagnostic_1.fiveBossConnectionDiagnostics.socketEvent(client.socket, "signal_rejected", `${signal}:proof_budget`);
        (_d = (_c = client.socket).destroy) === null || _d === void 0 ? void 0 : _d.call(_c, new Error("FIVE_BOSS_PROOF_BUDGET"));
        return false;
    }
    const previous = (_e = pendingFiveBossSignalWrites.get(key)) !== null && _e !== void 0 ? _e : Promise.resolve();
    // Acquire admission now. The coordinator already preserves per-player
    // order; waiting on another tail here would bypass its upstream bound.
    const proofSequence = ((_f = proofSequences.get(runtime)) !== null && _f !== void 0 ? _f : 0) + 1;
    proofSequences.set(runtime, proofSequence);
    const attempted = (0, business_rpc_1.invokeRealtimeBusiness)("fiveBoss.proof.persist", {
        runId, playerId, roomNumber, signal, proofSequence,
        roomInstanceId: room.lifecycle.instanceId,
        battleSessionId: room.lifecycle.battleSessionId,
    })
        .catch((error) => __awaiter(this, void 0, void 0, function* () {
        const uncertain = error;
        // This local promise observes the original application ACK. It is
        // not another business request and remains inside its IPC budget.
        if ((uncertain === null || uncertain === void 0 ? void 0 : uncertain.code) === "BUSINESS_OUTCOME_UNKNOWN" && uncertain.confirmation
            && typeof uncertain.confirmation.then === "function") {
            return yield uncertain.confirmation;
        }
        throw error;
    }))
        .then(result => { if (!result.persisted)
        throw new Error("Proof application ACK missing"); })
        .then(() => {
        var _a, _b, _c, _d;
        (_a = failedFiveBossSignals.get(key)) === null || _a === void 0 ? void 0 : _a.signals.delete(signal);
        if (((_b = failedFiveBossSignals.get(key)) === null || _b === void 0 ? void 0 : _b.signals.size) === 0)
            failedFiveBossSignals.delete(key);
        const currentRuntime = room.five_boss_runtime;
        if (signal === "scene_ready"
            && (currentRuntime === null || currentRuntime === void 0 ? void 0 : currentRuntime.runId) === runId
            && !((_c = currentRuntime.battleEnteredPlayerIds) === null || _c === void 0 ? void 0 : _c.includes(playerId))) {
            ((_d = currentRuntime.battleEnteredPlayerIds) !== null && _d !== void 0 ? _d : (currentRuntime.battleEnteredPlayerIds = [])).push(playerId);
        }
        connection_diagnostic_1.fiveBossConnectionDiagnostics.socketEvent(client.socket, signal === "scene_ready" ? "battle_entry_recorded"
            : signal === "level_next" ? "level_next_recorded" : "finalize_recorded", "tcp");
    });
    // Observe both immediately, but retain earlier proof writes in the HTTP
    // drain even if a later signal is rejected before it can enter the queue.
    const pending = (0, business_rpc_1.retainRealtimeBusinessTail)(Promise.all([previous, attempted]).then(() => { })
        .catch((error) => __awaiter(this, void 0, void 0, function* () {
        var _g, _h, _j;
        yield previous;
        // This handler terminates the chain: it must never throw, or the
        // next queued signal and the cleanup below would see a rejection.
        try {
            if (!terminalProofRuns.has(runId)) {
                const failure = (_g = failedFiveBossSignals.get(key)) !== null && _g !== void 0 ? _g : { at: Date.now(), signals: new Set() };
                failure.at = Date.now();
                failure.signals.add(signal);
                failedFiveBossSignals.set(key, failure);
            }
            if (signal === "scene_ready")
                client.fiveBossBattleEntered = false;
            else
                (_h = acceptedFiveBossSignals.get(runtime)) === null || _h === void 0 ? void 0 : _h.delete(dedupeKey);
            const code = (_j = error === null || error === void 0 ? void 0 : error.code) !== null && _j !== void 0 ? _j : "unknown";
            const message = error instanceof Error ? error.message : String(error);
            connection_diagnostic_1.fiveBossConnectionDiagnostics.socketEvent(client.socket, "signal_rejected", `${signal}:${code}`);
            coalesced_diagnostics_1.fiveBossDiagnostics.report(JSON.stringify(["signal", runId, roomNumber,
                playerId, signal, code]), () => `[FIVE-BOSS-SIGNAL] rejected=${code}`
                + ` room=${roomNumber} run=${runId}`
                + ` player=${playerId} connection=${client.connectionId} signal=${signal}: ${message}`);
        }
        catch (reportError) {
            console.error("[FIVE-BOSS-SIGNAL] failed to report rejected signal", reportError);
        }
    })));
    pendingFiveBossSignalWrites.set(key, pending);
    void pending.finally(() => {
        if (pendingFiveBossSignalWrites.get(key) === pending)
            pendingFiveBossSignalWrites.delete(key);
    }).catch(() => { });
    return true;
}
exports.recordFiveBossSignal = recordFiveBossSignal;
