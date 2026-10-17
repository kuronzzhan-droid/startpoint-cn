import { existsSync } from "../../lib/file-exists";

import path from "path"
import { Worker } from "worker_threads"
import { QuestPartyPoolCache } from "./quest-party-pool-cache"
import { isNpcPartyAllowedInRoom } from "./equipment-policy"
import { observeWorkerMemory, registerMemoryCounters } from "../../lib/memory-diagnostics"
import { QuestCategory } from "../../lib/types/quest"
import {
    getQuestNpcPartyPoolKey,
    isQuestNpcPartyPoolEligibleCategory,
    QUEST_NPC_POOL_MIN_POWER,
    QuestNpcPartySnapshot,
} from "./quest-party-pool-shared"

export interface RandomNpcParty {
    sourcePlayerId: number
    party: any
}

export interface PlayerNpcPartySelectionOptions {
    minimumBattlePower?: number
    requiredElement?: number
    questCategory?: number
    questId?: number
}

const STEAM_ROBOT_DECISIVE_ELEMENTS: Readonly<Record<number, number>> = {
    1001001: 1, // fire robot -> water
    1002001: 2, // water robot -> thunder
    1003001: 3, // thunder robot -> wind
    1004001: 0, // wind robot -> fire
    1005001: 5, // light robot -> dark
    1006001: 4, // dark robot -> light
}

const MIN_BATTLE_POWER_INCLUSIVE = Math.max(
    0,
    Number.parseInt(process.env.NPC_PARTY_POOL_MIN_BATTLE_POWER || "8000", 10) || 8_000,
)

const questPoolCache = new QuestPartyPoolCache()
let questPartyPools = questPoolCache.pools
let questPartyPoolWorker: Worker | null = null
let questPartyPoolWorkerReady = false
let pendingClearRecords: QuestNpcPartySnapshot[] = []
let nextCleanupRequestId = 1
let inFlightRecords = 0, droppedBeforeReady = 0, reloadRequested = false
let reloadTimer: NodeJS.Timeout | null = null
const pendingCleanupMessages: Array<{ type: "remove_players"; requestId: number; playerIds: number[] }> = []
const pendingCleanupRequests = new Map<number, {
    resolve: (result: QuestNpcPartyCleanupResult) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
}>()

export interface QuestNpcPartyCleanupResult {
    removedRows: number
    affectedQuestCount: number
}
registerMemoryCounters("npcPool", detailed => ({ ...(detailed ? questPoolCache.stats() : { pools: questPoolCache.pools.size }),
    cachedParties: 0, pendingRecords: pendingClearRecords.length,
    inFlightRecords, pendingCleanups: pendingCleanupRequests.size, droppedBeforeReady,
    workerReady: questPartyPoolWorkerReady }))

function postRecord(worker: Worker, snapshot: QuestNpcPartySnapshot): void {
    worker.postMessage({ type: "record", snapshot })
    inFlightRecords++
}
function requestPoolReload(worker: Worker): void {
    if (reloadRequested || questPartyPoolWorker !== worker) return
    reloadRequested = true
    worker.postMessage({ type: "reload" })
}

function rejectPendingCleanupRequests(error: Error): void {
    for (const request of pendingCleanupRequests.values()) {
        clearTimeout(request.timeout)
        request.reject(error)
    }
    pendingCleanupRequests.clear()
    pendingCleanupMessages.length = 0
}

function getQuestPartyWorkerLocation(): { filename: string; execArgv?: string[] } {
    const compiled = path.resolve(__dirname, "../../workers/quest-npc-party-pool-worker.js")
    if (existsSync(compiled)) return { filename: compiled }
    return {
        filename: path.resolve(__dirname, "../../workers/quest-npc-party-pool-worker.ts"),
        execArgv: ["-r", require.resolve("ts-node/register/transpile-only")],
    }
}

