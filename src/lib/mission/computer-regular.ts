import { getMissionBattleCountersSync } from "../../data/domains/mission_battle_facts"
import { countFinishedPlayerQuestsSync } from "../../data/domains/quest"
import { getPlayerSync } from "../../data/domains/player"
import { getRankDegree } from "../stamina"
import { getMissionCounterValueSync } from "./counters"
import { getMissionPattern } from "./patterns"
import { getSnapshot } from "./snapshot"
import type { MissionComputer, CategoryContext } from "./types"

function buildStats(playerId: number, category: number): CategoryContext {
    const player = getPlayerSync(playerId)
    if (!player) throw new Error(`Player ${playerId} not found.`)
    const totalQuestClears = category === 7 ? countFinishedPlayerQuestsSync(playerId) : 0
    const snapshot = category === 2 || category === 6
        ? getSnapshot(playerId, "daily")
        : category === 7 || category === 10
            ? getSnapshot(playerId, "weekly")
            : null
    return {
        category,
        playerId,
        player,
        questProgress: {},
        totalQuestClears,
        totalStories: 0,
        rankCounts: {},
        battleCounters: getMissionBattleCountersSync(playerId),
        snapshot,
    }
}

function periodValue(current: number, baseline: number | undefined): number {
    return Math.max(0, current - (baseline ?? 0))
}

function computeLifetime(pattern: string, context: CategoryContext, dbProgress: number): number {
    const counters = context.battleCounters!
    if (pattern === "max_combo") return Math.max(dbProgress, context.player.maxComboAchieved ?? 0)
    if (pattern === "rank_ss") return Math.max(dbProgress, counters.rankSsCount)
    if (pattern === "use_dash") return Math.max(dbProgress, context.player.totalDashes ?? 0)
    if (pattern === "single_battle_play") return Math.max(dbProgress, counters.singleClearCount)
    if (pattern === "use_power_flip") return Math.max(dbProgress, context.player.totalPowerflips ?? 0)
    if (pattern === "user_rank") return Math.max(dbProgress, getRankDegree(context.player.rankPoint))
    if (pattern === "total_login") return Math.max(dbProgress, context.player.totalLoginDays ?? 0)
    if (pattern === "multi_battle_play") return Math.max(dbProgress, counters.multiClearCount)
    if (pattern === "multi_play_host") return Math.max(dbProgress, counters.multiHostClearCount)
    if (pattern === "multi_play_guest") return Math.max(dbProgress, counters.multiGuestClearCount)
    const rescueRank = pattern.match(/^boss_battle_attention_rank([1-5])$/)
    if (rescueRank) {
        return Math.max(dbProgress, getMissionCounterValueSync(context.playerId, {
            dimension: "battle.multi_rescue_clear",
            scopeType: "lifetime",
            scopeKey: "all",
            qualifier: { questRank: Number(rescueRank[1]) },
        }))
    }
    return dbProgress
}

function computeDaily(pattern: string, context: CategoryContext, dbProgress: number): number {
    const counters = context.battleCounters!
    if (/^single_battle_play(?:_[23])?$/.test(pattern)) {
        return Math.max(dbProgress, periodValue(counters.singleClearCount, context.snapshot?.singleClearCount))
    }
    if (/^multi_battle_play(?:_[23])?$/.test(pattern)) {
        return Math.max(dbProgress, periodValue(counters.multiClearCount, context.snapshot?.multiClearCount))
    }
    if (/^use_dash(?:_[23])?$/.test(pattern)) {
        return Math.max(dbProgress, periodValue(context.player.totalDashes ?? 0, context.snapshot?.dashCount))
    }
    if (pattern === "daily_quest_stamina_use_2024_02") {
        return Math.max(dbProgress, periodValue(context.player.totalStaminaUsed ?? 0, context.snapshot?.staminaUsed))
    }
    return dbProgress
}

function computeWeekly(pattern: string, context: CategoryContext, dbProgress: number): number {
    if (pattern === "weekly_mission_1") {
        return Math.max(dbProgress, periodValue(context.player.totalLoginDays ?? 0, context.snapshot?.loginDays))
    }
    if (pattern === "weekly_mission_2") {
        return Math.max(dbProgress, periodValue(context.battleCounters!.multiClearCount, context.snapshot?.multiClearCount))
    }
    return dbProgress
}

export const RegularComputer: MissionComputer = {
    name: "Regular",
    buildContext(playerId: number, category: number): CategoryContext {
        return buildStats(playerId, category)
    },
    compute(missionId: number, context: CategoryContext, dbProgress: number): number {
        const pattern = getMissionPattern(context.category, missionId)
        if (context.category === 1) return computeLifetime(pattern, context, dbProgress)
        if (context.category === 2) return computeDaily(pattern, context, dbProgress)
        if (context.category === 10) return computeWeekly(pattern, context, dbProgress)
        return dbProgress
    },
}
