import * as net from "net"
import { sessionManager, SessionClient } from "../state/SessionManager"
import { getRoom, updateRoomState } from "../room/manager"
import { NpcMateProvider } from "../npc/controller"
import { stopRandomRecruitment } from "../recruitment"
import { gameVerboseLog } from "../../lib/game-logging"
import {
    getNpcPartySelectionOptions,
    getRandomPlayerNpcPartiesSync,
} from "../npc/player-party-pool"
import { isMode15RoomClosed } from "../mode15-room-gate"
import {
    getMode15ExclusiveGlobalPartyItemsSync,
    isMode15Quest,
} from "../../lib/mode15-optional"
import { getPlayerSync } from "../../data/domains/player"

const NPC_JOIN_DELAY_MS = parseInt(process.env.NPC_JOIN_DELAY_MS || "2000")
const NPC_READY_DELAY_MS = parseInt(process.env.NPC_READY_DELAY_MS || "500")
const REMATCH_RECONNECT_GRACE_MS = parseInt(process.env.REMATCH_RECONNECT_GRACE_MS || "25000")
const npcRecruitingRooms = new Set<string>()
const npcReconcilePendingRooms = new Set<string>()
const npcReconcileTimers = new Map<string, NodeJS.Timeout>()
const rematchCleanupTimers = new Map<string, NodeJS.Timeout>()
const rematchCleanedGeneration = new Map<string, number>()

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
    const clientsMap = (sessionManager as any).clients as Map<string, SessionClient> | undefined
    if (!clientsMap) return undefined
    for (const client of clientsMap.values()) {
        if (client.socket === socket) return client
    }
    return undefined
}

function findHostClient(roomNumber: string): SessionClient | undefined {
    const room = getRoom(roomNumber)
    if (!room) return undefined
    const clientsMap = (sessionManager as any).clients as Map<string, SessionClient> | undefined
    if (!clientsMap) return undefined
    for (const client of clientsMap.values()) {
        if (client.viewerId === room.host_viewer_id
            && client.roomNumber === roomNumber
            && client.roomGeneration === room.lobby_generation
            && !client.isBattle) {
            return client
        }
    }
    return undefined
}

function countRealPlayers(mates: any[]): number {
    return mates.filter(m => !m.comId).length  // real player has no comId
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
): any[] {
    const room = getRoom(roomNumber)
    const roster = normalizeRoster(mates)
    const clients = sessionManager.getClientsInRoom(roomNumber, room?.lobby_generation)
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
        }))
    }
    if (broadcast) sessionManager.broadcastToRoom(roomNumber, [1, [1, roster]])
    return roster
}

function collectCanonicalRoomRoster(roomNumber: string, preserveNpcCount = false): any[] {
    const room = getRoom(roomNumber)
    if (!room) return []

    const hostClient = findHostClient(roomNumber)
    const candidates: any[] = []
    if (hostClient?.yourself) candidates.push(hostClient.yourself)
    if (hostClient?.mates) candidates.push(...hostClient.mates)

    for (const connectedClient of sessionManager.getClientsInRoom(roomNumber, room.lobby_generation)) {
        if (!connectedClient.isBattle && connectedClient.yourself) {
            candidates.push(connectedClient.yourself)
        }
    }

    return synchronizeRoomRoster(roomNumber, candidates, false, preserveNpcCount)
}

