import * as net from "net"
import { stripWeaponRivenPublicPayload } from "../../lib/weapon-riven/public-payload"
import { startWeaponRivenPreparation, waitWeaponRivenPreparation, acceptWeaponRivenAck,
    cancelWeaponRivenPreparation, commitWeaponRivenPreparation } from "../../lib/weapon-riven/multi-room"
import { performance } from "node:perf_hooks"
import { freezeFiveBossLobby } from "../five-boss/lobby-runtime"
import { sessionManager, SessionClient } from "../state/SessionManager"
import { addRoomMember, getRoom, removeRoomMember } from "../room/manager"
import { NpcMateProvider, selectStableNpcSlots } from "../npc/controller"
import { stopRandomRecruitment } from "../recruitment"
import { gameVerboseLog } from "../../lib/game-logging"
import { captureRealtimeBusinessContext, createRealtimeMaintenanceTimer, invokeRealtimeBusiness, retainRealtimeBusinessTail } from "../coordinator/business-rpc"
import { isRealtimeOwnerChild } from "../coordinator/runtime-role"
import { applyPlayerBusinessFacts, getPlayerBusinessFacts, notifyRealtimePresence, type PlayerBusinessFacts } from "../coordinator/business-facts"
import { isNpcPartyAllowedInRoom } from "../npc/equipment-policy"
import { isMode15RoomClosed, getMode15HostRoomGate } from "../mode15-room-gate"
import { enforceEquipmentReady, enforceRoomEquipmentReady, freezeEquipmentSelections,
    recordEquipmentPartyChange, setPreparation } from "../room/equipment-ready"
import { embeddedMultiCoordinator } from "../coordinator/embedded"
import { handleAutoplayModeChange } from "./autoplay-mode"
import {
    recordRoomAdmissionDenial,
    roomAdmissionRegistry,
} from "../room/admission"
import { markTcpDisconnectReason } from "./disconnect-diagnostics"
import { ensureRematchReturnReservations, getExpiredReturnViewerIds,
    getNextReturnDeadline, getReservedReturnViewerIds,
    markMemberReturnDisconnected } from "../room/rematch-roster"
import { findBattlePlayBinding, getBattleSessionContract } from "../state/battle-contract"
import { isFiveBossGauntletQuest } from "../five-boss/contract"

const NPC_JOIN_DELAY_MS = parseInt(process.env.NPC_JOIN_DELAY_MS || "2000")
const NPC_READY_DELAY_MS = parseInt(process.env.NPC_READY_DELAY_MS || "500")
const npcRecruitingRooms = new Set<string>()
const npcReconcilePendingRooms = new Set<string>()
const npcReconcileTimers = new Map<string, NodeJS.Timeout>()
const rematchCleanupTimers = new Map<string, NodeJS.Timeout>()
const rematchCleanupDeadlines = new Map<string, number>()
const rematchCleanedGeneration = new Map<string, number>()

interface PendingFiveBossReturnEnter {
    room: NonNullable<ReturnType<typeof getRoom>>
    instanceId: string
    generation: number
    battleSessionId: string
    runId: string
    playerId: number
    playId: string
    connectionGeneration: number
    data: any[]
    deadline: number
    timer: NodeJS.Timeout | null
    closed: () => void
}
// One entry per existing host connection, never an independent room cache.
const pendingFiveBossReturnEnters = new WeakMap<SessionClient, PendingFiveBossReturnEnter>()
// Match the default TCP frame budget; retain no unbounded party payload.
const PENDING_RETURN_ENTER_MAX_BYTES = 262_144
const configuredReturnWait = Number(process.env.REMATCH_RESULT_WAIT_MAX_MS)
const PENDING_RETURN_ENTER_WAIT_MS = Math.min(180_000,
    Number.isFinite(configuredReturnWait) && configuredReturnWait > 0 ? configuredReturnWait : 180_000)

export function clearPendingFiveBossReturnEnter(client: SessionClient, reason: string): void {
    const pending = pendingFiveBossReturnEnters.get(client)
    if (!pending) return
    pendingFiveBossReturnEnters.delete(client)
    if (pending.timer) clearTimeout(pending.timer)
    client.socket.removeListener("end", pending.closed)
    client.socket.removeListener("close", pending.closed)
    gameVerboseLog(() => `[LOBBY] pending return Enter cleared: room=${client.roomNumber}`
        + ` viewer=${client.viewerId} generation=${pending.generation} reason=${reason}`)
}

function failPendingReturnEnter(client: SessionClient, reason: string): void {
    clearPendingFiveBossReturnEnter(client, reason)
    if (sessionManager.getClient(client.viewerId, client.roomNumber) !== client
        || client.superseded || client.socket.destroyed || client.enterData !== null) return
    // Stop the indexed waiter before buffered Ready/Start or heartbeats can act.
    sessionManager.removeClient(client)
    sessionManager.sendJson(client.socket, [1, [6, "multibattle_room_dismissed"]])
    client.socket.end()
    console.warn(`[LOBBY] pending return Enter rejected: room=${client.roomNumber}`
        + ` viewer=${client.viewerId} reason=${reason}`)
}

function queueFiveBossHostReturnEnter(client: SessionClient, data: any[], room: PendingFiveBossReturnEnter["room"]): void {
    const member = getBattleSessionContract(room)?.members.get(client.viewerId)
    if (!isFiveBossGauntletQuest(room.category, room.quest_id) || !room.five_boss_runtime || room.host_viewer_id !== client.viewerId
        || client.playerId === null || member?.playerId !== client.playerId
        || member.phase !== "SETTLED" || !member.playId || !member.playCommitted
        || !room.lifecycle.battleSessionId || client.roomGeneration !== room.lobby_generation
        || client.roomInstanceId !== room.lifecycle.instanceId || client.isBattle || client.superseded
        || client.enterData !== null || client.socket.destroyed || !client.socket.readable || !client.socket.writable
        || sessionManager.getClient(client.viewerId, client.roomNumber) !== client) return
    if (pendingFiveBossReturnEnters.has(client)) return // Replay cannot extend the deadline or add listeners.
    let snapshot: any[]
    try {
        const json = JSON.stringify(data)
        if (Buffer.byteLength(json, "utf8") > PENDING_RETURN_ENTER_MAX_BYTES) {
            failPendingReturnEnter(client, "frame_budget"); return
        }
        snapshot = JSON.parse(json)
    } catch { failPendingReturnEnter(client, "invalid_enter"); return }
    const pending: PendingFiveBossReturnEnter = {
        room, instanceId: room.lifecycle.instanceId, generation: room.lobby_generation,
        battleSessionId: room.lifecycle.battleSessionId, runId: room.five_boss_runtime.runId,
        playerId: client.playerId, playId: member.playId, connectionGeneration: client.connectionGeneration,
        data: snapshot, deadline: performance.now() + PENDING_RETURN_ENTER_WAIT_MS, timer: null,
        closed: () => { if (pendingFiveBossReturnEnters.get(client) === pending) clearPendingFiveBossReturnEnter(client, "socket_closed") },
    }
    pendingFiveBossReturnEnters.set(client, pending)
    client.socket.once("end", pending.closed)
    client.socket.once("close", pending.closed)
    const ownerUnavailable = () => {
        if (pendingFiveBossReturnEnters.get(client) !== pending) return
        clearPendingFiveBossReturnEnter(client, "owner_unavailable")
        // No authority mutation outside the room FIFO; socket close owns its normal cleanup.
        if (client.superseded || client.enterData !== null || client.socket.destroyed) return
        try { sessionManager.sendJson(client.socket, [1, [6, "multibattle_room_dismissed"]]) } catch { /* closing */ }
        try { client.socket.destroy() } catch { /* already gone */ }
    }
    const expire = () => {
        try { void embeddedMultiCoordinator.enqueueRoomCommand(client.roomNumber, () => {
            if (pendingFiveBossReturnEnters.get(client) !== pending) return
            const currentRoom = getRoom(client.roomNumber)
            if (currentRoom !== pending.room || currentRoom?.lifecycle.instanceId !== pending.instanceId) {
                failPendingReturnEnter(client, "stale_instance"); return
            }
            const remaining = pending.deadline - performance.now()
            if (remaining > 0) {
                pending.timer = createRealtimeMaintenanceTimer(() => setTimeout(expire, remaining))
                pending.timer.unref(); return
            }
            failPendingReturnEnter(client, "result_wait_expired")
        }).catch(ownerUnavailable) } catch { ownerUnavailable() }
    }
    pending.timer = createRealtimeMaintenanceTimer(() => setTimeout(expire, PENDING_RETURN_ENTER_WAIT_MS))
    pending.timer.unref()
    gameVerboseLog(() => `[LOBBY] pending return Enter queued: room=${client.roomNumber}`
        + ` viewer=${client.viewerId} generation=${pending.generation} run=${pending.runId}`)
}

/** Called synchronously inside the terminal room command, after BEGIN_RETURN. */
export function replayFiveBossHostReturnEnter(room: PendingFiveBossReturnEnter["room"], runId: string): void {
    const client = sessionManager.getClient(room.host_viewer_id, room.room_number)
    const pending = client && pendingFiveBossReturnEnters.get(client)
    if (!client || !pending) return
    if (performance.now() >= pending.deadline) {
        failPendingReturnEnter(client, "result_wait_expired"); return
    }
    const binding = findBattlePlayBinding(room, client.viewerId, pending.playerId, pending.playId)
    if (pending.room !== room || pending.instanceId !== room.lifecycle.instanceId
        || pending.generation !== room.lobby_generation || pending.battleSessionId !== room.lifecycle.battleSessionId
        || pending.runId !== runId || room.lifecycle.phase !== "RETURNING" || !binding?.current
        || binding.phase !== "SETTLED" || binding.generation !== pending.generation
        || client.playerId !== pending.playerId || client.roomGeneration !== pending.generation
        || client.roomInstanceId !== pending.instanceId || client.connectionGeneration !== pending.connectionGeneration
        || client.isBattle || client.superseded || client.enterData !== null || client.socket.destroyed
        || !client.socket.readable || !client.socket.writable || findClientBySocket(client.socket) !== client) {
        failPendingReturnEnter(client, "stale_return_identity"); return
    }
    clearPendingFiveBossReturnEnter(client, "terminal_replay")
    // No nested enqueue/await: handleEnter may clear the run identity while completing return.
    handleEnter(client.socket, client, pending.data)
}

