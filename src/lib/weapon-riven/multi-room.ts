import { randomUUID } from "node:crypto"
import type { MultiRoom } from "../types/multi"
import { getRoom } from "../../multi/room/manager"
import { sessionManager, type SessionClient } from "../../multi/state/SessionManager"
import { embeddedMultiCoordinator } from "../../multi/coordinator/embedded"
import { getSocketRivenCredentials } from "../../multi/coordinator/socket-admission"
import { selectedPartyId, setPreparation } from "../../multi/room/equipment-ready"
import { invokeRealtimeBusiness, retainRealtimeBusinessTail, createRealtimeMaintenanceTimer,
    runWithTcpBusinessAdmission } from "../../multi/coordinator/business-rpc"
import type { RivenSnapshot, RivenFreezeRequest, RivenPreparationIdentity } from "./multi-types"
import { parseRivenAcknowledgement } from "./multi-protocol"
import { disabledRivenSnapshot, rivenFreezeUnavailable } from "./multi-fallback"

// Private owner state: never attached to a room DTO, player facts or client Mate.
interface Entry {
    room: MultiRoom; identity: RivenPreparationIdentity
    peers: SessionClient[]; request: RivenFreezeRequest; snapshot?: RivenSnapshot; ack: Set<string>
    phase: "freezing" | "ack" | "validating" | "ready" | "binding" | "committed" | "cancelled"
    promise: Promise<boolean>; resolve: (ok: boolean) => void; timer: NodeJS.Timeout
    onReady: () => void; battleSessionId?: string; failed?: boolean; localDisabled?: boolean
    deadlineMs: number; redecided?: boolean
}
let ownerEpoch: string = randomUUID()
const entries = new Map<string, Entry>()
export function setWeaponRivenOwnerEpoch(epoch: string): void { ownerEpoch = epoch }
function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) }
function current(entry: Entry): boolean {
    const room = entry.room
    if (entries.get(room.room_number) !== entry || getRoom(room.room_number) !== room
        || room.lifecycle.instanceId !== entry.identity.roomInstanceId) return false
    if (entry.phase === "committed" || entry.phase === "binding") return room.lifecycle.battleSessionId === entry.battleSessionId
    return room.lifecycle.phase === "LOBBY" && room.lobby_generation === entry.identity.sourceLobbyGeneration
        && entry.peers.every((peer, i) => !peer.superseded && !peer.socket.destroyed && peer.enterData !== null
            && sessionManager.getClient(peer.viewerId, room.room_number) === peer
            && selectedPartyId(peer) === entry.request.members.filter((member: any) => !member.mate.comId)[i].partyId)
        && sessionManager.getClientsInRoom(room.room_number, room.lobby_generation)
            .filter(peer => !peer.isBattle && !peer.superseded && peer.enterData !== null).length === entry.peers.length
}
function send(entry: Entry, tag: 1 | 5): boolean {
    if (!entry.snapshot || !current(entry)) return false
    const frame = JSON.stringify([1, [tag, entry.snapshot.members]]) + "\0"
    for (const peer of entry.peers) {
        if (peer.superseded || peer.socket.destroyed || peer.enterData === null
            || peer.roomGeneration !== entry.identity.sourceLobbyGeneration) return false
        if (sessionManager.sendFrame(peer.socket, frame, { roomNumber: entry.room.room_number,
            viewerId: peer.viewerId, connectionId: peer.connectionId,
            roomGeneration: peer.roomGeneration, channel: "lobby" }) === "closed") return false
    }
    return true
}
function notify(entry: Entry, prefix: string, reason: string, p2Only: boolean): void {
    for (const peer of entry.peers) {
        if (peer.superseded || peer.socket.destroyed || peer.enterData === null) continue
        if (p2Only && !getSocketRivenCredentials(peer.socket)?.weaponRiven.p2) continue
        sessionManager.sendJson(peer.socket, [1, [8, `${prefix}|${entry.snapshot?.snapshotId ?? "none"}|${reason}`]])
    }
}
async function rpc(kind: string, payload: any): Promise<any> {
    try { return await invokeRealtimeBusiness(kind, payload) }
    catch (error) {
        const uncertain = error as { code?: string; confirmation?: Promise<unknown> }
        if (uncertain.code === "BUSINESS_OUTCOME_UNKNOWN" && uncertain.confirmation) {
            try { return await uncertain.confirmation }
            catch { throw Object.assign(new Error("RIVEN_CONFIRMATION_FAILED"), { code: "RIVEN_CONFIRMATION_FAILED" }) }
        }
        throw error
    }
}
function release(entry: Entry): void {
    if (entry.localDisabled) return // No parent snapshot exists for the disabled fallback.
    const payload = { identity: entry.identity, snapshotId: entry.snapshot?.snapshotId,
        ...(entry.battleSessionId ? { battleSessionId: entry.battleSessionId } : {}) }
    void retainRealtimeBusinessTail(rpc(entry.battleSessionId ? "riven.release" : "riven.cancel", payload)).catch(() => {})
}
function cancelEntry(entry: Entry, reason = "room_changed"): void {
    if (entries.get(entry.room.room_number) === entry) cancelWeaponRivenPreparation(entry.room, reason)
}
function failCommittedStart(entry: Entry, reason: string): void {
    if (!current(entry)) return
    entry.failed = true; entry.resolve(false); clearTimeout(entry.timer)
    if (sessionManager.commitRoomDisband(entry.room.room_number, reason)) return
    // Existing durable HTTP claims own termination until their outcome is known.
    const { deferPinnedRoomControl } = require("../../multi/coordinator/room-start-claims") as typeof import("../../multi/coordinator/room-start-claims")
    deferPinnedRoomControl(entry.room, () => {
        void runWithTcpBusinessAdmission(() => embeddedMultiCoordinator.enqueueRoomCommand(entry.room.room_number,
            () => { if (current(entry)) sessionManager.commitRoomDisband(entry.room.room_number, reason) })).catch(() => {})
    })
}
export function cancelWeaponRivenPreparation(room: MultiRoom, reason = "room_changed"): void {
    const entry = entries.get(room.room_number)
    if (!entry || entry.room !== room || entry.phase === "committed" || entry.phase === "binding") return
    entries.delete(room.room_number); entry.phase = "cancelled"; clearTimeout(entry.timer)
    notify(entry, "WFR2_CANCEL", reason, true)
    entry.resolve(false); release(entry)
    room.readyCountdownPending = false
    for (const peer of entry.peers) if (!peer.superseded && peer.yourself) setPreparation(peer, true)
    const mates = entry.peers.map(peer => peer.yourself).filter(Boolean)
    sessionManager.broadcastToRoom(room.room_number, [1, [1, mates]])
}
export function releaseWeaponRivenRoom(room: MultiRoom): void {
    const entry = entries.get(room.room_number)
    if (!entry || entry.room !== room) return
    entries.delete(room.room_number); clearTimeout(entry.timer); entry.resolve(false); release(entry)
}
export function suppressWeaponRivenPreview(client: SessionClient | undefined): boolean {
    if (!client) return false
    const entry = entries.get(client.roomNumber)
    if (!entry || entry.room.lifecycle.instanceId !== entry.identity.roomInstanceId) return false
    return entry.phase !== "cancelled" && entry.phase !== "committed" && entry.peers.includes(client)
}
function complete(entry: Entry): void {
    if (entry.phase !== "ack" || !entry.snapshot || !entry.snapshot.ackConnectionIds.every(id => entry.ack.has(id))) return
    if (entry.localDisabled) {
        entry.phase = "ready"
        entry.onReady()
        return
    }
    entry.phase = "validating"
    const task = rpc("riven.validate", { identity: entry.identity, snapshotId: entry.snapshot.snapshotId,
        members: entry.request.members }).then(result => embeddedMultiCoordinator.enqueueRoomCommand(entry.room.room_number, () => {
        if (!current(entry)) { cancelEntry(entry); return }
        if (result?.ok !== true) { cancelEntry(entry, "capability_changed"); return }
        entry.phase = "ready"
        entry.onReady()
    })).catch(() => embeddedMultiCoordinator.enqueueRoomCommand(entry.room.room_number,
        () => cancelEntry(entry, "validation_failed")))
    void retainRealtimeBusinessTail(task)
}
/** Called in a short room command. It never waits for RPC or ACK in that queue. */
export function startWeaponRivenPreparation(room: MultiRoom, members: any[], onReady: () => void, deadlineMs = 10_000): any | undefined {
    const existing = entries.get(room.room_number)
    if (existing && existing.room === room) {
        if (!current(existing)) { cancelWeaponRivenPreparation(room); return undefined }
        return existing.phase === "ready" || existing.phase === "committed"
            ? existing.localDisabled ? { members: existing.snapshot!.members } : existing.snapshot : undefined
    }
    if (room.lifecycle.phase !== "LOBBY" || members.length < 2 || members.length > 3) return undefined
    const peers: SessionClient[] = []
    const inputs = members.map(mate => {
        if (mate.comId) return { viewerId: mate.viewerId, playerId: 0, connectionId: String(mate.connectionId),
            partyId: 1, session: null, admissionToken: null, mate: copy(mate) }
        const peer = sessionManager.getClient(Number(mate.viewerId), room.room_number)
        if (!peer || peer.playerId === null || peer.superseded || peer.enterData === null || peer.socket.destroyed
            || peer.roomGeneration !== room.lobby_generation) throw new Error("RIVEN_ROSTER_NOT_CONNECTED")
        const credential = getSocketRivenCredentials(peer.socket)
        peers.push(peer)
        return { viewerId: peer.viewerId, playerId: peer.playerId, connectionId: peer.connectionId,
            partyId: selectedPartyId(peer), session: (credential?.session ?? null) as string | null,
            admissionToken: (credential?.token ?? null) as string | null, mate: copy(mate) }
    })
    if (entries.size >= 1024) throw new Error("RIVEN_ROOM_CAPACITY")
    const identity = { ownerEpoch, roomInstanceId: room.lifecycle.instanceId,
        sourceLobbyGeneration: room.lobby_generation, preparationId: randomUUID() }
    let resolve!: (ok: boolean) => void
    const promise = new Promise<boolean>(done => { resolve = done })
    const request = { identity, category: Number(room.category), questId: room.quest_id, members: inputs }
    const entry: Entry = { room, identity, peers, request, ack: new Set(), phase: "freezing", promise, resolve,
        timer: undefined as unknown as NodeJS.Timeout, onReady, deadlineMs }
    entries.set(room.room_number, entry)
    arm(entry)
    freeze(entry)
    return undefined
}
/** (Re)start the preparation deadline; a re-decided room gets a fresh window for its second prepare. */
function arm(entry: Entry): void {
    const room = entry.room
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = createRealtimeMaintenanceTimer(() => setTimeout(() => {
        void runWithTcpBusinessAdmission(() => embeddedMultiCoordinator.enqueueRoomCommand(room.room_number,
            () => {
                if (entries.get(room.room_number) !== entry) return
                if (entry.phase === "binding") failCommittedStart(entry, "riven_commit_timeout")
                else cancelWeaponRivenPreparation(room, "timeout")
            })).catch(() => {})
    }, Math.max(1, Math.min(10_000, entry.deadlineMs))))
    entry.timer.unref()
}
function freeze(entry: Entry): void {
    const { room, request, peers } = entry, identity = entry.identity
    const task = rpc("riven.freeze", request).catch(error => {
        if (!rivenFreezeUnavailable(error)) throw error
        // Never fall back after publishing an enabled snapshot or an uncertain RPC result.
        if (entry.identity === identity) entry.localDisabled = true
        return disabledRivenSnapshot(request, peers.filter(peer => getSocketRivenCredentials(peer.socket)?.weaponRiven.p2)
            .map(peer => peer.connectionId))
    }).then(snapshot => embeddedMultiCoordinator.enqueueRoomCommand(room.room_number, () => {
        if (entry.identity !== identity) return // Superseded by a re-decision; that path cancels this identity.
        entry.snapshot = snapshot
        if (!current(entry)) { release(entry); cancelEntry(entry); return }
        entry.phase = "ack"
        if (!send(entry, 1)) { cancelWeaponRivenPreparation(room, "send_failed"); return }
        if (snapshot.mode === 0 && snapshot.reason && snapshot.ackConnectionIds.length) notify(entry, "WFR2_DISABLED", snapshot.reason, false)
        complete(entry)
    })).catch(() => embeddedMultiCoordinator.enqueueRoomCommand(room.room_number,
        () => { if (entry.identity === identity) cancelEntry(entry, "freeze_failed") }))
    void retainRealtimeBusinessTail(task)
}
/**
 * NACK reasons that downgrade an enabled prepare instead of cancelling it. The shipped C22/r2/C23 client sends
 * `WFR2|N|<snapshot>|invalid_snapshot` for every Mates rejection: a catalog constant that differs from the server's,
 * missing riven master-table keys, or an invalid P2 context. `catalog` is the reserved explicit reason. A mode-0
 * prepare carries no rows and catalog "none", so a client can accept it in all of those cases.
 */
