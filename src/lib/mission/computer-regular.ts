import { cachedStatement } from "../cached-statement"
import mainQuests from "../../../assets/main_quest.json"
import exQuests from "../../../assets/ex_quest.json"
import { getDb } from "../../data/db"
import { getRankDegree } from "../stamina"
import { QuestCategory } from "../types"
import { makeMissionCounterKey, type MissionCounterQuery } from "./counters"
import { MissionEvaluationReadContext } from "./evaluation-context"
import { getMissionMasterDefinitions } from "./master-data"
import { getMissionPattern } from "./patterns"
import type { MissionComputer, CategoryContext } from "./types"

interface RegularContext extends CategoryContext {
    completedChapters: ReadonlySet<string>
}

const chapterKeyByMissionId = new Map<number, string>()
const questIdsByChapter = new Map<string, number[]>()
for (const [category, quests] of [
    [QuestCategory.MAIN, mainQuests],
    [QuestCategory.EX, exQuests],
] as const) {
    for (const id of Object.keys(quests)) {
        const questId = Number(id)
        const chapter = Math.floor(questId / 1_000_000)
        if (!Number.isSafeInteger(questId) || chapter <= 0) continue
        const key = `${category}:${chapter}`
        const ids = questIdsByChapter.get(key) ?? []
        ids.push(questId)
        questIdsByChapter.set(key, ids)
    }
}
for (const definition of getMissionMasterDefinitions(1)) {
    if (Number(definition.row[2]) !== 22) continue
    // Mission master uses 0/1 for normal/EX, not the API section IDs 1/4.
    const mode = String(definition.row[7])
    const chapter = Number(definition.row[8])
    if ((mode !== "0" && mode !== "1") || !Number.isSafeInteger(chapter) || chapter <= 0) continue
    const category = mode === "0" ? QuestCategory.MAIN : QuestCategory.EX
    chapterKeyByMissionId.set(definition.missionId, `${category}:${chapter}`)
}

function readCompletedChapters(playerId: number, missionIds?: readonly number[]): ReadonlySet<string> {
    const requestedChapters = new Set(missionIds === undefined
        ? chapterKeyByMissionId.values()
        : missionIds.flatMap(missionId => {
            const key = chapterKeyByMissionId.get(missionId)
            return key === undefined ? [] : [key]
        }))
    const completed = new Set<string>()
    if (requestedChapters.size === 0) return completed

    // Recover old saves from authoritative clear records. Only read the two
    // chapter sections and IDs, not every event quest's full progress payload.
    const rows = cachedStatement(getDb(), `
        SELECT section, quest_id FROM players_quest_progress
        WHERE player_id = ? AND section IN (?, ?) AND finished = 1
    `).all(playerId, QuestCategory.MAIN, QuestCategory.EX) as { section: number, quest_id: number }[]
    const finished = new Set(rows.map(row => `${row.section}:${row.quest_id}`))
    for (const key of requestedChapters) {
        const required = questIdsByChapter.get(key) ?? []
        const category = key.split(":")[0]
        // MAIN includes story nodes as well as battles. An empty/missing
        // chapter or a finished quest in another section cannot complete it.
        if (required.length > 0 && required.every(id => finished.has(`${category}:${id}`))) {
            completed.add(key)
        }
    }
    return completed
}

function rescueRankQuery(rank: number): MissionCounterQuery {
    return {
        dimension: "battle.multi_rescue_clear",
        scopeType: "lifetime",
        scopeKey: "all",
        qualifier: { questRank: rank },
    }
}

const multiMvpQuery: MissionCounterQuery = {
    dimension: "battle.multi_mvp",
    scopeType: "lifetime",
    scopeKey: "all",
    qualifier: {},
}

function buildStats(
    playerId: number,
    category: number,
    missionIds?: readonly number[],
    shared: MissionEvaluationReadContext = new MissionEvaluationReadContext(playerId),
): RegularContext {
    const player = shared.player
    // Keep full quest histories out of regular/daily/weekly/pass contexts;
    // chapter missions use a separate, narrowly scoped finished-ID read.
    const totalQuestClears = category === 7
        ? shared.totalQuestClears
        : 0

    const snapshot = category === 2 || category === 6
        ? shared.snapshot("daily")
        : category === 7 || category === 10
            ? shared.snapshot("weekly")
            : null
    const rescueRanks = category !== 1
        ? []
        : missionIds === undefined
            ? [1, 2, 3, 4, 5]
            : [...new Set(missionIds.flatMap(missionId => {
                const match = getMissionPattern(category, missionId).match(/^boss_battle_attention_rank([1-5])$/)
                return match ? [Number(match[1])] : []
            }))]
    const missionQueries = rescueRanks.map(rescueRankQuery)
    if (category === 1 && (missionIds === undefined
        || missionIds.some(missionId => getMissionPattern(category, missionId) === "get_mvp"))) {
        missionQueries.push(multiMvpQuery)
    }

    return {
        category,
        playerId,
        player,
        questProgress: {},
        totalQuestClears,
        totalStories: 0,
        rankCounts: {},
        battleCounters: shared.battleCounters,
        missionCounterValues: shared.missionCounters(missionQueries),
        snapshot,
        completedChapters: category === 1
            ? readCompletedChapters(playerId, missionIds)
            : new Set<string>(),
    }
}

