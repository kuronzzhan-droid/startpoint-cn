import { getServerTime } from "../../utils"
import { mergeMissionSettlementResponse } from "./response"
import { settleMissionCategories, type MissionSettlementResult } from "./settlement"
import { getDegreeMissionIdsForConditionTypes } from "./computer-degree"

type ResponseRecord = Record<string, any>

/**
 * Settles title missions at an authoritative mutation point and merges newly
 * acquired titles into that same API response.  The client uses mission_info
 * together with degree_list to show the acquisition notification immediately.
 */
export function settleDegreeMissionResponse(
    playerId: number,
    viewerId: number,
    data: ResponseRecord,
    evaluationTime: Date = new Date(getServerTime() * 1000),
    conditionTypes?: readonly number[],
    characterIds?: readonly number[],
): MissionSettlementResult {
    const missionIds = conditionTypes === undefined
        ? undefined
        : getDegreeMissionIdsForConditionTypes(conditionTypes, characterIds)
    const settlement = settleMissionCategories(
        playerId,
        [{ category: 5, ...(missionIds === undefined ? {} : { missionIds }) }],
        evaluationTime,
    )
    mergeMissionSettlementResponse(data, settlement, viewerId)
    return settlement
}
