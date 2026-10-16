import * as net from "net"
import { sendFrameReliably } from "../multi/tcp/reliable-send"

const LOUNGE_CAPACITY = 3
const LOUNGE_TTL_MS = 30 * 60 * 1000
const MAX_LOUNGES = 1024
// The CN client serializes its ReadyState enum (Preparation/Ready, no
// parameters) as a one-element array such as [1]. Keep a generous bound so a
// future client field still fits, while one frame cannot be amplified into
// every member's send queue.
export const LOUNGE_MAX_READY_STATE_ITEMS = 8
export const LOUNGE_MAX_READY_STATE_BYTES = 1024
const LOUNGE_MAX_PROFILE_NAME_LENGTH = 64

function positiveIntegerEnv(name: string, fallback: number, minimum: number): number {
    const parsed = Number.parseInt(process.env[name] ?? "", 10)
    return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback
}

// A dismissed client closes its own socket after reading the final frame.
// Closing from the server immediately can race that frame, so retire the
// socket after a grace period instead (same approach as the lobby disband).
const LOUNGE_DISBAND_SOCKET_GRACE_MS = positiveIntegerEnv("LOUNGE_DISBAND_SOCKET_GRACE_MS", 20_000, 0)

export interface LoungeHostProfile {
    name: string
    characterId: number
    characterEvolutionLevel: number
}

export interface LoungeMember {
    viewerId: number
    profile: Record<string, unknown>
    readyState: unknown[]
    socket: net.Socket
}

export interface LoungeRoom {
    id: number
    number: string
    advice: string
    useCase: number
    campaignId: number
    hostViewerId: number
    hostPlayerId: number
    hostProfile: LoungeHostProfile
    raisingState: number
    createdAt: number
    lastActivityAt: number
    members: Map<number, LoungeMember>
    pendingSockets: Map<number, net.Socket>
    shareTypes: Set<number>
}

interface LoungeSocketContext {
    roomId: number
    viewerId: number
}

const rooms = new Map<number, LoungeRoom>()
export function disconnectLoungePlayerLogin(viewerId: number): void {
    for (const room of rooms.values()) {
        room.members.get(viewerId)?.socket.destroy()
        room.pendingSockets.get(viewerId)?.destroy()
    }
}
const roomIdsByNumber = new Map<string, number>()
const socketContexts = new WeakMap<net.Socket, LoungeSocketContext>()
let loungeSequence = 0

function nextLoungeId(): number {
    loungeSequence = (loungeSequence + 1) % 1000
    return Date.now() * 1000 + loungeSequence
}

function nextLoungeNumber(): string {
    for (let attempt = 0; attempt < 1000; attempt++) {
        const value = String(100000 + Math.floor(Math.random() * 900000))
        if (!roomIdsByNumber.has(value)) return value
    }
    return String(nextLoungeId()).slice(-6).padStart(6, "0")
}

function removeRoom(room: LoungeRoom): void {
    rooms.delete(room.id)
    if (roomIdsByNumber.get(room.number) === room.id) {
        roomIdsByNumber.delete(room.number)
    }
}

function clearDisconnectedPendingSockets(room: LoungeRoom): void {
    for (const [viewerId, socket] of room.pendingSockets) {
        if (socket.destroyed || !socket.writable) room.pendingSockets.delete(viewerId)
    }
}

export function getLoungeOccupancy(room: LoungeRoom): number {
    clearDisconnectedPendingSockets(room)
    let occupancy = room.members.size
    for (const viewerId of room.pendingSockets.keys()) {
        if (!room.members.has(viewerId)) occupancy += 1
    }
    return occupancy
}

export function cleanupExpiredLounges(now = Date.now()): void {
    for (const room of rooms.values()) {
        if (now - room.lastActivityAt >= LOUNGE_TTL_MS) disbandLounge(room)
    }
    if (rooms.size <= MAX_LOUNGES) return
    const oldest = [...rooms.values()].sort((a, b) => a.lastActivityAt - b.lastActivityAt)
    for (let index = 0; rooms.size > MAX_LOUNGES && index < oldest.length; index++) {
        disbandLounge(oldest[index])
    }
}

const cleanupTimer = setInterval(cleanupExpiredLounges, 60_000)
cleanupTimer.unref()