function periodValue(current: number, baseline: number | undefined): number {
    return Math.max(0, current - (baseline ?? 0))
}

function computeLifetime(pattern: string, ctx: CategoryContext, dbProgress: number): number {
    const counters = ctx.battleCounters!
    if (pattern === "max_combo") return Math.max(dbProgress, ctx.player.maxComboAchieved ?? 0)
    if (pattern === "rank_ss") return Math.max(dbProgress, counters.rankSsCount)
    if (pattern === "use_dash") return Math.max(dbProgress, ctx.player.totalDashes ?? 0)
    if (pattern === "single_battle_play") return Math.max(dbProgress, counters.singleClearCount)
    if (pattern === "use_power_flip") return Math.max(dbProgress, ctx.player.totalPowerflips ?? 0)
    if (pattern === "user_rank") return Math.max(dbProgress, getRankDegree(ctx.player.rankPoint))
    if (pattern === "total_login") return Math.max(dbProgress, ctx.player.totalLoginDays ?? 0)
    if (pattern === "multi_battle_play") return Math.max(dbProgress, counters.multiClearCount)
    if (pattern === "multi_play_host") return Math.max(dbProgress, counters.multiHostClearCount)
    if (pattern === "multi_play_guest") return Math.max(dbProgress, counters.multiGuestClearCount)
    if (pattern === "get_mvp") return Math.max(dbProgress,
        ctx.missionCounterValues?.get(makeMissionCounterKey(multiMvpQuery)) ?? 0)
    const rescueRankMatch = pattern.match(/^boss_battle_attention_rank([1-5])$/)
    if (rescueRankMatch) {
        const query = rescueRankQuery(Number(rescueRankMatch[1]))
        return Math.max(dbProgress, ctx.missionCounterValues?.get(makeMissionCounterKey(query)) ?? 0)
    }
    return dbProgress
}

function computeDaily(pattern: string, ctx: CategoryContext, dbProgress: number): number {
    const snapshot = ctx.snapshot
    const counters = ctx.battleCounters!
    if (/^single_battle_play(?:_[23])?$/.test(pattern)) {
        return Math.max(dbProgress, periodValue(counters.singleClearCount, snapshot?.singleClearCount))
    }
    if (/^multi_battle_play(?:_[23])?$/.test(pattern)) {
        return Math.max(dbProgress, periodValue(counters.multiClearCount, snapshot?.multiClearCount))
    }
    if (/^use_dash(?:_[23])?$/.test(pattern)) {
        return Math.max(dbProgress, periodValue(ctx.player.totalDashes ?? 0, snapshot?.dashCount))
    }
    if (pattern === "daily_quest_stamina_use_2024_02") {
        return Math.max(dbProgress, periodValue(ctx.player.totalStaminaUsed ?? 0, snapshot?.staminaUsed))
    }
    return dbProgress
}

function computeWeekly(pattern: string, ctx: CategoryContext, dbProgress: number): number {
    const snapshot = ctx.snapshot
    const counters = ctx.battleCounters!
    if (pattern === "weekly_mission_1") {
        return Math.max(dbProgress, periodValue(ctx.player.totalLoginDays ?? 0, snapshot?.loginDays))
    }
    if (pattern === "weekly_mission_2") {
        return Math.max(dbProgress, periodValue(counters.multiClearCount, snapshot?.multiClearCount))
    }
    return dbProgress
}

export const RegularComputer: MissionComputer = {
    name: "Regular",

    buildContext(
        playerId: number,
        category: number,
        _evaluationTime: Date,
        missionIds?: readonly number[],
        readContext?: MissionEvaluationReadContext,
    ): CategoryContext {
        return buildStats(playerId, category, missionIds, readContext)
    },

    compute(missionId: number, ctx: CategoryContext, dbProgress: number): number {
        const pattern = getMissionPattern(ctx.category, missionId)
        if (ctx.category === 1) {
            const chapterKey = chapterKeyByMissionId.get(missionId)
            if (chapterKey !== undefined) {
                return Math.max(dbProgress, (ctx as RegularContext).completedChapters.has(chapterKey) ? 1 : 0)
            }
            return computeLifetime(pattern, ctx, dbProgress)
        }
        if (ctx.category === 2) return computeDaily(pattern, ctx, dbProgress)
        if (ctx.category === 10) return computeWeekly(pattern, ctx, dbProgress)
        return dbProgress
    },
}
