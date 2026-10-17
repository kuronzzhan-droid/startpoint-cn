import * as net from "net"
import { invokeRealtimeBusiness } from "../multi/coordinator/business-rpc"
import { notifyRealtimePresence } from "../multi/coordinator/business-facts"
import {
    attachLoungeSocket,
    broadcastLoungeFrame,
    canAttachLoungeViewer,
    detachLoungeSocket,
    enterLounge,
    getLounge,
    getLoungeSocketContext,
    loungeCanStart,
    matchesLoungeAccess,
    sendLoungeFrame,
    serializeLoungeMates,
    setLoungeMemberReady,
    touchLoungeActivity,
} from "./state"
import { LOUNGE_DISMISSED_MESSAGE } from "./protocol"

const playerIdsBySocket = new WeakMap<net.Socket, number>()
const loungeStartsPending = new WeakSet<net.Socket>()

function positiveSafeInteger(value: unknown): number | null {
    if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value))) return null
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function deny(socket: net.Socket, message = LOUNGE_DISMISSED_MESSAGE): void {
    sendLoungeFrame(socket, [1, message])
    socket.end()
}

export async function handleLoungeHandshake(socket: net.Socket, data: Record<string, unknown>): Promise<void> {
    const viewerId = positiveSafeInteger(data.viewerId)
    const loungeId = positiveSafeInteger(data.loungeId)
    const useCase = positiveSafeInteger(data.useCase)
    const establisherViewerId = positiveSafeInteger(data.establisherViewerId)
    const advice = typeof data.advice === "string" ? data.advice : ""
    if (viewerId === null || loungeId === null || useCase === null || establisherViewerId === null || advice.length === 0) {
        deny(socket)
        return
    }
    const room = getLounge(loungeId)
    if (!room) { deny(socket); return }
    const authorized = await invokeRealtimeBusiness<{ playerId: number } | null>("lounge.handshake", {
        viewerId, session: data.sp_session ?? null, campaignId: room.campaignId,
    })
    const playerId = authorized?.playerId
    if (!playerId || socket.destroyed || getLounge(loungeId) !== room || useCase !== 1
        || !matchesLoungeAccess(room, { useCase, advice, establisherViewerId })
        || !canAttachLoungeViewer(room, viewerId)) {
        deny(socket)
        return
    }
    attachLoungeSocket(room, viewerId, socket)
    playerIdsBySocket.set(socket, playerId)
    sendLoungeFrame(socket, [0, `lounge-${viewerId}`, loungeId])
}

export async function handleLoungeMessage(socket: net.Socket, value: unknown): Promise<void> {
    if (!Array.isArray(value) || Number(value[0]) !== 0 || !Array.isArray(value[1])) return
    const notify = value[1]
    const kind = Number(notify[0])
    if (kind === 0) {
        const profile = notify[1]
        if (!profile || typeof profile !== "object" || Array.isArray(profile)) return
        const entered = enterLounge(socket, profile as Record<string, unknown>)
        if (!entered) return
        notifyRealtimePresence(entered.member.viewerId)
        const mates = serializeLoungeMates(entered.room)
        sendLoungeFrame(socket, [1, [3, mates]])
        broadcastLoungeFrame(entered.room, [1, [4, mates]])
        return
    }

    const context = getLoungeSocketContext(socket)
    if (!context || !context.member || context.member.socket !== socket || socket.destroyed) return
    if (kind >= 1 && kind <= 6) {
        notifyRealtimePresence(context.viewerId)
    }
    switch (kind) {
        case 1:
            touchLoungeActivity(context.room)
            sendLoungeFrame(socket, [1, [7, context.viewerId]])
            break
        case 2:
            break
        case 3: {
            if (loungeStartsPending.has(socket)) break // Start captured this roster's accepted Ready state.
            const readyState = Array.isArray(notify[1]) ? notify[1] : [0]
            // setLoungeMemberReady rejects oversized states; nothing is
            // stored or rebroadcast for them.
            if (setLoungeMemberReady(context.room, context.viewerId, readyState)) {
                broadcastLoungeFrame(context.room, [1, [0, context.viewerId, readyState]])
            }
            break
        }
        case 4:
            // A repeated Start after the transition must not run the activity
            // twice or rebroadcast a start into clients already selecting.
            if (context.room.raisingState !== 2) break
            if (context.viewerId !== context.room.hostViewerId || !loungeCanStart(context.room)) {
                sendLoungeFrame(socket, [1, [6, [1]]])
                break
            }
            try {
                const members = [...context.room.members.values()]
                const roster = members.map(member => member.socket)
                if (roster.some(member => loungeStartsPending.has(member))) break
                roster.forEach(member => loungeStartsPending.add(member))
                const decided = await invokeRealtimeBusiness<boolean>("lounge.start", {
                    campaignId: context.room.campaignId,
                    playerIds: members.map(member => playerIdsBySocket.get(member.socket) ?? null),
                }).finally(() => roster.forEach(member => loungeStartsPending.delete(member)))
                if (getLounge(context.room.id) !== context.room || context.room.raisingState !== 2
                    || socket.destroyed || roster.some(member => member.destroyed)
                    || context.room.members.size !== roster.length
                    || [...context.room.members.values()].some((member, index) => member.socket !== roster[index])) break
                if (!decided) {
                    sendLoungeFrame(socket, [1, [6, [1]]])
                    break
                }
            } catch {
                console.warn(`[LOUNGE] start transaction failed: lounge=${context.room.id}`)
                sendLoungeFrame(socket, [1, [6, [1]]])
                break
            }
            context.room.raisingState = 97
            broadcastLoungeFrame(context.room, [1, [5]])
            break
        case 5:
            break
        case 6:
            detachLoungeSocket(socket, true)
            break
    }
}

export { detachLoungeSocket }
