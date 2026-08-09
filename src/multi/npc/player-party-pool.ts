import { existsSync } from "fs"
import path from "path"
import { Worker } from "worker_threads"
import { getDb } from "../../data/db"
import { PartyCategory, PlayerParty, RawPlayerParty } from "../../data/types"
import { gameVerboseLog } from "../../lib/game-logging"
import { QuestCategory } from "../../lib/types/quest"
import { parseGlobalPartyId } from "../../lib/special-event-parties"
import characterTable from "../../../assets/character.json"
import { buildRealParty } from "../tcp/handshake"
import {
    getQuestNpcPartyPoolKey,
    isQuestNpcPartyPoolEligibleCategory,
    QUEST_NPC_POOL_MIN_POWER,
    QuestNpcPartySnapshot,
} from "./quest-party-pool-shared"

interface CachedPlayerParty extends RawPlayerParty {
    player_id: number
}

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

const CACHE_TTL_MS = Math.max(
    10_000,
    Number.parseInt(process.env.NPC_PARTY_POOL_TTL_MS || "300000", 10) || 300_000,
)
const CACHE_MAX_ENTRIES = Math.max(
    100,
    Number.parseInt(process.env.NPC_PARTY_POOL_MAX_ENTRIES || "5000", 10) || 5_000,
)
const MIN_BATTLE_POWER_INCLUSIVE = Math.max(
    0,
    Number.parseInt(process.env.NPC_PARTY_POOL_MIN_BATTLE_POWER || "8000", 10) || 8_000,
)

let cachedParties: CachedPlayerParty[] = []
let cachedPartiesByElement = new Map<number, CachedPlayerParty[]>()
let cacheExpiresAt = 0
let questPartyPools = new Map<string, QuestNpcPartySnapshot[]>()
let questPartyPoolWorker: Worker | null = null
let questPartyPoolWorkerReady = false
let pendingClearRecords: QuestNpcPartySnapshot[] = []
let nextCleanupRequestId = 1
const pendingCleanupMessages: Array<{ type: "remove_players"; requestId: number; playerIds: number[] }> = []
const pendingCleanupRequests = new Map<number, {
    resolve: (result: QuestNpcPartyCleanupResult) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
    playerIds: Set<number>
}>()

export interface QuestNpcPartyCleanupResult {
    removedRows: number
    affectedQuestCount: number
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
    worker.on("message", (message: any) => {
        if (message?.type === "full_snapshot" && message.pools && typeof message.pools === "object") {
            questPartyPools = new Map(Object.entries(message.pools)) as Map<string, QuestNpcPartySnapshot[]>
            return
        }
        if (message?.type === "quest_snapshot" && typeof message.key === "string") {
            questPartyPools.set(message.key, Array.isArray(message.entries) ? message.entries : [])
            return
        }
        if (message?.type === "ready") {
            questPartyPoolWorkerReady = true
            const queued = pendingClearRecords
            pendingClearRecords = []
            for (const snapshot of queued) worker.postMessage({ type: "record", snapshot })
            for (const cleanup of pendingCleanupMessages.splice(0)) worker.postMessage(cleanup)
            console.log(`[LOBBY] quest-specific NPC party worker ready: pools=${questPartyPools.size}`)
            return
        }
        if (message?.type === "remove_players_result" && Number.isSafeInteger(message.requestId)) {
            const request = pendingCleanupRequests.get(message.requestId)
            if (!request) return
            pendingCleanupRequests.delete(message.requestId)
            clearTimeout(request.timeout)
            cachedParties = cachedParties.filter(party => !request.playerIds.has(party.player_id))
            indexCachedPartiesByElement()
            request.resolve({
                removedRows: Math.max(0, Math.trunc(Number(message.removedRows) || 0)),
                affectedQuestCount: Math.max(0, Math.trunc(Number(message.affectedQuestCount) || 0)),
            })
            return
        }
        if (message?.type === "operation_error") {
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
        rejectPendingCleanupRequests(error)
        console.error("[LOBBY] quest NPC party worker error", error)
    })
    worker.on("exit", code => {
        const wasCurrentWorker = questPartyPoolWorker === worker
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
    await worker.terminate()
}

export function recordSuccessfulQuestNpcParty(
    playerId: number,
    questCategory: number,
    questId: number,
    partySlot: number,
): void {
    if (!isQuestNpcPartyPoolEligibleCategory(questCategory)) return
    const parsed = parseGlobalPartyId(partySlot)
    if (!parsed) return
    const row = getDb().prepare(`
        SELECT slot, name, character_id_1, character_id_2, character_id_3,
               unison_character_1, unison_character_2, unison_character_3,
               equipment_1, equipment_2, equipment_3,
               ability_soul_1, ability_soul_2, ability_soul_3,
               edited, group_id, category, current_battle_power, before_battle_power,
               player_id
        FROM players_parties
        WHERE player_id = ? AND category = ? AND group_id = ? AND slot = ?
    `).get(playerId, PartyCategory.NORMAL, parsed.groupId, parsed.slot) as CachedPlayerParty | undefined
    if (!row || (row.current_battle_power ?? 0) < QUEST_NPC_POOL_MIN_POWER) return
    const party = buildRealParty(playerId, toPlayerParty(row))
    if (!hasCompleteMainCharacters(party)) return
    const snapshot: QuestNpcPartySnapshot = {
        questCategory,
        questId,
        sourcePlayerId: playerId,
        partySlot,
        battlePower: row.current_battle_power ?? 0,
        partyElement: getUniformPartyElement(row),
        clearedAt: Date.now(),
        party,
    }
    if (!questPartyPoolWorker || !questPartyPoolWorkerReady) {
        if (pendingClearRecords.length < 1000) pendingClearRecords.push(snapshot)
        return
    }
    questPartyPoolWorker.postMessage({ type: "record", snapshot })
}

export function reloadQuestNpcPartyPool(): void {
    if (questPartyPoolWorker && questPartyPoolWorkerReady) {
        questPartyPoolWorker.postMessage({ type: "reload" })
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
    cachedParties = cachedParties.filter(party => !removedPlayers.has(party.player_id))
    indexCachedPartiesByElement()
    cacheExpiresAt = 0
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
            playerIds: removedPlayers,
        })
        if (questPartyPoolWorker && questPartyPoolWorkerReady) {
            questPartyPoolWorker.postMessage(message)
        } else {
            pendingCleanupMessages.push(message)
        }
    })
}