// Original CN client PlayerDefaultName table.  The old summon flow selected
// names from this table client-side; the server-side AI entry needs the same
// pool because the repurposed share option no longer runs that client flow.
const NPC_NAME_POOL = [
    "狐狸先森",
    "这个名字没人取",
    "没有名字的空格",
    "酒与抹茶",
    "奕子期",
    "神奇之剑",
    "最爱喝可乐",
    "不需要等了",
    "开心超人",
    "科诺利亚",
    "山崖浪子",
    "记忆像铁轨一样",
    "我好欧啊",
    "光之铸灵",
    "全村人的绝望",
    "龙之骑士",
    "苍炎骇影",
    "咸鱼一号",
    "山有木兮木有枝",
    "三千幻象",
    "抄盘可去NGA",
    "半价洋芋片",
    "夏葵向南",
    "netaneta",
    "初号机",
    "小渔是吃货",
    "全村最好工具人",
    "正常黑",
    "梦醒了",
    "没有丛云",
    "古代树雨夜一猫",
    "多喝热水",
    "西红柿炒番茄",
    "弹射特价版",
    "编号9527",
    "名字真难取",
    "真难取名字",
    "取名真是难",
    "觉不疯",
    "不思量自难忘",
    "我使用剑圣小七",
    "黑虎阿福",
    "神木斩",
    "饭特稀",
    "可乐加冰",
    "从不看管人",
    "狂战士信条",
    "演员混铃铛",
    "铃儿响叮当",
    "再来一局",
    "天空是蔚蓝色",
    "凤凰院凶真",
    "栗悟饭与龟波功",
    "华强买瓜",
    "cooooool",
    "您只会踢罐吗",
    "十连五十星",
    "星星越多越厉害",
    "笑脸人",
    "早川",
    "我不打共斗",
    "helloworld",
    "策定乾坤算因果",
    "镜花水月",
    "poke梦",
    "去爱去工作",
    "弹珠十年老粉",
    "半夏微凉",
    "马铃薯炖土豆",
    "豹子头",
    "啥盘都有",
    "艾尔之暗",
    "仓鼠不囤",
    "众人皆醒我独醉",
    "awsl",
    "莫比乌斯",
    "肉香鱼丝",
    "打手机器人",
    "一天在线十小时",
    "流年花火",
    "武豪野犬",
    "ohhhhhh",
    "月下独舞",
    "路过的路人",
    "D级人员",
    "榴莲蛋糕",
    "草莓布丁",
    "栀落花凉",
    "壹贰叁",
    "半颗核桃",
    "我还有机会吗",
    "改什么名好呢",
    "我是萌新我骄傲",
    "倒地的咩尽龙",
    "蹭完就跑",
    "从不花体力",
    "一沙一世界",
    "墨染的非酋",
    "沐儒",
    "铁骨铮铮光王子",
] as const

function chooseNpcNames(count: number): { name: string }[] {
    const available = [...NPC_NAME_POOL]
    const selected: { name: string }[] = []
    const targetCount = Math.min(Math.max(0, count), available.length)
    for (let i = 0; i < targetCount; i++) {
        const index = Math.floor(Math.random() * available.length)
        selected.push({ name: available[index] })
        available.splice(index, 1)
    }
    return selected
}

function findClientBySocket(socket: net.Socket): SessionClient | undefined {
    return sessionManager.findClientBySocket(socket)
}

function findHostClient(roomNumber: string, roomGeneration?: number): SessionClient | undefined {
    const room = getRoom(roomNumber)
    if (!room) return undefined
    const expectedGeneration = roomGeneration ?? room.lobby_generation
    const clientsMap = (sessionManager as any).clients as Map<string, SessionClient> | undefined
    if (!clientsMap) return undefined
    for (const client of clientsMap.values()) {
        if (client.viewerId === room.host_viewer_id
            && client.roomNumber === roomNumber
            && client.roomGeneration === expectedGeneration
            && !client.isBattle) {
            return client
        }
    }
    return undefined
}

function countRealPlayers(mates: any[]): number {
    return mates.filter(m => !m.comId).length  // real player has no comId
}

function missingRematchReturnMembers(room: NonNullable<ReturnType<typeof getRoom>>): number[] {
    if (room.lobby_generation <= 0) return []
    ensureRematchReturnReservations(room)
    const liveViewerIds = new Set(sessionManager.getClientsInRoom(room.room_number, room.lobby_generation)
        .filter(client => !client.isBattle && !client.superseded && client.enterData !== null
            && !client.socket.destroyed && client.socket.readable && client.socket.writable)
        .map(client => client.viewerId))
    for (const viewerId of room.expected_real_viewer_ids) {
        if (!liveViewerIds.has(viewerId)) markMemberReturnDisconnected(room, viewerId)
    }
    // A surviving old lobby socket is not proof of a new Enter. Only the
    // successful admission path clears a reservation; otherwise an expired
    // pending-result seat could keep rearming an immediate cleanup forever.
    return getReservedReturnViewerIds(room)
}

function normalizeRoster(mates: any[]): any[] {
    const normalized: any[] = []
    const indexes = new Map<string, number>()

    for (const mate of mates) {
        if (!mate) continue
        const key = mate.comId
            ? `com:${Number(mate.comId)}`
            : `viewer:${Number(mate.viewerId)}`
        if (key.endsWith(":NaN")) continue

        const existingIndex = indexes.get(key)
        if (existingIndex === undefined) {
            indexes.set(key, normalized.length)
            normalized.push(mate)
        } else {
            // Prefer the newest object from the live connection while keeping
            // the stable host/guest display order.
            normalized[existingIndex] = mate
        }
    }

    return normalized.slice(0, 3)
}

function synchronizeRoomRoster(
    roomNumber: string,
    mates: any[],
    broadcast = false,
    preserveNpcCount = false,
    roomGeneration?: number,
): any[] {
    const room = getRoom(roomNumber)
    const roster = normalizeRoster(mates)
    const expectedGeneration = roomGeneration ?? room?.lobby_generation
    const clients = sessionManager.getClientsInRoom(roomNumber, expectedGeneration)
        .filter(client => !client.isBattle)

    // Every lobby connection must reference the same canonical roster. Merely
    // broadcasting Mates updates the UI but leaves older server-side client
    // objects stale, allowing a two-player snapshot to start a three-player
    // battle when an early entrant sends StartBattle first.
    for (const connectedClient of clients) connectedClient.mates = roster

    if (room) {
        if (!preserveNpcCount) room.npc_count = roster.filter(mate => !!mate.comId).length
        room.mates = roster.map(mate => ({
            viewer_id: mate.viewerId ?? null,
            com_id: mate.comId ?? 0,
            player_id: mate.playerId ?? undefined,
        }))
    }
    if (broadcast) sessionManager.broadcastToRoom(roomNumber, [1, [1, roster]])
    return roster
}

function collectCanonicalRoomRoster(
    roomNumber: string,
    preserveNpcCount = false,
    roomGeneration?: number,
): any[] {
    const room = getRoom(roomNumber)
    if (!room) return []
    const expectedGeneration = roomGeneration ?? room.lobby_generation

    const hostClient = findHostClient(roomNumber, expectedGeneration)
    const candidates: any[] = []
    if (hostClient?.yourself) candidates.push(hostClient.yourself)
    if (hostClient?.mates) candidates.push(...hostClient.mates)

    for (const connectedClient of sessionManager.getClientsInRoom(roomNumber, expectedGeneration)) {
        if (!connectedClient.isBattle && connectedClient.yourself) {
            candidates.push(connectedClient.yourself)
        }
    }

    return synchronizeRoomRoster(roomNumber, candidates, false, preserveNpcCount, expectedGeneration)
}

export function checkHostAutoReady(roomNumber: string, reconcileMissingNpcs = true): void {
    const room = getRoom(roomNumber)
    if (!room || room.lifecycle.phase !== "LOBBY") return
    const hostClient = findHostClient(roomNumber)
    if (!hostClient) return
    if (missingRematchReturnMembers(room).length > 0) {
        scheduleRematchRosterCleanup(roomNumber)
        return
    }
    const hostMate = hostClient.mates.find(m => m.viewerId === hostClient.viewerId)
    if (!hostMate) return

    // Two real players are already a valid multiplayer party in the original
    // client. The host mirrors ready once at least one non-host member exists
    // and every current non-host member is ready; a third unready entrant
    // cancels the host's ready state again.
    const hasPlayableParty = hostClient.mates.length >= 2
    const nonHostReady = hasPlayableParty && hostClient.mates.every(m =>
        m.viewerId === hostClient.viewerId || m.state?.[0] === 1
    )
    if (nonHostReady) {
        if (!enforceRoomEquipmentReady(room)) {
            room.readyCountdownPending = false
            return
        }
        if (hostMate.state?.[0] !== 1) {
            hostClient.isReady = true
            hostMate.state = [1]
            sessionManager.broadcastToRoom(roomNumber, [1, [2, hostMate.connectionId, [1]]])
            gameVerboseLog(() => `[LOBBY] host auto-ready: room=${roomNumber}`)
        }
    } else {
        room.readyCountdownPending = false
        hostClient.isReady = false
        if (hostMate.state?.[0] === 1) {
            hostMate.state = [0]
            sessionManager.broadcastToRoom(roomNumber, [1, [2, hostMate.connectionId, [0]]])
            gameVerboseLog(() => `[LOBBY] host auto-ready cancelled: room=${roomNumber}`)
        }
    }
    checkAllReadyAndStart(roomNumber, reconcileMissingNpcs)
}

export function refreshEquipmentReadiness(roomNumber: string): void {
    const room = getRoom(roomNumber)
    if (room) room.readyCountdownPending = false
    checkHostAutoReady(roomNumber)
}

