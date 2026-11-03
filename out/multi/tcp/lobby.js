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
exports.handleMessage = exports.requestWeaponRivenHttpStart = exports.scheduleRematchDisconnectCleanup = exports.seedLobbyRoomStateForTests = exports.getLobbyRoomStateForTests = exports.clearLobbyRoomState = exports.recruitNpcMatesForRoom = exports.scheduleNpcReconcile = exports.notifyRoomDisbanded = exports.refreshEquipmentReadiness = exports.checkHostAutoReady = exports.replayFiveBossHostReturnEnter = exports.clearPendingFiveBossReturnEnter = void 0;
const public_payload_1 = require("../../lib/weapon-riven/public-payload");
const multi_room_1 = require("../../lib/weapon-riven/multi-room");
const node_perf_hooks_1 = require("node:perf_hooks");
const lobby_runtime_1 = require("../five-boss/lobby-runtime");
const SessionManager_1 = require("../state/SessionManager");
const manager_1 = require("../room/manager");
const controller_1 = require("../npc/controller");
const recruitment_1 = require("../recruitment");
const game_logging_1 = require("../../lib/game-logging");
const business_rpc_1 = require("../coordinator/business-rpc");
const runtime_role_1 = require("../coordinator/runtime-role");
const business_facts_1 = require("../coordinator/business-facts");
const equipment_policy_1 = require("../npc/equipment-policy");
const mode15_room_gate_1 = require("../mode15-room-gate");
const equipment_ready_1 = require("../room/equipment-ready");
const embedded_1 = require("../coordinator/embedded");
const autoplay_mode_1 = require("./autoplay-mode");
const admission_1 = require("../room/admission");
const disconnect_diagnostics_1 = require("./disconnect-diagnostics");
const rematch_roster_1 = require("../room/rematch-roster");
const battle_contract_1 = require("../state/battle-contract");
const contract_1 = require("../five-boss/contract");
const NPC_JOIN_DELAY_MS = parseInt(process.env.NPC_JOIN_DELAY_MS || "2000");
const NPC_READY_DELAY_MS = parseInt(process.env.NPC_READY_DELAY_MS || "500");
const npcRecruitingRooms = new Set();
const npcReconcilePendingRooms = new Set();
const npcReconcileTimers = new Map();
const rematchCleanupTimers = new Map();
const rematchCleanupDeadlines = new Map();
const rematchCleanedGeneration = new Map();
// One entry per existing host connection, never an independent room cache.
const pendingFiveBossReturnEnters = new WeakMap();
// Match the default TCP frame budget; retain no unbounded party payload.
const PENDING_RETURN_ENTER_MAX_BYTES = 262144;
const configuredReturnWait = Number(process.env.REMATCH_RESULT_WAIT_MAX_MS);
const PENDING_RETURN_ENTER_WAIT_MS = Math.min(180000, Number.isFinite(configuredReturnWait) && configuredReturnWait > 0 ? configuredReturnWait : 180000);
function clearPendingFiveBossReturnEnter(client, reason) {
    const pending = pendingFiveBossReturnEnters.get(client);
    if (!pending)
        return;
    pendingFiveBossReturnEnters.delete(client);
    if (pending.timer)
        clearTimeout(pending.timer);
    client.socket.removeListener("end", pending.closed);
    client.socket.removeListener("close", pending.closed);
    (0, game_logging_1.gameVerboseLog)(() => `[LOBBY] pending return Enter cleared: room=${client.roomNumber}`
        + ` viewer=${client.viewerId} generation=${pending.generation} reason=${reason}`);
}
exports.clearPendingFiveBossReturnEnter = clearPendingFiveBossReturnEnter;
function failPendingReturnEnter(client, reason) {
    clearPendingFiveBossReturnEnter(client, reason);
    if (SessionManager_1.sessionManager.getClient(client.viewerId, client.roomNumber) !== client
        || client.superseded || client.socket.destroyed || client.enterData !== null)
        return;
    // Stop the indexed waiter before buffered Ready/Start or heartbeats can act.
    SessionManager_1.sessionManager.removeClient(client);
    SessionManager_1.sessionManager.sendJson(client.socket, [1, [6, "multibattle_room_dismissed"]]);
    client.socket.end();
    console.warn(`[LOBBY] pending return Enter rejected: room=${client.roomNumber}`
        + ` viewer=${client.viewerId} reason=${reason}`);
}
function queueFiveBossHostReturnEnter(client, data, room) {
    var _a;
    const member = (_a = (0, battle_contract_1.getBattleSessionContract)(room)) === null || _a === void 0 ? void 0 : _a.members.get(client.viewerId);
    if (!(0, contract_1.isFiveBossGauntletQuest)(room.category, room.quest_id) || !room.five_boss_runtime || room.host_viewer_id !== client.viewerId
        || client.playerId === null || (member === null || member === void 0 ? void 0 : member.playerId) !== client.playerId
        || member.phase !== "SETTLED" || !member.playId || !member.playCommitted
        || !room.lifecycle.battleSessionId || client.roomGeneration !== room.lobby_generation
        || client.roomInstanceId !== room.lifecycle.instanceId || client.isBattle || client.superseded
        || client.enterData !== null || client.socket.destroyed || !client.socket.readable || !client.socket.writable
        || SessionManager_1.sessionManager.getClient(client.viewerId, client.roomNumber) !== client)
        return;
    if (pendingFiveBossReturnEnters.has(client))
        return; // Replay cannot extend the deadline or add listeners.
    let snapshot;
    try {
        const json = JSON.stringify(data);
        if (Buffer.byteLength(json, "utf8") > PENDING_RETURN_ENTER_MAX_BYTES) {
            failPendingReturnEnter(client, "frame_budget");
            return;
        }
        snapshot = JSON.parse(json);
    }
    catch (_b) {
        failPendingReturnEnter(client, "invalid_enter");
        return;
    }
    const pending = {
        room, instanceId: room.lifecycle.instanceId, generation: room.lobby_generation,
        battleSessionId: room.lifecycle.battleSessionId, runId: room.five_boss_runtime.runId,
        playerId: client.playerId, playId: member.playId, connectionGeneration: client.connectionGeneration,
        data: snapshot, deadline: node_perf_hooks_1.performance.now() + PENDING_RETURN_ENTER_WAIT_MS, timer: null,
        closed: () => { if (pendingFiveBossReturnEnters.get(client) === pending)
            clearPendingFiveBossReturnEnter(client, "socket_closed"); },
    };
    pendingFiveBossReturnEnters.set(client, pending);
    client.socket.once("end", pending.closed);
    client.socket.once("close", pending.closed);
    const ownerUnavailable = () => {
        if (pendingFiveBossReturnEnters.get(client) !== pending)
            return;
        clearPendingFiveBossReturnEnter(client, "owner_unavailable");
        // No authority mutation outside the room FIFO; socket close owns its normal cleanup.
        if (client.superseded || client.enterData !== null || client.socket.destroyed)
            return;
        try {
            SessionManager_1.sessionManager.sendJson(client.socket, [1, [6, "multibattle_room_dismissed"]]);
        }
        catch ( /* closing */_a) { /* closing */ }
        try {
            client.socket.destroy();
        }
        catch ( /* already gone */_b) { /* already gone */ }
    };
    const expire = () => {
        try {
            void embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(client.roomNumber, () => {
                if (pendingFiveBossReturnEnters.get(client) !== pending)
                    return;
                const currentRoom = (0, manager_1.getRoom)(client.roomNumber);
                if (currentRoom !== pending.room || (currentRoom === null || currentRoom === void 0 ? void 0 : currentRoom.lifecycle.instanceId) !== pending.instanceId) {
                    failPendingReturnEnter(client, "stale_instance");
                    return;
                }
                const remaining = pending.deadline - node_perf_hooks_1.performance.now();
                if (remaining > 0) {
                    pending.timer = (0, business_rpc_1.createRealtimeMaintenanceTimer)(() => setTimeout(expire, remaining));
                    pending.timer.unref();
                    return;
                }
                failPendingReturnEnter(client, "result_wait_expired");
            }).catch(ownerUnavailable);
        }
        catch (_a) {
            ownerUnavailable();
        }
    };
    pending.timer = (0, business_rpc_1.createRealtimeMaintenanceTimer)(() => setTimeout(expire, PENDING_RETURN_ENTER_WAIT_MS));
    pending.timer.unref();
    (0, game_logging_1.gameVerboseLog)(() => `[LOBBY] pending return Enter queued: room=${client.roomNumber}`
        + ` viewer=${client.viewerId} generation=${pending.generation} run=${pending.runId}`);
}
/** Called synchronously inside the terminal room command, after BEGIN_RETURN. */
function replayFiveBossHostReturnEnter(room, runId) {
    const client = SessionManager_1.sessionManager.getClient(room.host_viewer_id, room.room_number);
    const pending = client && pendingFiveBossReturnEnters.get(client);
    if (!client || !pending)
        return;
    if (node_perf_hooks_1.performance.now() >= pending.deadline) {
        failPendingReturnEnter(client, "result_wait_expired");
        return;
    }
    const binding = (0, battle_contract_1.findBattlePlayBinding)(room, client.viewerId, pending.playerId, pending.playId);
    if (pending.room !== room || pending.instanceId !== room.lifecycle.instanceId
        || pending.generation !== room.lobby_generation || pending.battleSessionId !== room.lifecycle.battleSessionId
        || pending.runId !== runId || room.lifecycle.phase !== "RETURNING" || !(binding === null || binding === void 0 ? void 0 : binding.current)
        || binding.phase !== "SETTLED" || binding.generation !== pending.generation
        || client.playerId !== pending.playerId || client.roomGeneration !== pending.generation
        || client.roomInstanceId !== pending.instanceId || client.connectionGeneration !== pending.connectionGeneration
        || client.isBattle || client.superseded || client.enterData !== null || client.socket.destroyed
        || !client.socket.readable || !client.socket.writable || findClientBySocket(client.socket) !== client) {
        failPendingReturnEnter(client, "stale_return_identity");
        return;
    }
    clearPendingFiveBossReturnEnter(client, "terminal_replay");
    // No nested enqueue/await: handleEnter may clear the run identity while completing return.
    handleEnter(client.socket, client, pending.data);
}
exports.replayFiveBossHostReturnEnter = replayFiveBossHostReturnEnter;
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
];
function chooseNpcNames(count) {
    const available = [...NPC_NAME_POOL];
    const selected = [];
    const targetCount = Math.min(Math.max(0, count), available.length);
    for (let i = 0; i < targetCount; i++) {
        const index = Math.floor(Math.random() * available.length);
        selected.push({ name: available[index] });
        available.splice(index, 1);
    }
    return selected;
}
function findClientBySocket(socket) {
    return SessionManager_1.sessionManager.findClientBySocket(socket);
}
function findHostClient(roomNumber, roomGeneration) {
    const room = (0, manager_1.getRoom)(roomNumber);
    if (!room)
        return undefined;
    const expectedGeneration = roomGeneration !== null && roomGeneration !== void 0 ? roomGeneration : room.lobby_generation;
    const clientsMap = SessionManager_1.sessionManager.clients;
    if (!clientsMap)
        return undefined;
    for (const client of clientsMap.values()) {
        if (client.viewerId === room.host_viewer_id
            && client.roomNumber === roomNumber
            && client.roomGeneration === expectedGeneration
            && !client.isBattle) {
            return client;
        }
    }
    return undefined;
}
function countRealPlayers(mates) {
    return mates.filter(m => !m.comId).length; // real player has no comId
}
function missingRematchReturnMembers(room) {
    if (room.lobby_generation <= 0)
        return [];
    (0, rematch_roster_1.ensureRematchReturnReservations)(room);
    const liveViewerIds = new Set(SessionManager_1.sessionManager.getClientsInRoom(room.room_number, room.lobby_generation)
        .filter(client => !client.isBattle && !client.superseded && client.enterData !== null
        && !client.socket.destroyed && client.socket.readable && client.socket.writable)
        .map(client => client.viewerId));
    for (const viewerId of room.expected_real_viewer_ids) {
        if (!liveViewerIds.has(viewerId))
            (0, rematch_roster_1.markMemberReturnDisconnected)(room, viewerId);
    }
    // A surviving old lobby socket is not proof of a new Enter. Only the
    // successful admission path clears a reservation; otherwise an expired
    // pending-result seat could keep rearming an immediate cleanup forever.
    return (0, rematch_roster_1.getReservedReturnViewerIds)(room);
}
function normalizeRoster(mates) {
    const normalized = [];
    const indexes = new Map();
    for (const mate of mates) {
        if (!mate)
            continue;
        const key = mate.comId
            ? `com:${Number(mate.comId)}`
            : `viewer:${Number(mate.viewerId)}`;
        if (key.endsWith(":NaN"))
            continue;
        const existingIndex = indexes.get(key);
        if (existingIndex === undefined) {
            indexes.set(key, normalized.length);
            normalized.push(mate);
        }
        else {
            // Prefer the newest object from the live connection while keeping
            // the stable host/guest display order.
            normalized[existingIndex] = mate;
        }
    }
    return normalized.slice(0, 3);
}
function synchronizeRoomRoster(roomNumber, mates, broadcast = false, preserveNpcCount = false, roomGeneration) {
    const room = (0, manager_1.getRoom)(roomNumber);
    const roster = normalizeRoster(mates);
    const expectedGeneration = roomGeneration !== null && roomGeneration !== void 0 ? roomGeneration : room === null || room === void 0 ? void 0 : room.lobby_generation;
    const clients = SessionManager_1.sessionManager.getClientsInRoom(roomNumber, expectedGeneration)
        .filter(client => !client.isBattle);
    // Every lobby connection must reference the same canonical roster. Merely
    // broadcasting Mates updates the UI but leaves older server-side client
    // objects stale, allowing a two-player snapshot to start a three-player
    // battle when an early entrant sends StartBattle first.
    for (const connectedClient of clients)
        connectedClient.mates = roster;
    if (room) {
        if (!preserveNpcCount)
            room.npc_count = roster.filter(mate => !!mate.comId).length;
        room.mates = roster.map(mate => {
            var _a, _b, _c;
            return ({
                viewer_id: (_a = mate.viewerId) !== null && _a !== void 0 ? _a : null,
                com_id: (_b = mate.comId) !== null && _b !== void 0 ? _b : 0,
                player_id: (_c = mate.playerId) !== null && _c !== void 0 ? _c : undefined,
            });
        });
    }
    if (broadcast)
        SessionManager_1.sessionManager.broadcastToRoom(roomNumber, [1, [1, roster]]);
    return roster;
}
function collectCanonicalRoomRoster(roomNumber, preserveNpcCount = false, roomGeneration) {
    const room = (0, manager_1.getRoom)(roomNumber);
    if (!room)
        return [];
    const expectedGeneration = roomGeneration !== null && roomGeneration !== void 0 ? roomGeneration : room.lobby_generation;
    const hostClient = findHostClient(roomNumber, expectedGeneration);
    const candidates = [];
    if (hostClient === null || hostClient === void 0 ? void 0 : hostClient.yourself)
        candidates.push(hostClient.yourself);
    if (hostClient === null || hostClient === void 0 ? void 0 : hostClient.mates)
        candidates.push(...hostClient.mates);
    for (const connectedClient of SessionManager_1.sessionManager.getClientsInRoom(roomNumber, expectedGeneration)) {
        if (!connectedClient.isBattle && connectedClient.yourself) {
            candidates.push(connectedClient.yourself);
        }
    }
    return synchronizeRoomRoster(roomNumber, candidates, false, preserveNpcCount, expectedGeneration);
}
function checkHostAutoReady(roomNumber, reconcileMissingNpcs = true) {
    var _a, _b;
    const room = (0, manager_1.getRoom)(roomNumber);
    if (!room || room.lifecycle.phase !== "LOBBY")
        return;
    const hostClient = findHostClient(roomNumber);
    if (!hostClient)
        return;
    if (missingRematchReturnMembers(room).length > 0) {
        scheduleRematchRosterCleanup(roomNumber);
        return;
    }
    const hostMate = hostClient.mates.find(m => m.viewerId === hostClient.viewerId);
    if (!hostMate)
        return;
    // Two real players are already a valid multiplayer party in the original
    // client. The host mirrors ready once at least one non-host member exists
    // and every current non-host member is ready; a third unready entrant
    // cancels the host's ready state again.
    const hasPlayableParty = hostClient.mates.length >= 2;
    const nonHostReady = hasPlayableParty && hostClient.mates.every(m => { var _a; return m.viewerId === hostClient.viewerId || ((_a = m.state) === null || _a === void 0 ? void 0 : _a[0]) === 1; });
    if (nonHostReady) {
        if (!(0, equipment_ready_1.enforceRoomEquipmentReady)(room)) {
            room.readyCountdownPending = false;
            return;
        }
        if (((_a = hostMate.state) === null || _a === void 0 ? void 0 : _a[0]) !== 1) {
            hostClient.isReady = true;
            hostMate.state = [1];
            SessionManager_1.sessionManager.broadcastToRoom(roomNumber, [1, [2, hostMate.connectionId, [1]]]);
            (0, game_logging_1.gameVerboseLog)(() => `[LOBBY] host auto-ready: room=${roomNumber}`);
        }
    }
    else {
        room.readyCountdownPending = false;
        hostClient.isReady = false;
        if (((_b = hostMate.state) === null || _b === void 0 ? void 0 : _b[0]) === 1) {
            hostMate.state = [0];
            SessionManager_1.sessionManager.broadcastToRoom(roomNumber, [1, [2, hostMate.connectionId, [0]]]);
            (0, game_logging_1.gameVerboseLog)(() => `[LOBBY] host auto-ready cancelled: room=${roomNumber}`);
        }
    }
    checkAllReadyAndStart(roomNumber, reconcileMissingNpcs);
}
exports.checkHostAutoReady = checkHostAutoReady;
function refreshEquipmentReadiness(roomNumber) {
    const room = (0, manager_1.getRoom)(roomNumber);
    if (room)
        room.readyCountdownPending = false;
    checkHostAutoReady(roomNumber);
}
exports.refreshEquipmentReadiness = refreshEquipmentReadiness;
function checkAllReadyAndStart(roomNumber, reconcileMissingNpcs = true) {
    var _a;
    const hostClient = findHostClient(roomNumber);
    if (!hostClient)
        return;
    const room = (0, manager_1.getRoom)(roomNumber);
    if (!room || room.lifecycle.phase !== "LOBBY" || room.readyCountdownPending)
        return;
    if ((0, mode15_room_gate_1.isMode15RoomClosed)(room)) {
        (0, recruitment_1.stopRandomRecruitment)(roomNumber);
        SessionManager_1.sessionManager.commitRoomDisband(roomNumber, "mode15_room_completed");
        console.log(`[MODE15] auto rematch denied: completed host room=${roomNumber}`);
        return;
    }
    if ((_a = (0, mode15_room_gate_1.getMode15HostRoomGate)(room)) === null || _a === void 0 ? void 0 : _a.unknown)
        return;
    // Guard: auto continuation must wait for the exact real-player roster from
    // the previous battle.  npc_count is not a safe proxy because a real player
    // may have replaced a COM before the battle began.
    if (missingRematchReturnMembers(room).length > 0) {
        scheduleRematchRosterCleanup(roomNumber);
        return;
    }
    if (room.expected_real_viewer_ids.length > 0) {
        const presentRealViewerIds = new Set(hostClient.mates.filter(mate => !mate.comId).map(mate => Number(mate.viewerId)));
        if (room.expected_real_viewer_ids.some(viewerId => !presentRealViewerIds.has(viewerId)))
            return;
    }
    // A returning rescue guest can make two real players ready before the
    // asynchronous COM reconciliation has restored the third seat. Hold
    // auto-repeat until every required COM has entered and become ready.
    if (room.is_npc_mode) {
        const realCount = countRealPlayers(hostClient.mates);
        const presentNpcCount = hostClient.mates.filter(mate => !!mate.comId).length;
        const desiredNpcCount = Math.max(0, 3 - realCount);
        // Every multiplayer room can start with two ready real players. A
        // pending AI seat must only hold a one-real-player room; it must not
        // turn an otherwise valid two-player party into a silent wait.
        if (presentNpcCount < desiredNpcCount && realCount < 2) {
            if (reconcileMissingNpcs)
                scheduleNpcReconcile(roomNumber);
            return;
        }
    }
    // The LAN client can only auto-start a full party. Two ready members
    // remain eligible for manual StartBattle, without a misleading countdown.
    if (hostClient.mates.length < 3)
        return;
    const hostMate = hostClient.mates.find(mate => mate.viewerId === room.host_viewer_id);
    if ((hostMate === null || hostMate === void 0 ? void 0 : hostMate.autoStart) !== true)
        return;
    const allReady = hostClient.mates.every(m => { var _a; return ((_a = m.state) === null || _a === void 0 ? void 0 : _a[0]) === 1; });
    if (!allReady)
        return;
    if (!(0, equipment_ready_1.enforceRoomEquipmentReady)(room)) {
        room.readyCountdownPending = false;
        return;
    }
    room.readyCountdownPending = true;
    (0, game_logging_1.gameVerboseLog)(() => `[LOBBY] all ready — StartRemainingTime float: room=${roomNumber}`);
    SessionManager_1.sessionManager.broadcastToRoom(roomNumber, [1, [10, 2]]);
}
function notifyRoomDisbanded(roomNumber) {
    SessionManager_1.sessionManager.commitRoomDisband(roomNumber, "lobby_disband_requested");
}
exports.notifyRoomDisbanded = notifyRoomDisbanded;
function handleEnterComs(client, coms, maxNpcCount) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
        let room = (0, manager_1.getRoom)(client.roomNumber);
        if (!room)
            return;
        const roomInstanceId = embedded_1.embeddedMultiCoordinator.ensureLifecycle(room).instanceId;
        const roomGeneration = room.lobby_generation;
        if ((0, runtime_role_1.isRealtimeOwnerChild)()) {
            const version = room.lifecycle.version, category = room.category, questId = room.quest_id;
            const facts = yield (0, business_rpc_1.invokeRealtimeBusiness)("player.facts", {
                playerId: room.host_player_id, category, questId,
            });
            if ((0, manager_1.getRoom)(client.roomNumber) !== room || room.lifecycle.instanceId !== roomInstanceId
                || room.lobby_generation !== roomGeneration || room.lifecycle.version !== version
                || room.category !== category || room.quest_id !== questId || client.superseded || client.socket.destroyed)
                return;
            (0, business_facts_1.applyPlayerBusinessFacts)(facts);
            if (!(0, business_facts_1.getPlayerBusinessFacts)(room.host_player_id, { category, questId }))
                return;
        }
        if ((0, mode15_room_gate_1.isMode15RoomClosed)(room)) {
            (0, recruitment_1.stopRandomRecruitment)(client.roomNumber);
            SessionManager_1.sessionManager.commitRoomDisband(client.roomNumber, "mode15_room_completed");
            console.log(`[MODE15] TCP StartBattle denied: completed host room=${client.roomNumber}`);
            return;
        }
        room.is_npc_mode = true;
        const hostMate = (_b = (_a = findHostClient(client.roomNumber)) === null || _a === void 0 ? void 0 : _a.yourself) !== null && _b !== void 0 ? _b : client.mates[0];
        if (!hostMate)
            return;
        // Rebuild from live connections so an older client's local array cannot
        // omit a player who joined later.
        let realMates = collectCanonicalRoomRoster(client.roomNumber, true)
            .filter(m => !m.comId);
        if (realMates.length >= 3) {
            synchronizeRoomRoster(client.roomNumber, realMates.slice(0, 3), true);
            (0, game_logging_1.gameVerboseLog)(() => `[LOBBY] EnterComs: room already has three real players, stale NPC request cleared`);
            return;
        }
        // Determine NPC count: first recruit → calculate and store; rematch → restore fixed count
        // Always fill the seats not occupied by real players. npc_count may have
        // been reduced when a real player joined, so it cannot be used as a cap
        // when that player later leaves or the return lobby is rebuilt.
        const npcLimit = maxNpcCount === undefined ? 3 : Math.max(0, maxNpcCount);
        let needNPCs = Math.min(Math.max(0, 3 - realMates.length - missingRematchReturnMembers(room).length), npcLimit);
        if (maxNpcCount === undefined)
            room.npc_count = needNPCs; // persist the actual COM slots for rematch
        if (needNPCs <= 0) {
            (0, game_logging_1.gameVerboseLog)(() => `[LOBBY] EnterComs: room full (${realMates.length} players), skip NPCs`);
            return;
        }
        const npcProvider = new controller_1.NpcMateProvider();
        const recruitResult = yield npcProvider.onRecruit(client.roomNumber, String((_c = room === null || room === void 0 ? void 0 : room.host_viewer_id) !== null && _c !== void 0 ? _c : 0));
        room = (0, manager_1.getRoom)(client.roomNumber);
        if (!embedded_1.embeddedMultiCoordinator.isCurrentInstance(room, roomInstanceId)
            || room.lobby_generation !== roomGeneration
            || room.lifecycle.phase !== "LOBBY"
            || SessionManager_1.sessionManager.getClient(client.viewerId, client.roomNumber) !== client)
            return;
        // The provider is asynchronous. A real player may join/leave while it is
        // resolving, so take a fresh roster snapshot before creating COM slots.
        realMates = collectCanonicalRoomRoster(client.roomNumber, true)
            .filter(m => !m.comId);
        needNPCs = Math.min(Math.max(0, 3 - realMates.length - missingRematchReturnMembers(room).length), npcLimit);
        if (maxNpcCount === undefined)
            room.npc_count = needNPCs;
        if (needNPCs === 0) {
            synchronizeRoomRoster(client.roomNumber, realMates.slice(0, 3), true);
            return;
        }
        const npcMates = [];
        const recruitedMates = (0, controller_1.selectStableNpcSlots)(recruitResult.recruitedMates, needNPCs);
        (_d = room.npc_party_by_com_id) !== null && _d !== void 0 ? _d : (room.npc_party_by_com_id = {});
        // Test server: COM seats copy the host's current party instead of drawing
        // from the player party pool (author 1009). Off unless NPC_COPY_HOST_PARTY is set.
        const copyHostParty = /^(1|true|yes|on)$/i.test((_e = process.env.NPC_COPY_HOST_PARTY) !== null && _e !== void 0 ? _e : "");
        for (const recruited of recruitedMates) {
            const partyKey = String(recruited.com_id);
            const cached = room.npc_party_by_com_id[partyKey];
            if (cached && !(0, equipment_policy_1.isNpcPartyAllowedInRoom)(room.category, room.quest_id, cached)) {
                delete room.npc_party_by_com_id[partyKey];
            }
        }
        const missingPartyCount = copyHostParty ? 0 : recruitedMates.filter(recruited => !room.npc_party_by_com_id[String(recruited.com_id)]).length;
        // Select only parties for COM seats this room has never used. A rematch
        // whose complete COM roster is cached performs no pool scan or random draw.
        let npcParties = [];
        if (missingPartyCount > 0) {
            try {
                const selectionInstance = room.lifecycle.instanceId, selectionGeneration = room.lobby_generation;
                npcParties = yield (0, business_rpc_1.invokeRealtimeBusiness)("npc.parties", { playerId: client.playerId,
                    count: missingPartyCount, category: room.category, questId: room.quest_id });
                if ((0, manager_1.getRoom)(client.roomNumber) !== room || room.lifecycle.instanceId !== selectionInstance
                    || room.lobby_generation !== selectionGeneration || client.superseded || client.socket.destroyed)
                    return;
            }
            catch (error) {
                console.error(`[LOBBY] player NPC party pool selection failed room=${client.roomNumber}`, error);
            }
        }
        const firstFallbackComId = 3 - needNPCs;
        let nextPartyIndex = 0;
        for (let i = 0; i < needNPCs; i++) {
            const recruited = (_f = recruitedMates[i]) !== null && _f !== void 0 ? _f : null;
            const comId = (_g = recruited === null || recruited === void 0 ? void 0 : recruited.com_id) !== null && _g !== void 0 ? _g : (firstFallbackComId + i);
            const viewerId = (_h = recruited === null || recruited === void 0 ? void 0 : recruited.viewer_id) !== null && _h !== void 0 ? _h : (900000000 + comId);
            // Keep a room's COM composition stable across rematches. Re-randomizing
            // on every return can replace a battle-tested party with a much larger
            // custom-asset combination and make the AIR client's 4096 atlas packer
            // fail with U_1d93f4 during auto-repeat.
            const partyKey = String(comId);
            let party = copyHostParty
                ? ((0, equipment_policy_1.isNpcPartyAllowedInRoom)(room.category, room.quest_id, hostMate.party)
                    ? structuredClone(hostMate.party) : undefined)
                : room.npc_party_by_com_id[partyKey];
            while (!copyHostParty && !party && nextPartyIndex < npcParties.length) {
                const candidate = npcParties[nextPartyIndex++];
                if ((0, equipment_policy_1.isNpcPartyAllowedInRoom)(room.category, room.quest_id, candidate))
                    party = candidate;
            }
            if (!copyHostParty && !party && (0, equipment_policy_1.isNpcPartyAllowedInRoom)(room.category, room.quest_id, hostMate.party)) {
                party = hostMate.party;
            }
            if (!party || !(0, equipment_policy_1.isNpcPartyAllowedInRoom)(room.category, room.quest_id, party)) {
                delete room.npc_party_by_com_id[partyKey];
                continue;
            }
            party = (0, public_payload_1.stripWeaponRivenPublicPayload)(party);
            room.npc_party_by_com_id[partyKey] = (0, public_payload_1.stripWeaponRivenPublicPayload)(party);
            npcMates.push({
                viewerId: viewerId,
                comId: comId,
                name: (_m = (_k = (_j = coms[comId - 1]) === null || _j === void 0 ? void 0 : _j.name) !== null && _k !== void 0 ? _k : (_l = coms[i]) === null || _l === void 0 ? void 0 : _l.name) !== null && _m !== void 0 ? _m : `NPC${comId}`,
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
            });
        }
        client.mates = synchronizeRoomRoster(client.roomNumber, [...realMates, ...npcMates]);
        (0, game_logging_1.gameVerboseLog)(() => `[LOBBY] EnterComs: room=${client.roomNumber} real=${realMates.length} npc=${npcMates.length} total=${client.mates.length}`);
        const joinTimer = (0, business_rpc_1.createRealtimeMaintenanceTimer)(() => setTimeout(() => {
            void embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(client.roomNumber, () => {
                const currentRoom = (0, manager_1.getRoom)(client.roomNumber);
                if (!embedded_1.embeddedMultiCoordinator.isCurrentInstance(currentRoom, roomInstanceId)
                    || currentRoom.lobby_generation !== roomGeneration
                    || currentRoom.lifecycle.phase !== "LOBBY")
                    return;
                // A host reconnect may replace client before this delayed broadcast.
                const roster = collectCanonicalRoomRoster(client.roomNumber, true, roomGeneration);
                SessionManager_1.sessionManager.broadcastToRoom(client.roomNumber, [1, [1, roster]], undefined, roomGeneration);
            }).catch(e => console.error("[LOBBY] EnterComs send-mates error", e));
        }, NPC_JOIN_DELAY_MS));
        joinTimer.unref();
        // No legal party was available. Wait for a real roster/party change;
        // an automatic ready callback would otherwise recruit the same empty pool.
        if (npcMates.length === 0)
            return;
        const readyTimer = (0, business_rpc_1.createRealtimeMaintenanceTimer)(() => setTimeout(() => {
            void embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(client.roomNumber, () => {
                const currentRoom = (0, manager_1.getRoom)(client.roomNumber);
                if (!embedded_1.embeddedMultiCoordinator.isCurrentInstance(currentRoom, roomInstanceId)
                    || currentRoom.lobby_generation !== roomGeneration
                    || currentRoom.lifecycle.phase !== "LOBBY")
                    return;
                for (const npc of npcMates) {
                    npc.state = [1];
                    SessionManager_1.sessionManager.broadcastToRoom(client.roomNumber, [1, [2, npc.connectionId, [1]]], undefined, roomGeneration);
                }
                // Re-evaluate both one-real/two-COM and two-real/one-COM rooms.
                // This recruitment already tried every available seat. Missing
                // legal parties must not make its own ready callback recruit again.
                checkHostAutoReady(client.roomNumber, false);
            }).catch(e => console.error("[LOBBY] EnterComs npc-ready error", e));
        }, NPC_JOIN_DELAY_MS + NPC_READY_DELAY_MS));
        readyTimer.unref();
    });
}
function recruitNpcMatesForRoomAttempt(roomNumber, attempt) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const room = (0, manager_1.getRoom)(roomNumber);
        if (!room || !room.is_npc_mode || room.lifecycle.phase !== "LOBBY")
            return;
        if (npcRecruitingRooms.has(roomNumber)) {
            // Do not lose a roster-change signal while the provider is resolving.
            npcReconcilePendingRooms.add(roomNumber);
            return;
        }
        const hostClient = findHostClient(roomNumber);
        if (!(hostClient === null || hostClient === void 0 ? void 0 : hostClient.yourself)) {
            if (attempt < 40) {
                const roomInstanceId = embedded_1.embeddedMultiCoordinator.ensureLifecycle(room).instanceId;
                const roomGeneration = room.lobby_generation;
                const retryTimer = (0, business_rpc_1.createRealtimeMaintenanceTimer)(() => setTimeout(() => {
                    void embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(roomNumber, () => {
                        const currentRoom = (0, manager_1.getRoom)(roomNumber);
                        if (currentRoom !== room || !embedded_1.embeddedMultiCoordinator.isCurrentInstance(currentRoom, roomInstanceId)
                            || currentRoom.lobby_generation !== roomGeneration
                            || currentRoom.lifecycle.phase !== "LOBBY")
                            return;
                        return recruitNpcMatesForRoomAttempt(roomNumber, attempt + 1);
                    }).catch(error => console.error(`[LOBBY] AI recruitment retry failed room=${roomNumber}`, error));
                }, 250));
                retryTimer.unref();
            }
            else {
                (0, game_logging_1.gameVerboseLog)(() => `[LOBBY] AI recruitment skipped: host not ready room=${roomNumber}`);
            }
            return;
        }
        // Preserve the previous real-player seats only for the configured
        // reconnect grace. The cleanup timer removes expired expectations and
        // schedules another reconciliation, at which point COMs fill the vacancy.
        if (room.lobby_generation > 0 && room.expected_real_viewer_ids.length > 0) {
            const missingExpectedViewerIds = missingRematchReturnMembers(room);
            if (missingExpectedViewerIds.length > 0) {
                // Two-stage rematch: restore the AI count from the previous
                // battle immediately, but leave one seat free for every real
                // player still inside the reconnect grace. The post-grace
                // cleanup removes expired expectations and fills those seats with
                // the extra AI. Marking the room AI-capable here is what lets
                // that post-grace reconcile run even when the previous battle
                // had no AI at all.
                room.is_npc_mode = true;
                const rosterBeforeRestore = collectCanonicalRoomRoster(roomNumber, true);
                const realCountBeforeRestore = countRealPlayers(rosterBeforeRestore);
                const presentNpcCountBeforeRestore = rosterBeforeRestore.filter(mate => !!mate.comId).length;
                const freeSlotsBeforeRestore = Math.max(0, 3 - realCountBeforeRestore - missingExpectedViewerIds.length);
                const previousAiCount = (_b = (_a = room.rematch_ai_count) !== null && _a !== void 0 ? _a : room.npc_count) !== null && _b !== void 0 ? _b : 0;
                const restoreCount = Math.min(previousAiCount, freeSlotsBeforeRestore);
                if (restoreCount > presentNpcCountBeforeRestore) {
                    const hostClient = findHostClient(roomNumber);
                    if (hostClient) {
                        npcRecruitingRooms.add(roomNumber);
                        try {
                            yield handleEnterComs(hostClient, chooseNpcNames(2), restoreCount);
                        }
                        finally {
                            npcRecruitingRooms.delete(roomNumber);
                            if (npcReconcilePendingRooms.delete(roomNumber)) {
                                scheduleNpcReconcile(roomNumber);
                            }
                        }
                    }
                }
                scheduleRematchRosterCleanup(roomNumber);
                return;
            }
        }
        // npc_count records the previous battle's desired COM count, but it is not
        // proof that those COM mates are present in the newly-created lobby
        // generation. During settlement return the real-player roster can be
        // rebuilt first, so restore the missing COM entries even when npc_count is
        // already non-zero. Conversely, repeated share/reconnect requests are
        // idempotent once the expected COM roster is already present.
        const roster = collectCanonicalRoomRoster(roomNumber, true);
        const realCount = countRealPlayers(roster);
        const presentNpcCount = roster.filter(mate => !!mate.comId).length;
        const desiredNpcCount = 3 - realCount;
        room.npc_count = Math.max(0, desiredNpcCount);
        if (desiredNpcCount <= 0 || presentNpcCount >= desiredNpcCount)
            return;
        npcRecruitingRooms.add(roomNumber);
        try {
            yield handleEnterComs(hostClient, chooseNpcNames(2));
        }
        finally {
            npcRecruitingRooms.delete(roomNumber);
            if (npcReconcilePendingRooms.delete(roomNumber)) {
                scheduleNpcReconcile(roomNumber);
            }
        }
    });
}
function scheduleNpcReconcile(roomNumber, delayMs = 100) {
    if (npcReconcileTimers.has(roomNumber))
        return;
    const room = (0, manager_1.getRoom)(roomNumber);
    if (!room)
        return;
    const roomInstanceId = embedded_1.embeddedMultiCoordinator.ensureLifecycle(room).instanceId;
    const roomGeneration = room.lobby_generation;
    const timer = (0, business_rpc_1.createRealtimeMaintenanceTimer)(() => setTimeout(() => {
        if (npcReconcileTimers.get(roomNumber) !== timer)
            return;
        npcReconcileTimers.delete(roomNumber);
        void embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(roomNumber, () => {
            const currentRoom = (0, manager_1.getRoom)(roomNumber);
            if (currentRoom !== room || !embedded_1.embeddedMultiCoordinator.isCurrentInstance(currentRoom, roomInstanceId)
                || currentRoom.lobby_generation !== roomGeneration
                || currentRoom.lifecycle.phase !== "LOBBY")
                return;
            return recruitNpcMatesForRoomAttempt(roomNumber, 0);
        }).catch(error => console.error(`[LOBBY] AI reconciliation failed room=${roomNumber}`, error));
    }, delayMs));
    timer.unref();
    npcReconcileTimers.set(roomNumber, timer);
}
exports.scheduleNpcReconcile = scheduleNpcReconcile;
function recruitNpcMatesForRoom(roomNumber) {
    const room = (0, manager_1.getRoom)(roomNumber);
    if (!room)
        return;
    const roomInstanceId = embedded_1.embeddedMultiCoordinator.ensureLifecycle(room).instanceId;
    const roomGeneration = room.lobby_generation;
    void embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(roomNumber, () => {
        const currentRoom = (0, manager_1.getRoom)(roomNumber);
        if (currentRoom !== room || !embedded_1.embeddedMultiCoordinator.isCurrentInstance(currentRoom, roomInstanceId)
            || currentRoom.lobby_generation !== roomGeneration
            || currentRoom.lifecycle.phase !== "LOBBY")
            return;
        return recruitNpcMatesForRoomAttempt(roomNumber, 0);
    }).catch(error => console.error(`[LOBBY] AI recruitment failed room=${roomNumber}`, error));
}
exports.recruitNpcMatesForRoom = recruitNpcMatesForRoom;
function scheduleRematchRosterCleanup(roomNumber) {
    var _a;
    const room = (0, manager_1.getRoom)(roomNumber);
    if (!room || room.lobby_generation <= 0 || room.lifecycle.phase !== "LOBBY")
        return;
    missingRematchReturnMembers(room);
    const deadline = (0, rematch_roster_1.getNextReturnDeadline)(room);
    if (deadline === undefined)
        return;
    const existingTimer = rematchCleanupTimers.get(roomNumber);
    if (existingTimer && ((_a = rematchCleanupDeadlines.get(roomNumber)) !== null && _a !== void 0 ? _a : Infinity) <= deadline)
        return;
    if (existingTimer)
        clearTimeout(existingTimer);
    const generation = room.lobby_generation;
    const roomInstanceId = embedded_1.embeddedMultiCoordinator.ensureLifecycle(room).instanceId;
    room.rematch_wait_started_at = Date.now();
    const timer = (0, business_rpc_1.createRealtimeMaintenanceTimer)(() => setTimeout(() => {
        void embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(roomNumber, () => {
            if (rematchCleanupTimers.get(roomNumber) !== timer)
                return;
            rematchCleanupTimers.delete(roomNumber);
            rematchCleanupDeadlines.delete(roomNumber);
            const currentRoom = (0, manager_1.getRoom)(roomNumber);
            if (currentRoom !== room || !embedded_1.embeddedMultiCoordinator.isCurrentInstance(currentRoom, roomInstanceId)
                || currentRoom.lobby_generation !== generation
                || currentRoom.lifecycle.phase !== "LOBBY")
                return;
            const missingViewerIds = new Set(missingRematchReturnMembers(currentRoom));
            const removedViewerIds = (0, rematch_roster_1.getExpiredReturnViewerIds)(currentRoom)
                .filter(viewerId => missingViewerIds.has(viewerId)
                && (0, manager_1.removeRoomMember)(roomNumber, viewerId, generation));
            if (removedViewerIds.length > 0) {
                const hostClient = findHostClient(roomNumber);
                if (hostClient) {
                    hostClient.mates = hostClient.mates
                        .filter(mate => mate.comId || !removedViewerIds.includes(Number(mate.viewerId)));
                    SessionManager_1.sessionManager.broadcastToRoom(roomNumber, [1, [1, hostClient.mates]]);
                }
                console.warn(`[LOBBY] rematch reconnect grace expired: room=${roomNumber} removed=${removedViewerIds.join(",")}`);
            }
            currentRoom.rematch_wait_started_at = null;
            if ((0, rematch_roster_1.getNextReturnDeadline)(currentRoom) === undefined)
                rematchCleanedGeneration.set(roomNumber, generation);
            else
                scheduleRematchRosterCleanup(roomNumber);
            checkHostAutoReady(roomNumber);
            if (currentRoom.is_npc_mode)
                scheduleNpcReconcile(roomNumber);
        }).catch(error => console.error(`[LOBBY] rematch cleanup failed room=${roomNumber}`, error));
    }, Math.max(0, deadline - node_perf_hooks_1.performance.now())));
    timer.unref();
    rematchCleanupTimers.set(roomNumber, timer);
    rematchCleanupDeadlines.set(roomNumber, deadline);
}
/**
 * Drop per-room lobby bookkeeping when a room is removed. Room numbers can be
 * reused, so stale entries here must not leak into a later room.
 */