function getCharacterElement(characterId: number | null): number | null {
    if (!characterId) return null
    const entry = (characterTable as Record<string, { element?: number }>)[String(characterId)]
    return Number.isInteger(entry?.element) ? Number(entry.element) : null
}

function getUniformPartyElement(party: CachedPlayerParty): number | null {
    const characterIds = [
        party.character_id_1,
        party.character_id_2,
        party.character_id_3,
        party.unison_character_1,
        party.unison_character_2,
        party.unison_character_3,
    ].filter((characterId): characterId is number =>
        Number.isSafeInteger(characterId) && Number(characterId) > 0,
    )
    if (characterIds.length < 3) return null

    const elements = characterIds.map(getCharacterElement)
    if (elements.some(element => element === null)) return null
    return elements.every(element => element === elements[0]) ? elements[0] : null
}

function indexCachedPartiesByElement(): void {
    cachedPartiesByElement = new Map()
    for (const party of cachedParties) {
        const element = getUniformPartyElement(party)
        if (element === null) continue
        const parties = cachedPartiesByElement.get(element) ?? []
        parties.push(party)
        cachedPartiesByElement.set(element, parties)
    }
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

function toPlayerParty(row: CachedPlayerParty): PlayerParty {
    return {
        name: row.name,
        characterIds: [row.character_id_1, row.character_id_2, row.character_id_3],
        unisonCharacterIds: [
            row.unison_character_1,
            row.unison_character_2,
            row.unison_character_3,
        ],
        equipmentIds: [row.equipment_1, row.equipment_2, row.equipment_3],
        abilitySoulIds: [row.ability_soul_1, row.ability_soul_2, row.ability_soul_3],
        edited: row.edited !== 0,
        options: { allowOtherPlayersToHealMe: true },
        category: row.category,
        currentBattlePower: row.current_battle_power ?? 0,
        beforeBattlePower: row.before_battle_power ?? 0,
    }
}

function hasCompleteMainCharacters(party: any): boolean {
    return Array.isArray(party?.characters)
        && party.characters.length >= 3
        && party.characters.slice(0, 3).every((entry: any) =>
            Array.isArray(entry) && entry[0] === 0 && entry[1]?.id,
        )
}

export function refreshPlayerNpcPartyPoolSync(force = false): number {
    const now = Date.now()
    if (!force && now < cacheExpiresAt) return cachedParties.length

    // Only cache normal parties with three characters that still belong to the
    // source player. Equipment and unison data is checked again by
    // buildRealParty when the party is selected, so stale optional slots safely
    // become empty instead of breaking the multiplayer room.
    cachedParties = getDb().prepare(`
        SELECT
            p.slot, p.name,
            p.character_id_1, p.character_id_2, p.character_id_3,
            p.unison_character_1, p.unison_character_2, p.unison_character_3,
            p.equipment_1, p.equipment_2, p.equipment_3,
            p.ability_soul_1, p.ability_soul_2, p.ability_soul_3,
            p.edited, p.group_id, p.category,
            p.current_battle_power, p.before_battle_power,
            p.player_id
        FROM players_parties p
        INNER JOIN players_characters c1
            ON c1.player_id = p.player_id AND c1.id = p.character_id_1
        INNER JOIN players_characters c2
            ON c2.player_id = p.player_id AND c2.id = p.character_id_2
        INNER JOIN players_characters c3
            ON c3.player_id = p.player_id AND c3.id = p.character_id_3
        WHERE p.category = ?
          AND p.character_id_1 IS NOT NULL
          AND p.character_id_2 IS NOT NULL
          AND p.character_id_3 IS NOT NULL
          AND p.current_battle_power >= ?
        ORDER BY p.rowid DESC
        LIMIT ?
    `).all(PartyCategory.NORMAL, MIN_BATTLE_POWER_INCLUSIVE, CACHE_MAX_ENTRIES) as CachedPlayerParty[]

    indexCachedPartiesByElement()
    cacheExpiresAt = now + CACHE_TTL_MS
    gameVerboseLog(() =>
        `[LOBBY] player NPC party pool refreshed: entries=${cachedParties.length} minPowerInclusive=${MIN_BATTLE_POWER_INCLUSIVE} ttlMs=${CACHE_TTL_MS}`,
    )
    return cachedParties.length
}

export function invalidatePlayerNpcPartyPool(): void {
    cacheExpiresAt = 0
}

export function getRandomPlayerNpcPartiesSync(
    hostPlayerId: number | null,
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
                || candidate.partyElement === options.requiredElement),
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

    // Compatibility fallback while a newly installed server is still building
    // per-quest clear history. Its database scan is lazy and TTL-cached.
    refreshPlayerNpcPartyPoolSync()
    const candidateParties = options.requiredElement === undefined
        ? cachedParties
        : (cachedPartiesByElement.get(options.requiredElement) ?? [])
    if (targetCount === 0 || candidateParties.length === 0) return []

    const availableIndexes: number[] = []
    for (let index = 0; index < candidateParties.length; index++) {
        const candidate = candidateParties[index]
        if ((candidate.current_battle_power ?? 0) >= minimumBattlePower) {
            availableIndexes.push(index)
        }
    }

    const selected: RandomNpcParty[] = []
    const usedSourcePlayers = new Set<number>()
    const deferredSamePlayer: CachedPlayerParty[] = []

    while (availableIndexes.length > 0 && selected.length < targetCount) {
        const pickedOffset = Math.floor(Math.random() * availableIndexes.length)
        const [pickedIndex] = availableIndexes.splice(pickedOffset, 1)
        const candidate = candidateParties[pickedIndex]
        if (usedSourcePlayers.has(candidate.player_id)) {
            deferredSamePlayer.push(candidate)
            continue
        }

        const party = buildRealParty(candidate.player_id, toPlayerParty(candidate))
        if (!hasCompleteMainCharacters(party)) continue
        selected.push({ sourcePlayerId: candidate.player_id, party })
        usedSourcePlayers.add(candidate.player_id)
    }

    // Small servers may only have one valid source player. In that case allow
    // two different parties from that player before falling back to the host.
    while (deferredSamePlayer.length > 0 && selected.length < targetCount) {
        const pickedOffset = Math.floor(Math.random() * deferredSamePlayer.length)
        const [candidate] = deferredSamePlayer.splice(pickedOffset, 1)
        const party = buildRealParty(candidate.player_id, toPlayerParty(candidate))
        if (!hasCompleteMainCharacters(party)) continue
        selected.push({ sourcePlayerId: candidate.player_id, party })
    }

    return selected
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
        size: cachedParties.length,
        expiresAt: cacheExpiresAt,
        ttlMs: CACHE_TTL_MS,
        maxEntries: CACHE_MAX_ENTRIES,
        minBattlePowerInclusive: MIN_BATTLE_POWER_INCLUSIVE,
        questPoolCount: questPartyPools.size,
        questPoolEntryCount: [...questPartyPools.values()]
            .reduce((total, entries) => total + entries.length, 0),
    }
}
