import type { ReadonlyContentRepository } from "../../../content/runtime/content-snapshot"
import { getDb } from "../../../data/db"
import { getPlayerSync } from "../../../data/domains/player"
import { getPlayerQuestProgressSync } from "../../../data/domains/quest"
import {
    getActiveMissionEventMasterDefinition,
} from "../active-master-data"
import {
    getActiveMissionRewardStageIds,
    getActiveMissionEventReleasePhase,
    parseActiveMissionDefinition,
    parseActiveMissionEventDefinition,
    settleActiveMissionProgress,
    type ActiveMissionProgressDelta,
    type ActiveMissionProgressState,
} from "../active-core"
import { getMissionRewardStageDefinition } from "../rewards"
import { computeActiveMissionFactProgress, validateActiveMissionFactDefinition } from "./fact-progress"
import {
    parseCanonicalIntegerList,
    parseCanonicalNonNegativeInteger,
    resolveActiveMissionQuestIds,
} from "./quest-range"
import { buildActiveMissionFactRequirements } from "./requirements"
import { buildActiveMissionFactState, readRequiredRepositoryRecord } from "./state"
import type {
    ActiveMissionFactQuestProgress,
    ReconcileActiveMissionFactsInput,
} from "./types"

interface ReconciliationDefinition {
    readonly missionId: number
    readonly row: readonly unknown[]
}