function clearLobbyRoomState(roomNumber) {
    for (const client of SessionManager_1.sessionManager.getClientsInRoom(roomNumber))
        clearPendingFiveBossReturnEnter(client, "room_cleared");
    const rematchTimer = rematchCleanupTimers.get(roomNumber);
    if (rematchTimer)
        clearTimeout(rematchTimer);
    rematchCleanupTimers.delete(roomNumber);
    rematchCleanupDeadlines.delete(roomNumber);
    rematchCleanedGeneration.delete(roomNumber);
    const reconcileTimer = npcReconcileTimers.get(roomNumber);
    if (reconcileTimer)
        clearTimeout(reconcileTimer);
    npcReconcileTimers.delete(roomNumber);
    npcReconcilePendingRooms.delete(roomNumber);
    // npcRecruitingRooms is owned by the in-flight recruitment and is always
    // released in its finally block; clearing it here could let that stale
    // finally clear a newer room's marker.
}
exports.clearLobbyRoomState = clearLobbyRoomState;
/** Test-only view of per-room lobby bookkeeping. */
function getLobbyRoomStateForTests(roomNumber) {
    return {
        rematchTimer: rematchCleanupTimers.has(roomNumber),
        rematchCleanedGeneration: rematchCleanedGeneration.get(roomNumber),
        npcReconcileTimer: npcReconcileTimers.has(roomNumber),
        npcReconcilePending: npcReconcilePendingRooms.has(roomNumber),
    };
}
exports.getLobbyRoomStateForTests = getLobbyRoomStateForTests;
/** Test-only seed for per-room lobby bookkeeping. */
function seedLobbyRoomStateForTests(roomNumber, generation) {
    rematchCleanedGeneration.set(roomNumber, generation);
    npcReconcilePendingRooms.add(roomNumber);
    scheduleNpcReconcile(roomNumber, 60000);
}
exports.seedLobbyRoomStateForTests = seedLobbyRoomStateForTests;
function scheduleRematchDisconnectCleanup(roomNumber) {
    const existingTimer = rematchCleanupTimers.get(roomNumber);
    if (existingTimer)
        clearTimeout(existingTimer);
    rematchCleanupTimers.delete(roomNumber);
    rematchCleanupDeadlines.delete(roomNumber);
    rematchCleanedGeneration.delete(roomNumber);
    scheduleRematchRosterCleanup(roomNumber);
}
exports.scheduleRematchDisconnectCleanup = scheduleRematchDisconnectCleanup;
function reserveMissingRematchMembersForLegacyAi(room, requester) {
    if (room.lobby_generation <= 0
        || requester.viewerId !== room.host_viewer_id
        || room.expected_real_viewer_ids.length === 0)
        return;
    // Legacy Notify10 also occurs automatically. It cannot prove that the host
    // chose to revoke another player's result/return lease. Normal expiry owns
    // destructive replacement, and EnterComs also enforces these reservations.
    missingRematchReturnMembers(room);
    scheduleRematchRosterCleanup(room.room_number);
}
function rejectClaimedAdmission(socket, client, reason) {
    var _a;
    (0, admission_1.recordRoomAdmissionDenial)(reason);
    admission_1.roomAdmissionRegistry.releaseClaim(client.roomNumber, (_a = client.admissionGeneration) !== null && _a !== void 0 ? _a : client.roomGeneration, client.viewerId, client.connectionId);
    client.admissionClaimed = false;
    SessionManager_1.sessionManager.sendJson(socket, [1, [6, "multibattle_room_dismissed"]]);
    SessionManager_1.sessionManager.removeClient(client);
    (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "room_rejected");
    socket.end();
    console.warn(`[LOBBY] claimed admission rejected: viewer=${client.viewerId}`
        + ` room=${client.roomNumber} reason=${reason}`);
}
function commitClaimedAdmission(socket, client) {
    var _a;
    if (!client.admissionClaimed) {
        return client.playerId !== null
            && (0, manager_1.addRoomMember)(client.roomNumber, client.viewerId, client.playerId);
    }
    const committed = admission_1.roomAdmissionRegistry.commit(client.roomNumber, (_a = client.admissionGeneration) !== null && _a !== void 0 ? _a : client.roomGeneration, client.viewerId, client.connectionId);
    client.admissionClaimed = false;
    if (committed) {
        return client.playerId !== null
            && (0, manager_1.addRoomMember)(client.roomNumber, client.viewerId, client.playerId);
    }
    rejectClaimedAdmission(socket, client, "claim_lost_before_enter");
    return false;
}
function handleEnter(socket, client, data) {
    var _a, _b, _c, _d;
    if (SessionManager_1.sessionManager.takeStaleAssetViewer(client.roomNumber, client.viewerId)) {
        // MeetingServerMessage.AssetUpdate (9): the client leaves the room and
        // returns to the title, which downloads the missing resource edges.
        // Let the normal Enter/Welcome finish first so the room UI is ready.
        console.warn(`[MULTI] outdated resources, sending AssetUpdate: room=${client.roomNumber} viewer=${client.viewerId}`);
        setTimeout(() => {
            if (!socket.destroyed)
                SessionManager_1.sessionManager.sendJson(socket, [1, [9]], {
                    roomNumber: client.roomNumber, connectionId: client.connectionId, viewerId: client.viewerId,
                    roomGeneration: client.roomGeneration, channel: "asset_update",
                });
        }, 300).unref();
    }
    const existingRoom = (0, manager_1.getRoom)(client.roomNumber);
    if ((existingRoom === null || existingRoom === void 0 ? void 0 : existingRoom.lifecycle.phase) === "BATTLE") {
        queueFiveBossHostReturnEnter(client, data, existingRoom);
        return;
    }
    const ed = (_a = data[1]) !== null && _a !== void 0 ? _a : {};
    if (!client.yourself)
        return;
    const entryPartyId = Number((_b = data[2]) !== null && _b !== void 0 ? _b : ed.currentPartyId);
    if (Number.isSafeInteger(entryPartyId) && entryPartyId >= 1 && entryPartyId <= 120) {
        client.equipmentSelectedPartyId = entryPartyId;
        client.yourself.currentPartyId = entryPartyId;
    }
    // Reconnect Enter packets may omit party.  The handshake already built a
    // valid DB-backed party, so still complete Welcome instead of silently
    // returning and leaving the client without its own mate entry (C15202).
    if (ed.party)
        client.yourself.party = ed.party;
    if (ed.autoplayMode !== undefined)
        client.yourself.autoplayMode = ed.autoplayMode;
    if (ed.autoskillMode !== undefined)
        client.yourself.autoskillMode = ed.autoskillMode;
    if (ed.autoSpeedLevel !== undefined)
        client.yourself.autoSpeedLevel = ed.autoSpeedLevel;
    if (ed.autoStart !== undefined)
        client.yourself.autoStart = ed.autoStart;
    if (ed.skillAbilityBehaviorMode !== undefined)
        client.yourself.skillAbilityBehaviorMode = ed.skillAbilityBehaviorMode;
    if (ed.dashBehaviorMode !== undefined)
        client.yourself.dashBehaviorMode = ed.dashBehaviorMode;
    if (ed.allowHealFromOtherPlayers !== undefined)
        client.yourself.allowHealFromOtherPlayers = ed.allowHealFromOtherPlayers;
    client.enterData = ed;
    const room = (0, manager_1.getRoom)(client.roomNumber);
    if (!room) {
        client.mates = [client.yourself];
        SessionManager_1.sessionManager.sendJson(socket, [1, [0, client.yourself, [client.yourself]]]);
        SessionManager_1.sessionManager.sendJson(socket, [1, [6, "room_not_found"]]);
        SessionManager_1.sessionManager.removeClient(client);
        (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "room_rejected");
        socket.end();
        return;
    }
    if (client.admissionClaimed) {
        const admissionGeneration = (_c = client.admissionGeneration) !== null && _c !== void 0 ? _c : client.roomGeneration;
        const roomPhase = embedded_1.embeddedMultiCoordinator.ensureLifecycle(room).phase;
        if (admissionGeneration !== room.lobby_generation || roomPhase !== "LOBBY") {
            rejectClaimedAdmission(socket, client, admissionGeneration !== room.lobby_generation
                ? "generation_changed_before_enter"
                : "phase_changed_before_enter");
            return;
        }
    }
    if (room)
        client.roomGeneration = room.lobby_generation;
    const isHost = room && client.viewerId === room.host_viewer_id;
    if (isHost) {
        SessionManager_1.sessionManager.cancelHostReconnectGrace(client.roomNumber);
        SessionManager_1.sessionManager.completeSettlementReturn(client.roomNumber);
    }
    const hostClient = findHostClient(client.roomNumber);
    // Guest entered before host (or host connected but hasn't entered) → wait with Welcome
    if (!isHost && (!hostClient || !hostClient.mates[0])) {
        client.mates = [client.yourself];
        if (!commitClaimedAdmission(socket, client))
            return;
        SessionManager_1.sessionManager.sendJson(client.socket, [1, [0, client.yourself, [client.yourself]]]);
        SessionManager_1.sessionManager.beginRescueGuestWait(client);
        (0, game_logging_1.gameVerboseLog)(() => `[LOBBY] guest ${client.viewerId} entered alone, waiting for host in room ${client.roomNumber}`);
        return;
    }
    if (isHost) {
        client.mates = [client.yourself];
        const currentGenerationClients = SessionManager_1.sessionManager.getClientsInRoom(client.roomNumber, room === null || room === void 0 ? void 0 : room.lobby_generation);
        for (const connectedClient of currentGenerationClients) {
            if (connectedClient !== client && !connectedClient.isBattle && connectedClient.yourself) {
                client.mates.push(connectedClient.yourself);
            }
        }
        client.mates = synchronizeRoomRoster(client.roomNumber, client.mates, false, true);
        if (client.mates.length > 1) {
            SessionManager_1.sessionManager.broadcastToRoom(client.roomNumber, [1, [1, client.mates]], `${client.viewerId}@${client.roomNumber}`);
        }
        if (room && room.is_npc_mode && countRealPlayers(client.mates) < 3) {
            // The AI switch stays enabled across auto-repeat battles. Restore
            // COM mates from the mode flag rather than npc_count, because the
            // latter may transiently be zero while the return lobby rebuilds
            // its real-player roster.
            const roomInstanceId = embedded_1.embeddedMultiCoordinator.ensureLifecycle(room).instanceId;
            const roomGeneration = room.lobby_generation;
            const timer = (0, business_rpc_1.createRealtimeMaintenanceTimer)(() => setTimeout(() => {
                const currentRoom = (0, manager_1.getRoom)(client.roomNumber);
                if (currentRoom !== room || !embedded_1.embeddedMultiCoordinator.isCurrentInstance(currentRoom, roomInstanceId)
                    || currentRoom.lobby_generation !== roomGeneration
                    || currentRoom.lifecycle.phase !== "LOBBY"
                    || client.superseded || client.socket.destroyed
                    || findHostClient(client.roomNumber) !== client)
                    return;
                recruitNpcMatesForRoom(client.roomNumber);
            }, 500));
            timer.unref();
        }
        scheduleRematchRosterCleanup(client.roomNumber);
    }
    else {
        if (hostClient && client.yourself) {
            hostClient.mates = hostClient.mates.filter(mate => mate.viewerId !== client.viewerId);
            hostClient.mates.push(client.yourself);
            while (hostClient.mates.length > 3) {
                const npcIdx = hostClient.mates.findIndex(m => !!m.comId);
                if (npcIdx >= 0)
                    hostClient.mates.splice(npcIdx, 1);
                else
                    break;
            }
            client.mates = collectCanonicalRoomRoster(client.roomNumber);
            if (!client.mates.some(mate => mate.viewerId === client.viewerId)) {
                SessionManager_1.sessionManager.sendJson(socket, [1, [0, client.yourself, [client.yourself]]]);
                SessionManager_1.sessionManager.sendJson(socket, [1, [6, "room_full"]]);
                SessionManager_1.sessionManager.removeClient(client);
                (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "room_rejected");
                socket.end();
                console.warn(`[LOBBY] overflow guest rejected before Mates: viewer=${client.viewerId} room=${client.roomNumber}`);
                return;
            }
        }
        else {
            client.mates = [client.yourself];
        }
        if (room && room.lobby_generation > 0 && !room.expected_real_viewer_ids.includes(client.viewerId)) {
            room.expected_real_viewer_ids.push(client.viewerId);
        }
    }
    if (!commitClaimedAdmission(socket, client))
        return;
    const yourself = client.yourself;
    if (yourself) {
        SessionManager_1.sessionManager.sendJson(client.socket, [1, [0, yourself, [yourself]]]);
    }
    if (isHost) {
        // A reconnecting host is intentionally excluded from the roster
        // broadcast above so it cannot receive Mates before Welcome.  Replay
        // the complete canonical roster directly after Welcome; otherwise the
        // new host socket only knows about itself while the guest remains
        // present (and possibly ready) on the server.
        client.mates = collectCanonicalRoomRoster(client.roomNumber, true);
        SessionManager_1.sessionManager.sendJson(client.socket, [1, [1, client.mates]]);
        checkHostAutoReady(client.roomNumber);
    }
    else {
        const mates = (_d = hostClient === null || hostClient === void 0 ? void 0 : hostClient.mates) !== null && _d !== void 0 ? _d : client.mates;
        SessionManager_1.sessionManager.broadcastToRoom(client.roomNumber, [1, [1, mates]], undefined);
        checkHostAutoReady(client.roomNumber);
        SessionManager_1.sessionManager.beginRescueGuestWait(client);
    }
    if (room.is_npc_mode)
        scheduleNpcReconcile(client.roomNumber);
    (0, game_logging_1.gameVerboseLog)(() => `[LOBBY] ${isHost ? "host" : "guest"} ${client.viewerId} entered room ${client.roomNumber}`);
}
function handleBye(_socket, client, _data) {
    var _a, _b;
    (0, disconnect_diagnostics_1.markTcpDisconnectReason)(client.socket, "client_bye");
    const room = (0, manager_1.getRoom)(client.roomNumber);
    // StartBattle advances the generation before the client closes its lobby
    // socket. That Bye only ends the lobby transport; the frozen battle seat
    // remains the identity used by /load and restore_room. A late Bye from a
    // previous round likewise cannot release a seat in the current lobby.
    if (!room || room.lifecycle.phase !== "LOBBY"
        || client.roomGeneration !== room.lobby_generation) {
        SessionManager_1.sessionManager.removeClient(client);
        try {
            client.socket.destroy();
        }
        catch (e) { }
        (0, game_logging_1.gameVerboseLog)(() => {
            var _a;
            return `[LOBBY] transport ended: viewer=${client.viewerId} room=${client.roomNumber}`
                + ` generation=${client.roomGeneration} phase=${(_a = room === null || room === void 0 ? void 0 : room.lifecycle.phase) !== null && _a !== void 0 ? _a : "missing"}`;
        });
        return;
    }
    const set = (_b = (_a = SessionManager_1.sessionManager.roomClients) === null || _a === void 0 ? void 0 : _a.get) === null || _b === void 0 ? void 0 : _b.call(_a, client.roomNumber);
    if (set) {
        const clientsMap = SessionManager_1.sessionManager.clients;
        if (clientsMap) {
            for (const addr of set) {
                const c = clientsMap.get(addr);
                if (c && c !== client && !c.isBattle) {
                    c.mates = c.mates.filter(m => m.viewerId !== client.viewerId);
                }
            }
        }
    }
    const hostClient = findHostClient(client.roomNumber);
    (0, manager_1.removeRoomMember)(client.roomNumber, client.viewerId);
    if (room && room.lifecycle.phase === "LOBBY" && client.roomGeneration === room.lobby_generation) {
        room.expected_real_viewer_ids = room.expected_real_viewer_ids
            .filter(viewerId => viewerId !== client.viewerId);
    }
    SessionManager_1.sessionManager.removeClient(client);
    // Only refresh the mate list if the room still exists AND a *different* client is the host (i.e. a
    // guest left but the room lives on). If the room was disbanded (host left / went empty), the
    // [6, dismissed] broadcast already tore it down — pushing a stale/empty mate list here makes the
    // remaining client's refreshMates dereference undefined character-display data and crash (F1010).
    const remainingRoom = (0, manager_1.getRoom)(client.roomNumber);
    if (remainingRoom && hostClient && hostClient !== client) {
        const remainingMates = synchronizeRoomRoster(client.roomNumber, hostClient.mates, false, true, remainingRoom.lobby_generation);
        SessionManager_1.sessionManager.broadcastToRoom(client.roomNumber, [1, [1, remainingMates]]);
        if (remainingRoom.is_npc_mode)
            scheduleNpcReconcile(client.roomNumber);
    }
    try {
        client.socket.destroy();
    }
    catch (e) { }
    (0, game_logging_1.gameVerboseLog)(() => `[LOBBY] client ${client.viewerId} left room ${client.roomNumber}`);
}
function handleChangeParty(_socket, client, data) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        const currentRoom = (0, manager_1.getRoom)(client.roomNumber);
        if (!currentRoom || currentRoom.lifecycle.phase !== "LOBBY"
            || client.roomGeneration !== currentRoom.lobby_generation)
            return;
        const pd = data[1];
        const previousSavedPartyId = (_a = (0, business_facts_1.getPlayerBusinessFacts)(Number(client.playerId))) === null || _a === void 0 ? void 0 : _a.player.partySlot;
        const currentPartyId = (_b = data[3]) !== null && _b !== void 0 ? _b : pd === null || pd === void 0 ? void 0 : pd.currentPartyId;
        const changed = (currentPartyId !== undefined && currentPartyId !== ((_c = client.yourself) === null || _c === void 0 ? void 0 : _c.currentPartyId))
            || (!!(pd === null || pd === void 0 ? void 0 : pd.party) && JSON.stringify(pd.party) !== JSON.stringify((_d = client.yourself) === null || _d === void 0 ? void 0 : _d.party));
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
            ];
            for (const field of mutableMateFields) {
                if (pd[field] !== undefined)
                    client.yourself[field] = pd[field];
            }
            if (client.playerId && pd.party !== undefined) {
                // Keep reconnect handshakes aligned with the in-memory room
                // roster immediately; the low-priority DB save may finish later.
                if (!(0, runtime_role_1.isRealtimeOwnerChild)())
                    require("../party-snapshot").setRealPartySnapshot(client.playerId, pd.party);
            }
            if (currentPartyId !== undefined) {
                client.yourself.currentPartyId = currentPartyId;
            }
        }
        const mate = client.mates.find(m => m.viewerId === client.viewerId);
        if (mate) {
            if (changed) {
                currentRoom.readyCountdownPending = false;
                (0, equipment_ready_1.recordEquipmentPartyChange)(client, Number(currentPartyId), data[2] !== true);
                // Automatic rematches with legal parties retain their Ready state.
                // Invalid automatic changes were already reset by the shared gate.
                if (data[2] !== true)
                    (0, equipment_ready_1.setPreparation)(client, true);
            }
            if (client.playerId && currentPartyId !== undefined) {
                const playerId = client.playerId;
                const partySlot = currentPartyId;
                // Party selection is already authoritative in the in-memory room.
                // Defer the low-priority save so the TCP callback can broadcast the
                // roster without synchronously waiting on SQLite.
                const restoreBusinessContext = (0, business_rpc_1.captureRealtimeBusinessContext)();
                const partyPersistence = new Promise(resolve => {
                    setImmediate(() => restoreBusinessContext(() => {
                        var _a, _b, _c;
                        if (SessionManager_1.sessionManager.getClient(client.viewerId, client.roomNumber) !== client
                            || client.superseded || (0, manager_1.getRoom)(client.roomNumber) !== currentRoom
                            || currentRoom.lifecycle.phase !== "LOBBY"
                            || client.roomGeneration !== currentRoom.lobby_generation
                            || ((_a = client.yourself) === null || _a === void 0 ? void 0 : _a.currentPartyId) !== partySlot) {
                            resolve();
                            return;
                        }
                        void (0, business_rpc_1.invokeRealtimeBusiness)("player.party", Object.assign({ playerId, partyId: partySlot, category: currentRoom.category, questId: currentRoom.quest_id, party: (_c = (_b = client.yourself) === null || _b === void 0 ? void 0 : _b.party) !== null && _c !== void 0 ? _c : null }, (previousSavedPartyId === undefined ? {} : { expectedSavedPartyId: previousSavedPartyId })))
                            .catch(error => {
                            const uncertain = error;
                            if ((uncertain === null || uncertain === void 0 ? void 0 : uncertain.code) === "BUSINESS_OUTCOME_UNKNOWN" && uncertain.confirmation)
                                return uncertain.confirmation;
                            throw error;
                        }).then(() => resolve(), error => {
                            console.warn(`[MULTI] deferred party persistence failed player=${playerId}`, error);
                            resolve();
                        });
                    }));
                });
                // Hold the accepted frame until the actual save ACK, while allowing
                // later lobby commands and heartbeats to use the room queue.
                (0, business_rpc_1.retainRealtimeBusinessTail)(partyPersistence);
            }
            const room = (0, manager_1.getRoom)(client.roomNumber);
            if (room && room.host_viewer_id === client.viewerId && currentPartyId !== undefined)
                room.host_party_id = currentPartyId;
            const roster = collectCanonicalRoomRoster(client.roomNumber);
            SessionManager_1.sessionManager.broadcastToRoom(client.roomNumber, [1, [1, roster]]);
            // An invalid host fallback leaves COM seats empty. Once the host's
            // actual wire party is corrected, fill only those missing seats.
            if (changed && (room === null || room === void 0 ? void 0 : room.is_npc_mode) && room.host_viewer_id === client.viewerId
                && roster.length < 3
                && (0, equipment_policy_1.isNpcPartyAllowedInRoom)(room.category, room.quest_id, (_e = client.yourself) === null || _e === void 0 ? void 0 : _e.party)) {
                scheduleNpcReconcile(client.roomNumber);
            }
        }
        checkHostAutoReady(client.roomNumber);
        (0, game_logging_1.gameVerboseLog)(() => { var _a, _b; return `[LOBBY] client ${client.viewerId} changed party: party=${currentPartyId !== null && currentPartyId !== void 0 ? currentPartyId : "unchanged"} allowHeal=${(_b = (_a = client.yourself) === null || _a === void 0 ? void 0 : _a.allowHealFromOtherPlayers) !== null && _b !== void 0 ? _b : "unchanged"}`; });
    });
}
function handleReady(_socket, client, data) {
    const room = (0, manager_1.getRoom)(client.roomNumber);
    if (room
        && room.lifecycle.phase === "RETURNING"
        && room.host_viewer_id === client.viewerId) {
        SessionManager_1.sessionManager.completeSettlementReturn(client.roomNumber);
    }
    if (!room || room.lifecycle.phase !== "LOBBY"
        || client.roomGeneration !== room.lobby_generation)
        return;
    const readyState = Array.isArray(data[1]) ? data[1][0] : data[1];
    if (readyState === 1 && !(0, equipment_ready_1.enforceEquipmentReady)(room, client, true)) {
        room.readyCountdownPending = false;
        checkHostAutoReady(client.roomNumber);
        return;
    }
    client.isReady = readyState === 1;
    if (SessionManager_1.sessionManager.isRescueGuest(client.roomNumber, client.viewerId)) {
        SessionManager_1.sessionManager.beginRescueGuestWait(client);
    }
    const mate = client.mates.find(m => m.viewerId === client.viewerId);
    if (mate) {
        mate.state = [client.isReady ? 1 : 0];
        SessionManager_1.sessionManager.broadcastToRoom(client.roomNumber, [1, [2, mate.connectionId, mate.state]]);
    }
    checkHostAutoReady(client.roomNumber);
    (0, game_logging_1.gameVerboseLog)(() => `[LOBBY] client ${client.viewerId} ready: ${client.isReady}`);
}
function handleHeartbeat(socket, client, _data) {
    SessionManager_1.sessionManager.sendJson(socket, [1, [11, client.connectionId]]);
}
function handleChangeAutoStart(socket, client, data) {
    const autoStart = data[1];
    if (typeof autoStart !== "boolean")
        return;
    const room = (0, manager_1.getRoom)(client.roomNumber);
    if (!room || room.lifecycle.phase !== "LOBBY"
        || client.roomGeneration !== room.lobby_generation
        || client.isBattle || client.superseded || !client.yourself
        || client.enterData === null || socket.destroyed || client.socket !== socket
        || SessionManager_1.sessionManager.getClient(client.viewerId, client.roomNumber) !== client
        || findClientBySocket(socket) !== client)
        return;
    const roster = collectCanonicalRoomRoster(client.roomNumber, true, room.lobby_generation);
    const mate = roster.find(current => !current.comId
        && current.viewerId === client.viewerId && current.connectionId === client.connectionId);
    if (!mate || (mate.autoStart === autoStart && client.yourself.autoStart === autoStart))
        return;
    client.yourself.autoStart = autoStart;
    mate.autoStart = autoStart;
    synchronizeRoomRoster(client.roomNumber, roster, false, true, room.lobby_generation);
    if (client.viewerId === room.host_viewer_id)
        room.readyCountdownPending = false;
    SessionManager_1.sessionManager.broadcastToRoom(client.roomNumber, [1, [4, client.connectionId, autoStart]]);
    checkHostAutoReady(client.roomNumber);
}
function handleStartBattle(_socket, client, _data, deadlineMs = 10000) {
    var _a, _b, _c, _d;
    const battleAlreadyInitialized = !!((_b = (_a = SessionManager_1.sessionManager.battleExpectedCount) === null || _a === void 0 ? void 0 : _a.has) === null || _b === void 0 ? void 0 : _b.call(_a, client.roomNumber));
    if (battleAlreadyInitialized)
        return;
    const room = (0, manager_1.getRoom)(client.roomNumber);
    if (!room)
        return;
    if ((_c = (0, mode15_room_gate_1.getMode15HostRoomGate)(room)) === null || _c === void 0 ? void 0 : _c.unknown)
        return;
    let lifecyclePhase = embedded_1.embeddedMultiCoordinator.ensureLifecycle(room).phase;
    if (lifecyclePhase === "RETURNING"
        && SessionManager_1.sessionManager.isHostOnline(room.host_viewer_id, client.roomNumber)
        && SessionManager_1.sessionManager.completeSettlementReturn(client.roomNumber)) {
        lifecyclePhase = embedded_1.embeddedMultiCoordinator.ensureLifecycle(room).phase;
    }
    // Normally TCP StartBattle commits the transition before HTTP /start.
    // If a very fast client reverses that order, /start has already committed
    // the same battle generation; finish the lobby delivery without advancing
    // the room a second time.
    if (lifecyclePhase !== "LOBBY" && lifecyclePhase !== "BATTLE")
        return;
    const sourceGeneration = lifecyclePhase === "BATTLE"
        ? Math.max(0, room.lobby_generation - 1)
        : room.lobby_generation;
    // StartBattle may be sent first by any participant. Always use the
    // canonical host roster instead of that sender's potentially older copy.
    let members = collectCanonicalRoomRoster(client.roomNumber, false, sourceGeneration);
    if (!room.equipmentPartyIds && !(0, equipment_ready_1.enforceRoomEquipmentReady)(room, sourceGeneration)) {
        room.readyCountdownPending = false;
        return;
    }
    // checkAllReadyAndStart already waits for the previous battle's real
    // players, but the client can send StartBattle directly as soon as the
    // host and restored COM mates appear ready. Enforce the same rule at the
    // final mutation boundary so that request cannot overwrite the expected
    // roster and start a 1-real/2-COM rematch before a guest returns.
    if (lifecyclePhase === "LOBBY" && missingRematchReturnMembers(room).length > 0) {
        scheduleRematchRosterCleanup(client.roomNumber);
        return;
    }
    if (room.lobby_generation > 0 && room.expected_real_viewer_ids.length > 0) {
        const presentRealViewerIds = new Set(members
            .filter(mate => !mate.comId && Number.isFinite(Number(mate.viewerId)))
            .map(mate => Number(mate.viewerId)));
        const missingExpectedViewerIds = room.expected_real_viewer_ids
            .filter(viewerId => !presentRealViewerIds.has(viewerId));
        if (missingExpectedViewerIds.length > 0) {
            scheduleRematchRosterCleanup(client.roomNumber);
            (0, game_logging_1.gameVerboseLog)(() => `[LOBBY] StartBattle deferred: room=${client.roomNumber}`
                + ` waiting=${missingExpectedViewerIds.join(",")} sender=${client.viewerId}`);
            return;
        }
    }
    if (members.length < 2) {
        (0, game_logging_1.gameVerboseLog)(() => `[LOBBY] StartBattle deferred: room=${client.roomNumber} roster=${members.length}/2 sender=${client.viewerId}`);
        return;
    }
    if (!members.every(mate => { var _a; return ((_a = mate.state) === null || _a === void 0 ? void 0 : _a[0]) === 1; })) {
        (0, game_logging_1.gameVerboseLog)(() => `[LOBBY] StartBattle deferred: room=${client.roomNumber} unready roster sender=${client.viewerId}`);
        return;
    }
    // Gate-off rooms keep the original synchronous start, including HTTP-first delivery.
    const rivenEnabled = process.env.WEAPON_RIVEN_MULTI_ENABLED === "1";
    const frozen = rivenEnabled ? (0, multi_room_1.startWeaponRivenPreparation)(room, members, () => handleStartBattle(_socket, client, _data, deadlineMs), deadlineMs) : undefined;
    if (rivenEnabled && !frozen)
        return;
    if (frozen)
        members = frozen.members;
    const realViewerIds = [...new Set(members
            .filter(mate => !mate.comId && Number.isFinite(Number(mate.viewerId)))
            .map(mate => Number(mate.viewerId)))];
    if (!(0, lobby_runtime_1.freezeFiveBossLobby)(room, members, frozen === null || frozen === void 0 ? void 0 : frozen.conversionLoadouts)) {
        (0, game_logging_1.gameVerboseLog)(() => `[LOBBY] StartBattle deferred: five-boss roster invalid`
            + ` room=${client.roomNumber} roster=${members.length}`
            + ` ready=${members.filter(mate => { var _a; return ((_a = mate.state) === null || _a === void 0 ? void 0 : _a[0]) === 1; }).length}`);
        return;
    }
    const expectedCount = realViewerIds.length;
    for (const viewerId of realViewerIds) {
        SessionManager_1.sessionManager.clearRescueGuestLobbyWait(client.roomNumber, viewerId);
    }
    room.readyCountdownPending = false;
    room.expected_real_viewer_ids = realViewerIds;
    room.npc_count = members.filter(mate => !!mate.comId).length;
    room.rematch_ai_count = room.npc_count;
    room.mates = members.map(mate => {
        var _a, _b, _c;
        return ({
            viewer_id: (_a = mate.viewerId) !== null && _a !== void 0 ? _a : null,
            com_id: (_b = mate.comId) !== null && _b !== void 0 ? _b : 0,
            player_id: (_c = mate.playerId) !== null && _c !== void 0 ? _c : undefined,
        });
    });
    room.rematch_wait_started_at = null;
    const cleanupTimer = rematchCleanupTimers.get(client.roomNumber);
    if (cleanupTimer)
        clearTimeout(cleanupTimer);
    rematchCleanupTimers.delete(client.roomNumber);
    rematchCleanupDeadlines.delete(client.roomNumber);
    rematchCleanedGeneration.delete(client.roomNumber);
    const battleStart = lifecyclePhase === "LOBBY"
        ? embedded_1.embeddedMultiCoordinator.commitBattleStart(room)
        : {
            ok: true,
            previousGeneration: Math.max(0, room.lobby_generation - 1),
            battleSessionId: (_d = room.lifecycle.battleSessionId) !== null && _d !== void 0 ? _d : "",
        };
    if (!battleStart.ok)
        return;
    if (!room.equipmentPartyIds)
        (0, equipment_ready_1.freezeEquipmentSelections)(room, sourceGeneration);
    const expectedBattleSeats = SessionManager_1.sessionManager.getClientsInRoom(client.roomNumber, battleStart.previousGeneration)
        .filter(current => realViewerIds.includes(current.viewerId))
        .map(current => ({ viewerId: current.viewerId, connectionId: current.connectionId }));
    SessionManager_1.sessionManager.setBattleExpectedCount(client.roomNumber, expectedCount, expectedBattleSeats);
    (0, recruitment_1.stopRandomRecruitment)(client.roomNumber);
    // Keep rescue membership for the whole room lifecycle.  Battle finish
    // needs this marker to grant the repeatable rescue reward, and a rescue
    // guest who remains for auto-repeat is still a rescue guest next round.
    // Lobby wait timers were already cleared above; the membership itself is
    // removed only when the guest is ejected or the room is disbanded.
    room.readyCountdownPending = false;
    if (rivenEnabled)
        (0, multi_room_1.commitWeaponRivenPreparation)(room);
    else {
        const eligibleViewerIds = new Set(realViewerIds);
        for (const current of SessionManager_1.sessionManager.getClientsInRoom(client.roomNumber, battleStart.previousGeneration)) {
            if (eligibleViewerIds.has(current.viewerId))
                SessionManager_1.sessionManager.sendJson(current.socket, [1, [5, members]]);
        }
    }
    (0, game_logging_1.gameVerboseLog)(() => { var _a, _b; return `[LOBBY] StartBattle: room=${client.roomNumber} mates=${members.length} real=${expectedCount} npc=${(_a = room === null || room === void 0 ? void 0 : room.npc_count) !== null && _a !== void 0 ? _a : 0} nextGeneration=${(_b = room === null || room === void 0 ? void 0 : room.lobby_generation) !== null && _b !== void 0 ? _b : 0}`; });
}
/** HTTP joins the same two-phase TCP start, waiting outside the serialized room queue. */
function requestWeaponRivenHttpStart(room, viewerId, partyId, remainingMs) {
    return __awaiter(this, void 0, void 0, function* () {
        yield embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(room.room_number, () => {
            var _a, _b, _c;
            if ((0, manager_1.getRoom)(room.room_number) !== room)
                return;
            const peer = SessionManager_1.sessionManager.getClient(viewerId, room.room_number);
            if (!peer || peer.superseded || peer.enterData === null
                || Number((_c = (_a = peer.equipmentSelectedPartyId) !== null && _a !== void 0 ? _a : (_b = peer.yourself) === null || _b === void 0 ? void 0 : _b.currentPartyId) !== null && _c !== void 0 ? _c : 1) !== partyId)
                return;
            handleStartBattle(peer.socket, peer, [], remainingMs);
        });
        return (0, multi_room_1.waitWeaponRivenPreparation)(room);
    });
}
exports.requestWeaponRivenHttpStart = requestWeaponRivenHttpStart;
function handleNotify(socket, client, data) {
    return __awaiter(this, void 0, void 0, function* () {
        const notifyData = data[1];
        if (!Array.isArray(notifyData))
            return;
        const tag = notifyData[0];
        if ((0, runtime_role_1.isRealtimeOwnerChild)() && (tag === 3 || tag === 6)) {
            const room = (0, manager_1.getRoom)(client.roomNumber);
            if (!room || room.lifecycle.phase !== "LOBBY")
                return;
            const instance = room.lifecycle.instanceId, generation = room.lobby_generation;
            const version = room.lifecycle.version, category = room.category, questId = room.quest_id;
            const participants = SessionManager_1.sessionManager.getClientsInRoom(client.roomNumber, generation)
                .filter(current => !current.isBattle && !current.superseded && current.playerId !== null && current.yourself);
            const snapshots = participants.map(current => {
                var _a, _b;
                return ({ current, connectionId: current.connectionId,
                    partyId: Number((_b = (_a = current.equipmentSelectedPartyId) !== null && _a !== void 0 ? _a : current.yourself.currentPartyId) !== null && _b !== void 0 ? _b : 1),
                    wireParty: JSON.stringify(current.yourself.party) });
            });
            const requests = snapshots.map(snapshot => (0, business_rpc_1.invokeRealtimeBusiness)("player.facts", {
                playerId: snapshot.current.playerId, category: room.category, questId: room.quest_id,
                partyId: snapshot.partyId, wireParty: snapshot.current.yourself.party,
            }));
            if (!snapshots.some(snapshot => snapshot.current.playerId === room.host_player_id))
                requests.push((0, business_rpc_1.invokeRealtimeBusiness)("player.facts", { playerId: room.host_player_id, category, questId }));
            const facts = yield Promise.all(requests);
            if ((0, manager_1.getRoom)(client.roomNumber) !== room || room.lifecycle.instanceId !== instance
                || room.lobby_generation !== generation || room.lifecycle.phase !== "LOBBY"
                || room.lifecycle.version !== version || room.category !== category || room.quest_id !== questId
                || snapshots.some(snapshot => snapshot.current.superseded || snapshot.current.socket.destroyed
                    || SessionManager_1.sessionManager.getClient(snapshot.current.viewerId, client.roomNumber) !== snapshot.current
                    || snapshot.current.connectionId !== snapshot.connectionId
                    || JSON.stringify(snapshot.current.yourself.party) !== snapshot.wireParty))
                return;
            facts.forEach(fact => (0, business_facts_1.applyPlayerBusinessFacts)(fact));
            if (!(0, business_facts_1.getPlayerBusinessFacts)(room.host_player_id, { category, questId }))
                return;
            if (snapshots.some(snapshot => !(0, business_facts_1.getPlayerBusinessFacts)(Number(snapshot.current.playerId), {
                category: room.category, questId: room.quest_id, partyId: snapshot.partyId
            })))
                return;
        }
        switch (tag) {
            case 0:
                handleEnter(socket, client, notifyData);
                break;
            case 1:
                handleBye(socket, client, notifyData);
                break;
            case 2:
                yield handleChangeParty(socket, client, notifyData);
                break;
            case 3:
                handleReady(socket, client, notifyData);
                break;
            case 4:
                handleHeartbeat(socket, client, notifyData);
                break;
            case 5: break;
            case 9:
                (0, multi_room_1.acceptWeaponRivenAck)(client, notifyData[1]);
                break;
            case 6:
                handleStartBattle(socket, client, notifyData);
                break;
            case 7: {
                const change = (0, autoplay_mode_1.handleAutoplayModeChange)(client, notifyData, (roomNumber, message) => SessionManager_1.sessionManager.broadcastToRoom(roomNumber, message));
                if (change) {
                    (0, game_logging_1.gameVerboseLog)(() => `[LOBBY] autoplay changed: room=${client.roomNumber}`
                        + ` viewer=${client.viewerId} auto=${change.autoplayMode}`
                        + ` manual=${change.manualMode}`);
                }
                break;
            }
            case 8:
                handleChangeAutoStart(socket, client, notifyData);
                break;
            case 10: {
                const room = (0, manager_1.getRoom)(client.roomNumber);
                if (room === null || room === void 0 ? void 0 : room.is_npc_mode) {
                    reserveMissingRematchMembersForLegacyAi(room, client);
                    yield handleEnterComs(client, notifyData[1]);
                }
                else {
                    (0, game_logging_1.gameVerboseLog)(() => `[LOBBY] ignored legacy COM summon for real-player room=${client.roomNumber}`);
                }
                break;
            }
            default:
                console.warn(`[LOBBY] unhandled Notify: ${tag}`);
        }
    });
}
function handleBroadcast(_socket, client, data) {
    // Client2Server.Broadcast carries MeetingBroadcastMessage entries (the
    // room protocol only defines Emotion). The sender already renders its own
    // balloon locally, so relay the payload to the other room members in the
    // envelope the room parser expects:
    //   MeetingServer2Client.Messages(senderConnectionId, messages)
    // Relaying the raw client frame ([1, ...]) made the client parse it as a
    // server Message instead of Messages, so lobby emotions were dropped.
    const messages = data[1];
    if (!Array.isArray(messages) || messages.length === 0)
        return;
    SessionManager_1.sessionManager.broadcastToRoom(client.roomNumber, [2, client.connectionId, messages], `${client.viewerId}@${client.roomNumber}`);
}
function handleSend(_socket, client, data) {
    var _a;
    const targetViewerId = Number(data[1]);
    if (!Number.isSafeInteger(targetViewerId) || targetViewerId <= 0)
        return;
    // Lobby clients are indexed by viewer@room, so the target is a direct
    // lookup. Apply the same recipient rules as broadcastToRoom: current
    // connection, Enter already answered, and the room's current round.
    const target = SessionManager_1.sessionManager.getClient(targetViewerId, client.roomNumber);
    if (!target || target.isBattle || target.superseded || target.enterData === null)
        return;
    const currentGeneration = (_a = (0, manager_1.getRoom)(client.roomNumber)) === null || _a === void 0 ? void 0 : _a.lobby_generation;
    if (currentGeneration !== undefined && target.roomGeneration !== currentGeneration)
        return;
    SessionManager_1.sessionManager.sendJson(target.socket, data, {
        roomNumber: client.roomNumber,
        connectionId: target.connectionId,
        viewerId: target.viewerId,
        roomGeneration: target.roomGeneration,
        channel: "lobby",
    });
}
function handleMessage(socket, data) {
    if (!Array.isArray(data))
        return;
    const tag = data[0];
    const client = findClientBySocket(socket);
    if (!client) {
        if (SessionManager_1.sessionManager.isSupersededSocket(socket)
            || SessionManager_1.sessionManager.isRetiredLobbySocket(socket)) {
            (0, game_logging_1.gameVerboseLog)(() => `[LOBBY] dropped late message from quarantined socket tag=${tag}`);
        }
        else {
            console.warn(`[LOBBY] no client found for socket, dropping message tag=${tag}`);
        }
        return;
    }
    return embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(client.roomNumber, () => __awaiter(this, void 0, void 0, function* () {
        const current = findClientBySocket(socket);
        if (!current || current.superseded)
            return;
        if (tag === 0 && Array.isArray(data[1]) && [0, 1, 2, 7, 10].includes(data[1][0])) {
            const room = (0, manager_1.getRoom)(current.roomNumber);
            if (room)
                (0, multi_room_1.cancelWeaponRivenPreparation)(room, "roster_changed");
        }
        if (!socket.destroyed && (tag === 0 || tag === 1 || tag === 2)) {
            (0, business_facts_1.notifyRealtimePresence)(current.viewerId);
        }
        switch (tag) {
            case 0:
                yield handleNotify(socket, current, data);
                break;
            case 1:
                handleBroadcast(socket, current, data);
                break;
            case 2:
                handleSend(socket, current, data);
                break;
            default:
                console.warn(`[LOBBY] unhandled Client2Server: ${tag}`);
        }
    })).catch(error => {
        console.error(`[LOBBY] room command failed: room=${client.roomNumber} tag=${tag}`, error);
        if (!socket.destroyed) {
            (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "message_error");
            socket.destroy();
        }
    });
}
exports.handleMessage = handleMessage;