function preflightBattleRoster(room: any, members: any[]): {
    members: any[]
    rejectedViewerIds: number[]
} {
    if (isMode15Quest(Number(room.category), Number(room.quest_id))) {
        return { members, rejectedViewerIds: [] }
    }

    const lobbyClients = sessionManager.getClientsInRoom(room.room_number, room.lobby_generation)
    const clientsByViewerId = new Map(lobbyClients.map(current => [current.viewerId, current]))
    const rejectedViewerIds: number[] = []

    for (const member of members) {
        if (member?.comId) continue
        const viewerId = Number(member?.viewerId)
        if (!Number.isFinite(viewerId) || viewerId <= 0) continue
        const current = clientsByViewerId.get(viewerId)
        const playerId = Number(current?.playerId)
        // /party/edit persists the actually selected global party before the
        // lobby emits StartBattle.  The Mate cached by the room handshake can
        // still contain the previous/default slot, so the persisted player
        // value must be authoritative for admission.
        const persistedPartyId = Number(getPlayerSync(playerId)?.partySlot)
        const partyId = Number(
            (Number.isFinite(persistedPartyId) && persistedPartyId > 0
                ? persistedPartyId
                : undefined)
            ?? member?.currentPartyId
            ?? current?.yourself?.currentPartyId
            ?? 1,
        )
        if (!current || !Number.isFinite(playerId) || playerId <= 0
            || !Number.isFinite(partyId) || partyId <= 0) continue
        try {
            const restricted = getMode15ExclusiveGlobalPartyItemsSync(playerId, 1, partyId)
            if (restricted.length > 0) {
                rejectedViewerIds.push(viewerId)
                console.warn(`[MODE15] lobby preflight rejected exclusive equipment: room=${room.room_number}`
                    + ` viewer=${viewerId} player=${playerId} party=${partyId}`
                    + ` items=${restricted.join(",")}`)
            }
        } catch (e) {
            // Fail open if the optional Mode15 module is unavailable. The HTTP
            // start boundary remains the authoritative final validation.
            console.warn(`[MODE15] lobby preflight lookup failed: room=${room.room_number}`
                + ` viewer=${viewerId}`, e)
        }
    }

    if (rejectedViewerIds.length === 0) return { members, rejectedViewerIds }

    const rejectedSet = new Set(rejectedViewerIds)
    const eligibleMembers = members.filter(member => {
        const viewerId = Number(member?.viewerId)
        return member?.comId || !Number.isFinite(viewerId) || !rejectedSet.has(viewerId)
    })
    for (const current of lobbyClients) {
        if (rejectedSet.has(current.viewerId)) {
            // Remove the client before StartBattle. It never becomes a battle
            // peer, so no synthetic BattleServerMessage.Leave is required.
            sessionManager.sendJson(current.socket, [1, [6, "multibattle_room_dismissed"]])
            const socket = current.socket
            const timer = setTimeout(() => socket.destroy(), 100)
            timer.unref()
            continue
        }
        current.mates = eligibleMembers
        sessionManager.sendJson(current.socket, [1, [1, eligibleMembers]])
    }
    room.mates = eligibleMembers.map(member => ({
        viewer_id: member.viewerId ?? null,
        com_id: member.comId ?? 0,
    }))
    return { members: eligibleMembers, rejectedViewerIds }
}

export function checkHostAutoReady(roomNumber: string): void {
    const room = getRoom(roomNumber)
    if (!room) return
    const hostClient = findHostClient(roomNumber)
    if (!hostClient) return
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
        if (hostMate.state?.[0] !== 1) {
            hostMate.state = [1]
            sessionManager.broadcastToRoom(roomNumber, [1, [2, hostMate.connectionId, [1]]])
            gameVerboseLog(() => `[LOBBY] host auto-ready: room=${roomNumber}`)
        }
    } else {
        autoStartingRooms.delete(roomNumber)
        if (hostMate.state?.[0] === 1) {
            hostMate.state = [0]
            sessionManager.broadcastToRoom(roomNumber, [1, [2, hostMate.connectionId, [0]]])
            gameVerboseLog(() => `[LOBBY] host auto-ready cancelled: room=${roomNumber}`)
        }
    }
    checkAllReadyAndStart(roomNumber)
}

const autoStartingRooms = new Set<string>()

function checkAllReadyAndStart(roomNumber: string): void {
    if (autoStartingRooms.has(roomNumber)) return
    const hostClient = findHostClient(roomNumber)
    if (!hostClient) return
    const room = getRoom(roomNumber)
    if (!room) return
    if (isMode15RoomClosed(room)) {
        stopRandomRecruitment(roomNumber)
        sessionManager.broadcastToRoom(roomNumber, [1, [6, "multibattle_room_dismissed"]])
        console.log(`[MODE15] auto rematch denied: completed host room=${roomNumber}`)
        return
    }

    // Guard: auto continuation must wait for the exact real-player roster from
    // the previous battle.  npc_count is not a safe proxy because a real player
    // may have replaced a COM before the battle began.
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
        if (presentNpcCount < desiredNpcCount) {
            scheduleNpcReconcile(roomNumber)
            return
        }
    }
    if (hostClient.mates.length < 2) return

    const allReady = hostClient.mates.every(m => m.state?.[0] === 1)
    if (!allReady) return

    autoStartingRooms.add(roomNumber)
    gameVerboseLog(() => `[LOBBY] all ready — StartRemainingTime float: room=${roomNumber}`)
    sessionManager.broadcastToRoom(roomNumber, [1, [10, 2]])
}