function checkAllReadyAndStart(roomNumber: string, reconcileMissingNpcs = true): void {
    const hostClient = findHostClient(roomNumber)
    if (!hostClient) return
    const room = getRoom(roomNumber)
    if (!room || room.lifecycle.phase !== "LOBBY" || room.readyCountdownPending) return
    if (isMode15RoomClosed(room)) {
        stopRandomRecruitment(roomNumber)
        sessionManager.commitRoomDisband(roomNumber, "mode15_room_completed")
        console.log(`[MODE15] auto rematch denied: completed host room=${roomNumber}`)
        return
    }
    if (getMode15HostRoomGate(room)?.unknown) return

    // Guard: auto continuation must wait for the exact real-player roster from
    // the previous battle.  npc_count is not a safe proxy because a real player
    // may have replaced a COM before the battle began.
    if (missingRematchReturnMembers(room).length > 0) {
        scheduleRematchRosterCleanup(roomNumber)
        return
    }
    if (room.expected_real_viewer_ids.length > 0) {
        const presentRealViewerIds = new Set(
            hostClient.mates.filter(mate => !mate.comId).map(mate => Number(mate.viewerId)),
        )
        if (room.expected_real_viewer_ids.some(viewerId => !presentRealViewerIds.has(viewerId))) return
    }

    // A returning rescue guest can make two real players ready before the
    // asynchronous COM reconciliation has restored the third seat. Hold
    // auto-repeat until every required COM has entered and become ready.
    if (room.is_npc_mode) {
        const realCount = countRealPlayers(hostClient.mates)
        const presentNpcCount = hostClient.mates.filter(mate => !!mate.comId).length
        const desiredNpcCount = Math.max(0, 3 - realCount)
        // Every multiplayer room can start with two ready real players. A
        // pending AI seat must only hold a one-real-player room; it must not
        // turn an otherwise valid two-player party into a silent wait.
        if (presentNpcCount < desiredNpcCount && realCount < 2) {
            if (reconcileMissingNpcs) scheduleNpcReconcile(roomNumber)
            return
        }
    }
    // The LAN client can only auto-start a full party. Two ready members
    // remain eligible for manual StartBattle, without a misleading countdown.
    if (hostClient.mates.length < 3) return
    const hostMate = hostClient.mates.find(mate => mate.viewerId === room.host_viewer_id)
    if (hostMate?.autoStart !== true) return

    const allReady = hostClient.mates.every(m => m.state?.[0] === 1)
    if (!allReady) return
    if (!enforceRoomEquipmentReady(room)) {
        room.readyCountdownPending = false
        return
    }

    room.readyCountdownPending = true
    gameVerboseLog(() => `[LOBBY] all ready — StartRemainingTime float: room=${roomNumber}`)
    sessionManager.broadcastToRoom(roomNumber, [1, [10, 2]])
}

export function notifyRoomDisbanded(roomNumber: string): void {
    sessionManager.commitRoomDisband(roomNumber, "lobby_disband_requested")
}

async function handleEnterComs(
    client: SessionClient,
    coms: { name: string }[],
    maxNpcCount?: number,
): Promise<void> {
    let room = getRoom(client.roomNumber)
    if (!room) return
    const roomInstanceId = embeddedMultiCoordinator.ensureLifecycle(room).instanceId
    const roomGeneration = room.lobby_generation
    if (isRealtimeOwnerChild()) {
        const version = room.lifecycle.version, category = room.category, questId = room.quest_id
        const facts = await invokeRealtimeBusiness<PlayerBusinessFacts>("player.facts", {
            playerId: room.host_player_id, category, questId,
        })
        if (getRoom(client.roomNumber) !== room || room.lifecycle.instanceId !== roomInstanceId
            || room.lobby_generation !== roomGeneration || room.lifecycle.version !== version
            || room.category !== category || room.quest_id !== questId || client.superseded || client.socket.destroyed) return
        applyPlayerBusinessFacts(facts)
        if (!getPlayerBusinessFacts(room.host_player_id, { category, questId })) return
    }
    if (isMode15RoomClosed(room)) {
        stopRandomRecruitment(client.roomNumber)
        sessionManager.commitRoomDisband(client.roomNumber, "mode15_room_completed")
        console.log(`[MODE15] TCP StartBattle denied: completed host room=${client.roomNumber}`)
        return
    }
    room.is_npc_mode = true

    const hostMate = findHostClient(client.roomNumber)?.yourself ?? client.mates[0]
    if (!hostMate) return

    // Rebuild from live connections so an older client's local array cannot
    // omit a player who joined later.
    let realMates = collectCanonicalRoomRoster(client.roomNumber, true)
        .filter(m => !m.comId)

    if (realMates.length >= 3) {
        synchronizeRoomRoster(client.roomNumber, realMates.slice(0, 3), true)
        gameVerboseLog(() => `[LOBBY] EnterComs: room already has three real players, stale NPC request cleared`)
        return
    }

    // Determine NPC count: first recruit → calculate and store; rematch → restore fixed count
    // Always fill the seats not occupied by real players. npc_count may have
    // been reduced when a real player joined, so it cannot be used as a cap
    // when that player later leaves or the return lobby is rebuilt.
    const npcLimit = maxNpcCount === undefined ? 3 : Math.max(0, maxNpcCount)
    let needNPCs = Math.min(Math.max(0, 3 - realMates.length - missingRematchReturnMembers(room).length), npcLimit)
    if (maxNpcCount === undefined) room.npc_count = needNPCs  // persist the actual COM slots for rematch
    if (needNPCs <= 0) {
        gameVerboseLog(() => `[LOBBY] EnterComs: room full (${realMates.length} players), skip NPCs`)
        return
    }

    const npcProvider = new NpcMateProvider()
    const recruitResult = await npcProvider.onRecruit(client.roomNumber, String(room?.host_viewer_id ?? 0))

    room = getRoom(client.roomNumber)
    if (!embeddedMultiCoordinator.isCurrentInstance(room, roomInstanceId)
        || room.lobby_generation !== roomGeneration
        || room.lifecycle.phase !== "LOBBY"
        || sessionManager.getClient(client.viewerId, client.roomNumber) !== client) return

    // The provider is asynchronous. A real player may join/leave while it is
    // resolving, so take a fresh roster snapshot before creating COM slots.
    realMates = collectCanonicalRoomRoster(client.roomNumber, true)
        .filter(m => !m.comId)
    needNPCs = Math.min(Math.max(0, 3 - realMates.length - missingRematchReturnMembers(room).length), npcLimit)
    if (maxNpcCount === undefined) room.npc_count = needNPCs
    if (needNPCs === 0) {
        synchronizeRoomRoster(client.roomNumber, realMates.slice(0, 3), true)
        return
    }

    const npcMates: any[] = []
    const recruitedMates = selectStableNpcSlots(recruitResult.recruitedMates, needNPCs)
    room.npc_party_by_com_id ??= {}
    for (const recruited of recruitedMates) {
        const partyKey = String(recruited.com_id)
        const cached = room.npc_party_by_com_id[partyKey]
        if (cached && !isNpcPartyAllowedInRoom(room.category, room.quest_id, cached)) {
            delete room.npc_party_by_com_id[partyKey]
        }
    }
    const missingPartyCount = recruitedMates.filter(recruited =>
        !room.npc_party_by_com_id[String(recruited.com_id)]).length
    // Select only parties for COM seats this room has never used. A rematch
    // whose complete COM roster is cached performs no pool scan or random draw.
    let npcParties: any[] = []
    if (missingPartyCount > 0) {
        try {
            const selectionInstance = room.lifecycle.instanceId, selectionGeneration = room.lobby_generation
            npcParties = await invokeRealtimeBusiness<any[]>("npc.parties", { playerId: client.playerId,
                count: missingPartyCount, category: room.category, questId: room.quest_id })
            if (getRoom(client.roomNumber) !== room || room.lifecycle.instanceId !== selectionInstance
                || room.lobby_generation !== selectionGeneration || client.superseded || client.socket.destroyed) return
        } catch (error) {
            console.error(`[LOBBY] player NPC party pool selection failed room=${client.roomNumber}`, error)
        }
    }
    const firstFallbackComId = 3 - needNPCs
    let nextPartyIndex = 0
    for (let i = 0; i < needNPCs; i++) {
        const recruited = recruitedMates[i] ?? null
        const comId = recruited?.com_id ?? (firstFallbackComId + i)
        const viewerId = recruited?.viewer_id ?? (900000000 + comId)
        // Keep a room's COM composition stable across rematches. Re-randomizing
        // on every return can replace a battle-tested party with a much larger
        // custom-asset combination and make the AIR client's 4096 atlas packer
        // fail with U_1d93f4 during auto-repeat.
        const partyKey = String(comId)
        let party = room.npc_party_by_com_id[partyKey]
        while (!party && nextPartyIndex < npcParties.length) {
            const candidate = npcParties[nextPartyIndex++]
            if (isNpcPartyAllowedInRoom(room.category, room.quest_id, candidate)) party = candidate
        }
        if (!party && isNpcPartyAllowedInRoom(room.category, room.quest_id, hostMate.party)) {
            party = hostMate.party
        }
        if (!party || !isNpcPartyAllowedInRoom(room.category, room.quest_id, party)) {
            delete room.npc_party_by_com_id[partyKey]
            continue
        }
        party = stripWeaponRivenPublicPayload(party)
        room.npc_party_by_com_id[partyKey] = stripWeaponRivenPublicPayload(party)

        npcMates.push({
            viewerId: viewerId,
            comId: comId,
            name: coms[comId - 1]?.name ?? coms[i]?.name ?? `NPC${comId}`,
            rank: hostMate.rank,
            degreeId: hostMate.degreeId,
            playerRoleKind: 99,
            party,
            connectionId: `${client.roomNumber}-npc-${comId}`,
            autoplayMode: false,
            autoskillMode: 1,
            autoSpeedLevel: 1,
            autoStart: false,
            skillAbilityBehaviorMode: 1,
            dashBehaviorMode: 1,
            allowHealFromOtherPlayers: true,
            state: [0],
            entryTime: Date.now(),
            isNewbie: false,
            isHost: false,
        })
    }

    client.mates = synchronizeRoomRoster(client.roomNumber, [...realMates, ...npcMates])

    gameVerboseLog(() => `[LOBBY] EnterComs: room=${client.roomNumber} real=${realMates.length} npc=${npcMates.length} total=${client.mates.length}`)

    const joinTimer = createRealtimeMaintenanceTimer(() => setTimeout(() => {
        void embeddedMultiCoordinator.enqueueRoomCommand(client.roomNumber, () => {
            const currentRoom = getRoom(client.roomNumber)
            if (!embeddedMultiCoordinator.isCurrentInstance(currentRoom, roomInstanceId)
                || currentRoom.lobby_generation !== roomGeneration
                || currentRoom.lifecycle.phase !== "LOBBY") return
            // A host reconnect may replace client before this delayed broadcast.
            const roster = collectCanonicalRoomRoster(client.roomNumber, true, roomGeneration)
            sessionManager.broadcastToRoom(
                client.roomNumber,
                [1, [1, roster]],
                undefined,
                roomGeneration,
            )
        }).catch(e => console.error("[LOBBY] EnterComs send-mates error", e))
    }, NPC_JOIN_DELAY_MS))
    joinTimer.unref()

    // No legal party was available. Wait for a real roster/party change;
    // an automatic ready callback would otherwise recruit the same empty pool.
    if (npcMates.length === 0) return

    const readyTimer = createRealtimeMaintenanceTimer(() => setTimeout(() => {
        void embeddedMultiCoordinator.enqueueRoomCommand(client.roomNumber, () => {
            const currentRoom = getRoom(client.roomNumber)
            if (!embeddedMultiCoordinator.isCurrentInstance(currentRoom, roomInstanceId)
                || currentRoom.lobby_generation !== roomGeneration
                || currentRoom.lifecycle.phase !== "LOBBY") return
            for (const npc of npcMates) {
                npc.state = [1]
                sessionManager.broadcastToRoom(
                    client.roomNumber,
                    [1, [2, npc.connectionId, [1]]],
                    undefined,
                    roomGeneration,
                )
            }
            // Re-evaluate both one-real/two-COM and two-real/one-COM rooms.
            // This recruitment already tried every available seat. Missing
            // legal parties must not make its own ready callback recruit again.
            checkHostAutoReady(client.roomNumber, false)
        }).catch(e => console.error("[LOBBY] EnterComs npc-ready error", e))
    }, NPC_JOIN_DELAY_MS + NPC_READY_DELAY_MS))
    readyTimer.unref()
}