export function startQuestNpcPartyPoolWorker(): void {
    if (questPartyPoolWorker) return
    const location = getQuestPartyWorkerLocation()
    const worker = new Worker(location.filename, { execArgv: location.execArgv })
    questPartyPoolWorker = worker
    questPartyPoolWorkerReady = false
    questPoolCache.resetWorker()
    inFlightRecords = 0
    reloadRequested = false
    observeWorkerMemory("npcPool", worker)
    worker.on("message", (message: any) => {
        if (questPartyPoolWorker !== worker) return
        if (["snapshot_begin", "snapshot_end", "quest_snapshot", "quest_delta"].includes(message?.type)) {
            const result = questPoolCache.apply(message)
            questPartyPools = questPoolCache.pools
            if (message.type === "quest_snapshot") worker.postMessage({ type: "snapshot_ack", revision: message.revision })
            if (result === "reload") requestPoolReload(worker)
            return
        }
        if (message?.type === "record_done") {
            inFlightRecords = Math.max(0, inFlightRecords - 1)
            return
        }
        if (message?.type === "ready") {
            questPartyPoolWorkerReady = true
            reloadRequested = false
            const queued = pendingClearRecords
            pendingClearRecords = []
            for (const snapshot of queued) postRecord(worker, snapshot)
            for (const cleanup of pendingCleanupMessages.splice(0)) worker.postMessage(cleanup)
            console.log(`[LOBBY] quest-specific NPC party worker ready: pools=${questPartyPools.size}`)
            return
        }
        if (message?.type === "remove_players_result" && Number.isSafeInteger(message.requestId)) {
            const request = pendingCleanupRequests.get(message.requestId)
            if (!request) return
            pendingCleanupRequests.delete(message.requestId)
            clearTimeout(request.timeout)
            request.resolve({
                removedRows: Math.max(0, Math.trunc(Number(message.removedRows) || 0)),
                affectedQuestCount: Math.max(0, Math.trunc(Number(message.affectedQuestCount) || 0)),
            })
            return
        }
        if (message?.type === "operation_error") {
            if (message.operation === "reload") {
                reloadRequested = false
                if (!reloadTimer) reloadTimer = setTimeout(() => {
                    reloadTimer = null; requestPoolReload(worker)
                }, 5_000)
                reloadTimer?.unref()
            } else if (message.operation === "record") requestPoolReload(worker)
            if (Number.isSafeInteger(message.requestId)) {
                const request = pendingCleanupRequests.get(message.requestId)
                if (request) {
                    pendingCleanupRequests.delete(message.requestId)
                    clearTimeout(request.timeout)
                    request.reject(new Error(String(message.error || "AI party cleanup failed")))
                }
            }
            console.error(`[LOBBY] quest NPC party worker ${message.operation} failed: ${message.error}`)
        }
    })
    worker.on("error", error => {
        rejectPendingCleanupRequests(error instanceof Error ? error : new Error(String(error)))
        console.error("[LOBBY] quest NPC party worker error", error)
    })
    worker.on("exit", code => {
        const wasCurrentWorker = questPartyPoolWorker === worker
        if (!wasCurrentWorker) return
        if (reloadTimer) clearTimeout(reloadTimer)
        reloadTimer = null
        inFlightRecords = 0
        if (wasCurrentWorker) questPartyPoolWorker = null
        questPartyPoolWorkerReady = false
        if (wasCurrentWorker) {
            rejectPendingCleanupRequests(new Error(`Quest NPC party worker exited (code ${code})`))
        }
        if (code !== 0 && wasCurrentWorker) {
            console.error(`[LOBBY] quest NPC party worker exited: code=${code}`)
        }
    })
}

export async function stopQuestNpcPartyPoolWorker(): Promise<void> {
    const worker = questPartyPoolWorker
    if (!worker) return
    questPartyPoolWorker = null
    questPartyPoolWorkerReady = false
    if (reloadTimer) clearTimeout(reloadTimer)
    reloadTimer = null
    inFlightRecords = 0
    await worker.terminate()
}

export function recordSuccessfulQuestNpcParty(
    frozenSnapshot: QuestNpcPartySnapshot | null | undefined,
): void {
    if (!frozenSnapshot
        || !isQuestNpcPartyPoolEligibleCategory(frozenSnapshot.questCategory)
        || !Number.isFinite(frozenSnapshot.battlePower)
        || frozenSnapshot.battlePower < QUEST_NPC_POOL_MIN_POWER
        || !hasCompleteMainCharacters(frozenSnapshot.party)) return

    // The successful clear belongs to the party approved at battle start.
    // Never reload a mutable SET here, including while the worker is warming.
    const snapshot: QuestNpcPartySnapshot = {
        ...frozenSnapshot,
        party: JSON.parse(JSON.stringify(frozenSnapshot.party)),
        clearedAt: Date.now(),
    }
    if (!questPartyPoolWorker || !questPartyPoolWorkerReady) {
        if (pendingClearRecords.length < 1000) pendingClearRecords.push(snapshot)
        else droppedBeforeReady++
        return
    }
    postRecord(questPartyPoolWorker, snapshot)
}

export function reloadQuestNpcPartyPool(): void {
    if (questPartyPoolWorker && questPartyPoolWorkerReady) {
        requestPoolReload(questPartyPoolWorker)
    }
}

