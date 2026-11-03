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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPlayerNpcPartyPoolStats = exports.getRandomPlayerNpcPartiesSync = exports.getNpcPartySelectionOptions = exports.removePlayerQuestNpcPartySnapshots = exports.reloadQuestNpcPartyPool = exports.recordSuccessfulQuestNpcParty = exports.stopQuestNpcPartyPoolWorker = exports.startQuestNpcPartyPoolWorker = void 0;
const file_exists_1 = require("../../lib/file-exists");
const path_1 = __importDefault(require("path"));
const worker_threads_1 = require("worker_threads");
const quest_party_pool_cache_1 = require("./quest-party-pool-cache");
const equipment_policy_1 = require("./equipment-policy");
const memory_diagnostics_1 = require("../../lib/memory-diagnostics");
const quest_1 = require("../../lib/types/quest");
const public_payload_1 = require("../../lib/weapon-riven/public-payload");
const quest_party_pool_shared_1 = require("./quest-party-pool-shared");
const STEAM_ROBOT_DECISIVE_ELEMENTS = {
    1001001: 1, // fire robot -> water
    1002001: 2, // water robot -> thunder
    1003001: 3, // thunder robot -> wind
    1004001: 0, // wind robot -> fire
    1005001: 5, // light robot -> dark
    1006001: 4, // dark robot -> light
};
const MIN_BATTLE_POWER_INCLUSIVE = Math.max(0, Number.parseInt(process.env.NPC_PARTY_POOL_MIN_BATTLE_POWER || "8000", 10) || 8000);
const questPoolCache = new quest_party_pool_cache_1.QuestPartyPoolCache();
let questPartyPools = questPoolCache.pools;
let questPartyPoolWorker = null;
let questPartyPoolWorkerReady = false;
let pendingClearRecords = [];
let nextCleanupRequestId = 1;
let inFlightRecords = 0, droppedBeforeReady = 0, reloadRequested = false;
let reloadTimer = null;
const pendingCleanupMessages = [];
const pendingCleanupRequests = new Map();
(0, memory_diagnostics_1.registerMemoryCounters)("npcPool", detailed => (Object.assign(Object.assign({}, (detailed ? questPoolCache.stats() : { pools: questPoolCache.pools.size })), { cachedParties: 0, pendingRecords: pendingClearRecords.length, inFlightRecords, pendingCleanups: pendingCleanupRequests.size, droppedBeforeReady, workerReady: questPartyPoolWorkerReady })));
function postRecord(worker, snapshot) {
    worker.postMessage({ type: "record", snapshot });
    inFlightRecords++;
}
function requestPoolReload(worker) {
    if (reloadRequested || questPartyPoolWorker !== worker)
        return;
    reloadRequested = true;
    worker.postMessage({ type: "reload" });
}
function rejectPendingCleanupRequests(error) {
    for (const request of pendingCleanupRequests.values()) {
        clearTimeout(request.timeout);
        request.reject(error);
    }
    pendingCleanupRequests.clear();
    pendingCleanupMessages.length = 0;
}
function getQuestPartyWorkerLocation() {
    const compiled = path_1.default.resolve(__dirname, "../../workers/quest-npc-party-pool-worker.js");
    if ((0, file_exists_1.existsSync)(compiled))
        return { filename: compiled };
    return {
        filename: path_1.default.resolve(__dirname, "../../workers/quest-npc-party-pool-worker.ts"),
        execArgv: ["-r", require.resolve("ts-node/register/transpile-only")],
    };
}
function startQuestNpcPartyPoolWorker() {
    if (questPartyPoolWorker)
        return;
    const location = getQuestPartyWorkerLocation();
    const worker = new worker_threads_1.Worker(location.filename, { execArgv: location.execArgv });
    questPartyPoolWorker = worker;
    questPartyPoolWorkerReady = false;
    questPoolCache.resetWorker();
    inFlightRecords = 0;
    reloadRequested = false;
    (0, memory_diagnostics_1.observeWorkerMemory)("npcPool", worker);
    worker.on("message", (message) => {
        if (questPartyPoolWorker !== worker)
            return;
        if (["snapshot_begin", "snapshot_end", "quest_snapshot", "quest_delta"].includes(message === null || message === void 0 ? void 0 : message.type)) {
            const result = questPoolCache.apply(message);
            questPartyPools = questPoolCache.pools;
            if (message.type === "quest_snapshot")
                worker.postMessage({ type: "snapshot_ack", revision: message.revision });
            if (result === "reload")
                requestPoolReload(worker);
            return;
        }
        if ((message === null || message === void 0 ? void 0 : message.type) === "record_done") {
            inFlightRecords = Math.max(0, inFlightRecords - 1);
            return;
        }
        if ((message === null || message === void 0 ? void 0 : message.type) === "ready") {
            questPartyPoolWorkerReady = true;
            reloadRequested = false;
            const queued = pendingClearRecords;
            pendingClearRecords = [];
            for (const snapshot of queued)
                postRecord(worker, snapshot);
            for (const cleanup of pendingCleanupMessages.splice(0))
                worker.postMessage(cleanup);
            console.log(`[LOBBY] quest-specific NPC party worker ready: pools=${questPartyPools.size}`);
            return;
        }
        if ((message === null || message === void 0 ? void 0 : message.type) === "remove_players_result" && Number.isSafeInteger(message.requestId)) {
            const request = pendingCleanupRequests.get(message.requestId);
            if (!request)
                return;
            pendingCleanupRequests.delete(message.requestId);
            clearTimeout(request.timeout);
            request.resolve({
                removedRows: Math.max(0, Math.trunc(Number(message.removedRows) || 0)),
                affectedQuestCount: Math.max(0, Math.trunc(Number(message.affectedQuestCount) || 0)),
            });
            return;
        }
        if ((message === null || message === void 0 ? void 0 : message.type) === "operation_error") {
            if (message.operation === "reload") {
                reloadRequested = false;
                if (!reloadTimer)
                    reloadTimer = setTimeout(() => {
                        reloadTimer = null;
                        requestPoolReload(worker);
                    }, 5000);
                reloadTimer === null || reloadTimer === void 0 ? void 0 : reloadTimer.unref();
            }
            else if (message.operation === "record")
                requestPoolReload(worker);
            if (Number.isSafeInteger(message.requestId)) {
                const request = pendingCleanupRequests.get(message.requestId);
                if (request) {
                    pendingCleanupRequests.delete(message.requestId);
                    clearTimeout(request.timeout);
                    request.reject(new Error(String(message.error || "AI party cleanup failed")));
                }
            }
            console.error(`[LOBBY] quest NPC party worker ${message.operation} failed: ${message.error}`);
        }
    });
    worker.on("error", error => {
        rejectPendingCleanupRequests(error instanceof Error ? error : new Error(String(error)));
        console.error("[LOBBY] quest NPC party worker error", error);
    });
    worker.on("exit", code => {
        const wasCurrentWorker = questPartyPoolWorker === worker;
        if (!wasCurrentWorker)
            return;
        if (reloadTimer)
            clearTimeout(reloadTimer);
        reloadTimer = null;
        inFlightRecords = 0;
        if (wasCurrentWorker)
            questPartyPoolWorker = null;
        questPartyPoolWorkerReady = false;
        if (wasCurrentWorker) {
            rejectPendingCleanupRequests(new Error(`Quest NPC party worker exited (code ${code})`));
        }
        if (code !== 0 && wasCurrentWorker) {
            console.error(`[LOBBY] quest NPC party worker exited: code=${code}`);
        }
    });
}
exports.startQuestNpcPartyPoolWorker = startQuestNpcPartyPoolWorker;
function stopQuestNpcPartyPoolWorker() {
    return __awaiter(this, void 0, void 0, function* () {
        const worker = questPartyPoolWorker;
        if (!worker)
            return;
        questPartyPoolWorker = null;
        questPartyPoolWorkerReady = false;
        if (reloadTimer)
            clearTimeout(reloadTimer);
        reloadTimer = null;
        inFlightRecords = 0;
        yield worker.terminate();
    });
}
exports.stopQuestNpcPartyPoolWorker = stopQuestNpcPartyPoolWorker;
function recordSuccessfulQuestNpcParty(frozenSnapshot) {
    if (!frozenSnapshot
        || !(0, quest_party_pool_shared_1.isQuestNpcPartyPoolEligibleCategory)(frozenSnapshot.questCategory)
        || !Number.isFinite(frozenSnapshot.battlePower)
        || frozenSnapshot.battlePower < quest_party_pool_shared_1.QUEST_NPC_POOL_MIN_POWER
        || !hasCompleteMainCharacters(frozenSnapshot.party))
        return;
    // The successful clear belongs to the party approved at battle start.
    // Never reload a mutable SET here, including while the worker is warming.
    const snapshot = (0, public_payload_1.stripWeaponRivenPublicPayload)(Object.assign(Object.assign({}, frozenSnapshot), { clearedAt: Date.now() }));
    if (!questPartyPoolWorker || !questPartyPoolWorkerReady) {
        if (pendingClearRecords.length < 1000)
            pendingClearRecords.push(snapshot);
        else
            droppedBeforeReady++;
        return;
    }
    postRecord(questPartyPoolWorker, snapshot);
}
exports.recordSuccessfulQuestNpcParty = recordSuccessfulQuestNpcParty;
function reloadQuestNpcPartyPool() {
    if (questPartyPoolWorker && questPartyPoolWorkerReady) {
        requestPoolReload(questPartyPoolWorker);
    }
}
exports.reloadQuestNpcPartyPool = reloadQuestNpcPartyPool;
function removePlayerQuestNpcPartySnapshots(playerIds, timeoutMs = 10000) {
    const normalizedPlayerIds = [...new Set(playerIds
            .map(playerId => Math.trunc(Number(playerId)))
            .filter(playerId => Number.isSafeInteger(playerId) && playerId > 0))];
    if (normalizedPlayerIds.length === 0) {
        return Promise.resolve({ removedRows: 0, affectedQuestCount: 0 });
    }
    const removedPlayers = new Set(normalizedPlayerIds);
    pendingClearRecords = pendingClearRecords.filter(snapshot => !removedPlayers.has(snapshot.sourcePlayerId));
    startQuestNpcPartyPoolWorker();
    const requestId = nextCleanupRequestId++;
    const message = { type: "remove_players", requestId, playerIds: normalizedPlayerIds };
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            pendingCleanupRequests.delete(requestId);
            const queuedIndex = pendingCleanupMessages.findIndex(entry => entry.requestId === requestId);
            if (queuedIndex >= 0)
                pendingCleanupMessages.splice(queuedIndex, 1);
            reject(new Error(`Quest NPC party cleanup timed out after ${timeoutMs}ms`));
        }, Math.max(1000, timeoutMs));
        pendingCleanupRequests.set(requestId, {
            resolve,
            reject,
            timeout,
        });
        if (questPartyPoolWorker && questPartyPoolWorkerReady) {
            questPartyPoolWorker.postMessage(message);
        }
        else {
            pendingCleanupMessages.push(message);
        }
    });
}
exports.removePlayerQuestNpcPartySnapshots = removePlayerQuestNpcPartySnapshots;
function getNpcPartySelectionOptions(questCategory, questId) {
    const base = { questCategory, questId };
    if (questCategory !== quest_1.QuestCategory.HARD_MULTI_EVENT)
        return base;
    const requiredElement = STEAM_ROBOT_DECISIVE_ELEMENTS[questId];
    if (requiredElement === undefined)
        return base;
    return Object.assign(Object.assign({}, base), { minimumBattlePower: 10000, requiredElement });
}
exports.getNpcPartySelectionOptions = getNpcPartySelectionOptions;
function hasCompleteMainCharacters(party) {
    return Array.isArray(party === null || party === void 0 ? void 0 : party.characters)
        && party.characters.length >= 3
        && party.characters.slice(0, 3).every((entry) => { var _a; return Array.isArray(entry) && entry[0] === 0 && ((_a = entry[1]) === null || _a === void 0 ? void 0 : _a.id); });
}
function getRandomPlayerNpcPartiesSync(_hostPlayerId, count, options = {}) {
    var _a, _b;
    const targetCount = Math.max(0, Math.trunc(count));
    const minimumBattlePower = Math.max(MIN_BATTLE_POWER_INCLUSIVE, Math.trunc((_a = options.minimumBattlePower) !== null && _a !== void 0 ? _a : MIN_BATTLE_POWER_INCLUSIVE));
    const questKey = options.questCategory !== undefined && options.questId !== undefined
        ? (0, quest_party_pool_shared_1.getQuestNpcPartyPoolKey)(options.questCategory, options.questId)
        : null;
    const historicalParties = questKey ? ((_b = questPartyPools.get(questKey)) !== null && _b !== void 0 ? _b : []) : [];
    if (targetCount > 0 && historicalParties.length > 0) {
        const available = historicalParties.filter(candidate => candidate.battlePower >= minimumBattlePower
            && (options.requiredElement === undefined
                || candidate.partyElement === options.requiredElement)
            && (0, equipment_policy_1.isNpcPartyAllowedInRoom)(options.questCategory, options.questId, candidate.party));
        const selected = [];
        while (available.length > 0 && selected.length < targetCount) {
            const offset = Math.floor(Math.random() * available.length);
            const [candidate] = available.splice(offset, 1);
            if (!hasCompleteMainCharacters(candidate.party))
                continue;
            selected.push({ sourcePlayerId: candidate.sourcePlayerId, party: (0, public_payload_1.stripWeaponRivenPublicPayload)(candidate.party) });
        }
        // Very new or rare quests can temporarily have only one historical
        // source. Reuse that valid clear snapshot instead of the live host.
        while (selected.length > 0 && selected.length < targetCount) {
            const candidate = selected[Math.floor(Math.random() * selected.length)];
            selected.push({ sourcePlayerId: candidate.sourcePlayerId, party: (0, public_payload_1.stripWeaponRivenPublicPayload)(candidate.party) });
        }
        if (selected.length >= targetCount)
            return selected;
    }
    // Only the same quest's successful battle snapshots are candidates.
    // An empty history leaves fallback selection to the lobby; never scan SETs.
    return [];
}
exports.getRandomPlayerNpcPartiesSync = getRandomPlayerNpcPartiesSync;
function getPlayerNpcPartyPoolStats() {
    return {
        // Keep legacy stats fields without reviving the removed SET pool.
        size: 0,
        expiresAt: 0,
        ttlMs: 0,
        maxEntries: 0,
        minBattlePowerInclusive: MIN_BATTLE_POWER_INCLUSIVE,
        questPoolCount: questPartyPools.size,
        questPoolEntryCount: [...questPartyPools.values()]
            .reduce((total, entries) => total + entries.length, 0),
    };
}
exports.getPlayerNpcPartyPoolStats = getPlayerNpcPartyPoolStats;