async function recruitNpcMatesForRoomAttempt(roomNumber: string, attempt: number): Promise<void> {
    const room = getRoom(roomNumber)
    if (!room || !room.is_npc_mode || room.lifecycle.phase !== "LOBBY") return
    if (npcRecruitingRooms.has(roomNumber)) {
        // Do not lose a roster-change signal while the provider is resolving.
        npcReconcilePendingRooms.add(roomNumber)
        return
    }

    const hostClient = findHostClient(roomNumber)
    if (!hostClient?.yourself) {
        if (attempt < 40) {
            const roomInstanceId = embeddedMultiCoordinator.ensureLifecycle(room).instanceId
            const roomGeneration = room.lobby_generation
            const retryTimer = createRealtimeMaintenanceTimer(() => setTimeout(() => {
                void embeddedMultiCoordinator.enqueueRoomCommand(
                    roomNumber,
                    () => {
                        const currentRoom = getRoom(roomNumber)
                        if (currentRoom !== room || !embeddedMultiCoordinator.isCurrentInstance(currentRoom, roomInstanceId)
                            || currentRoom.lobby_generation !== roomGeneration
                            || currentRoom.lifecycle.phase !== "LOBBY") return
                        return recruitNpcMatesForRoomAttempt(roomNumber, attempt + 1)
                    },
                ).catch(error => console.error(`[LOBBY] AI recruitment retry failed room=${roomNumber}`, error))
            }, 250))
            retryTimer.unref()
        } else {
            gameVerboseLog(() => `[LOBBY] AI recruitment skipped: host not ready room=${roomNumber}`)
        }
        return
    }

    // Preserve the previous real-player seats only for the configured
    // reconnect grace. The cleanup timer removes expired expectations and
    // schedules another reconciliation, at which point COMs fill the vacancy.
    if (room.lobby_generation > 0 && room.expected_real_viewer_ids.length > 0) {
        const missingExpectedViewerIds = missingRematchReturnMembers(room)
        if (missingExpectedViewerIds.length > 0) {
            // Two-stage rematch: restore the AI count from the previous
            // battle immediately, but leave one seat free for every real
            // player still inside the reconnect grace. The post-grace
            // cleanup removes expired expectations and fills those seats with
            // the extra AI. Marking the room AI-capable here is what lets
            // that post-grace reconcile run even when the previous battle
            // had no AI at all.
            room.is_npc_mode = true
            const rosterBeforeRestore = collectCanonicalRoomRoster(roomNumber, true)
            const realCountBeforeRestore = countRealPlayers(rosterBeforeRestore)
            const presentNpcCountBeforeRestore = rosterBeforeRestore.filter(mate => !!mate.comId).length
            const freeSlotsBeforeRestore = Math.max(
                0,
                3 - realCountBeforeRestore - missingExpectedViewerIds.length,
            )
            const previousAiCount = room.rematch_ai_count ?? room.npc_count ?? 0
            const restoreCount = Math.min(previousAiCount, freeSlotsBeforeRestore)
            if (restoreCount > presentNpcCountBeforeRestore) {
                const hostClient = findHostClient(roomNumber)
                if (hostClient) {
                    npcRecruitingRooms.add(roomNumber)
                    try {
                        await handleEnterComs(hostClient, chooseNpcNames(2), restoreCount)
                    } finally {
                        npcRecruitingRooms.delete(roomNumber)
                        if (npcReconcilePendingRooms.delete(roomNumber)) {
                            scheduleNpcReconcile(roomNumber)
                        }
                    }
                }
            }
            scheduleRematchRosterCleanup(roomNumber)
            return
        }
    }

    // npc_count records the previous battle's desired COM count, but it is not
    // proof that those COM mates are present in the newly-created lobby
    // generation. During settlement return the real-player roster can be
    // rebuilt first, so restore the missing COM entries even when npc_count is
    // already non-zero. Conversely, repeated share/reconnect requests are
    // idempotent once the expected COM roster is already present.
    const roster = collectCanonicalRoomRoster(roomNumber, true)
    const realCount = countRealPlayers(roster)
    const presentNpcCount = roster.filter(mate => !!mate.comId).length
    const desiredNpcCount = 3 - realCount
    room.npc_count = Math.max(0, desiredNpcCount)
    if (desiredNpcCount <= 0 || presentNpcCount >= desiredNpcCount) return

    npcRecruitingRooms.add(roomNumber)
    try {
        await handleEnterComs(hostClient, chooseNpcNames(2))
    } finally {
        npcRecruitingRooms.delete(roomNumber)
        if (npcReconcilePendingRooms.delete(roomNumber)) {
            scheduleNpcReconcile(roomNumber)
        }
    }
}

export function scheduleNpcReconcile(roomNumber: string, delayMs = 100): void {
    if (npcReconcileTimers.has(roomNumber)) return
    const room = getRoom(roomNumber)
    if (!room) return
    const roomInstanceId = embeddedMultiCoordinator.ensureLifecycle(room).instanceId
    const roomGeneration = room.lobby_generation
    const timer = createRealtimeMaintenanceTimer(() => setTimeout(() => {
        if (npcReconcileTimers.get(roomNumber) !== timer) return
        npcReconcileTimers.delete(roomNumber)
        void embeddedMultiCoordinator.enqueueRoomCommand(
            roomNumber,
            () => {
                const currentRoom = getRoom(roomNumber)
                if (currentRoom !== room || !embeddedMultiCoordinator.isCurrentInstance(currentRoom, roomInstanceId)
                    || currentRoom.lobby_generation !== roomGeneration
                    || currentRoom.lifecycle.phase !== "LOBBY") return
                return recruitNpcMatesForRoomAttempt(roomNumber, 0)
            },
        ).catch(error => console.error(`[LOBBY] AI reconciliation failed room=${roomNumber}`, error))
    }, delayMs))
    timer.unref()
    npcReconcileTimers.set(roomNumber, timer)
}

export function recruitNpcMatesForRoom(roomNumber: string): void {
    const room = getRoom(roomNumber)
    if (!room) return
    const roomInstanceId = embeddedMultiCoordinator.ensureLifecycle(room).instanceId
    const roomGeneration = room.lobby_generation
    void embeddedMultiCoordinator.enqueueRoomCommand(
        roomNumber,
        () => {
            const currentRoom = getRoom(roomNumber)
            if (currentRoom !== room || !embeddedMultiCoordinator.isCurrentInstance(currentRoom, roomInstanceId)
                || currentRoom.lobby_generation !== roomGeneration
                || currentRoom.lifecycle.phase !== "LOBBY") return
            return recruitNpcMatesForRoomAttempt(roomNumber, 0)
        },
    ).catch(error => console.error(`[LOBBY] AI recruitment failed room=${roomNumber}`, error))
}