export function notifyRoomDisbanded(roomNumber: string): void {
    sessionManager.broadcastToRoom(roomNumber, [1, [6, "multibattle_room_dismissed"]])
}

async function handleEnterComs(client: SessionClient, coms: { name: string }[]): Promise<void> {
    const room = getRoom(client.roomNumber)
    if (!room) return
    if (isMode15RoomClosed(room)) {
        stopRandomRecruitment(client.roomNumber)
        sessionManager.broadcastToRoom(client.roomNumber, [1, [6, "multibattle_room_dismissed"]])
        console.log(`[MODE15] TCP StartBattle denied: completed host room=${client.roomNumber}`)
        return
    }
    room.is_npc_mode = true

    const hostMate = client.yourself ?? client.mates[0]
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
    let needNPCs = 3 - realMates.length
    room.npc_count = needNPCs  // persist the actual COM slots for rematch
    if (needNPCs <= 0) {
        gameVerboseLog(() => `[LOBBY] EnterComs: room full (${realMates.length} players), skip NPCs`)
        return
    }

    const npcProvider = new NpcMateProvider()
    const recruitResult = await npcProvider.onRecruit(client.roomNumber, String(room?.host_viewer_id ?? 0))

    // The provider is asynchronous. A real player may join/leave while it is
    // resolving, so take a fresh roster snapshot before creating COM slots.
    realMates = collectCanonicalRoomRoster(client.roomNumber, true)
        .filter(m => !m.comId)
    needNPCs = Math.max(0, 3 - realMates.length)
    room.npc_count = needNPCs
    if (needNPCs === 0) {
        synchronizeRoomRoster(client.roomNumber, realMates.slice(0, 3), true)
        return
    }

    // Select valid parties from the cached server-wide player-party pool.
    // The host is excluded so COM mates do not simply mirror the host. A
    // complete host party remains the final fallback for very small/new
    // databases that do not yet contain other valid three-character parties.
    let npcParties: any[] = []
    try {
        const selectionOptions = getNpcPartySelectionOptions(room.category, room.quest_id)
        npcParties = getRandomPlayerNpcPartiesSync(
            client.playerId,
            needNPCs,
            selectionOptions,
        )
            .map(entry => entry.party)
    } catch (error) {
        console.error(`[LOBBY] player NPC party pool selection failed room=${client.roomNumber}`, error)
    }

    const npcMates: any[] = []
    for (let i = 0; i < needNPCs; i++) {
        const recruited = recruitResult.recruitedMates[i] ?? null
        const comId = recruited?.com_id ?? (i + 1)
        const viewerId = recruited?.viewer_id ?? (900000000 + i + 1)
        const party = npcParties[i] ?? npcParties[0] ?? hostMate.party

        npcMates.push({
            viewerId: viewerId,
            comId: comId,
            name: coms[i]?.name ?? `NPC${comId}`,
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

    setTimeout(() => {
        try {
            // Publish the same completed roster to every connected client.
            sessionManager.broadcastToRoom(client.roomNumber, [1, [1, client.mates]])
        } catch (e) { console.error("[LOBBY] EnterComs send-mates error", e) }
    }, NPC_JOIN_DELAY_MS)

    setTimeout(() => {
        try {
            for (const npc of npcMates) {
                npc.state = [1]
                sessionManager.broadcastToRoom(client.roomNumber, [1, [2, npc.connectionId, [1]]])
            }
            // Re-evaluate both one-real/two-COM and two-real/one-COM rooms.
            checkHostAutoReady(client.roomNumber)
        } catch (e) { console.error("[LOBBY] EnterComs npc-ready error", e) }
    }, NPC_JOIN_DELAY_MS + NPC_READY_DELAY_MS)
}

function recruitNpcMatesForRoomAttempt(roomNumber: string, attempt: number): void {
    const room = getRoom(roomNumber)
    if (!room || !room.is_npc_mode || room.raising_state === 4) return
    if (npcRecruitingRooms.has(roomNumber)) {
        // Do not lose a roster-change signal while the provider is resolving.
        npcReconcilePendingRooms.add(roomNumber)
        return
    }

    const hostClient = findHostClient(roomNumber)
    if (!hostClient?.yourself) {
        if (attempt < 40) {
            setTimeout(() => recruitNpcMatesForRoomAttempt(roomNumber, attempt + 1), 250)
        } else {
            gameVerboseLog(() => `[LOBBY] AI recruitment skipped: host not ready room=${roomNumber}`)
        }
        return
    }

    // Preserve the previous real-player seats only for the configured
    // reconnect grace. The cleanup timer removes expired expectations and
    // schedules another reconciliation, at which point COMs fill the vacancy.
    if (room.lobby_generation > 0 && room.expected_real_viewer_ids.length > 0) {
        const liveViewerIds = new Set(
            sessionManager.getClientsInRoom(roomNumber, room.lobby_generation)
                .filter(connectedClient => !connectedClient.isBattle)
                .map(connectedClient => connectedClient.viewerId),
        )
        const waitingForRealPlayer = room.expected_real_viewer_ids
            .some(viewerId => !liveViewerIds.has(viewerId))
        if (waitingForRealPlayer) {
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
    handleEnterComs(hostClient, chooseNpcNames(2))
        .catch(error => console.error(`[LOBBY] AI recruitment error room=${roomNumber}`, error))
        .finally(() => {
            npcRecruitingRooms.delete(roomNumber)
            if (npcReconcilePendingRooms.delete(roomNumber)) {
                scheduleNpcReconcile(roomNumber)
            }
        })
}

export function scheduleNpcReconcile(roomNumber: string, delayMs = 100): void {
    if (npcReconcileTimers.has(roomNumber)) return
    const timer = setTimeout(() => {
        npcReconcileTimers.delete(roomNumber)
        recruitNpcMatesForRoomAttempt(roomNumber, 0)
    }, delayMs)
    timer.unref()
    npcReconcileTimers.set(roomNumber, timer)
}

export function recruitNpcMatesForRoom(roomNumber: string): void {
    recruitNpcMatesForRoomAttempt(roomNumber, 0)
}

function scheduleRematchRosterCleanup(roomNumber: string): void {
    const room = getRoom(roomNumber)
    if (!room || room.lobby_generation <= 0) return
    if (rematchCleanedGeneration.get(roomNumber) === room.lobby_generation) return
    if (rematchCleanupTimers.has(roomNumber)) return

    const generation = room.lobby_generation
    room.rematch_wait_started_at = Date.now()
    const timer = setTimeout(() => {
        rematchCleanupTimers.delete(roomNumber)
        const currentRoom = getRoom(roomNumber)
        if (!currentRoom || currentRoom.lobby_generation !== generation || currentRoom.raising_state === 4) return

        const liveClients = sessionManager.getClientsInRoom(roomNumber, generation)
            .filter(client => !client.isBattle)
        const liveViewerIds = new Set(liveClients.map(client => client.viewerId))
        const missingViewerIds = currentRoom.expected_real_viewer_ids
            .filter(viewerId => !liveViewerIds.has(viewerId))

        if (missingViewerIds.length > 0) {
            currentRoom.expected_real_viewer_ids = currentRoom.expected_real_viewer_ids
                .filter(viewerId => liveViewerIds.has(viewerId))
            currentRoom.mates = currentRoom.mates
                .filter(mate => mate.viewer_id === null || !missingViewerIds.includes(mate.viewer_id))

            const hostClient = findHostClient(roomNumber)
            if (hostClient) {
                hostClient.mates = hostClient.mates
                    .filter(mate => mate.comId || !missingViewerIds.includes(Number(mate.viewerId)))
                sessionManager.broadcastToRoom(roomNumber, [1, [1, hostClient.mates]])
            }
            console.warn(`[LOBBY] rematch reconnect grace expired: room=${roomNumber} removed=${missingViewerIds.join(",")}`)
        }

        currentRoom.rematch_wait_started_at = null
        rematchCleanedGeneration.set(roomNumber, generation)
        checkHostAutoReady(roomNumber)
        if (currentRoom.is_npc_mode) scheduleNpcReconcile(roomNumber)
    }, REMATCH_RECONNECT_GRACE_MS)
    timer.unref()
    rematchCleanupTimers.set(roomNumber, timer)
}

export function scheduleRematchDisconnectCleanup(roomNumber: string): void {
    const existingTimer = rematchCleanupTimers.get(roomNumber)
    if (existingTimer) clearTimeout(existingTimer)
    rematchCleanupTimers.delete(roomNumber)
    rematchCleanedGeneration.delete(roomNumber)
    scheduleRematchRosterCleanup(roomNumber)
}

function handleEnter(socket: net.Socket, client: SessionClient, data: any[]): void {
    const ed = data[1] ?? {}
    if (!client.yourself) return

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
        socket.end()
        return
    }
    if (room) client.roomGeneration = room.lobby_generation
    const isHost = room && client.viewerId === room.host_viewer_id

    if (isHost) {
        sessionManager.cancelHostReconnectGrace(client.roomNumber)
        sessionManager.completeSettlementReturn(client.roomNumber)
        updateRoomState(client.roomNumber, 1)
    }

    const hostClient = findHostClient(client.roomNumber)

    // Guest entered before host (or host connected but hasn't entered) → wait with Welcome
    if (!isHost && (!hostClient || !hostClient.mates[0])) {
        client.mates = [client.yourself!]
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
            setTimeout(() => recruitNpcMatesForRoom(client.roomNumber), 500)
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
    const room = getRoom(client.roomNumber)
    if (room && room.raising_state !== 4 && client.roomGeneration === room.lobby_generation) {
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
        sessionManager.broadcastToRoom(client.roomNumber, [1, [1, hostClient.mates]])
        if (remainingRoom.is_npc_mode) scheduleNpcReconcile(client.roomNumber)
    }
    try { client.socket.destroy(); } catch (e) {}
    gameVerboseLog(() => `[LOBBY] client ${client.viewerId} left room ${client.roomNumber}`)
}

function handleChangeParty(_socket: net.Socket, client: SessionClient, data: any[]): void {
    const pd = data[1]
    const currentPartyId = data[3] ?? pd?.currentPartyId
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
        if (currentPartyId !== undefined) {
            client.yourself.currentPartyId = currentPartyId
        }
    }
    const mate = client.mates.find(m => m.viewerId === client.viewerId)
    if (mate) {
        if (client.playerId && currentPartyId !== undefined) { try { const up = require("../../data/domains/player").updatePlayerSync; up({ id: client.playerId, partySlot: currentPartyId }); } catch(e) {} }
        const room = getRoom(client.roomNumber)
        if (room && room.host_viewer_id === client.viewerId && currentPartyId !== undefined) room.host_party_id = currentPartyId
        const roster = collectCanonicalRoomRoster(client.roomNumber)
        sessionManager.broadcastToRoom(client.roomNumber, [1, [1, roster]])
    }
    gameVerboseLog(() => `[LOBBY] client ${client.viewerId} changed party: party=${currentPartyId ?? "unchanged"} allowHeal=${client.yourself?.allowHealFromOtherPlayers ?? "unchanged"}`)
}

function handleReady(_socket: net.Socket, client: SessionClient, data: any[]): void {
    const readyState = Array.isArray(data[1]) ? data[1][0] : data[1]
    client.isReady = readyState === 1
    if (sessionManager.isRescueGuest(client.roomNumber, client.viewerId)) {
        sessionManager.beginRescueGuestWait(client)
    }

    const mate = client.mates.find(m => m.viewerId === client.viewerId)
    if (mate) {
        mate.state = data[1] ?? [1]
        sessionManager.broadcastToRoom(client.roomNumber, [1, [2, mate.connectionId, mate.state]])
    }

    checkHostAutoReady(client.roomNumber)
    gameVerboseLog(() => `[LOBBY] client ${client.viewerId} ready: ${client.isReady}`)
}

function handleHeartbeat(socket: net.Socket, client: SessionClient, _data: any[]): void {
    sessionManager.sendJson(socket, [1, [11, client.connectionId]])
}

function handleStartBattle(_socket: net.Socket, client: SessionClient, _data: any[]): void {
    if ((sessionManager as any).battleExpectedCount?.has?.(client.roomNumber)) return

    // StartBattle may be sent first by any participant. Always use the
    // canonical host roster instead of that sender's potentially older copy.
    let members = collectCanonicalRoomRoster(client.roomNumber)
    const room = getRoom(client.roomNumber)
    if (!room) return
    const preflight = preflightBattleRoster(room, members)
    members = preflight.members
    if (preflight.rejectedViewerIds.includes(Number(room.host_viewer_id))) {
        gameVerboseLog(() => `[LOBBY] StartBattle cancelled: host failed preflight room=${client.roomNumber}`)
        return
    }

    // checkAllReadyAndStart already waits for the previous battle's real
    // players, but the client can send StartBattle directly as soon as the
    // host and restored COM mates appear ready. Enforce the same rule at the
    // final mutation boundary so that request cannot overwrite the expected
    // roster and start a 1-real/2-COM rematch before a guest returns.
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
    const realViewerIds = [...new Set(
        members
            .filter(mate => !mate.comId && Number.isFinite(Number(mate.viewerId)))
            .map(mate => Number(mate.viewerId)),
    )]
    const expectedCount = realViewerIds.length
    for (const viewerId of realViewerIds) {
        sessionManager.clearRescueGuestLobbyWait(client.roomNumber, viewerId)
    }
    autoStartingRooms.delete(client.roomNumber)
    sessionManager.setBattleExpectedCount(client.roomNumber, expectedCount)
    room.expected_real_viewer_ids = realViewerIds
    room.npc_count = members.filter(mate => !!mate.comId).length
    room.mates = members.map(mate => ({ viewer_id: mate.viewerId ?? null, com_id: mate.comId ?? 0 }))
    room.lobby_generation += 1
    room.rematch_wait_started_at = null
    room.settlement_return_pending = false
    const cleanupTimer = rematchCleanupTimers.get(client.roomNumber)
    if (cleanupTimer) clearTimeout(cleanupTimer)
    rematchCleanupTimers.delete(client.roomNumber)
    rematchCleanedGeneration.delete(client.roomNumber)
    updateRoomState(client.roomNumber, 4)
    stopRandomRecruitment(client.roomNumber)
    // Keep rescue membership for the whole room lifecycle.  Battle finish
    // needs this marker to grant the repeatable rescue reward, and a rescue
    // guest who remains for auto-repeat is still a rescue guest next round.
    // Lobby wait timers were already cleared above; the membership itself is
    // removed only when the guest is ejected or the room is disbanded.

    autoStartingRooms.delete(client.roomNumber)
    const eligibleViewerIds = new Set(realViewerIds)
    for (const current of sessionManager.getClientsInRoom(client.roomNumber, room.lobby_generation - 1)) {
        if (eligibleViewerIds.has(current.viewerId)) {
            sessionManager.sendJson(current.socket, [1, [5, members]])
        }
    }
    gameVerboseLog(() => `[LOBBY] StartBattle: room=${client.roomNumber} mates=${members.length} real=${expectedCount} npc=${room?.npc_count ?? 0} nextGeneration=${room?.lobby_generation ?? 0}`)
}

function handleNotify(socket: net.Socket, client: SessionClient, data: any[]): void {
    const notifyData = data[1]
    if (!Array.isArray(notifyData)) return
    const tag = notifyData[0] as number

    switch (tag) {
        case 0: handleEnter(socket, client, notifyData); break
        case 1: handleBye(socket, client, notifyData); break
        case 2: handleChangeParty(socket, client, notifyData); break
        case 3: handleReady(socket, client, notifyData); break
        case 4: handleHeartbeat(socket, client, notifyData); break
        case 5: case 7: case 8: case 9: break  // Suspend/ChangeAutoplay/ChangeAutoStart/Log — silently ignored
        case 6: handleStartBattle(socket, client, notifyData); break
        case 10: {
            const room = getRoom(client.roomNumber)
            if (room?.is_npc_mode) {
                handleEnterComs(client, notifyData[1] as any[]).catch(e => console.error("[LOBBY] EnterComs error", e))
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
    sessionManager.broadcastToRoom(client.roomNumber, data)
}

function handleSend(_socket: net.Socket, _client: SessionClient, data: any[]): void {
    const targetViewerId = data[1] as number
    const roomNumber = _client.roomNumber
    const clientsMap = (sessionManager as any).clients as Map<string, SessionClient> | undefined
    if (!clientsMap) return
    for (const c of clientsMap.values()) {
        if (c.viewerId === targetViewerId && c.roomNumber === roomNumber) {
            sessionManager.sendJson(c.socket, data)
            return
        }
    }
}

export function handleMessage(socket: net.Socket, data: unknown): void {
    if (!Array.isArray(data)) return
    const tag = data[0] as number
    const client = findClientBySocket(socket)
    if (!client) {
        console.warn(`[LOBBY] no client found for socket, dropping message tag=${tag}`)
        return
    }

    switch (tag) {
        case 0: handleNotify(socket, client, data); break
        case 1: handleBroadcast(socket, client, data); break
        case 2: handleSend(socket, client, data); break
        default:
            console.warn(`[LOBBY] unhandled Client2Server: ${tag}`)
    }
}
