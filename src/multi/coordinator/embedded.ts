import { randomUUID } from "crypto"
import type { MultiRoom, MultiRoomLifecycle, MultiRoomPhase } from "../types"
import { buildBattleInstanceId } from "../settlement-snapshot"
import { gameVerboseLog } from "../../lib/game-logging"
import { battleTelemetry } from "../battle-telemetry"

export type RoomTransitionResult =
    | { ok: true; previous: MultiRoomPhase; current: MultiRoomPhase; version: number }
    | { ok: false; reason: "INVALID_TRANSITION" | "STALE_GENERATION" | "ROOM_DISBANDED" }

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
 * The public values and commands are deliberately serializable so the same
 * boundary can gain a remote Hub adapter later.  For now every room is owned
 * by this process and commands for one room are executed strictly in order.
 */
export class EmbeddedMultiCoordinator {
    private readonly roomQueues = new Map<string, Promise<void>>()

    createLifecycle(): MultiRoomLifecycle {
        return {
            instanceId: randomUUID(),
            phase: "LOBBY",
            version: 1,
            battleSessionId: null,
        }
    }

    ensureLifecycle(room: MultiRoom): MultiRoomLifecycle {
        // Backward compatibility for rooms constructed by focused tests or by
        // an older in-memory snapshot during a rolling development restart.
        if (!room.lifecycle) room.lifecycle = this.createLifecycle()
        return room.lifecycle
    }

    enqueueRoomCommand<T>(roomNumber: string, command: RoomCommand<T>): Promise<T> {
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
        room.lobby_generation += 1
        const lifecycle = this.ensureLifecycle(room)
        lifecycle.battleSessionId = buildBattleInstanceId(
            room.room_number,
            room.lobby_generation,
            Number(room.category),
            room.quest_id,
        )
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
            lifecycle.battleSessionId = null
            room.equipmentPartyIds = undefined
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
