import { incrementPlayerQuestMultiClearSync } from "../../data/domains/quest"
import { recordMissionBattleResultSync } from "../../data/domains/mission_battle_facts"
import { trackCharacterClears } from "../quest/finish/character-clear-tracker"
import { trackLeaderPowerflip } from "../quest/finish/leader-powerflip-tracker"
import { trackPartyCoClears } from "../quest/finish/party-co-clear-tracker"
import { trackPowerflip } from "../quest/finish/powerflip-tracker"
import type { FinishContext } from "../quest/finish/types"
import { getServerTime } from "../../utils"
import { recordEventMissionBattleFacts } from "./event-battle-facts"
import { recordPassMissionBattleFacts } from "./pass-battle-facts"
import { recordActiveMissionConditionalBattleFactsSync } from "./active-conditional-battle-facts"
import { recordActiveMissionLoadoutBattleFactsSync } from "./active-loadout-battle-facts"
import { recordDailyMissionBattleFacts } from "./daily-battle-facts"
import { getDegreeMissionIdsForConditionTypes } from "./computer-degree"
import { getEventItemMissionIdsForItems } from "./computer-event-safe"
import type { MissionSettlementScope } from "./settlement"
import { QuestCategory } from "../types"

// Category 5 (titles) must be settled in the battle result response.  Deferring
// it until get_mission_progress made newly acquired titles invisible until the
// player opened the title screen.
export const BATTLE_SETTLEMENT_CATEGORIES = Object.freeze([1, 2, 3, 5, 6, 7, 8, 10])

const BATTLE_DEGREE_CONDITION_TYPES = Object.freeze([
    // Battle results may grant/level characters and equipment in addition to
    // updating battle counters, so include those reward-driven title types.
    1, 4, 5, 8, 14, 15, 16, 17, 19, 20, 21, 22, 23, 25, 26, 28, 30,
    31, 37, 39, 44, 92,
])

const BATTLE_ACTIVE_MISSION_PATTERNS = Object.freeze([
    // Battle counters, stamina, quest completion, party/loadout facts and
    // reward-driven character level/bond changes.
    4, 5, 8, 13, 14, 16, 17, 23, 26, 39, 57, 70, 71, 72, 73, 89,
])

export interface MissionBattleFactResult {
    readonly dailyMissionIds: readonly number[]
    readonly eventMissionIds: readonly number[]
    readonly passMissionIds: readonly number[]
    readonly awakeMissionIds: readonly number[]
}

export function buildBattleMissionSettlementScopes(
    facts: MissionBattleFactResult,
    grantedItemIds: readonly number[] = [],
    extraEventMissionIds: readonly number[] = [],
    affectedCharacterIds: readonly number[] = [],
): readonly (number | MissionSettlementScope)[] {
    const eventMissionIds = [...new Set([
        ...facts.eventMissionIds,
        ...getEventItemMissionIdsForItems(grantedItemIds),
        ...extraEventMissionIds.filter(missionId => Number.isSafeInteger(missionId) && missionId > 0),
    ])]
    return [
        1,
        // Daily all-clear depends on the complete set of enabled core missions,
        // so category 2 deliberately remains a full (but small) evaluation.
        2,
        { category: 3, missionIds: eventMissionIds },
        {
            category: 5,
            missionIds: getDegreeMissionIdsForConditionTypes(
                BATTLE_DEGREE_CONDITION_TYPES,
                affectedCharacterIds,
                grantedItemIds,
            ),
        },
        6,
        7,
        { category: 8, missionIds: facts.passMissionIds },
        10,
    ]
}

/** Active Mission patterns whose authoritative facts can change in one battle. */
export function getBattleActiveMissionPatterns(questCategory: number): number[] {
    return [
        ...BATTLE_ACTIVE_MISSION_PATTERNS,
        ...(questCategory === QuestCategory.CHARACTER ? [21] : []),
        ...(questCategory === QuestCategory.MAIN || questCategory === QuestCategory.EX ? [66] : []),
    ]
}

export function recordMissionBattleFacts(
    ctx: FinishContext,
    evaluationTime: Date = new Date(getServerTime() * 1000),
): MissionBattleFactResult {
    recordMissionBattleResultSync(ctx.playerId, {
        isMulti: ctx.isMulti === true,
        isHost: ctx.isMultiHost,
        accomplished: ctx.questAccomplished,
        clearRank: ctx.clearRank,
    })
    if (!ctx.questAccomplished) {
        return { dailyMissionIds: [], eventMissionIds: [], passMissionIds: [], awakeMissionIds: [] }
    }
    const dailyMissionIds = recordDailyMissionBattleFacts(ctx, evaluationTime)
    const eventMissionIds = recordEventMissionBattleFacts(ctx, evaluationTime)
    const passMissionIds = recordPassMissionBattleFacts(ctx, evaluationTime)
    recordActiveMissionLoadoutBattleFactsSync(ctx)
    recordActiveMissionConditionalBattleFactsSync(ctx)
    if (ctx.isMulti) {
        incrementPlayerQuestMultiClearSync(ctx.playerId, ctx.questCategory, ctx.questId)
    }
    trackCharacterClears(ctx)
    trackLeaderPowerflip(ctx)
    const awakeMissionIds = trackPartyCoClears(ctx)
    trackPowerflip(ctx)
    return { dailyMissionIds, eventMissionIds, passMissionIds, awakeMissionIds }
}