const RIVEN_DOWNGRADE_NACK_REASONS: ReadonlySet<string> = new Set(["invalid_snapshot", "catalog"])
/**
 * A P2 client that cannot accept an enabled prepare (see RIVEN_DOWNGRADE_NACK_REASONS) NACKs it. Instead of
 * cancelling the start, the whole room is re-decided once as disabled (new parent preparation identity, mode 0,
 * catalog "none", reason catalog_mismatch); the normal two-phase start then continues with fresh ACKs.
 */
function redecideDisabled(entry: Entry, reason: "catalog_mismatch"): void {
    const old = { identity: entry.identity, snapshotId: entry.snapshot!.snapshotId }
    void retainRealtimeBusinessTail(rpc("riven.cancel", old)).catch(() => {})
    entry.redecided = true
    entry.identity = { ...entry.identity, preparationId: randomUUID() }
    entry.request = { ...entry.request, identity: entry.identity, disabledReason: reason }
    entry.snapshot = undefined; entry.ack = new Set(); entry.phase = "freezing"
    arm(entry)
    freeze(entry)
}
export function waitWeaponRivenPreparation(room: MultiRoom): Promise<boolean> {
    const entry = entries.get(room.room_number)
    return entry?.room === room ? entry.promise : Promise.resolve(room.lifecycle.phase === "BATTLE")
}
export function acceptWeaponRivenAck(client: SessionClient, message: unknown): void {
    if (typeof message !== "string" || !message.startsWith("WFR2|")) return
    const entry = entries.get(client.roomNumber)
    if (!entry || entry.phase !== "ack" || !entry.snapshot || !current(entry) || !entry.peers.includes(client)
        || !entry.snapshot.ackConnectionIds.includes(client.connectionId)) return
    let ack
    try { ack = parseRivenAcknowledgement(message) }
    catch { cancelWeaponRivenPreparation(entry.room, "invalid_ack"); return }
    if (!ack || ack.snapshotId !== entry.snapshot.snapshotId) return
    if (ack.kind === "N") {
        if (RIVEN_DOWNGRADE_NACK_REASONS.has(ack.reason) && entry.snapshot.mode === 1 && !entry.redecided && !entry.localDisabled) {
            redecideDisabled(entry, "catalog_mismatch"); return
        }
        cancelWeaponRivenPreparation(entry.room, "client_rejected"); return
    }
    if (ack.canonical !== entry.snapshot.canonical) { cancelWeaponRivenPreparation(entry.room, "invalid_ack"); return }
    entry.ack.add(client.connectionId); complete(entry)
}
/** Bind the exact prepared DTO before delivering Start; callers must not await in the room queue. */
export function commitWeaponRivenPreparation(room: MultiRoom): void {
    const entry = entries.get(room.room_number)
    if (!entry || entry.phase !== "ready" || !entry.snapshot || !room.lifecycle.battleSessionId) throw new Error("RIVEN_NOT_READY")
    entry.phase = "binding"; entry.battleSessionId = room.lifecycle.battleSessionId
    if (entry.localDisabled) {
        entry.phase = "committed"; clearTimeout(entry.timer)
        if (!send(entry, 5)) { failCommittedStart(entry, "riven_start_send_failed"); return }
        entry.resolve(true)
        return
    }
    const task = rpc("riven.commit", { identity: entry.identity, snapshotId: entry.snapshot.snapshotId,
        battleSessionId: entry.battleSessionId }).then(result => embeddedMultiCoordinator.enqueueRoomCommand(room.room_number, () => {
        if (!result || result.snapshotId !== entry.snapshot!.snapshotId || result.canonical !== entry.snapshot!.canonical
            || JSON.stringify(result.identity) !== JSON.stringify(entry.identity)) throw new Error("RIVEN_COMMIT_REJECTED")
        if (!current(entry)) { release(entry); entry.resolve(false); return }
        if (entry.failed) { release(entry); return }
        entry.phase = "committed"; clearTimeout(entry.timer)
        if (!send(entry, 5)) {
            failCommittedStart(entry, "riven_start_send_failed"); return
        }
        entry.resolve(true)
    })).catch(() => embeddedMultiCoordinator.enqueueRoomCommand(room.room_number, () => {
        entry.resolve(false)
        if (current(entry)) failCommittedStart(entry, "riven_commit_failed")
    }))
    void retainRealtimeBusinessTail(task)
}
export function weaponRivenBattleSocketAllowed(room: MultiRoom, socket: import("node:net").Socket): boolean {
    const entry = entries.get(room.room_number)
    if (!entry) return true // Existing battles without P2 remain restorable under their old contract.
    if (entry.phase !== "committed" || entry.battleSessionId !== room.lifecycle.battleSessionId) return false
    const capability = getSocketRivenCredentials(socket)?.weaponRiven
    return entry.snapshot?.mode === 0 || !!(capability?.p1 && capability.p2 && capability.catalog === entry.snapshot?.catalog)
}
