import { getQuestFromCategorySync } from "../../assets"
import { getPlayerActiveQuestSync } from "../../../data/domains/quest_active"
import { BattleQuest, QuestCategory } from "../../types"
import type { PlayerActiveQuest } from "../../../data/types"
import type { ActiveQuest } from "../../../routes/api/singleBattleQuest"
import { getDb } from "../../../data/db"
import { BATTLE_CLOCK_VERSION, isSupportedBattleClockVersion, isClockAbortedPlaySync } from "../../battle-clock-compatibility"

/** Where the active quest backing a finish/continue request came from. */
export type ActiveQuestSource = "memory" | "database" | "rebuilt"

/** Request fields needed to rebuild a missing active-quest registration. */
export interface ActiveQuestHint {
    quest_id: number
    category: number
    continue_count?: number
    play_id?: string
}

export interface ResolvedActiveQuest {
    quest: ActiveQuest
    source: ActiveQuestSource
}

export interface ResolveActiveQuestOptions {
    playerId: number
    hint: ActiveQuestHint
    memory: Record<number, ActiveQuest>
    /** Defaults to the inverse of isStrictFinishMode. */
    allowRebuild?: boolean
    readPersisted?: (playerId: number) => PlayerActiveQuest | null
    findQuest?: (category: QuestCategory, questId: number) => BattleQuest | null
}

// Rush/raid clients can report a client-side category number that differs from
// the server category. Try the reported category first, then the safe fallbacks.
const REBUILD_FALLBACK_CATEGORIES: QuestCategory[] = [
    QuestCategory.RUSH_EVENT,
    QuestCategory.RAID_EVENT,
]

/** Set QUEST_FINISH_STRICT=1 to disable request-body rebuilding. */
export function isStrictFinishMode(): boolean {
    const raw = (process.env.QUEST_FINISH_STRICT ?? "").trim().toLowerCase()
    return raw === "1" || raw === "true" || raw === "yes"
}

function isBattleQuest(quest: BattleQuest | null): quest is BattleQuest {
    return quest !== null && "rankPointReward" in quest
}

export function resolveRebuildCategory(
    clientCategory: number,
    questId: number,
    findQuest: (category: QuestCategory, questId: number) => BattleQuest | null
): { category: QuestCategory, questData: BattleQuest } | null {
    const tried = new Set<QuestCategory>()
    for (const category of [clientCategory as QuestCategory, ...REBUILD_FALLBACK_CATEGORIES]) {
        if (tried.has(category)) continue
        tried.add(category)
        const questData = findQuest(category, questId)
        if (isBattleQuest(questData)) return { category, questData }
    }
    return null
}

function fromPersisted(row: PlayerActiveQuest): ActiveQuest {
    return {
        questId: row.questId,
        category: row.category as QuestCategory,
        useBossBoostPoint: row.useBossBoostPoint,
        useBoostPoint: row.useBoostPoint,
        isAutoStartMode: row.isAutoStartMode,
        isMulti: row.isMulti,
        isMultiHost: row.isMultiHost,
        roomNumber: row.roomNumber ?? undefined,
        entryItemId: row.entryItemId ?? undefined,
        eventId: row.eventId ?? undefined,
        partySlot: row.partySlot ?? undefined,
        playId: row.playId,
        continueCount: row.continueCount,
        startedAtMs: row.startedAtMs ?? undefined,
        questTimeRevision: row.questTimeRevision ?? null,
        clockVersion: row.clockVersion,
        battleRoster: row.battleRoster,
    }
}

function rebuildFromHint(
    hint: ActiveQuestHint,
    findQuest: (category: QuestCategory, questId: number) => BattleQuest | null
): ActiveQuest | null {
    const resolved = resolveRebuildCategory(hint.category, hint.quest_id, findQuest)
    if (resolved === null) return null

    return {
        questId: hint.quest_id,
        category: resolved.category,
        // A rebuilt entry did not reserve boost points or entry items at start.
        useBossBoostPoint: false,
        useBoostPoint: false,
        isAutoStartMode: false,
        isMulti: false,
        eventId: resolved.questData.eventId,
        playId: hint.play_id ?? "",
        continueCount: hint.continue_count ?? 0,
    }
}

/**
 * Resolve from memory, then the persisted row, then (unless strict mode is
 * enabled) rebuild a minimal active quest from the request body.
 */
export function resolveActiveQuest(options: ResolveActiveQuestOptions): ResolvedActiveQuest | null {
    const { playerId, hint, memory } = options
    const readPersisted = options.readPersisted ?? getPlayerActiveQuestSync
    const findQuest = options.findQuest
        ?? ((category, questId) => getQuestFromCategorySync(category, questId) as BattleQuest | null)
    const allowRebuild = options.allowRebuild ?? !isStrictFinishMode()

    if (!options.readPersisted) {
        if (hint.play_id && isClockAbortedPlaySync(getDb(), playerId, hint.play_id)) return null
    }
    const persisted = readPersisted(playerId)
    const cached = memory[playerId]
    if (cached !== undefined) {
        if (persisted?.playId === cached.playId && isSupportedBattleClockVersion(persisted.clockVersion)) {
            // Keep room metadata in memory, but use the committed clock and roster.
            cached.startedAtMs = persisted.startedAtMs ?? undefined
            cached.clockVersion = persisted.clockVersion
            cached.battleRoster = persisted.battleRoster
            return { quest: cached, source: "memory" }
        }
        if (cached.clockVersion === BATTLE_CLOCK_VERSION) return { quest: cached, source: "memory" }
        delete memory[playerId]
    }

    const usePersisted = (row: PlayerActiveQuest): ResolvedActiveQuest => {
        const quest = fromPersisted(row)
        memory[playerId] = quest
        return { quest, source: "database" }
    }

    if (persisted !== null) {
        if (!isSupportedBattleClockVersion(persisted.clockVersion)) return null
        if (persisted.questId === hint.quest_id || !allowRebuild) return usePersisted(persisted)
        const rebuilt = rebuildFromHint(hint, findQuest)
        if (rebuilt === null) return usePersisted(persisted)
        console.warn(`[QUEST-RESOLVE] player ${playerId} persisted quest ${persisted.questId} != requested ${hint.quest_id}, rebuilding from request`)
        return { quest: rebuilt, source: "rebuilt" }
    }

    if (!allowRebuild) return null
    const rebuilt = rebuildFromHint(hint, findQuest)
    return rebuilt === null ? null : { quest: rebuilt, source: "rebuilt" }
}