function scheduleRematchRosterCleanup(roomNumber: string): void {
    const room = getRoom(roomNumber)
    if (!room || room.lobby_generation <= 0 || room.lifecycle.phase !== "LOBBY") return
    missingRematchReturnMembers(room)
    const deadline = getNextReturnDeadline(room)
    if (deadline === undefined) return
    const existingTimer = rematchCleanupTimers.get(roomNumber)
    if (existingTimer && (rematchCleanupDeadlines.get(roomNumber) ?? Infinity) <= deadline) return
    if (existingTimer) clearTimeout(existingTimer)

    const generation = room.lobby_generation
    const roomInstanceId = embeddedMultiCoordinator.ensureLifecycle(room).instanceId
    room.rematch_wait_started_at = Date.now()
    const timer = createRealtimeMaintenanceTimer(() => setTimeout(() => {
        void embeddedMultiCoordinator.enqueueRoomCommand(roomNumber, () => {
            if (rematchCleanupTimers.get(roomNumber) !== timer) return
            rematchCleanupTimers.delete(roomNumber)
            rematchCleanupDeadlines.delete(roomNumber)
            const currentRoom = getRoom(roomNumber)
            if (currentRoom !== room || !embeddedMultiCoordinator.isCurrentInstance(currentRoom, roomInstanceId)
                || currentRoom.lobby_generation !== generation
                || currentRoom.lifecycle.phase !== "LOBBY") return

            const missingViewerIds = new Set(missingRematchReturnMembers(currentRoom))
            const removedViewerIds = getExpiredReturnViewerIds(currentRoom)
                .filter(viewerId => missingViewerIds.has(viewerId)
                    && removeRoomMember(roomNumber, viewerId, generation))

            if (removedViewerIds.length > 0) {
                const hostClient = findHostClient(roomNumber)
                if (hostClient) {
                    hostClient.mates = hostClient.mates
                        .filter(mate => mate.comId || !removedViewerIds.includes(Number(mate.viewerId)))
                    sessionManager.broadcastToRoom(roomNumber, [1, [1, hostClient.mates]])
                }
                console.warn(`[LOBBY] rematch reconnect grace expired: room=${roomNumber} removed=${removedViewerIds.join(",")}`)
            }

            currentRoom.rematch_wait_started_at = null
            if (getNextReturnDeadline(currentRoom) === undefined) rematchCleanedGeneration.set(roomNumber, generation)
            else scheduleRematchRosterCleanup(roomNumber)
            checkHostAutoReady(roomNumber)
            if (currentRoom.is_npc_mode) scheduleNpcReconcile(roomNumber)
        }).catch(error => console.error(`[LOBBY] rematch cleanup failed room=${roomNumber}`, error))
    }, Math.max(0, deadline - performance.now())))
    timer.unref()
    rematchCleanupTimers.set(roomNumber, timer)
    rematchCleanupDeadlines.set(roomNumber, deadline)
}

/**
 * Drop per-room lobby bookkeeping when a room is removed. Room numbers can be
 * reused, so stale entries here must not leak into a later room.
 */
export function clearLobbyRoomState(roomNumber: string): void {
    for (const client of sessionManager.getClientsInRoom(roomNumber)) clearPendingFiveBossReturnEnter(client, "room_cleared")
    const rematchTimer = rematchCleanupTimers.get(roomNumber)
    if (rematchTimer) clearTimeout(rematchTimer)
    rematchCleanupTimers.delete(roomNumber)
    rematchCleanupDeadlines.delete(roomNumber)
    rematchCleanedGeneration.delete(roomNumber)
    const reconcileTimer = npcReconcileTimers.get(roomNumber)
    if (reconcileTimer) clearTimeout(reconcileTimer)
    npcReconcileTimers.delete(roomNumber)
    npcReconcilePendingRooms.delete(roomNumber)
    // npcRecruitingRooms is owned by the in-flight recruitment and is always
    // released in its finally block; clearing it here could let that stale
    // finally clear a newer room's marker.
}

/** Test-only view of per-room lobby bookkeeping. */
export function getLobbyRoomStateForTests(roomNumber: string): {
    rematchTimer: boolean
    rematchCleanedGeneration: number | undefined
    npcReconcileTimer: boolean
    npcReconcilePending: boolean
} {
    return {
        rematchTimer: rematchCleanupTimers.has(roomNumber),
        rematchCleanedGeneration: rematchCleanedGeneration.get(roomNumber),
        npcReconcileTimer: npcReconcileTimers.has(roomNumber),
        npcReconcilePending: npcReconcilePendingRooms.has(roomNumber),
    }
}

/** Test-only seed for per-room lobby bookkeeping. */
export function seedLobbyRoomStateForTests(roomNumber: string, generation: number): void {
    rematchCleanedGeneration.set(roomNumber, generation)
    npcReconcilePendingRooms.add(roomNumber)
    scheduleNpcReconcile(roomNumber, 60_000)
}

export function scheduleRematchDisconnectCleanup(roomNumber: string): void {
    const existingTimer = rematchCleanupTimers.get(roomNumber)
    if (existingTimer) clearTimeout(existingTimer)
    rematchCleanupTimers.delete(roomNumber)
    rematchCleanupDeadlines.delete(roomNumber)
    rematchCleanedGeneration.delete(roomNumber)
    scheduleRematchRosterCleanup(roomNumber)
}

function reserveMissingRematchMembersForLegacyAi(
    room: NonNullable<ReturnType<typeof getRoom>>,
    requester: SessionClient,
): void {
    if (room.lobby_generation <= 0
        || requester.viewerId !== room.host_viewer_id
        || room.expected_real_viewer_ids.length === 0) return
    // Legacy Notify10 also occurs automatically. It cannot prove that the host
    // chose to revoke another player's result/return lease. Normal expiry owns
    // destructive replacement, and EnterComs also enforces these reservations.
    missingRematchReturnMembers(room)
    scheduleRematchRosterCleanup(room.room_number)
}

function rejectClaimedAdmission(
    socket: net.Socket,
    client: SessionClient,
    reason: string,
): void {
    recordRoomAdmissionDenial(reason)
    roomAdmissionRegistry.releaseClaim(
        client.roomNumber,
        client.admissionGeneration ?? client.roomGeneration,
        client.viewerId,
        client.connectionId,
    )
    client.admissionClaimed = false
    sessionManager.sendJson(socket, [1, [6, "multibattle_room_dismissed"]])
    sessionManager.removeClient(client)
    markTcpDisconnectReason(socket, "room_rejected")
    socket.end()
    console.warn(
        `[LOBBY] claimed admission rejected: viewer=${client.viewerId}`
        + ` room=${client.roomNumber} reason=${reason}`,
    )
}

function commitClaimedAdmission(socket: net.Socket, client: SessionClient): boolean {
    if (!client.admissionClaimed) {
        return client.playerId !== null
            && addRoomMember(client.roomNumber, client.viewerId, client.playerId)
    }
    const committed = roomAdmissionRegistry.commit(
        client.roomNumber,
        client.admissionGeneration ?? client.roomGeneration,
        client.viewerId,
        client.connectionId,
    )
    client.admissionClaimed = false
    if (committed) {
        return client.playerId !== null
            && addRoomMember(client.roomNumber, client.viewerId, client.playerId)
    }
    rejectClaimedAdmission(socket, client, "claim_lost_before_enter")
    return false
}

