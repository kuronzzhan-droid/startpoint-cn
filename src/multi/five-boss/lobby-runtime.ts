import { randomUUID } from "crypto"
import type { MultiRoom } from "../../lib/types/multi"
import { getRoomMemberPlayerId } from "../room/manager"
import { sessionManager, type SessionClient } from "../state/SessionManager"
import { recordMemberBattleSignalSync } from "../../data/domains/fiveBossGauntletRun"
import { getPlayerCharacterSync } from "../../data/domains/character"
import { FIVE_BOSS_GAUNTLET, isFiveBossGauntletQuest } from "./contract"
import { fiveBossDiagnostics } from "../../lib/coalesced-diagnostics"
import { fiveBossConnectionDiagnostics } from "./connection-diagnostic"
import { runPersistenceTransaction } from "../../lib/persistence-coordinator"

// TCP proof notifications are acknowledged before their SQLite write has
// necessarily committed.  Keep the tail for each frozen member so HTTP
// settlement can wait for notifications that already reached this process.
const pendingFiveBossSignalWrites = new Map<string, Promise<void>>()

function fiveBossSignalKey(runId: string, playerId: number): string {
    return `${runId}:${playerId}`
}

// level_next/finalize are first-write-wins (COALESCE) rows. Once a signal for
// a member is queued or recorded, repeated frames need no further write.
// Keyed by the frozen runtime object so entries vanish with the run.
const acceptedFiveBossSignals = new WeakMap<object, Set<string>>()

function acceptedSignalsFor(runtime: object): Set<string> {
    let accepted = acceptedFiveBossSignals.get(runtime)
    if (!accepted) acceptedFiveBossSignals.set(runtime, accepted = new Set())
    return accepted
}

/** Wait for proof notifications already accepted from this member's socket. */
export function waitForFiveBossSignalPersistence(runId: string, playerId: number): Promise<void> {
    return pendingFiveBossSignalWrites.get(fiveBossSignalKey(runId, playerId)) ?? Promise.resolve()
}

/** Freeze the canonical live lobby before either HTTP or TCP starts the battle. */
export function freezeFiveBossLobby(room: MultiRoom, members?: any[]): boolean {
    if (!isFiveBossGauntletQuest(room.category, room.quest_id)) return true
    if (room.five_boss_runtime) return true
    const generation = room.lifecycle.phase === "BATTLE"
        ? Math.max(0, room.lobby_generation - 1) : room.lobby_generation
    const clients = sessionManager.getClientsInRoom(room.room_number, generation)
        .filter(client => !client.isBattle && !client.superseded)
    const host = clients.find(client => client.viewerId === room.host_viewer_id)
    const canonical = new Map<string, any>()
    for (const mate of [...(members ?? host?.mates ?? []), ...clients.map(c => c.yourself)]) {
        if (mate) canonical.set(mate.comId ? `com:${mate.comId}` : `viewer:${mate.viewerId}`, mate)
    }
    const roster = [...canonical.values()]
    // A two-player room is valid. AI may fill the third slot, but it is not a
    // prerequisite for starting when two real players are ready.
    if (!host || roster.length < 2 || roster.length > FIVE_BOSS_GAUNTLET.roomMemberLimit
        || !roster.every(mate => mate.state?.[0] === 1)) return false
    const frozen: NonNullable<MultiRoom["five_boss_runtime"]> = {
        runId: randomUUID(), expectedRealPlayerIds: [], battleEnteredPlayerIds: [],
        autoplayModeByPlayerId: {},
        partyCharacterIdsByPlayerId: {}, battleIdentityByViewerId: {},
    }
    for (const mate of roster.filter(m => !m.comId)) {
        const live = clients.find(client => client.viewerId === Number(mate.viewerId))
        const playerId = getRoomMemberPlayerId(room, Number(mate.viewerId))
        if (!live || !playerId || live.playerId !== playerId
            || typeof live.yourself?.autoplayMode !== "boolean" || !live.socket.remoteAddress) return false
        const party = live.yourself.party
        if (!Array.isArray(party?.characters) || !Array.isArray(party?.unison_characters)
            || party.characters.length > 3 || party.unison_characters.length > 3) return false
        const ids = [...(party?.characters ?? []), ...(party?.unison_characters ?? [])]
            .filter(entry => Array.isArray(entry) && entry[0] === 0)
            .map(entry => Number(entry[1]?.id))
            .filter(id => Number.isSafeInteger(id) && id > 0)
        if (!ids.length || ids.some(id => !getPlayerCharacterSync(playerId, id))
            || frozen.expectedRealPlayerIds.includes(playerId)) return false
        frozen.expectedRealPlayerIds.push(playerId)
        frozen.autoplayModeByPlayerId[String(playerId)] = live.yourself.autoplayMode
        frozen.partyCharacterIdsByPlayerId[String(playerId)] = [...new Set(ids)]
        frozen.battleIdentityByViewerId[String(live.viewerId)] = {
            playerId, remoteAddress: live.socket.remoteAddress, connectionId: live.connectionId,
        }
    }
    if (!frozen.expectedRealPlayerIds.includes(room.host_player_id)) return false
    room.five_boss_runtime = frozen
    fiveBossConnectionDiagnostics.begin(room)
    return true
}