export function createLounge(input: {
    advice: string
    useCase: number
    campaignId: number
    hostViewerId: number
    hostPlayerId: number
    hostProfile: LoungeHostProfile
}): LoungeRoom {
    cleanupExpiredLounges()
    // One host owns at most one lounge regardless of use case. Replacing it
    // notifies the previous members instead of silently orphaning them.
    for (const existing of [...rooms.values()]) {
        // The host is leaving that lounge itself: retire its own old socket
        // without a dismissal frame, and tell the other members.
        if (existing.hostViewerId === input.hostViewerId) {
            disbandLounge(existing, undefined, input.hostViewerId)
        }
    }
    const now = Date.now()
    const room: LoungeRoom = {
        id: nextLoungeId(),
        number: nextLoungeNumber(),
        advice: input.advice,
        useCase: input.useCase,
        campaignId: input.campaignId,
        hostViewerId: input.hostViewerId,
        hostPlayerId: input.hostPlayerId,
        hostProfile: input.hostProfile,
        raisingState: 1,
        createdAt: now,
        lastActivityAt: now,
        members: new Map(),
        pendingSockets: new Map(),
        shareTypes: new Set(),
    }
    rooms.set(room.id, room)
    roomIdsByNumber.set(room.number, room.id)
    return room
}

export function getLounge(id: number): LoungeRoom | undefined {
    cleanupExpiredLounges()
    return rooms.get(id)
}

export function getLoungeByNumber(number: string): LoungeRoom | undefined {
    cleanupExpiredLounges()
    const id = roomIdsByNumber.get(number)
    return id === undefined ? undefined : rooms.get(id)
}

export function listLounges(useCase: number): LoungeRoom[] {
    cleanupExpiredLounges()
    return [...rooms.values()]
        .filter(room => room.useCase === useCase && room.raisingState === 2 && getLoungeOccupancy(room) < LOUNGE_CAPACITY)
        .sort((a, b) => b.createdAt - a.createdAt)
}

export function matchesLoungeAccess(room: LoungeRoom, input: {
    useCase: number
    advice: string
    establisherViewerId: number
}): boolean {
    return room.useCase === input.useCase
        && room.advice === input.advice
        && room.hostViewerId === input.establisherViewerId
}

export function prepareLounge(room: LoungeRoom): void {
    room.raisingState = 2
    room.lastActivityAt = Date.now()
}

export function setLoungeShareTypes(room: LoungeRoom, values: number[]): void {
    room.shareTypes = new Set(values)
    room.lastActivityAt = Date.now()
}

export function canAttachLoungeViewer(room: LoungeRoom, viewerId: number): boolean {
    return room.raisingState === 2
        && (room.members.has(viewerId)
            || room.pendingSockets.has(viewerId)
            || getLoungeOccupancy(room) < LOUNGE_CAPACITY)
}

export function attachLoungeSocket(room: LoungeRoom, viewerId: number, socket: net.Socket): void {
    const existing = room.members.get(viewerId)
    const pending = room.pendingSockets.get(viewerId)
    socketContexts.set(socket, { roomId: room.id, viewerId })
    room.lastActivityAt = Date.now()
    room.pendingSockets.set(viewerId, socket)
    if (pending && pending !== socket && !pending.destroyed) pending.destroy()
    if (existing && existing.socket !== socket && !existing.socket.destroyed) {
        existing.socket.destroy()
    }
}

export function enterLounge(socket: net.Socket, profile: Record<string, unknown>): {
    room: LoungeRoom
    member: LoungeMember
} | null {
    const context = socketContexts.get(socket)
    if (!context) return null
    const room = rooms.get(context.roomId)
    if (!room || room.pendingSockets.get(context.viewerId) !== socket
        || !canAttachLoungeViewer(room, context.viewerId)) return null
    room.pendingSockets.delete(context.viewerId)
    const member: LoungeMember = {
        viewerId: context.viewerId,
        profile: {
            name: String(profile.name ?? "").slice(0, LOUNGE_MAX_PROFILE_NAME_LENGTH),
            characterId: Number(profile.characterId ?? 1),
            evolutionLevel: Number(profile.evolutionLevel ?? 0),
            rank: Number(profile.rank ?? 1),
            degreeId: Number(profile.degreeId ?? 1),
        },
        readyState: [1],
        socket,
    }
    room.members.set(context.viewerId, member)
    room.lastActivityAt = Date.now()
    return { room, member }
}