function handleEnter(socket: net.Socket, client: SessionClient, data: any[]): void {
    if (sessionManager.takeStaleAssetViewer(client.roomNumber, client.viewerId)) {
        // MeetingServerMessage.AssetUpdate (9): the client leaves the room and
        // returns to the title, which downloads the missing resource edges.
        // Let the normal Enter/Welcome finish first so the room UI is ready.
        console.warn(`[MULTI] outdated resources, sending AssetUpdate: room=${client.roomNumber} viewer=${client.viewerId}`)
        setTimeout(() => {
            if (!socket.destroyed) sessionManager.sendJson(socket, [1, [9]], {
                roomNumber: client.roomNumber, connectionId: client.connectionId, viewerId: client.viewerId,
                roomGeneration: client.roomGeneration, channel: "asset_update",
            })
        }, 300).unref()
    }
    const existingRoom = getRoom(client.roomNumber)
    if (existingRoom?.lifecycle.phase === "BATTLE") {
        queueFiveBossHostReturnEnter(client, data, existingRoom)
        return
    }
    const ed = data[1] ?? {}
    if (!client.yourself) return

    const entryPartyId = Number(data[2] ?? ed.currentPartyId)
    if (Number.isSafeInteger(entryPartyId) && entryPartyId >= 1 && entryPartyId <= 120) {
        client.equipmentSelectedPartyId = entryPartyId
        client.yourself.currentPartyId = entryPartyId
    }

    // Reconnect Enter packets may omit party.  The handshake already built a
    // valid DB-backed party, so still complete Welcome instead of silently
    // returning and leaving the client without its own mate entry (C15202).
    if (ed.party) client.yourself.party = ed.party
    if (ed.autoplayMode !== undefined) client.yourself.autoplayMode = ed.autoplayMode;
    if (ed.autoskillMode !== undefined) client.yourself.autoskillMode = ed.autoskillMode;
    if (ed.autoSpeedLevel !== undefined) client.yourself.autoSpeedLevel = ed.autoSpeedLevel;
    if (ed.autoStart !== undefined) client.yourself.autoStart = ed.autoStart;
    if (ed.skillAbilityBehaviorMode !== undefined) client.yourself.skillAbilityBehaviorMode = ed.skillAbilityBehaviorMode;
    if (ed.dashBehaviorMode !== undefined) client.yourself.dashBehaviorMode = ed.dashBehaviorMode;
    if (ed.allowHealFromOtherPlayers !== undefined) client.yourself.allowHealFromOtherPlayers = ed.allowHealFromOtherPlayers;
    client.enterData = ed

    const room = getRoom(client.roomNumber)
    if (!room) {
        client.mates = [client.yourself]
        sessionManager.sendJson(socket, [1, [0, client.yourself, [client.yourself]]])
        sessionManager.sendJson(socket, [1, [6, "room_not_found"]])
        sessionManager.removeClient(client)
        markTcpDisconnectReason(socket, "room_rejected")
        socket.end()
        return
    }
    if (client.admissionClaimed) {
        const admissionGeneration = client.admissionGeneration ?? client.roomGeneration
        const roomPhase = embeddedMultiCoordinator.ensureLifecycle(room).phase
        if (admissionGeneration !== room.lobby_generation || roomPhase !== "LOBBY") {
            rejectClaimedAdmission(
                socket,
                client,
                admissionGeneration !== room.lobby_generation
                    ? "generation_changed_before_enter"
                    : "phase_changed_before_enter",
            )
            return
        }
    }
    if (room) client.roomGeneration = room.lobby_generation
    const isHost = room && client.viewerId === room.host_viewer_id

    if (isHost) {
        sessionManager.cancelHostReconnectGrace(client.roomNumber)
        sessionManager.completeSettlementReturn(client.roomNumber)
    }

    const hostClient = findHostClient(client.roomNumber)

    // Guest entered before host (or host connected but hasn't entered) → wait with Welcome
    if (!isHost && (!hostClient || !hostClient.mates[0])) {
        client.mates = [client.yourself!]
        if (!commitClaimedAdmission(socket, client)) return
        sessionManager.sendJson(client.socket, [1, [0, client.yourself, [client.yourself]]])
        sessionManager.beginRescueGuestWait(client)
        gameVerboseLog(() => `[LOBBY] guest ${client.viewerId} entered alone, waiting for host in room ${client.roomNumber}`)
        return
    }

    if (isHost) {
        client.mates = [client.yourself!]
        const currentGenerationClients = sessionManager.getClientsInRoom(
            client.roomNumber,
            room?.lobby_generation,
        )
        for (const connectedClient of currentGenerationClients) {
            if (connectedClient !== client && !connectedClient.isBattle && connectedClient.yourself) {
                client.mates.push(connectedClient.yourself)
            }
        }
        client.mates = synchronizeRoomRoster(client.roomNumber, client.mates, false, true)
        if (client.mates.length > 1) {
            sessionManager.broadcastToRoom(client.roomNumber, [1, [1, client.mates]], `${client.viewerId}@${client.roomNumber}`)
        }
        if (room && room.is_npc_mode && countRealPlayers(client.mates) < 3) {
            // The AI switch stays enabled across auto-repeat battles. Restore
            // COM mates from the mode flag rather than npc_count, because the
            // latter may transiently be zero while the return lobby rebuilds
            // its real-player roster.
            const roomInstanceId = embeddedMultiCoordinator.ensureLifecycle(room).instanceId
            const roomGeneration = room.lobby_generation
            const timer = createRealtimeMaintenanceTimer(() => setTimeout(() => {
                const currentRoom = getRoom(client.roomNumber)
                if (currentRoom !== room || !embeddedMultiCoordinator.isCurrentInstance(currentRoom, roomInstanceId)
                    || currentRoom.lobby_generation !== roomGeneration
                    || currentRoom.lifecycle.phase !== "LOBBY"
                    || client.superseded || client.socket.destroyed
                    || findHostClient(client.roomNumber) !== client) return
                recruitNpcMatesForRoom(client.roomNumber)
            }, 500))
            timer.unref()
        }
        scheduleRematchRosterCleanup(client.roomNumber)
    } else {
        if (hostClient && client.yourself) {
            hostClient.mates = hostClient.mates.filter(mate => mate.viewerId !== client.viewerId)
            hostClient.mates.push(client.yourself)
            while (hostClient.mates.length > 3) {
                const npcIdx = hostClient.mates.findIndex(m => !!m.comId)
                if (npcIdx >= 0) hostClient.mates.splice(npcIdx, 1)
                else break
            }
            client.mates = collectCanonicalRoomRoster(client.roomNumber)
            if (!client.mates.some(mate => mate.viewerId === client.viewerId)) {
                sessionManager.sendJson(socket, [1, [0, client.yourself, [client.yourself]]])
                sessionManager.sendJson(socket, [1, [6, "room_full"]])
                sessionManager.removeClient(client)
                markTcpDisconnectReason(socket, "room_rejected")
                socket.end()
                console.warn(`[LOBBY] overflow guest rejected before Mates: viewer=${client.viewerId} room=${client.roomNumber}`)
                return
            }
        } else {
            client.mates = [client.yourself!]
        }
        if (room && room.lobby_generation > 0 && !room.expected_real_viewer_ids.includes(client.viewerId)) {
            room.expected_real_viewer_ids.push(client.viewerId)
        }
    }

    if (!commitClaimedAdmission(socket, client)) return

    const yourself = client.yourself
    if (yourself) {
        sessionManager.sendJson(client.socket, [1, [0, yourself, [yourself]]])
    }

    if (isHost) {
        // A reconnecting host is intentionally excluded from the roster
        // broadcast above so it cannot receive Mates before Welcome.  Replay
        // the complete canonical roster directly after Welcome; otherwise the
        // new host socket only knows about itself while the guest remains
        // present (and possibly ready) on the server.
        client.mates = collectCanonicalRoomRoster(client.roomNumber, true)
        sessionManager.sendJson(client.socket, [1, [1, client.mates]])
        checkHostAutoReady(client.roomNumber)
    } else {
        const mates = hostClient?.mates ?? client.mates
        sessionManager.broadcastToRoom(client.roomNumber, [1, [1, mates]], undefined)
        checkHostAutoReady(client.roomNumber)
        sessionManager.beginRescueGuestWait(client)
    }
    if (room.is_npc_mode) scheduleNpcReconcile(client.roomNumber)

    gameVerboseLog(() => `[LOBBY] ${isHost ? "host" : "guest"} ${client.viewerId} entered room ${client.roomNumber}`)
}

function handleBye(_socket: net.Socket, client: SessionClient, _data: any[]): void {
    markTcpDisconnectReason(client.socket, "client_bye")
    const room = getRoom(client.roomNumber)
    // StartBattle advances the generation before the client closes its lobby
    // socket. That Bye only ends the lobby transport; the frozen battle seat
    // remains the identity used by /load and restore_room. A late Bye from a
    // previous round likewise cannot release a seat in the current lobby.
    if (!room || room.lifecycle.phase !== "LOBBY"
        || client.roomGeneration !== room.lobby_generation) {
        sessionManager.removeClient(client)
        try { client.socket.destroy() } catch (e) {}
        gameVerboseLog(() => `[LOBBY] transport ended: viewer=${client.viewerId} room=${client.roomNumber}`
            + ` generation=${client.roomGeneration} phase=${room?.lifecycle.phase ?? "missing"}`)
        return
    }
    const set = (sessionManager as any).roomClients?.get?.(client.roomNumber) as Set<string> | undefined
    if (set) {
        const clientsMap = (sessionManager as any).clients as Map<string, SessionClient> | undefined
        if (clientsMap) {
            for (const addr of set) {
                const c = clientsMap.get(addr)
                if (c && c !== client && !c.isBattle) {
                    c.mates = c.mates.filter(m => m.viewerId !== client.viewerId)
                }
            }
        }
    }
    const hostClient = findHostClient(client.roomNumber)
    removeRoomMember(client.roomNumber, client.viewerId)
    if (room && room.lifecycle.phase === "LOBBY" && client.roomGeneration === room.lobby_generation) {
        room.expected_real_viewer_ids = room.expected_real_viewer_ids
            .filter(viewerId => viewerId !== client.viewerId)
    }
    sessionManager.removeClient(client)
    // Only refresh the mate list if the room still exists AND a *different* client is the host (i.e. a
    // guest left but the room lives on). If the room was disbanded (host left / went empty), the
    // [6, dismissed] broadcast already tore it down — pushing a stale/empty mate list here makes the
    // remaining client's refreshMates dereference undefined character-display data and crash (F1010).
    const remainingRoom = getRoom(client.roomNumber)
    if (remainingRoom && hostClient && hostClient !== client) {
        const remainingMates = synchronizeRoomRoster(
            client.roomNumber,
            hostClient.mates,
            false,
            true,
            remainingRoom.lobby_generation,
        )
        sessionManager.broadcastToRoom(client.roomNumber, [1, [1, remainingMates]])
        if (remainingRoom.is_npc_mode) scheduleNpcReconcile(client.roomNumber)
    }
    try { client.socket.destroy(); } catch (e) {}
    gameVerboseLog(() => `[LOBBY] client ${client.viewerId} left room ${client.roomNumber}`)
}

async function handleChangeParty(_socket: net.Socket, client: SessionClient, data: any[]): Promise<void> {
    const currentRoom = getRoom(client.roomNumber)
    if (!currentRoom || currentRoom.lifecycle.phase !== "LOBBY"
        || client.roomGeneration !== currentRoom.lobby_generation) return
    const pd = data[1]
    const previousSavedPartyId = getPlayerBusinessFacts(Number(client.playerId))?.player.partySlot
    const currentPartyId = data[3] ?? pd?.currentPartyId
    const changed = (currentPartyId !== undefined && currentPartyId !== client.yourself?.currentPartyId)
        || (!!pd?.party && JSON.stringify(pd.party) !== JSON.stringify(client.yourself?.party))
    if (pd && client.yourself) {
        // ChangeParty carries the complete Mate object, not only the party.
        // In particular, the "allow healing from teammates" toggle updates
        // allowHealFromOtherPlayers here.  If we keep the old value and then
        // broadcast Mates, the sender's local toggle is immediately overwritten
        // and the following battle is created with the wrong healing policy.
        const mutableMateFields = [
            "party",
            "autoplayMode",
            "autoskillMode",
            "autoSpeedLevel",
            "autoStart",
            "skillAbilityBehaviorMode",
            "dashBehaviorMode",
            "allowHealFromOtherPlayers",
        ]
        for (const field of mutableMateFields) {
            if (pd[field] !== undefined) client.yourself[field] = pd[field]
        }
        if (client.playerId && pd.party !== undefined) {
            // Keep reconnect handshakes aligned with the in-memory room
            // roster immediately; the low-priority DB save may finish later.
            if (!isRealtimeOwnerChild()) require("../party-snapshot").setRealPartySnapshot(client.playerId, pd.party, currentPartyId ?? client.yourself.currentPartyId)
        }
        if (currentPartyId !== undefined) {
            client.yourself.currentPartyId = currentPartyId
        }
    }
    const mate = client.mates.find(m => m.viewerId === client.viewerId)
    if (mate) {
        if (changed) {
            currentRoom.readyCountdownPending = false
            recordEquipmentPartyChange(client, Number(currentPartyId), data[2] !== true)
            // Automatic rematches with legal parties retain their Ready state.
            // Invalid automatic changes were already reset by the shared gate.
            if (data[2] !== true) setPreparation(client, true)
        }
        if (client.playerId && currentPartyId !== undefined) {
            const playerId = client.playerId
            const partySlot = currentPartyId
            // Party selection is already authoritative in the in-memory room.
            // Defer the low-priority save so the TCP callback can broadcast the
            // roster without synchronously waiting on SQLite.
            const restoreBusinessContext = captureRealtimeBusinessContext()
            const partyPersistence = new Promise<void>(resolve => {
                setImmediate(() => restoreBusinessContext(() => {
                    if (sessionManager.getClient(client.viewerId, client.roomNumber) !== client
                        || client.superseded || getRoom(client.roomNumber) !== currentRoom
                        || currentRoom.lifecycle.phase !== "LOBBY"
                        || client.roomGeneration !== currentRoom.lobby_generation
                        || client.yourself?.currentPartyId !== partySlot) { resolve(); return }
                    void invokeRealtimeBusiness("player.party", { playerId, partyId: partySlot,
                        category: currentRoom.category, questId: currentRoom.quest_id, party: client.yourself?.party ?? null,
                        ...(previousSavedPartyId === undefined ? {} : { expectedSavedPartyId: previousSavedPartyId }) })
                        .catch(error => {
                            const uncertain = error as { code?: string; confirmation?: Promise<unknown> }
                            if (uncertain?.code === "BUSINESS_OUTCOME_UNKNOWN" && uncertain.confirmation) return uncertain.confirmation
                            throw error
                        }).then(() => resolve(), error => {
                            console.warn(`[MULTI] deferred party persistence failed player=${playerId}`, error)
                            resolve()
                        })
                }))
            })
            // Hold the accepted frame until the actual save ACK, while allowing
            // later lobby commands and heartbeats to use the room queue.
            retainRealtimeBusinessTail(partyPersistence)
        }
        const room = getRoom(client.roomNumber)
        if (room && room.host_viewer_id === client.viewerId && currentPartyId !== undefined) room.host_party_id = currentPartyId
        const roster = collectCanonicalRoomRoster(client.roomNumber)
        sessionManager.broadcastToRoom(client.roomNumber, [1, [1, roster]])
        // An invalid host fallback leaves COM seats empty. Once the host's
        // actual wire party is corrected, fill only those missing seats.
        if (changed && room?.is_npc_mode && room.host_viewer_id === client.viewerId
            && roster.length < 3
            && isNpcPartyAllowedInRoom(room.category, room.quest_id, client.yourself?.party)) {
            scheduleNpcReconcile(client.roomNumber)
        }
    }
    checkHostAutoReady(client.roomNumber)
    gameVerboseLog(() => `[LOBBY] client ${client.viewerId} changed party: party=${currentPartyId ?? "unchanged"} allowHeal=${client.yourself?.allowHealFromOtherPlayers ?? "unchanged"}`)
}

