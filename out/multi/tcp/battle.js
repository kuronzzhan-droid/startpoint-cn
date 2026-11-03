"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleBattleRelayActivity = exports.handleBattleMessage = exports.discardPinnedBattleControlsForShutdown = void 0;
const SessionManager_1 = require("../state/SessionManager");
const relay_1 = require("./relay");
const chain_diagnostic_1 = require("./chain-diagnostic");
const manager_1 = require("../room/manager");
const lobby_runtime_1 = require("../five-boss/lobby-runtime");
const connection_diagnostic_1 = require("../five-boss/connection-diagnostic");
const business_facts_1 = require("../coordinator/business-facts");
const battle_telemetry_1 = require("../battle-telemetry");
const relay_recorder_1 = require("./relay-recorder");
const battle_contract_1 = require("../state/battle-contract");
const room_start_claims_1 = require("../coordinator/room-start-claims");
const business_rpc_1 = require("../coordinator/business-rpc");
const state_fingerprint_1 = require("./state-fingerprint");
// Each room still has the existing 64-control pin FIFO. The aggregate matches
// the bounded TCP work budget, and one close listener serves each socket.
const pendingPinnedControls = new Set();
const pinnedControlsBySocket = new Map();
const MAX_PENDING_PINNED_CONTROLS = 128;
function trackPinnedControl(socket, discard) {
    if (pendingPinnedControls.size >= MAX_PENDING_PINNED_CONTROLS)
        throw new Error("START_CONTROL_WORK_BUDGET");
    let entry = pinnedControlsBySocket.get(socket);
    if (!entry) {
        const controls = new Set();
        entry = { controls, close: () => { for (const cancel of [...controls])
                cancel(); } };
        pinnedControlsBySocket.set(socket, entry);
        socket.once("close", entry.close);
    }
    entry.controls.add(discard);
    pendingPinnedControls.add(discard);
    return () => {
        pendingPinnedControls.delete(discard);
        entry.controls.delete(discard);
        if (!entry.controls.size) {
            socket.off("close", entry.close);
            pinnedControlsBySocket.delete(socket);
        }
    };
}
/** Called after TCP ingress closes. No room transition, proof or business write. */
function discardPinnedBattleControlsForShutdown() {
    for (const discard of [...pendingPinnedControls])
        discard();
}
exports.discardPinnedBattleControlsForShutdown = discardPinnedBattleControlsForShutdown;
function findBattleClientBySocket(socket) {
    const client = SessionManager_1.sessionManager.findClientBySocket(socket);
    return (client === null || client === void 0 ? void 0 : client.isBattle) ? client : undefined;
}
function sendToBattleClient(client, data, channel) {
    SessionManager_1.sessionManager.sendJson(client.socket, data, {
        roomNumber: client.roomNumber,
        connectionId: client.connectionId,
        viewerId: client.viewerId,
        roomGeneration: client.roomGeneration,
        channel,
    });
}
function handleBattleNotify(socket, data, indexedClient) {
    var _a, _b;
    if (!Array.isArray(data))
        return;
    const tag = data[0];
    // The outer packet handler already resolved this socket. Reuse that
    // lookup for notify/relay handling so a high-rate battle connection does
    // not perform the same Map lookup three times for every frame.
    const client = indexedClient !== null && indexedClient !== void 0 ? indexedClient : findBattleClientBySocket(socket);
    if (client)
        (0, chain_diagnostic_1.recordBattleNotify)(client, tag, data);
    if (tag === 0 || tag === 1 || tag === 2) {
        connection_diagnostic_1.fiveBossConnectionDiagnostics.socketEvent(socket, tag === 0 ? "scene_ready" : tag === 1 ? "level_next" : "finalize", client ? "indexed" : "client_unindexed");
    }
    switch (tag) {
        case 0: { // SceneReady
            if (!client)
                break;
            SessionManager_1.sessionManager.markSceneReady(client.connectionId, client.roomNumber);
            break;
        }
        case 1: { // LevelNext (CN dual-boss battle)
            if (client) {
                const room = (0, manager_1.getRoom)(client.roomNumber);
                if (room === null || room === void 0 ? void 0 : room.five_boss_runtime)
                    (0, lobby_runtime_1.recordFiveBossSignal)(room, client, "level_next");
                SessionManager_1.sessionManager.beginBattleLevelNext(client.connectionId, client.roomNumber);
            }
            break;
        }
        case 2: { // Finalize
            const room = client && (0, manager_1.getRoom)(client.roomNumber);
            if (client && (room === null || room === void 0 ? void 0 : room.five_boss_runtime))
                (0, lobby_runtime_1.recordFiveBossSignal)(room, client, "finalize");
            if (client)
                client.finalizeSent = true;
            if (client && room)
                (0, battle_contract_1.markBattleMemberPhase)(room, client.viewerId, "FINALIZED");
            if (client)
                sendToBattleClient(client, [1, [2]], "battle_finalize_ack");
            break;
        }
        case 3: { // Measurement
            if (client) {
                const params = data[1];
                const frame = (_a = params === null || params === void 0 ? void 0 : params[0]) !== null && _a !== void 0 ? _a : 0;
                const clientTime = (_b = params === null || params === void 0 ? void 0 : params[1]) !== null && _b !== void 0 ? _b : 0;
                sendToBattleClient(client, [1, [3, frame, clientTime, Date.now()]], "battle_measurement_ack");
            }
            break;
        }
        case 4: // LineSpeedWarning
            break;
        case 5: // Heartbeat
            if ((0, state_fingerprint_1.isStateFingerprintNotify)(data)) {
                (0, state_fingerprint_1.handleBattleFingerprintNotify)(socket, data, client);
                break;
            }
            if (client)
                sendToBattleClient(client, [1, [3, 0, 0, Date.now()]], "battle_heartbeat_ack");
            break;
        default:
            break;
    }
}
function handleBattleMessage(socket, data) {
    if (!Array.isArray(data))
        return;
    const tag = data[0];
    const activityClient = findBattleClientBySocket(socket);
    if (activityClient && !SessionManager_1.sessionManager.isCurrentBattleClient(activityClient))
        return;
    if (activityClient && tag === 0 && Array.isArray(data[1]) && [0, 1, 2].includes(data[1][0])) {
        const room = (0, manager_1.getRoom)(activityClient.roomNumber), control = data[1][0];
        const instanceId = room === null || room === void 0 ? void 0 : room.lifecycle.instanceId, battleSessionId = room === null || room === void 0 ? void 0 : room.lifecycle.battleSessionId;
        if (room) {
            let completeDeferred;
            const deferredTail = new Promise(resolve => { completeDeferred = resolve; });
            const restoreBusinessContext = (0, business_rpc_1.captureRealtimeBusinessContext)();
            let discarded = false, completed = false, untrack = () => { };
            const finish = () => {
                if (completed)
                    return;
                completed = true;
                untrack();
                completeDeferred();
            };
            const discard = () => { discarded = true; finish(); };
            try {
                if ((0, room_start_claims_1.deferPinnedRoomControl)(room, () => {
                    if (discarded)
                        return;
                    try {
                        restoreBusinessContext(() => {
                            const current = (0, manager_1.getRoom)(activityClient.roomNumber);
                            if (current === room && current.lifecycle.instanceId === instanceId
                                && current.lifecycle.battleSessionId === battleSessionId
                                && !socket.destroyed && SessionManager_1.sessionManager.isCurrentBattleClient(activityClient)) {
                                handleBattleMessage(socket, [0, [control]]);
                            }
                        });
                    }
                    catch (_a) {
                        socket.destroy();
                    }
                    finally {
                        finish();
                    }
                })) {
                    // A stored callback is outside the original async chain.
                    // Keep its accepted TCP work alive until replay or discard;
                    // any proof scheduled by replay retains its own tail.
                    untrack = trackPinnedControl(socket, discard);
                    if (socket.destroyed)
                        discard();
                    void (0, business_rpc_1.retainRealtimeBusinessTail)(deferredTail).catch(() => socket.destroy());
                    return;
                }
                finish();
            }
            catch (_a) {
                discard();
                socket.destroy();
                return;
            }
        }
    }
    connection_diagnostic_1.fiveBossConnectionDiagnostics.packet(socket, !!activityClient);
    if (activityClient && (!(0, state_fingerprint_1.isStateFingerprintPacket)(data) || (0, state_fingerprint_1.isStateFingerprintEnabled)())) {
        (0, relay_recorder_1.recordBattleFrame)(activityClient.roomNumber, activityClient.roomGeneration, activityClient.viewerId, activityClient.connectionId, data);
    }
    if (activityClient) {
        SessionManager_1.sessionManager.noteBattleActivity(activityClient.connectionId);
        battle_telemetry_1.battleTelemetry.packet(activityClient.roomNumber, activityClient.viewerId, tag, tag === 0 && Array.isArray(data[1]) ? data[1][0] : undefined);
        if (!socket.destroyed && SessionManager_1.sessionManager.isCurrentBattleClient(activityClient)) {
            (0, business_facts_1.notifyRealtimePresence)(activityClient.viewerId);
        }
    }
    switch (tag) {
        case 0: // Notify
            handleBattleNotify(socket, data[1], activityClient);
            break;
        case 1: { // Broadcast → relay as BattleServer2Client.Messages(2, senderId, array)
            const client = activityClient;
            if (client) {
                const bcData = data[1];
                (0, relay_1.relayToBattleRoom)(client, [2, client.connectionId, bcData], "broadcast", tag);
                sendToBattleClient(client, [1, [3, 0, 0, Date.now()]], "battle_broadcast_ack");
            }
            break;
        }
        case 2: { // Send → relay as BattleServer2Client.Send(3, senderId, message)
            const client = activityClient;
            if (client) {
                const sendMsg = data[2];
                if (sendMsg !== undefined && sendMsg !== null) {
                    (0, relay_1.relayToBattleRoom)(client, [3, client.connectionId, sendMsg], "direct", tag);
                }
                sendToBattleClient(client, [1, [3, 0, 0, Date.now()]], "battle_direct_ack");
            }
            break;
        }
        default:
            break;
    }
}
exports.handleBattleMessage = handleBattleMessage;
/** Child-local packets refresh existing leases and diagnostics without replay. */
function handleBattleRelayActivity(socket, activity) {
    const client = findBattleClientBySocket(socket);
    if (!client || socket.destroyed || !SessionManager_1.sessionManager.isCurrentBattleClient(client))
        return;
    const packets = activity.broadcasts + activity.sends + activity.heartbeats
        + activity.measurements + activity.lineSpeedWarnings;
    if (packets > 0) {
        connection_diagnostic_1.fiveBossConnectionDiagnostics.packet(socket, true);
        SessionManager_1.sessionManager.noteBattleActivity(client.connectionId);
        (0, business_facts_1.notifyRealtimePresence)(client.viewerId);
    }
    battle_telemetry_1.battleTelemetry.relayActivity(client.roomNumber, client.viewerId, {
        packets, broadcasts: activity.broadcasts + activity.sends,
        lineSpeedWarnings: activity.lineSpeedWarnings, maxGapMs: activity.maxGapMs,
        relayedOut: activity.relayedOut,
    });
    if (activity.maxBackpressureMs >= 100) {
        battle_telemetry_1.battleTelemetry.backpressure(client.roomNumber, client.viewerId, activity.maxBackpressureMs);
    }
}
exports.handleBattleRelayActivity = handleBattleRelayActivity;