export function getLoungeSocketContext(socket: net.Socket): {
    room: LoungeRoom
    viewerId: number
    member?: LoungeMember
} | null {
    const context = socketContexts.get(socket)
    if (!context) return null
    const room = rooms.get(context.roomId)
    if (!room) return null
    return { room, viewerId: context.viewerId, member: room.members.get(context.viewerId) }
}

export function serializeLoungeMates(room: LoungeRoom): Record<string, unknown>[] {
    return [...room.members.values()].map(member => ({
        viewerId: member.viewerId,
        ...member.profile,
        readyState: member.readyState,
    }))
}

export function isAcceptableLoungeReadyState(value: unknown): value is unknown[] {
    if (!Array.isArray(value) || value.length > LOUNGE_MAX_READY_STATE_ITEMS) return false
    try {
        return Buffer.byteLength(JSON.stringify(value), "utf8") <= LOUNGE_MAX_READY_STATE_BYTES
    } catch {
        return false
    }
}

export function setLoungeMemberReady(room: LoungeRoom, viewerId: number, readyState: unknown[]): boolean {
    if (!isAcceptableLoungeReadyState(readyState)) return false
    const member = room.members.get(viewerId)
    if (!member) return false
    member.readyState = readyState
    room.lastActivityAt = Date.now()
    return true
}

export function touchLoungeActivity(room: LoungeRoom): void {
    if (rooms.get(room.id) === room) room.lastActivityAt = Date.now()
}

export function loungeCanStart(room: LoungeRoom): boolean {
    return room.members.size === LOUNGE_CAPACITY
        && [...room.members.values()].every(member => Number(member.readyState[0]) === 1)
}

export function sendLoungeFrame(socket: net.Socket, value: unknown): boolean {
    if (socket.destroyed || !socket.writable) return false
    let frame: string
    try {
        frame = `${JSON.stringify(value)}\0`
    } catch {
        return false
    }
    // Share the bounded per-socket queue used by lobby/battle traffic: a peer
    // that stops reading is disconnected instead of growing server memory.
    return sendFrameReliably(socket, frame, { channel: "lounge" }) !== "closed"
}

function retireDisbandedLoungeSocket(socket: net.Socket): void {
    if (socket.destroyed) return
    const timer = setTimeout(() => {
        if (!socket.destroyed) socket.destroy()
    }, LOUNGE_DISBAND_SOCKET_GRACE_MS)
    timer.unref?.()
}

export function broadcastLoungeFrame(room: LoungeRoom, value: unknown): void {
    for (const member of room.members.values()) sendLoungeFrame(member.socket, value)
}

export function disbandLounge(
    room: LoungeRoom,
    message = "multibattle_room_dismissed",
    silentViewerId?: number,
): void {
    const frame = [1, [1, message]]
    const sentSockets = new Set<net.Socket>()
    const notify = (viewerId: number, socket: net.Socket) => {
        if (sentSockets.has(socket)) return
        sentSockets.add(socket)
        if (viewerId !== silentViewerId) sendLoungeFrame(socket, frame)
    }
    for (const member of room.members.values()) notify(member.viewerId, member.socket)
    for (const [viewerId, socket] of room.pendingSockets) notify(viewerId, socket)
    room.raisingState = 99
    removeRoom(room)
    for (const socket of sentSockets) {
        socketContexts.delete(socket)
        retireDisbandedLoungeSocket(socket)
    }
}

export function getLoungeCountForTests(): number {
    return rooms.size
}

export function detachLoungeSocket(socket: net.Socket, explicitBye = false): void {
    const context = socketContexts.get(socket)
    if (!context) return
    socketContexts.delete(socket)
    const room = rooms.get(context.roomId)
    if (!room) return
    const pending = room.pendingSockets.get(context.viewerId)
    if (pending === socket) room.pendingSockets.delete(context.viewerId)
    const member = room.members.get(context.viewerId)
    // A reconnecting viewer keeps the existing member slot while the new
    // socket completes its Enter message. The old socket must not remove it.
    if (pending && pending !== socket) return
    if (member?.socket !== socket) return
    room.members.delete(context.viewerId)
    room.lastActivityAt = Date.now()
    if (explicitBye && context.viewerId === room.hostViewerId) {
        disbandLounge(room)
        return
    }
    if (explicitBye) {
        broadcastLoungeFrame(room, [1, [4, serializeLoungeMates(room)]])
    }
}

export function resetLoungesForTests(): void {
    rooms.clear()
    roomIdsByNumber.clear()
    loungeSequence = 0
}