function handleReady(_socket: net.Socket, client: SessionClient, data: any[]): void {
    const room = getRoom(client.roomNumber)
    if (room
        && room.lifecycle.phase === "RETURNING"
        && room.host_viewer_id === client.viewerId) {
        sessionManager.completeSettlementReturn(client.roomNumber)
    }
    if (!room || room.lifecycle.phase !== "LOBBY"
        || client.roomGeneration !== room.lobby_generation) return
    const readyState = Array.isArray(data[1]) ? data[1][0] : data[1]
    if (readyState === 1 && !enforceEquipmentReady(room, client, true)) {
        room.readyCountdownPending = false
        checkHostAutoReady(client.roomNumber)
        return
    }
    client.isReady = readyState === 1
    if (sessionManager.isRescueGuest(client.roomNumber, client.viewerId)) {
        sessionManager.beginRescueGuestWait(client)
    }

    const mate = client.mates.find(m => m.viewerId === client.viewerId)
    if (mate) {
        mate.state = [client.isReady ? 1 : 0]
        sessionManager.broadcastToRoom(client.roomNumber, [1, [2, mate.connectionId, mate.state]])
    }

    checkHostAutoReady(client.roomNumber)
    gameVerboseLog(() => `[LOBBY] client ${client.viewerId} ready: ${client.isReady}`)
}

function handleHeartbeat(socket: net.Socket, client: SessionClient, _data: any[]): void {
    sessionManager.sendJson(socket, [1, [11, client.connectionId]])
}

function handleChangeAutoStart(socket: net.Socket, client: SessionClient, data: any[]): void {
    const autoStart = data[1]
    if (typeof autoStart !== "boolean") return
    const room = getRoom(client.roomNumber)
    if (!room || room.lifecycle.phase !== "LOBBY"
        || client.roomGeneration !== room.lobby_generation
        || client.isBattle || client.superseded || !client.yourself
        || client.enterData === null || socket.destroyed || client.socket !== socket
        || sessionManager.getClient(client.viewerId, client.roomNumber) !== client
        || findClientBySocket(socket) !== client) return

    const roster = collectCanonicalRoomRoster(client.roomNumber, true, room.lobby_generation)
    const mate = roster.find(current => !current.comId
        && current.viewerId === client.viewerId && current.connectionId === client.connectionId)
    if (!mate || (mate.autoStart === autoStart && client.yourself.autoStart === autoStart)) return

    client.yourself.autoStart = autoStart
    mate.autoStart = autoStart
    synchronizeRoomRoster(client.roomNumber, roster, false, true, room.lobby_generation)
    if (client.viewerId === room.host_viewer_id) room.readyCountdownPending = false
    sessionManager.broadcastToRoom(client.roomNumber, [1, [4, client.connectionId, autoStart]])
    checkHostAutoReady(client.roomNumber)
}

function handleStartBattle(_socket: net.Socket, client: SessionClient, _data: any[], deadlineMs = 10_000): void {
    const battleAlreadyInitialized = !!(sessionManager as any).battleExpectedCount?.has?.(client.roomNumber)
    if (battleAlreadyInitialized) return

    const room = getRoom(client.roomNumber)
    if (!room) return
    if (getMode15HostRoomGate(room)?.unknown) return
    let lifecyclePhase = embeddedMultiCoordinator.ensureLifecycle(room).phase
    if (lifecyclePhase === "RETURNING"
        && sessionManager.isHostOnline(room.host_viewer_id, client.roomNumber)
        && sessionManager.completeSettlementReturn(client.roomNumber)) {
        lifecyclePhase = embeddedMultiCoordinator.ensureLifecycle(room).phase
    }
    // Normally TCP StartBattle commits the transition before HTTP /start.
    // If a very fast client reverses that order, /start has already committed
    // the same battle generation; finish the lobby delivery without advancing
    // the room a second time.
    if (lifecyclePhase !== "LOBBY" && lifecyclePhase !== "BATTLE") return
    const sourceGeneration = lifecyclePhase === "BATTLE"
        ? Math.max(0, room.lobby_generation - 1)
        : room.lobby_generation
    // StartBattle may be sent first by any participant. Always use the
    // canonical host roster instead of that sender's potentially older copy.
    let members = collectCanonicalRoomRoster(client.roomNumber, false, sourceGeneration)
    if (!room.equipmentPartyIds && !enforceRoomEquipmentReady(room, sourceGeneration)) {
        room.readyCountdownPending = false
        return
    }

    // checkAllReadyAndStart already waits for the previous battle's real
    // players, but the client can send StartBattle directly as soon as the
    // host and restored COM mates appear ready. Enforce the same rule at the
    // final mutation boundary so that request cannot overwrite the expected
    // roster and start a 1-real/2-COM rematch before a guest returns.
    if (lifecyclePhase === "LOBBY" && missingRematchReturnMembers(room).length > 0) {
        scheduleRematchRosterCleanup(client.roomNumber)
        return
    }
    if (room.lobby_generation > 0 && room.expected_real_viewer_ids.length > 0) {
        const presentRealViewerIds = new Set(
            members
                .filter(mate => !mate.comId && Number.isFinite(Number(mate.viewerId)))
                .map(mate => Number(mate.viewerId)),
        )
        const missingExpectedViewerIds = room.expected_real_viewer_ids
            .filter(viewerId => !presentRealViewerIds.has(viewerId))
        if (missingExpectedViewerIds.length > 0) {
            scheduleRematchRosterCleanup(client.roomNumber)
            gameVerboseLog(() =>
                `[LOBBY] StartBattle deferred: room=${client.roomNumber}`
                + ` waiting=${missingExpectedViewerIds.join(",")} sender=${client.viewerId}`
            )
            return
        }
    }

    if (members.length < 2) {
        gameVerboseLog(() => `[LOBBY] StartBattle deferred: room=${client.roomNumber} roster=${members.length}/2 sender=${client.viewerId}`)
        return
    }
    if (!members.every(mate => mate.state?.[0] === 1)) {
        gameVerboseLog(() => `[LOBBY] StartBattle deferred: room=${client.roomNumber} unready roster sender=${client.viewerId}`)
        return
    }
    // Gate-off rooms keep the original synchronous start, including HTTP-first delivery.
    const rivenEnabled = process.env.WEAPON_RIVEN_MULTI_ENABLED === "1"
    const frozen = rivenEnabled ? startWeaponRivenPreparation(room, members,
        () => handleStartBattle(_socket, client, _data, deadlineMs), deadlineMs) : undefined
    if (rivenEnabled && !frozen) return
    if (frozen) members = frozen.members
    const realViewerIds = [...new Set(
        members
            .filter(mate => !mate.comId && Number.isFinite(Number(mate.viewerId)))
            .map(mate => Number(mate.viewerId)),
    )]
    if (!freezeFiveBossLobby(room, members, frozen?.conversionLoadouts)) {
        gameVerboseLog(() => `[LOBBY] StartBattle deferred: five-boss roster invalid`
            + ` room=${client.roomNumber} roster=${members.length}`
            + ` ready=${members.filter(mate => mate.state?.[0] === 1).length}`)
        return
    }
    const expectedCount = realViewerIds.length
    for (const viewerId of realViewerIds) {
        sessionManager.clearRescueGuestLobbyWait(client.roomNumber, viewerId)
    }
    room.readyCountdownPending = false
    room.expected_real_viewer_ids = realViewerIds
    room.npc_count = members.filter(mate => !!mate.comId).length
    room.rematch_ai_count = room.npc_count
    room.mates = members.map(mate => ({
        viewer_id: mate.viewerId ?? null,
        com_id: mate.comId ?? 0,
        player_id: mate.playerId ?? undefined,
    }))
    room.rematch_wait_started_at = null
    const cleanupTimer = rematchCleanupTimers.get(client.roomNumber)
    if (cleanupTimer) clearTimeout(cleanupTimer)
    rematchCleanupTimers.delete(client.roomNumber)
    rematchCleanupDeadlines.delete(client.roomNumber)
    rematchCleanedGeneration.delete(client.roomNumber)
    const battleStart = lifecyclePhase === "LOBBY"
        ? embeddedMultiCoordinator.commitBattleStart(room)
        : {
            ok: true as const,
            previousGeneration: Math.max(0, room.lobby_generation - 1),
            battleSessionId: room.lifecycle.battleSessionId ?? "",
        }
    if (!battleStart.ok) return
    if (!room.equipmentPartyIds) freezeEquipmentSelections(room, sourceGeneration)
    const expectedBattleSeats = sessionManager.getClientsInRoom(client.roomNumber, battleStart.previousGeneration)
        .filter(current => realViewerIds.includes(current.viewerId))
        .map(current => ({ viewerId: current.viewerId, connectionId: current.connectionId }))
    sessionManager.setBattleExpectedCount(client.roomNumber, expectedCount, expectedBattleSeats)
    stopRandomRecruitment(client.roomNumber)
    // Keep rescue membership for the whole room lifecycle.  Battle finish
    // needs this marker to grant the repeatable rescue reward, and a rescue
    // guest who remains for auto-repeat is still a rescue guest next round.
    // Lobby wait timers were already cleared above; the membership itself is
    // removed only when the guest is ejected or the room is disbanded.

    room.readyCountdownPending = false
    if (rivenEnabled) commitWeaponRivenPreparation(room)
    else {
        const eligibleViewerIds = new Set(realViewerIds)
        for (const current of sessionManager.getClientsInRoom(client.roomNumber, battleStart.previousGeneration)) {
            if (eligibleViewerIds.has(current.viewerId)) sessionManager.sendJson(current.socket, [1, [5, members]])
        }
    }
    gameVerboseLog(() => `[LOBBY] StartBattle: room=${client.roomNumber} mates=${members.length} real=${expectedCount} npc=${room?.npc_count ?? 0} nextGeneration=${room?.lobby_generation ?? 0}`)
}