function nonNegativeSafe(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
        throw new TypeError(`Invalid Active Mission ${field}.`)
    }
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Unsafe Active Mission ${field}.`)
    return value
}

function positiveSafe(value: unknown, field: string): number {
    const parsed = nonNegativeSafe(value, field)
    if (parsed === 0) throw new RangeError(`Invalid Active Mission ${field}.`)
    return parsed
}

function canonicalPositiveId(raw: string, field: string): number {
    const parsed = parseCanonicalNonNegativeInteger(raw, field)
    if (parsed === 0) throw new RangeError(`Invalid Active Mission ${field}.`)
    return parsed
}

function normalizedNow(value: number | Date): number {
    const epoch = value instanceof Date ? value.getTime() : value
    if (typeof epoch !== "number" || !Number.isFinite(epoch)) {
        throw new TypeError("Invalid Active Mission reconciliation time.")
    }
    return epoch
}

function requestedPatterns(patterns: readonly number[] | undefined): ReadonlySet<number> | undefined {
    if (patterns === undefined) return undefined
    if (!Array.isArray(patterns)) throw new TypeError("Invalid Active Mission pattern filter.")
    for (let index = 0; index < patterns.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(patterns, index)) {
            throw new TypeError("Invalid Active Mission sparse pattern filter.")
        }
    }
    return new Set(patterns.map(pattern => nonNegativeSafe(pattern, "pattern filter")))
}

function optionalCanonical(
    value: unknown,
    field: string,
    options: { readonly positive?: boolean } = {},
): number | undefined {
    if (value === undefined || value === null || value === "" || value === "(None)") return undefined
    const parsed = parseCanonicalNonNegativeInteger(value, field)
    if (options.positive && parsed === 0) throw new RangeError(`Invalid Active Mission ${field}.`)
    return parsed
}

function validateRepository(repository: ReadonlyContentRepository): readonly ReconciliationDefinition[] {
    if (typeof repository !== "object"
        || repository === null
        || typeof repository.info !== "function"
        || typeof repository.table !== "function") {
        throw new TypeError("Invalid Active Mission repository.")
    }
    const missions = readRequiredRepositoryRecord(repository, "mission_active.json")
    const events = readRequiredRepositoryRecord(repository, "mission_active_event.json")
    const rewards = readRequiredRepositoryRecord(repository, "mission_active_reward.json")
    const eventIds = new Set<number>()
    for (const [rawEventId, rawRows] of Object.entries(events)) {
        const eventId = canonicalPositiveId(rawEventId, "event id")
        if (!Array.isArray(rawRows) || !Array.isArray(rawRows[0])) {
            throw new TypeError(`Invalid Active Mission event ${eventId}.`)
        }
        const row = rawRows[0] as readonly unknown[]
        if (typeof row[0] !== "string" || row[0].length === 0) {
            throw new TypeError(`Invalid Active Mission event string id ${eventId}.`)
        }
        parseCanonicalNonNegativeInteger(row[2], "event kind")
        optionalCanonical(row[3], "event max phase", { positive: true })
        optionalCanonical(row[22], "event prerequisite quest", { positive: true })
        parseActiveMissionEventDefinition(eventId, row)
        eventIds.add(eventId)
    }
    for (const [rawMissionId, rawStages] of Object.entries(rewards)) {
        const missionId = canonicalPositiveId(rawMissionId, "reward mission id")
        if (typeof rawStages !== "object" || rawStages === null || Array.isArray(rawStages)) {
            throw new TypeError(`Invalid Active Mission reward table ${missionId}.`)
        }
        const stages = rawStages as Record<string, unknown>
        const ids = Object.keys(stages).map(id => canonicalPositiveId(id, "reward stage id")).sort((a, b) => a - b)
        if (ids.some((id, index) => id !== index + 1)) {
            throw new TypeError(`Invalid Active Mission reward stage sequence ${missionId}.`)
        }
        for (const stageId of ids) {
            const rawRows = stages[String(stageId)]
            if (!Array.isArray(rawRows) || !Array.isArray(rawRows[0])) {
                throw new TypeError(`Invalid Active Mission reward ${missionId}:${stageId}.`)
            }
            parseCanonicalNonNegativeInteger(rawRows[0][3], "reward target progress")
            optionalCanonical(rawRows[0][4], "reward target clear seconds")
            if (getMissionRewardStageDefinition(missionId, stageId, repository) === null) {
                throw new TypeError(`Invalid Active Mission reward definition ${missionId}:${stageId}.`)
            }
        }
    }
    const definitions = Object.entries(missions).map(([rawMissionId, rawRows]) => {
        const missionId = canonicalPositiveId(rawMissionId, "mission id")
        if (!Array.isArray(rawRows) || !Array.isArray(rawRows[0])) {
            throw new TypeError(`Invalid Active Mission ${missionId}.`)
        }
        const row = rawRows[0] as readonly unknown[]
        const eventId = parseCanonicalNonNegativeInteger(row[0], "event id")
        if (eventId === 0) throw new RangeError("Invalid Active Mission event id.")
        optionalCanonical(row[1], "phase", { positive: true })
        const needMissionId = optionalCanonical(row[56], "need mission id", { positive: true })
        if (needMissionId !== undefined) optionalCanonical(row[57], "need stage", { positive: true })
        const showMissionId = optionalCanonical(row[58], "show mission id", { positive: true })
        if (showMissionId !== undefined) optionalCanonical(row[59], "show stage", { positive: true })
        const mission = parseActiveMissionDefinition(missionId, row)
        const pattern = parseCanonicalNonNegativeInteger(row[29], "mission pattern")
        validateActiveMissionFactDefinition(pattern, row)
        if (!eventIds.has(mission.eventId)) throw new TypeError(`Missing Active Mission event ${mission.eventId}.`)
        if (!(rawMissionId in rewards)) throw new TypeError(`Missing Active Mission rewards ${missionId}.`)
        return Object.freeze({ missionId, row })
    })
    return Object.freeze(definitions.sort((left, right) => left.missionId - right.missionId))
}

function readActiveMissions(playerId: number): Record<string, ActiveMissionProgressState> {
    const database = getDb()
    const missionRows = database.prepare(`
        SELECT id, progress FROM players_active_missions
        WHERE player_id = ? ORDER BY id
    `).all(playerId) as Array<{ id: unknown, progress: unknown }>
    const result: Record<string, { progress: number, stages: Record<string, boolean> }> = {}
    for (const row of missionRows) {
        const missionId = positiveSafe(row.id, "stored mission id")
        result[String(missionId)] = { progress: nonNegativeSafe(row.progress, "stored mission progress"), stages: {} }
    }
    const stageRows = database.prepare(`
        SELECT id, status, mission_id FROM players_active_missions_stages
        WHERE player_id = ? ORDER BY mission_id, id
    `).all(playerId) as Array<{ id: unknown, status: unknown, mission_id: unknown }>
    for (const row of stageRows) {
        const missionId = positiveSafe(row.mission_id, "stored stage mission id")
        const mission = result[String(missionId)]
        if (!mission) throw new TypeError(`Orphan Active Mission stage ${missionId}.`)
        const stageId = positiveSafe(row.id, "stored stage id")
        const status = nonNegativeSafe(row.status, "stored stage status")
        if (status > 1) throw new RangeError("Invalid Active Mission stored stage status.")
        mission.stages[String(stageId)] = status === 1
    }
    return result
}

function readQuestFacts(playerId: number): {
    readonly raw: ReturnType<typeof getPlayerQuestProgressSync>
    readonly facts: readonly ActiveMissionFactQuestProgress[]
    readonly finishedIds: ReadonlySet<number>
} {
    const storedRows = getDb().prepare(`
        SELECT section, quest_id, finished, unlocked, clear_rank,
               leader_character_id, multi_clear_count
        FROM players_quest_progress WHERE player_id = ?
    `).all(playerId) as Array<Record<string, unknown>>
    for (const row of storedRows) {
        positiveSafe(row.section, "stored quest category")
        positiveSafe(row.quest_id, "stored quest id")
        const finished = nonNegativeSafe(row.finished, "stored quest finished status")
        const unlocked = nonNegativeSafe(row.unlocked, "stored quest unlocked status")
        if (finished > 1 || unlocked > 1) throw new RangeError("Invalid Active Mission stored quest status.")
        if (row.clear_rank !== null) nonNegativeSafe(row.clear_rank, "stored quest clear rank")
        if (row.leader_character_id !== null) positiveSafe(row.leader_character_id, "stored quest leader character id")
        nonNegativeSafe(row.multi_clear_count, "stored quest multi clear count")
    }
    const raw = getPlayerQuestProgressSync(playerId)
    const facts: ActiveMissionFactQuestProgress[] = []
    const finishedIds = new Set<number>()
    for (const [rawCategory, progressList] of Object.entries(raw)) {
        const category = canonicalPositiveId(rawCategory, "quest category")
        if (!Array.isArray(progressList)) throw new TypeError("Invalid Active Mission quest progress list.")
        for (const progress of progressList) {
            const questId = positiveSafe(progress.questId, "quest id")
            if (typeof progress.finished !== "boolean") throw new TypeError("Invalid Active Mission quest finished flag.")
            const multiClearCount = progress.multiClearCount === undefined
                ? 0
                : nonNegativeSafe(progress.multiClearCount, "quest multi clear count")
            const fact = Object.freeze({
                category,
                questId,
                finished: progress.finished,
                ...(progress.clearRank === undefined || progress.clearRank === null
                    ? {}
                    : { clearRank: nonNegativeSafe(progress.clearRank, "quest clear rank") }),
                ...(progress.leaderCharacterId === undefined || progress.leaderCharacterId === null
                    ? {}
                    : { leaderCharacterId: positiveSafe(progress.leaderCharacterId, "quest leader character id") }),
                multiClearCount,
            })
            facts.push(fact)
            if (progress.finished) {
                const normalized = category === 4 && questId < 10_000_000 ? questId + 10_000_000 : questId
                finishedIds.add(positiveSafe(normalized, "finished quest id"))
            }
        }
    }
    return { raw, facts: Object.freeze(facts), finishedIds }
}

function missionComplete(
    missionId: number,
    activeMissions: Readonly<Record<string, ActiveMissionProgressState>>,
    repository: ReadonlyContentRepository,
): boolean {
    const stageIds = getActiveMissionRewardStageIds(missionId, repository)
    if (stageIds.length === 0) return false
    const progress = activeMissions[String(missionId)]?.progress ?? 0
    return stageIds.every(stageId => {
        const reward = getMissionRewardStageDefinition(missionId, stageId, repository)
        return reward !== null && progress >= reward.targetProgress
    })
}

function authoritativeProgress(
    definition: ReconciliationDefinition,
    activeMissions: Readonly<Record<string, ActiveMissionProgressState>>,
    finishedIds: ReadonlySet<number>,
    repository: ReadonlyContentRepository,
    state: Parameters<typeof computeActiveMissionFactProgress>[2],
): number | null {
    const pattern = parseCanonicalNonNegativeInteger(definition.row[29], "mission pattern")
    const computed = computeActiveMissionFactProgress(pattern, definition.row, state, definition.missionId)
    if (computed !== null) return nonNegativeSafe(computed, "authoritative progress")
    if (pattern === 57) {
        return resolveActiveMissionQuestIds(definition.row).filter(id => finishedIds.has(id)).length
    }
    if (pattern === 13) {
        const targets = parseCanonicalIntegerList(definition.row[55], "target mission ids")
        targets.forEach(id => positiveSafe(id, "target mission id"))
        return targets.filter(id => missionComplete(id, activeMissions, repository)).length
    }
    return null
}

function eventEligible(
    input: ReconcileActiveMissionFactsInput,
    eventId: number,
    cache: Map<number, boolean>,
): boolean {
    const cached = cache.get(eventId)
    if (cached !== undefined) return cached
    const master = getActiveMissionEventMasterDefinition(eventId, input.repository)
    if (!master) throw new TypeError(`Missing Active Mission event ${eventId}.`)
    const event = parseActiveMissionEventDefinition(eventId, master.row)
    const eventStringId = master.row[0]
    if (typeof eventStringId !== "string") throw new TypeError(`Invalid Active Mission event ${eventId}.`)
    const eligible = !eventStringId.includes("come_back_mission") || input.isEventEligible?.({
        playerId: input.playerId,
        eventId,
        eventStringId,
        eventKind: event.kind,
    }) === true
    cache.set(eventId, eligible)
    return eligible
}

function questFinished(
    questProgress: Readonly<Record<string, readonly { readonly questId: number, readonly finished: boolean }[]>>,
    questId: number | undefined,
): boolean {
    if (questId === undefined) return true
    return Object.entries(questProgress).some(([rawCategory, progressList]) => progressList.some(progress => {
        const category = canonicalPositiveId(rawCategory, "quest category")
        const normalized = category === 4 && progress.questId < 10_000_000
            ? progress.questId + 10_000_000
            : progress.questId
        return positiveSafe(normalized, "quest id") === questId && progress.finished === true
    }))
}

function stageReceivedAndComplete(
    activeMissions: Readonly<Record<string, ActiveMissionProgressState>>,
    reference: { readonly missionId: number, readonly stage: number } | undefined,
    repository: ReadonlyContentRepository,
): boolean {
    if (!reference) return true
    const reward = getMissionRewardStageDefinition(reference.missionId, reference.stage, repository)
    if (!reward) throw new TypeError(`Missing Active Mission reward ${reference.missionId}:${reference.stage}.`)
    const state = activeMissions[String(reference.missionId)]
    return state?.stages?.[String(reference.stage)] === true && state.progress >= reward.targetProgress
}

function activeMissionAvailable(
    definition: ReconciliationDefinition,
    input: ReconcileActiveMissionFactsInput,
    now: number,
    activeMissions: Readonly<Record<string, ActiveMissionProgressState>>,
    questProgress: Readonly<Record<string, readonly { readonly questId: number, readonly finished: boolean }[]>>,
): boolean {
    const mission = parseActiveMissionDefinition(definition.missionId, definition.row)
    const eventMaster = getActiveMissionEventMasterDefinition(mission.eventId, input.repository)
    if (!eventMaster) throw new TypeError(`Missing Active Mission event ${mission.eventId}.`)
    const event = parseActiveMissionEventDefinition(mission.eventId, eventMaster.row)
    if (now < event.startTime
        || (event.endTime !== undefined && now > event.endTime)
        || !questFinished(questProgress, event.needQuestMultipliedId)
        || (mission.enableStartTime !== undefined && now < mission.enableStartTime)
        || (mission.enableEndTime !== undefined && now > mission.enableEndTime)) return false
    if (mission.phase !== undefined && mission.phase > getActiveMissionEventReleasePhase(
        mission.eventId,
        activeMissions,
        input.repository,
    )) return false
    return stageReceivedAndComplete(activeMissions, mission.need, input.repository)
        && stageReceivedAndComplete(activeMissions, mission.show, input.repository)
}

function checkForeignKeys(): void {
    const violations = getDb().pragma("foreign_key_check") as unknown[]
    if (violations.length > 0) throw new Error("Active Mission foreign key check failed.")
}

function writeSettlement(
    playerId: number,
    missionId: number,
    previous: ActiveMissionProgressState | undefined,
    settlement: ReturnType<typeof settleActiveMissionProgress>,
): void {
    const database = getDb()
    if (previous?.progress !== settlement.state.progress) {
        const result = database.prepare(`
            INSERT INTO players_active_missions (id, progress, player_id)
            VALUES (?, ?, ?)
            ON CONFLICT(id, player_id) DO UPDATE SET progress = excluded.progress
            WHERE typeof(players_active_missions.progress) = 'integer'
              AND players_active_missions.progress >= 0
              AND players_active_missions.progress <= excluded.progress
        `).run(missionId, settlement.state.progress, playerId)
        if (result.changes !== 1) throw new Error("Active Mission progress row count mismatch.")
        checkForeignKeys()
    }
    for (const stage of settlement.delta?.stages ?? []) {
        const result = database.prepare(`
            INSERT INTO players_active_missions_stages (id, status, player_id, mission_id)
            VALUES (?, 0, ?, ?)
            ON CONFLICT(id, mission_id, player_id) DO NOTHING
        `).run(stage.stage, playerId, missionId)
        if (result.changes !== 1) throw new Error("Active Mission stage row count mismatch.")
        checkForeignKeys()
    }
}

function mergeDelta(
    deltas: Map<number, { progress: number, stages: Set<number> }>,
    delta: ActiveMissionProgressDelta,
): void {
    const current = deltas.get(delta.mission_id) ?? { progress: 0, stages: new Set<number>() }
    current.progress = nonNegativeSafe(delta.progress_value, "delta progress")
    delta.stages.forEach(stage => current.stages.add(positiveSafe(stage.stage, "delta stage")))
    deltas.set(delta.mission_id, current)
}

export function reconcileActiveMissionFacts(input: ReconcileActiveMissionFactsInput): ActiveMissionProgressDelta[] {
    const playerId = positiveSafe(input.playerId, "player id")
    const now = normalizedNow(input.now)
    const filter = requestedPatterns(input.patterns)
    const allDefinitions = validateRepository(input.repository)
    const definitions = allDefinitions.filter(definition => filter === undefined
        || filter.has(parseCanonicalNonNegativeInteger(definition.row[29], "mission pattern")))
    return getDb().transaction(() => {
        const player = getPlayerSync(playerId)
        if (!player) throw new Error(`Player ${playerId} does not exist.`)
        const activeMissions = readActiveMissions(playerId)
        const quest = readQuestFacts(playerId)
        const requirements = buildActiveMissionFactRequirements(definitions)
        const state = buildActiveMissionFactState(playerId, player, quest.finishedIds, quest.facts, input.repository, requirements)
        const deltas = new Map<number, { progress: number, stages: Set<number> }>()
        const eventEligibility = new Map<number, boolean>()
        for (let pass = 0; pass <= definitions.length; pass += 1) {
            let changed = false
            for (const definition of definitions) {
                const mission = parseActiveMissionDefinition(definition.missionId, definition.row)
                if (!eventEligible(input, mission.eventId, eventEligibility)) continue
                if (!activeMissionAvailable(definition, input, now, activeMissions, quest.raw)) continue
                const progress = authoritativeProgress(definition, activeMissions, quest.finishedIds, input.repository, state)
                if (progress === null) continue
                if (activeMissions[String(definition.missionId)] === undefined && progress === 0) continue
                const previous = activeMissions[String(definition.missionId)]
                const settlement = settleActiveMissionProgress(definition.missionId, previous, progress, { repository: input.repository })
                if (!settlement.delta) continue
                writeSettlement(playerId, definition.missionId, previous, settlement)
                activeMissions[String(definition.missionId)] = settlement.state
                mergeDelta(deltas, settlement.delta)
                changed = true
            }
            if (!changed) break
            if (pass === definitions.length) throw new Error("Active Mission reconciliation did not converge.")
        }
        return [...deltas.entries()].sort(([left], [right]) => left - right).map(([missionId, delta]) => ({
            mission_id: missionId,
            progress_value: delta.progress,
            stages: [...delta.stages].sort((left, right) => left - right).map(stage => ({ stage, received: false as const })),
        }))
    })()
}
