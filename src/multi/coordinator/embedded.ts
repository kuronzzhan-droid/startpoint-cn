import { randomUUID } from "crypto"
import type { MultiRoom, MultiRoomLifecycle, MultiRoomPhase } from "../types"
import { buildBattleInstanceId } from "../settlement-snapshot"
import { gameVerboseLog } from "../../lib/game-logging"
import { battleTelemetry } from "../battle-telemetry"
import { captureRoomCommandIdentity, roomCommandIdentityMatches, ensureBattleSessionContract, retainBattleSessionContract } from "../state/battle-contract"
import type { RoomCommandIdentity } from "../state/battle-contract"
import { hasRoomStartClaims } from "./room-start-claims"
import { assertRealtimeAuthority } from "./runtime-role"

export type RoomTransitionResult =
    | { ok: true; previous: MultiRoomPhase; current: MultiRoomPhase; version: number }
    | { ok: false; reason: "INVALID_TRANSITION" | "STALE_GENERATION" | "STALE_IDENTITY" | "ROOM_DISBANDED" }

export interface CoordinatedRoomCommand {
    roomNumber: string
    identity: RoomCommandIdentity
    kind: "BEGIN_RETURN" | "COMPLETE_RETURN" | "DISBAND"
    reason?: string
}

const ALLOWED_TRANSITIONS: Readonly<Record<MultiRoomPhase, readonly MultiRoomPhase[]>> = {
    LOBBY: ["STARTING", "DISBANDED"],
    STARTING: ["LOBBY", "BATTLE", "DISBANDED"],
    BATTLE: ["SETTLING", "RETURNING", "DISBANDED"],
    SETTLING: ["RETURNING", "DISBANDED"],
    RETURNING: ["LOBBY", "DISBANDED"],
    DISBANDED: [],
}

type RoomCommand<T> = () => T | Promise<T>

/**
 * Single-process multiplayer coordinator.
 *
 * Typed lifecycle commands carry serializable identities. Legacy callbacks
 * remain internal migration seams; they are not a remote Hub protocol.
 */
export class EmbeddedMultiCoordinator {
    private readonly roomQueues = new Map<string, Promise<void>>()

    async drain(): Promise<void> {
        while (this.roomQueues.size) await Promise.allSettled([...this.roomQueues.values()])
    }

    createLifecycle(): MultiRoomLifecycle {
        return {
            instanceId: randomUUID(),
            phase: "LOBBY",
            version: 1,
            battleSessionId: null,
            sceneEpoch: 0,
        }
    }

    ensureLifecycle(room: MultiRoom): MultiRoomLifecycle {
        // Backward compatibility for rooms constructed by focused tests or by
        // an older in-memory snapshot during a rolling development restart.
        if (!room.lifecycle) room.lifecycle = this.createLifecycle()
        if (room.lifecycle.sceneEpoch === undefined) room.lifecycle.sceneEpoch = 0
        return room.lifecycle
    }

    identity(room: MultiRoom): RoomCommandIdentity {
        this.ensureLifecycle(room)
        return captureRoomCommandIdentity(room)
    }

    applyRoomCommand(room: MultiRoom, command: CoordinatedRoomCommand): RoomTransitionResult {
        if (room.room_number !== command.roomNumber || !roomCommandIdentityMatches(room, command.identity)) {
            return { ok: false, reason: "STALE_IDENTITY" }
        }
        switch (command.kind) {
            case "BEGIN_RETURN": return this.beginSettlementReturn(room, command.identity.generation)
            case "COMPLETE_RETURN": return this.completeSettlementReturn(room)
            case "DISBAND": return this.commitDisband(room, command.reason ?? "command")
        }
    }

    dispatchRoomCommand(command: CoordinatedRoomCommand): Promise<RoomTransitionResult> {
        return this.enqueueRoomCommand(command.roomNumber, () => {
            const room = require("../room/manager").getRoom(command.roomNumber) as MultiRoom | undefined
            return room ? this.applyRoomCommand(room, command) : { ok: false, reason: "ROOM_DISBANDED" }
        })
    }

    enqueueRoomCommand<T>(roomNumber: string, command: RoomCommand<T>): Promise<T> {
        assertRealtimeAuthority()
        const previous = this.roomQueues.get(roomNumber) ?? Promise.resolve()
        const result = previous.then(command, command)
        const tail = result.then(() => undefined, () => undefined)
        this.roomQueues.set(roomNumber, tail)
        void tail.finally(() => {
            if (this.roomQueues.get(roomNumber) === tail) this.roomQueues.delete(roomNumber)
        })
        return result
    }

