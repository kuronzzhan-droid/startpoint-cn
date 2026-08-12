import { getQuestFromCategorySync } from "../../assets"
import { getPlayerActiveQuestSync } from "../../../data/domains/quest_active"
import { BattleQuest, QuestCategory } from "../../types"
import type { PlayerActiveQuest } from "../../../data/types"
import type { ActiveQuest } from "../../../routes/api/singleBattleQuest"

/**
 * Where the ActiveQuest backing a finish/continue request came from.
 *
 * `/single_battle_quest/start` is what normally registers it, but three deployments break
 * that assumption and used to end in `400 No active quest to finish.`: a server restart
 * mid-battle (the in-memory table is lost), a multi-process deployment (start and finish
 * land on different workers), and patched clients that call finish without calling start.
 */
export type ActiveQuestSource = "memory" | "database" | "rebuilt"

/** The request-body fields a rebuild needs when no registration survives. */
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
    /** Defaults to the inverse of {@link isStrictFinishMode}. */
    allowRebuild?: boolean
    readPersisted?: (playerId: number) => PlayerActiveQuest | null
    findQuest?: (category: QuestCategory, questId: number) => BattleQuest | null
}

/**
 * Rush and raid battles start on their own endpoints, which register the server-side
 * QuestCategory (RUSH_EVENT 24 / RAID_EVENT 23). The client numbers those categories
 * differently, so a rebuild that only trusted `body.category` would look the quest up in
 * the wrong table — client 18 resolves to WORLD_STORY_EVENT here.
 */
const REBUILD_FALLBACK_CATEGORIES: QuestCategory[] = [
    QuestCategory.RUSH_EVENT,
    QuestCategory.RAID_EVENT,
]

/** `QUEST_FINISH_STRICT` restores the pre-compat behaviour: no rebuild from the body. */
export function isStrictFinishMode(): boolean {
    const raw = (process.env.QUEST_FINISH_STRICT ?? "").trim().toLowerCase()
    return raw === "1" || raw === "true" || raw === "yes"
}

function isBattleQuest(quest: BattleQuest | null): quest is BattleQuest {
    return quest !== null && "rankPointReward" in quest
}

/**
 * Picks the server-side category a client-reported category/quest pair refers to. The
 * client's own number wins when it resolves, so quests that exist in both numbering
 * schemes keep behaving the way `/start` registered them.
 */
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
        playId: row.playId,
        continueCount: row.continueCount,
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
        // Nothing was reserved at start, so a rebuild must not spend a boost point or
        // report an entry item back to the client.
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
 * Resolves the quest a finish/continue request refers to: the in-memory table first (an
 * untouched hit keeps the existing start→finish and rush paths byte-for-byte), then the
 * persisted row, then a minimal quest rebuilt from the request body.
 *
 * Returns null only when strict mode is on, or when the body names no quest that exists.
 */
export function resolveActiveQuest(options: ResolveActiveQuestOptions): ResolvedActiveQuest | null {
    const { playerId, hint, memory } = options
    const readPersisted = options.readPersisted ?? getPlayerActiveQuestSync
    const findQuest = options.findQuest ??
        ((category, questId) => getQuestFromCategorySync(category, questId) as BattleQuest | null)
    const allowRebuild = options.allowRebuild ?? !isStrictFinishMode()

    const cached = memory[playerId]
    if (cached !== undefined) return { quest: cached, source: "memory" }

    const usePersisted = (row: PlayerActiveQuest): ResolvedActiveQuest => {
        const quest = fromPersisted(row)
        memory[playerId] = quest
        return { quest, source: "database" }
    }

    const persisted = readPersisted(playerId)
    if (persisted !== null) {
        if (persisted.questId === hint.quest_id || !allowRebuild) return usePersisted(persisted)
        // A row for a different quest is a leftover the client already moved on from.
        const rebuilt = rebuildFromHint(hint, findQuest)
        if (rebuilt === null) return usePersisted(persisted)
        console.warn(`[QUEST-RESOLVE] player ${playerId} persisted quest ${persisted.questId} != requested ${hint.quest_id}, rebuilding from request`)
        return { quest: rebuilt, source: "rebuilt" }
    }

    if (!allowRebuild) return null
    const rebuilt = rebuildFromHint(hint, findQuest)
    return rebuilt === null ? null : { quest: rebuilt, source: "rebuilt" }
}
