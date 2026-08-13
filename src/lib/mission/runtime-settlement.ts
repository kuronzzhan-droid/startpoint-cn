import { getContentSnapshot } from "../../content/runtime/content-snapshot"
import { getDb } from "../../data/db"
import type { ActiveMissionProgressDelta } from "./active-core"
import { reconcileActiveMissionFacts } from "./active-reconciliation"
import { settleMissionCategories, type MissionSettlementResult } from "./settlement"

export const BATTLE_SETTLEMENT_CATEGORIES = Object.freeze([1, 2, 3, 6, 7, 8, 10])

export interface BattleMissionRuntimeResult {
    readonly missionSettlement: MissionSettlementResult
    readonly activeMissionList: readonly ActiveMissionProgressDelta[]
}

export function settleBattleMissionRuntime(
    playerId: number,
    evaluationTime: Date,
): BattleMissionRuntimeResult {
    if (!(evaluationTime instanceof Date) || !Number.isFinite(evaluationTime.getTime())) {
        throw new TypeError("Invalid battle mission settlement time.")
    }
    return getDb().transaction(() => ({
        missionSettlement: settleMissionCategories(
            playerId,
            BATTLE_SETTLEMENT_CATEGORIES,
            evaluationTime,
        ),
        activeMissionList: reconcileActiveMissionFacts({
            playerId,
            repository: getContentSnapshot().repository,
            now: evaluationTime,
        }),
    }))()
}