    transition(room: MultiRoom, to: MultiRoomPhase, reason: string): RoomTransitionResult {
        assertRealtimeAuthority()
        if (hasRoomStartClaims(room)) return { ok: false, reason: "INVALID_TRANSITION" }
        const lifecycle = this.ensureLifecycle(room)
        const previous = lifecycle.phase
        if (previous === "DISBANDED") return { ok: false, reason: "ROOM_DISBANDED" }
        if (previous === to) {
            return { ok: true, previous, current: to, version: lifecycle.version }
        }
        if (!ALLOWED_TRANSITIONS[previous].includes(to)) {
            return { ok: false, reason: "INVALID_TRANSITION" }
        }
        lifecycle.phase = to
        lifecycle.version += 1
        if (previous === "BATTLE") battleTelemetry.end(room.room_number, `${to.toLowerCase()}:${reason}`)
        if (to === "BATTLE") battleTelemetry.begin(room)
        gameVerboseLog(() => `[MULTI-LIFECYCLE] room=${room.room_number}`
            + ` instance=${lifecycle.instanceId} version=${lifecycle.version}`
            + ` ${previous}->${to} reason=${reason}`)
        return { ok: true, previous, current: to, version: lifecycle.version }
    }

    commitBattleStart(room: MultiRoom): {
        ok: true
        previousGeneration: number
        battleSessionId: string
    } | { ok: false; reason: "INVALID_TRANSITION" | "ROOM_DISBANDED" } {
        const starting = this.transition(room, "STARTING", "start_battle")
        if (!starting.ok) return starting.reason === "ROOM_DISBANDED"
            ? { ok: false, reason: "ROOM_DISBANDED" }
            : { ok: false, reason: "INVALID_TRANSITION" }

        const previousGeneration = room.lobby_generation
        retainBattleSessionContract(room)
        if (room.expected_real_viewer_ids.length === 0) {
            room.expected_real_viewer_ids = [...new Set(room.member_viewer_ids)]
        }
        room.lobby_generation += 1
        const lifecycle = this.ensureLifecycle(room)
        lifecycle.battleSessionId = buildBattleInstanceId(
            room.room_number,
            room.lobby_generation,
            Number(room.category),
            room.quest_id,
            lifecycle.instanceId,
        )
        lifecycle.sceneEpoch = 0
        room.raising_state = 4
        room.settlement_return_pending = false
        room.readyCountdownPending = false

        const battle = this.transition(room, "BATTLE", "start_battle_committed")
        if (!battle.ok) {
            // This is unreachable while commands are serialized, but preserve
            // a consistent lobby if a future caller violates the boundary.
            room.lobby_generation = previousGeneration
            room.raising_state = 1
            lifecycle.battleSessionId = null
            this.transition(room, "LOBBY", "start_battle_rollback")
            return { ok: false, reason: "INVALID_TRANSITION" }
        }
        ensureBattleSessionContract(room)
        return { ok: true, previousGeneration, battleSessionId: lifecycle.battleSessionId }
    }

    beginSettlementReturn(room: MultiRoom, battleGeneration: number): RoomTransitionResult {
        if (room.lobby_generation !== battleGeneration) {
            return { ok: false, reason: "STALE_GENERATION" }
        }
        const lifecycle = this.ensureLifecycle(room)
        if (lifecycle.phase === "BATTLE") {
            const settling = this.transition(room, "SETTLING", "finish_received")
            if (!settling.ok) return settling
        }
        const returning = this.transition(room, "RETURNING", "settlement_return_pending")
        if (returning.ok) {
            room.raising_state = 1
            room.settlement_return_pending = true
        }
        return returning
    }

    completeSettlementReturn(room: MultiRoom): RoomTransitionResult {
        if (hasRoomStartClaims(room)) return { ok: false, reason: "INVALID_TRANSITION" }
        const lifecycle = this.ensureLifecycle(room)
        if (lifecycle.phase === "LOBBY") {
            room.raising_state = 1
            room.settlement_return_pending = false
            return {
                ok: true,
                previous: "LOBBY",
                current: "LOBBY",
                version: lifecycle.version,
            }
        }
        const result = this.transition(room, "LOBBY", "host_entered_return_lobby")
        if (result.ok) {
            room.raising_state = 1
            room.settlement_return_pending = false
            retainBattleSessionContract(room)
            lifecycle.battleSessionId = null
            room.equipmentPartyIds = undefined
            room.battleParties = undefined
            room.npcPartySnapshots = undefined
            room.readyCountdownPending = false
        }
        return result
    }

    commitDisband(room: MultiRoom, reason: string): RoomTransitionResult {
        const lifecycle = this.ensureLifecycle(room)
        if (lifecycle.phase === "DISBANDED") {
            return {
                ok: true,
                previous: "DISBANDED",
                current: "DISBANDED",
                version: lifecycle.version,
            }
        }
        return this.transition(room, "DISBANDED", reason)
    }

    isCurrentInstance(room: MultiRoom | undefined, instanceId: string): room is MultiRoom {
        return !!room
            && this.ensureLifecycle(room).instanceId === instanceId
            && room.lifecycle.phase !== "DISBANDED"
    }
}

export const embeddedMultiCoordinator = new EmbeddedMultiCoordinator()
