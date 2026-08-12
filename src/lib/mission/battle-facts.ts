import { recordMissionBattleResultSync } from "../../data/domains/mission_battle_facts"
import { incrementPlayerQuestMultiClearSync } from "../../data/domains/quest"
import { getDb } from "../../data/db"
import { getServerTime } from "../../utils"
import { trackCharacterClears } from "../quest/finish/character-clear-tracker"
import { trackLeaderPowerflip } from "../quest/finish/leader-powerflip-tracker"
import { trackPartyCoClears } from "../quest/finish/party-co-clear-tracker"
import { trackPowerflip } from "../quest/finish/powerflip-tracker"
import type { FinishContext } from "../quest/finish/types"
import { recordActiveMissionConditionalBattleFactsSync } from "./active-conditional-battle-facts"
import { recordActiveMissionLoadoutBattleFactsSync } from "./active-loadout-battle-facts"
import { recordDailyMissionBattleFacts } from "./daily-battle-facts"
import { recordEventMissionBattleFacts } from "./event-battle-facts"
import { recordPassMissionBattleFacts } from "./pass-battle-facts"

export interface MissionBattleFactResult {
    readonly dailyMissionIds: readonly number[]
    readonly eventMissionIds: readonly number[]
    readonly passMissionIds: readonly number[]
}

const EMPTY_FACTS: MissionBattleFactResult = Object.freeze({
    dailyMissionIds: Object.freeze([]),
    eventMissionIds: Object.freeze([]),
    passMissionIds: Object.freeze([]),
})

function recordSuccessfulBattleFacts(
    context: FinishContext,
    evaluationTime: Date,
): MissionBattleFactResult {
    const dailyMissionIds = recordDailyMissionBattleFacts(context, evaluationTime)
    const eventMissionIds = recordEventMissionBattleFacts(context, evaluationTime)
    const passMissionIds = recordPassMissionBattleFacts(context, evaluationTime)
    recordActiveMissionLoadoutBattleFactsSync(context)
    recordActiveMissionConditionalBattleFactsSync(context)
    if (context.isMulti === true) {
        incrementPlayerQuestMultiClearSync(context.playerId, context.questCategory, context.questId)
    }
    trackCharacterClears(context)
    trackLeaderPowerflip(context)
    trackPartyCoClears(context)
    trackPowerflip(context)
    return { dailyMissionIds, eventMissionIds, passMissionIds }
}

export function recordMissionBattleFacts(
    context: FinishContext,
    evaluationTime: Date = new Date(getServerTime() * 1000),
): MissionBattleFactResult {
    return getDb().transaction(() => {
        recordMissionBattleResultSync(context.playerId, {
            isMulti: context.isMulti === true,
            isHost: context.isMultiHost,
            accomplished: context.questAccomplished,
            clearRank: context.clearRank,
        })
        if (!context.questAccomplished) return EMPTY_FACTS
        return recordSuccessfulBattleFacts(context, evaluationTime)
    })()
}