/** HTTP joins the same two-phase TCP start, waiting outside the serialized room queue. */
export async function requestWeaponRivenHttpStart(room: NonNullable<ReturnType<typeof getRoom>>, viewerId: number,
    partyId: number, remainingMs: number): Promise<boolean> {
    await embeddedMultiCoordinator.enqueueRoomCommand(room.room_number, () => {
        if (getRoom(room.room_number) !== room) return
        const peer = sessionManager.getClient(viewerId, room.room_number)
        if (!peer || peer.superseded || peer.enterData === null
            || Number(peer.equipmentSelectedPartyId ?? peer.yourself?.currentPartyId ?? 1) !== partyId) return
        handleStartBattle(peer.socket, peer, [], remainingMs)
    })
    return waitWeaponRivenPreparation(room)
}

async function handleNotify(socket: net.Socket, client: SessionClient, data: any[]): Promise<void> {
    const notifyData = data[1]
    if (!Array.isArray(notifyData)) return
    const tag = notifyData[0] as number

    if (isRealtimeOwnerChild() && (tag === 3 || tag === 6)) {
        const room = getRoom(client.roomNumber)
        if (!room || room.lifecycle.phase !== "LOBBY") return
        const instance = room.lifecycle.instanceId, generation = room.lobby_generation
        const version = room.lifecycle.version, category = room.category, questId = room.quest_id
        const participants = sessionManager.getClientsInRoom(client.roomNumber, generation)
            .filter(current => !current.isBattle && !current.superseded && current.playerId !== null && current.yourself)
        const snapshots = participants.map(current => ({ current, connectionId: current.connectionId,
            partyId: Number(current.equipmentSelectedPartyId ?? current.yourself.currentPartyId ?? 1),
            wireParty: JSON.stringify(current.yourself.party) }))
        const requests = snapshots.map(snapshot => invokeRealtimeBusiness<PlayerBusinessFacts>("player.facts", {
            playerId: snapshot.current.playerId, category: room.category, questId: room.quest_id,
            partyId: snapshot.partyId, wireParty: snapshot.current.yourself.party,
        }))
        if (!snapshots.some(snapshot => snapshot.current.playerId === room.host_player_id)) requests.push(
            invokeRealtimeBusiness<PlayerBusinessFacts>("player.facts", { playerId: room.host_player_id, category, questId }))
        const facts = await Promise.all(requests)
        if (getRoom(client.roomNumber) !== room || room.lifecycle.instanceId !== instance
            || room.lobby_generation !== generation || room.lifecycle.phase !== "LOBBY"
            || room.lifecycle.version !== version || room.category !== category || room.quest_id !== questId
            || snapshots.some(snapshot => snapshot.current.superseded || snapshot.current.socket.destroyed
                || sessionManager.getClient(snapshot.current.viewerId, client.roomNumber) !== snapshot.current
                || snapshot.current.connectionId !== snapshot.connectionId
                || JSON.stringify(snapshot.current.yourself.party) !== snapshot.wireParty)) return
        facts.forEach(fact => applyPlayerBusinessFacts(fact))
        if (!getPlayerBusinessFacts(room.host_player_id, { category, questId })) return
        if (snapshots.some(snapshot => !getPlayerBusinessFacts(Number(snapshot.current.playerId), {
            category: room.category, questId: room.quest_id, partyId: snapshot.partyId }))) return
    }

    switch (tag) {
        case 0: handleEnter(socket, client, notifyData); break
        case 1: handleBye(socket, client, notifyData); break
        case 2: await handleChangeParty(socket, client, notifyData); break
        case 3: handleReady(socket, client, notifyData); break
        case 4: handleHeartbeat(socket, client, notifyData); break
        case 5: break
        case 9: acceptWeaponRivenAck(client, notifyData[1]); break
        case 6: handleStartBattle(socket, client, notifyData); break
        case 7: {
            const change = handleAutoplayModeChange(
                client,
                notifyData,
                (roomNumber, message) => sessionManager.broadcastToRoom(roomNumber, message),
            )
            if (change) {
                gameVerboseLog(() =>
                    `[LOBBY] autoplay changed: room=${client.roomNumber}`
                    + ` viewer=${client.viewerId} auto=${change.autoplayMode}`
                    + ` manual=${change.manualMode}`
                )
            }
            break
        }
        case 8: handleChangeAutoStart(socket, client, notifyData); break
        case 10: {
            const room = getRoom(client.roomNumber)
            if (room?.is_npc_mode) {
                reserveMissingRematchMembersForLegacyAi(room, client)
                await handleEnterComs(client, notifyData[1] as any[])
            } else {
                gameVerboseLog(() => `[LOBBY] ignored legacy COM summon for real-player room=${client.roomNumber}`)
            }
            break
        }
        default:
            console.warn(`[LOBBY] unhandled Notify: ${tag}`)
    }
}

function handleBroadcast(_socket: net.Socket, client: SessionClient, data: any[]): void {
    // Client2Server.Broadcast carries MeetingBroadcastMessage entries (the
    // room protocol only defines Emotion). The sender already renders its own
    // balloon locally, so relay the payload to the other room members in the
    // envelope the room parser expects:
    //   MeetingServer2Client.Messages(senderConnectionId, messages)
    // Relaying the raw client frame ([1, ...]) made the client parse it as a
    // server Message instead of Messages, so lobby emotions were dropped.
    const messages = data[1]
    if (!Array.isArray(messages) || messages.length === 0) return
    sessionManager.broadcastToRoom(
        client.roomNumber,
        [2, client.connectionId, messages],
        `${client.viewerId}@${client.roomNumber}`,
    )
}

function handleSend(_socket: net.Socket, client: SessionClient, data: any[]): void {
    const targetViewerId = Number(data[1])
    if (!Number.isSafeInteger(targetViewerId) || targetViewerId <= 0) return
    // Lobby clients are indexed by viewer@room, so the target is a direct
    // lookup. Apply the same recipient rules as broadcastToRoom: current
    // connection, Enter already answered, and the room's current round.
    const target = sessionManager.getClient(targetViewerId, client.roomNumber)
    if (!target || target.isBattle || target.superseded || target.enterData === null) return
    const currentGeneration = getRoom(client.roomNumber)?.lobby_generation
    if (currentGeneration !== undefined && target.roomGeneration !== currentGeneration) return
    sessionManager.sendJson(target.socket, data, {
        roomNumber: client.roomNumber,
        connectionId: target.connectionId,
        viewerId: target.viewerId,
        roomGeneration: target.roomGeneration,
        channel: "lobby",
    })
}

export function handleMessage(socket: net.Socket, data: unknown): Promise<void> | void {
    if (!Array.isArray(data)) return
    const tag = data[0] as number
    const client = findClientBySocket(socket)
    if (!client) {
        if (sessionManager.isSupersededSocket(socket)
            || sessionManager.isRetiredLobbySocket(socket)) {
            gameVerboseLog(() => `[LOBBY] dropped late message from quarantined socket tag=${tag}`)
        } else {
            console.warn(`[LOBBY] no client found for socket, dropping message tag=${tag}`)
        }
        return
    }

    return embeddedMultiCoordinator.enqueueRoomCommand(client.roomNumber, async () => {
        const current = findClientBySocket(socket)
        if (!current || current.superseded) return
        if (tag === 0 && Array.isArray(data[1]) && [0, 1, 2, 7, 10].includes(data[1][0])) {
            const room = getRoom(current.roomNumber)
            if (room) cancelWeaponRivenPreparation(room, "roster_changed")
        }
        if (!socket.destroyed && (tag === 0 || tag === 1 || tag === 2)) {
            notifyRealtimePresence(current.viewerId)
        }
        switch (tag) {
            case 0: await handleNotify(socket, current, data); break
            case 1: handleBroadcast(socket, current, data); break
            case 2: handleSend(socket, current, data); break
            default:
                console.warn(`[LOBBY] unhandled Client2Server: ${tag}`)
        }
    }).catch(error => {
        console.error(`[LOBBY] room command failed: room=${client.roomNumber} tag=${tag}`, error)
        if (!socket.destroyed) {
            markTcpDisconnectReason(socket, "message_error")
            socket.destroy()
        }
    })
}
