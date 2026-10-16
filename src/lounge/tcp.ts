import * as net from "net"
import { getSession } from "../data/domains/session"
import { playerSocketAllowed } from "../lib/player-login"
import { markPlayerOnlineFromTcp } from "../lib/online-presence"
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

function positiveSafeInteger(value: unknown): number | null {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function deny(socket: net.Socket, message = LOUNGE_DISMISSED_MESSAGE): void {
    sendLoungeFrame(socket, [1, message])
    socket.end()
}

export async function handleLoungeHandshake(socket: net.Socket, data: Record<string, unknown>): Promise<void> {
    const viewerId = positiveSafeInteger(data.viewerId)
    if (!playerSocketAllowed(viewerId, data.sp_session)) { deny(socket); return }
    const loungeId = positiveSafeInteger(data.loungeId)
    const useCase = positiveSafeInteger(data.useCase)
    const establisherViewerId = positiveSafeInteger(data.establisherViewerId)
    const advice = typeof data.advice === "string" ? data.advice : ""
    if (viewerId === null || loungeId === null || useCase === null || establisherViewerId === null || advice.length === 0) {
        deny(socket)
        return
    }
    const session = await getSession(String(viewerId))
    const room = getLounge(loungeId)
    if (!session || !room || !matchesLoungeAccess(room, { useCase, advice, establisherViewerId })
        || !canAttachLoungeViewer(room, viewerId)) {
        deny(socket)
        return
    }
    attachLoungeSocket(room, viewerId, socket)
    sendLoungeFrame(socket, [0, `lounge-${viewerId}`, loungeId])
}

export function handleLoungeMessage(socket: net.Socket, value: unknown): void {
    if (!Array.isArray(value) || Number(value[0]) !== 0 || !Array.isArray(value[1])) return
    const notify = value[1]
    const kind = Number(notify[0])
    if (kind === 0) {
        const profile = notify[1]
        if (!profile || typeof profile !== "object" || Array.isArray(profile)) return
        const entered = enterLounge(socket, profile as Record<string, unknown>)
        if (!entered) return
        markPlayerOnlineFromTcp(entered.member.viewerId)
        const mates = serializeLoungeMates(entered.room)
        sendLoungeFrame(socket, [1, [3, mates]])
        broadcastLoungeFrame(entered.room, [1, [4, mates]])
        return
    }

    const context = getLoungeSocketContext(socket)
    if (!context || !context.member) return
    if (!socket.destroyed && context.member.socket === socket && kind >= 1 && kind <= 6) {
        markPlayerOnlineFromTcp(context.viewerId)
    }
    switch (kind) {
        case 1:
            touchLoungeActivity(context.room)
            sendLoungeFrame(socket, [1, [7, context.viewerId]])
            break
        case 2:
            break
        case 3: {
            const readyState = Array.isArray(notify[1]) ? notify[1] : [0]
            // setLoungeMemberReady rejects oversized states; nothing is
            // stored or rebroadcast for them.
            if (setLoungeMemberReady(context.room, context.viewerId, readyState)) {
                broadcastLoungeFrame(context.room, [1, [0, context.viewerId, readyState]])
            }
            break
        }
        case 4:
            if (context.viewerId !== context.room.hostViewerId || !loungeCanStart(context.room)) {
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
