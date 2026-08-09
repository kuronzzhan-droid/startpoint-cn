import adventEventQuests from "../../../assets/advent_event_quest.json"
import scoreAttackEventQuests from "../../../assets/score_attack_event_quest.json"
import { incrementPlayerCategoryMissionSync } from "../../data/domains/mission"
import type { FinishContext } from "../quest/finish/types"
import { getMissionMasterDefinitions, isMissionDefinitionEnabledAt } from "./master-data"

const SCORE_ATTACK_DAILY_MISSION_ID = 10075
const ANY_BATTLE_DAILY_MISSION_ID = 800392
const ACTIVE_DAILY_BATTLE_MISSION_IDS = new Set([
    800115,
    800116,
    800117,
    800124,
    800125,
    800126,
])

const ADVENT_EVENT_RANGE_KIND = 5
const BOSS_BATTLE_RANGE_KIND = 2
const SCORE_ATTACK_EVENT_RANGE_KIND = 20
const SCORE_ATTACK_QUEST_CATEGORY = 27
const SCORE_ATTACK_CLEAR_PATTERN_TYPE = 14
const ANY_BATTLE_CLEAR_PATTERN_TYPE = 23
const MULTI_BATTLE_CLEAR_PATTERN_TYPE = 16

const adventQuestIds = new Set(
    Object.keys(adventEventQuests).map(Number).filter(Number.isSafeInteger),
)
const scoreAttackQuestEventIds = new Map(
    Object.entries(scoreAttackEventQuests).map(([questId, quest]) => [
        Number(questId),
        Number(quest.eventId),
    ]),
)

function matchesAdventEvent(
    row: readonly unknown[],
    questCategory: number,
    questId: number,
): boolean {
    if (questCategory !== 7 || !adventQuestIds.has(questId)) return false
    const eventSelector = Number(row[8])
    return Number.isSafeInteger(eventSelector)
        && eventSelector > 0
        && Math.trunc(questId / 1_000) === eventSelector
}

function matchesQuestRange(
    row: readonly unknown[],
    questCategory: number,
    questId: number,
): boolean {
    const rangeKind = Number(row[7])
    if (rangeKind === ADVENT_EVENT_RANGE_KIND) {
        return matchesAdventEvent(row, questCategory, questId)
    }
    return rangeKind === BOSS_BATTLE_RANGE_KIND && questCategory === 2
}

function matchesScoreAttackEvent(
    row: readonly unknown[],
    questCategory: number,
    questId: number,
): boolean {
    if (questCategory !== SCORE_ATTACK_QUEST_CATEGORY
        || Number(row[7]) !== SCORE_ATTACK_EVENT_RANGE_KIND) return false
    const eventId = scoreAttackQuestEventIds.get(questId)
    return eventId !== undefined && eventId === Number(row[8])
}

export function recordDailyMissionBattleFacts(
    context: FinishContext,
    evaluationTime: Date,
): number[] {
    if (!context.questAccomplished) return []

    const matchedMissionIds: number[] = []
    for (const definition of getMissionMasterDefinitions(2)) {
        if (!isMissionDefinitionEnabledAt(definition, evaluationTime)) continue

        const patternType = Number(definition.row[2])
        const matchesExistingMultiMission = context.isMulti === true
            && ACTIVE_DAILY_BATTLE_MISSION_IDS.has(definition.missionId)
            && patternType === MULTI_BATTLE_CLEAR_PATTERN_TYPE
            && matchesQuestRange(definition.row, context.questCategory, context.questId)
        const matchesScoreAttackMission = definition.missionId === SCORE_ATTACK_DAILY_MISSION_ID
            && patternType === SCORE_ATTACK_CLEAR_PATTERN_TYPE
            && matchesScoreAttackEvent(definition.row, context.questCategory, context.questId)
        const matchesAnyBattleMission = definition.missionId === ANY_BATTLE_DAILY_MISSION_ID
            && patternType === ANY_BATTLE_CLEAR_PATTERN_TYPE

        if (!matchesExistingMultiMission
            && !matchesScoreAttackMission
            && !matchesAnyBattleMission) continue

        incrementPlayerCategoryMissionSync(context.playerId, 2, definition.missionId, 1)
        matchedMissionIds.push(definition.missionId)
    }
    return matchedMissionIds
}
