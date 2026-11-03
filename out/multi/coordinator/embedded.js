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
exports.embeddedMultiCoordinator = exports.EmbeddedMultiCoordinator = void 0;
const crypto_1 = require("crypto");
const settlement_snapshot_1 = require("../settlement-snapshot");
const game_logging_1 = require("../../lib/game-logging");
const battle_telemetry_1 = require("../battle-telemetry");
const battle_contract_1 = require("../state/battle-contract");
const room_start_claims_1 = require("./room-start-claims");
const runtime_role_1 = require("./runtime-role");
const ALLOWED_TRANSITIONS = {
    LOBBY: ["STARTING", "DISBANDED"],
    STARTING: ["LOBBY", "BATTLE", "DISBANDED"],
    BATTLE: ["SETTLING", "RETURNING", "DISBANDED"],
    SETTLING: ["RETURNING", "DISBANDED"],
    RETURNING: ["LOBBY", "DISBANDED"],
    DISBANDED: [],
};
/**
 * Single-process multiplayer coordinator.
 *
 * Typed lifecycle commands carry serializable identities. Legacy callbacks
 * remain internal migration seams; they are not a remote Hub protocol.
 */
class EmbeddedMultiCoordinator {
    constructor() {
        this.roomQueues = new Map();
    }
    drain() {
        return __awaiter(this, void 0, void 0, function* () {
            while (this.roomQueues.size)
                yield Promise.allSettled([...this.roomQueues.values()]);
        });
    }
    createLifecycle() {
        return {
            instanceId: (0, crypto_1.randomUUID)(),
            phase: "LOBBY",
            version: 1,
            battleSessionId: null,
            sceneEpoch: 0,
        };
    }
    ensureLifecycle(room) {
        // Backward compatibility for rooms constructed by focused tests or by
        // an older in-memory snapshot during a rolling development restart.
        if (!room.lifecycle)
            room.lifecycle = this.createLifecycle();
        if (room.lifecycle.sceneEpoch === undefined)
            room.lifecycle.sceneEpoch = 0;
        return room.lifecycle;
    }
    identity(room) {
        this.ensureLifecycle(room);
        return (0, battle_contract_1.captureRoomCommandIdentity)(room);
    }
    applyRoomCommand(room, command) {
        var _a;
        if (room.room_number !== command.roomNumber || !(0, battle_contract_1.roomCommandIdentityMatches)(room, command.identity)) {
            return { ok: false, reason: "STALE_IDENTITY" };
        }
        switch (command.kind) {
            case "BEGIN_RETURN": return this.beginSettlementReturn(room, command.identity.generation);
            case "COMPLETE_RETURN": return this.completeSettlementReturn(room);
            case "DISBAND": return this.commitDisband(room, (_a = command.reason) !== null && _a !== void 0 ? _a : "command");
        }
    }
    dispatchRoomCommand(command) {
        return this.enqueueRoomCommand(command.roomNumber, () => {
            const room = require("../room/manager").getRoom(command.roomNumber);
            return room ? this.applyRoomCommand(room, command) : { ok: false, reason: "ROOM_DISBANDED" };
        });
    }
    enqueueRoomCommand(roomNumber, command) {
        var _a;
        (0, runtime_role_1.assertRealtimeAuthority)();
        const previous = (_a = this.roomQueues.get(roomNumber)) !== null && _a !== void 0 ? _a : Promise.resolve();
        const result = previous.then(command, command);
        const tail = result.then(() => undefined, () => undefined);
        this.roomQueues.set(roomNumber, tail);
        void tail.finally(() => {
            if (this.roomQueues.get(roomNumber) === tail)
                this.roomQueues.delete(roomNumber);
        });
        return result;
    }
    transition(room, to, reason) {
        (0, runtime_role_1.assertRealtimeAuthority)();
        if ((0, room_start_claims_1.hasRoomStartClaims)(room))
            return { ok: false, reason: "INVALID_TRANSITION" };
        const lifecycle = this.ensureLifecycle(room);
        const previous = lifecycle.phase;
        if (previous === "DISBANDED")
            return { ok: false, reason: "ROOM_DISBANDED" };
        if (previous === to) {
            return { ok: true, previous, current: to, version: lifecycle.version };
        }
        if (!ALLOWED_TRANSITIONS[previous].includes(to)) {
            return { ok: false, reason: "INVALID_TRANSITION" };
        }
        lifecycle.phase = to;
        lifecycle.version += 1;
        if (previous === "BATTLE")
            battle_telemetry_1.battleTelemetry.end(room.room_number, `${to.toLowerCase()}:${reason}`);
        if (to === "BATTLE")
            battle_telemetry_1.battleTelemetry.begin(room);
        (0, game_logging_1.gameVerboseLog)(() => `[MULTI-LIFECYCLE] room=${room.room_number}`
            + ` instance=${lifecycle.instanceId} version=${lifecycle.version}`
            + ` ${previous}->${to} reason=${reason}`);
        return { ok: true, previous, current: to, version: lifecycle.version };
    }
    commitBattleStart(room) {
        const starting = this.transition(room, "STARTING", "start_battle");
        if (!starting.ok)
            return starting.reason === "ROOM_DISBANDED"
                ? { ok: false, reason: "ROOM_DISBANDED" }
                : { ok: false, reason: "INVALID_TRANSITION" };
        const previousGeneration = room.lobby_generation;
        (0, battle_contract_1.retainBattleSessionContract)(room);
        if (room.expected_real_viewer_ids.length === 0) {
            room.expected_real_viewer_ids = [...new Set(room.member_viewer_ids)];
        }
        room.lobby_generation += 1;
        const lifecycle = this.ensureLifecycle(room);
        lifecycle.battleSessionId = (0, settlement_snapshot_1.buildBattleInstanceId)(room.room_number, room.lobby_generation, Number(room.category), room.quest_id, lifecycle.instanceId);
        lifecycle.sceneEpoch = 0;
        room.raising_state = 4;
        room.settlement_return_pending = false;
        room.readyCountdownPending = false;
        const battle = this.transition(room, "BATTLE", "start_battle_committed");
        if (!battle.ok) {
            // This is unreachable while commands are serialized, but preserve
            // a consistent lobby if a future caller violates the boundary.
            room.lobby_generation = previousGeneration;
            room.raising_state = 1;
            lifecycle.battleSessionId = null;
            this.transition(room, "LOBBY", "start_battle_rollback");
            return { ok: false, reason: "INVALID_TRANSITION" };
        }
        (0, battle_contract_1.ensureBattleSessionContract)(room);
        return { ok: true, previousGeneration, battleSessionId: lifecycle.battleSessionId };
    }
    beginSettlementReturn(room, battleGeneration) {
        if (room.lobby_generation !== battleGeneration) {
            return { ok: false, reason: "STALE_GENERATION" };
        }
        const lifecycle = this.ensureLifecycle(room);
        if (lifecycle.phase === "BATTLE") {
            const settling = this.transition(room, "SETTLING", "finish_received");
            if (!settling.ok)
                return settling;
        }
        const returning = this.transition(room, "RETURNING", "settlement_return_pending");
        if (returning.ok) {
            room.raising_state = 1;
            room.settlement_return_pending = true;
        }
        return returning;
    }
    completeSettlementReturn(room) {
        if ((0, room_start_claims_1.hasRoomStartClaims)(room))
            return { ok: false, reason: "INVALID_TRANSITION" };
        const lifecycle = this.ensureLifecycle(room);
        if (lifecycle.phase === "LOBBY") {
            room.raising_state = 1;
            room.settlement_return_pending = false;
            return {
                ok: true,
                previous: "LOBBY",
                current: "LOBBY",
                version: lifecycle.version,
            };
        }
        const result = this.transition(room, "LOBBY", "host_entered_return_lobby");
        if (result.ok) {
            require("../../lib/weapon-riven/multi-room").releaseWeaponRivenRoom(room);
            room.raising_state = 1;
            room.settlement_return_pending = false;
            (0, battle_contract_1.retainBattleSessionContract)(room);
            lifecycle.battleSessionId = null;
            room.equipmentPartyIds = undefined;
            room.npcPartySnapshots = undefined;
            room.readyCountdownPending = false;
        }
        return result;
    }
    commitDisband(room, reason) {
        const lifecycle = this.ensureLifecycle(room);
        if (lifecycle.phase === "DISBANDED") {
            return {
                ok: true,
                previous: "DISBANDED",
                current: "DISBANDED",
                version: lifecycle.version,
            };
        }
        const result = this.transition(room, "DISBANDED", reason);
        if (result.ok)
            require("../../lib/weapon-riven/multi-room").releaseWeaponRivenRoom(room);
        return result;
    }
    isCurrentInstance(room, instanceId) {
        return !!room
            && this.ensureLifecycle(room).instanceId === instanceId
            && room.lifecycle.phase !== "DISBANDED";
    }
}
exports.EmbeddedMultiCoordinator = EmbeddedMultiCoordinator;
exports.embeddedMultiCoordinator = new EmbeddedMultiCoordinator();