export function removePlayerQuestNpcPartySnapshots(
    playerIds: number[],
    timeoutMs = 10_000,
): Promise<QuestNpcPartyCleanupResult> {
    const normalizedPlayerIds = [...new Set(playerIds
        .map(playerId => Math.trunc(Number(playerId)))
        .filter(playerId => Number.isSafeInteger(playerId) && playerId > 0))]
    if (normalizedPlayerIds.length === 0) {
        return Promise.resolve({ removedRows: 0, affectedQuestCount: 0 })
    }

    const removedPlayers = new Set(normalizedPlayerIds)
    pendingClearRecords = pendingClearRecords.filter(snapshot => !removedPlayers.has(snapshot.sourcePlayerId))
    startQuestNpcPartyPoolWorker()

    const requestId = nextCleanupRequestId++
    const message = { type: "remove_players" as const, requestId, playerIds: normalizedPlayerIds }
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            pendingCleanupRequests.delete(requestId)
            const queuedIndex = pendingCleanupMessages.findIndex(entry => entry.requestId === requestId)
            if (queuedIndex >= 0) pendingCleanupMessages.splice(queuedIndex, 1)
            reject(new Error(`Quest NPC party cleanup timed out after ${timeoutMs}ms`))
        }, Math.max(1_000, timeoutMs))
        pendingCleanupRequests.set(requestId, {
            resolve,
            reject,
            timeout,
        })
        if (questPartyPoolWorker && questPartyPoolWorkerReady) {
            questPartyPoolWorker.postMessage(message)
        } else {
            pendingCleanupMessages.push(message)
        }
    })
}

export function getNpcPartySelectionOptions(
    questCategory: number,
    questId: number,
): PlayerNpcPartySelectionOptions {
    const base = { questCategory, questId }
    if (questCategory !== QuestCategory.HARD_MULTI_EVENT) return base
    const requiredElement = STEAM_ROBOT_DECISIVE_ELEMENTS[questId]
    if (requiredElement === undefined) return base
    return {
        ...base,
        minimumBattlePower: 10_000,
        requiredElement,
    }
}

function hasCompleteMainCharacters(party: any): boolean {
    return Array.isArray(party?.characters)
        && party.characters.length >= 3
        && party.characters.slice(0, 3).every((entry: any) =>
            Array.isArray(entry) && entry[0] === 0 && entry[1]?.id,
        )
}

export function getRandomPlayerNpcPartiesSync(
    _hostPlayerId: number | null,
    count: number,
    options: PlayerNpcPartySelectionOptions = {},
): RandomNpcParty[] {
    const targetCount = Math.max(0, Math.trunc(count))
    const minimumBattlePower = Math.max(
        MIN_BATTLE_POWER_INCLUSIVE,
        Math.trunc(options.minimumBattlePower ?? MIN_BATTLE_POWER_INCLUSIVE),
    )
    const questKey = options.questCategory !== undefined && options.questId !== undefined
        ? getQuestNpcPartyPoolKey(options.questCategory, options.questId)
        : null
    const historicalParties = questKey ? (questPartyPools.get(questKey) ?? []) : []
    if (targetCount > 0 && historicalParties.length > 0) {
        const available = historicalParties.filter(candidate =>
            candidate.battlePower >= minimumBattlePower
            && (options.requiredElement === undefined
                || candidate.partyElement === options.requiredElement)
            && isNpcPartyAllowedInRoom(options.questCategory, options.questId, candidate.party),
        )
        const selected: RandomNpcParty[] = []
        while (available.length > 0 && selected.length < targetCount) {
            const offset = Math.floor(Math.random() * available.length)
            const [candidate] = available.splice(offset, 1)
            if (!hasCompleteMainCharacters(candidate.party)) continue
            selected.push({ sourcePlayerId: candidate.sourcePlayerId, party: candidate.party })
        }
        // Very new or rare quests can temporarily have only one historical
        // source. Reuse that valid clear snapshot instead of the live host.
        while (selected.length > 0 && selected.length < targetCount) {
            const candidate = selected[Math.floor(Math.random() * selected.length)]
            selected.push({ sourcePlayerId: candidate.sourcePlayerId, party: candidate.party })
        }
        if (selected.length >= targetCount) return selected
    }

    // Only the same quest's successful battle snapshots are candidates.
    // An empty history leaves fallback selection to the lobby; never scan SETs.
    return []
}

export function getPlayerNpcPartyPoolStats(): {
    size: number
    expiresAt: number
    ttlMs: number
    maxEntries: number
    minBattlePowerInclusive: number
    questPoolCount: number
    questPoolEntryCount: number
} {
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
    }
}