export function isFrozenFiveBossBattleClient(room: MultiRoom, client: SessionClient): boolean {
    const identity = room.five_boss_runtime?.battleIdentityByViewerId[String(client.viewerId)]
    return !!identity && identity.playerId === client.playerId
        && identity.connectionId === client.connectionId && !client.superseded
}

export function recordFiveBossSignal(
    room: MultiRoom,
    client: SessionClient,
    signal: "scene_ready" | "level_next" | "finalize",
): boolean {
    if (!isFrozenFiveBossBattleClient(room, client)) {
        fiveBossConnectionDiagnostics.socketEvent(client.socket, "signal_rejected", `${signal}:identity`)
        fiveBossDiagnostics.report(JSON.stringify(["signal", room.five_boss_runtime?.runId, room.room_number,
            client.playerId, signal, "identity"]), () => `[FIVE-BOSS-SIGNAL] rejected=identity room=${room.room_number}`
            + ` run=${room.five_boss_runtime?.runId} player=${client.playerId} connection=${client.connectionId} signal=${signal}`)
        return false
    }
    if (signal === "scene_ready" && client.fiveBossBattleEntered) return true
    const runtime = room.five_boss_runtime!
    const runId = runtime.runId
    const playerId = client.playerId!
    const roomNumber = room.room_number
    const dedupeKey = `${playerId}:${signal}`
    if (signal !== "scene_ready") {
        const accepted = acceptedSignalsFor(runtime)
        if (accepted.has(dedupeKey)) return true
        accepted.add(dedupeKey)
    }
    if (signal === "scene_ready") client.fiveBossBattleEntered = true
    // The TCP handler must only update the in-memory barrier and return. The
    // proof row is durable evidence, but it is not part of the realtime ACK.
    fiveBossConnectionDiagnostics.socketEvent(client.socket,
        signal === "scene_ready" ? "battle_entry_queued"
            : signal === "level_next" ? "level_next_queued" : "finalize_queued", "tcp")
    const key = fiveBossSignalKey(runId, playerId)
    const previous = pendingFiveBossSignalWrites.get(key) ?? Promise.resolve()
    const pending = previous.then(() => runPersistenceTransaction({
        domain: "multi-settlement", playerId, operation: `five_boss_${signal}`,
    }, () => recordMemberBattleSignalSync({ runId, playerId, roomNumber, signal })))
        .then(() => {
            const currentRuntime = room.five_boss_runtime
            if (signal === "scene_ready"
                && currentRuntime?.runId === runId
                && !currentRuntime.battleEnteredPlayerIds?.includes(playerId)) {
                (currentRuntime.battleEnteredPlayerIds ??= []).push(playerId)
            }
            fiveBossConnectionDiagnostics.socketEvent(client.socket,
                signal === "scene_ready" ? "battle_entry_recorded"
                    : signal === "level_next" ? "level_next_recorded" : "finalize_recorded", "tcp")
        })
        .catch(error => {
            // This handler terminates the chain: it must never throw, or the
            // next queued signal and the cleanup below would see a rejection.
            try {
                if (signal === "scene_ready") client.fiveBossBattleEntered = false
                else acceptedFiveBossSignals.get(runtime)?.delete(dedupeKey)
                const code = (error as { code?: string } | null)?.code ?? "unknown"
                const message = error instanceof Error ? error.message : String(error)
                fiveBossConnectionDiagnostics.socketEvent(client.socket, "signal_rejected", `${signal}:${code}`)
                fiveBossDiagnostics.report(JSON.stringify(["signal", runId, roomNumber,
                    playerId, signal, code]), () => `[FIVE-BOSS-SIGNAL] rejected=${code}`
                    + ` room=${roomNumber} run=${runId}`
                    + ` player=${playerId} connection=${client.connectionId} signal=${signal}: ${message}`)
            } catch (reportError) {
                console.error("[FIVE-BOSS-SIGNAL] failed to report rejected signal", reportError)
            }
        })
    pendingFiveBossSignalWrites.set(key, pending)
    void pending.finally(() => {
        if (pendingFiveBossSignalWrites.get(key) === pending) pendingFiveBossSignalWrites.delete(key)
    }).catch(() => {})
    return true
}
