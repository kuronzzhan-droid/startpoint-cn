import { registerWriterCommand } from "./command-registry"
import { getServerDate } from "../../utils"
import {
    MISSION_SETTLE_CATEGORIES,
    MULTI_CLEANUP_ACTIVE_QUEST,
    MULTI_RECORD_BATTLE_FACTS,
    MULTI_SETTLE_FINISH,
    SINGLE_REFRESH_QUEST_PROGRESS,
    SINGLE_SETTLE_FINISH,
    type MissionSettleCategoriesArgs,
    type MultiCleanupActiveQuestArgs,
    type MultiRecordBattleFactsArgs,
    type MultiRecordBattleFactsResult,
    type MultiSettleFinishArgs,
    type MultiSettleFinishResult,
    type SingleRefreshQuestProgressArgs,
    type SingleRefreshQuestProgressResult,
    type SingleSettleFinishArgs,
    type SingleSettleFinishResult,
} from "./command-names"
import { settleMissionCategories, type MissionSettlementResult } from "../mission/settlement"
import { getPlayerSingleQuestProgressSync } from "../../data/domains/quest"
import { deletePlayerActiveQuestIfPlayIdSync } from "../../data/domains/quest_active"
import { getFinishReceiptSync, recordFinishReceiptSync } from "../../data/domains/finish-receipt"
import { recordMissionBattleFacts } from "../mission/battle-facts"
import { trackSteamRobotChallengeMission } from "../mission/steam-robot-challenge"
import { recordQuestRecommendedPartySafe } from "../quest/recommended-party-history"
import { givePlayerCharactersExpSync } from "../character"
import { settleSingleQuestFinishInTransaction } from "../quest/finish/single-finish-transaction"
import { settleMultiQuestFinishInTransaction } from "../quest/finish/multi-finish-transaction"
import { runPersistenceTransactionSync } from "../persistence-coordinator"

/**
 * Domain command implementations.
 *
 * This module is the single place that binds stable command names to domain
 * code. It must be imported by every process that executes commands: the main
 * process (in-process fallback and rollback mode) and the writer worker. The
 * import is intentionally side-effect only.
 *
 * Adding a domain here means the identical function is used by both execution
 * paths, which is what makes the `CN_WRITER_THREAD` switch behaviour-neutral.
 */

registerWriterCommand<MissionSettleCategoriesArgs, MissionSettlementResult>(
    MISSION_SETTLE_CATEGORIES,
    args => settleMissionCategories(
        args.playerId,
        args.categories,
        getServerDate(),
    ),
)

registerWriterCommand<SingleRefreshQuestProgressArgs, SingleRefreshQuestProgressResult>(
    SINGLE_REFRESH_QUEST_PROGRESS,
    args => runPersistenceTransactionSync(
        { domain: "single-quest", playerId: args.playerId, operation: "progress_refresh" },
        () => getPlayerSingleQuestProgressSync(args.playerId, args.section, args.questId),
    ),
)

registerWriterCommand<MultiCleanupActiveQuestArgs, boolean>(
    MULTI_CLEANUP_ACTIVE_QUEST,
    args => runPersistenceTransactionSync(
        { domain: "multi-settlement", playerId: args.playerId, operation: "active_quest_cleanup" },
        () => {
            // Only fill in a receipt the reward transaction created.
            if (args.receipt && getFinishReceiptSync(args.playerId, "multi", args.receipt.playId) !== null) {
                recordFinishReceiptSync(args.playerId, "multi", args.receipt.playId, args.receipt.response)
            }
            return deletePlayerActiveQuestIfPlayIdSync(
                args.playerId,
                args.expectedPlayId,
            )
        },
    ),
)

registerWriterCommand<MultiRecordBattleFactsArgs, MultiRecordBattleFactsResult>(
    MULTI_RECORD_BATTLE_FACTS,
    args => runPersistenceTransactionSync(
        { domain: "multi-settlement", playerId: args.finishCtx.playerId, operation: "facts_transaction" },
        () => {
            const missionBattleFacts = recordMissionBattleFacts(
                args.finishCtx,
                getServerDate(),
            )
            if (!args.fixedParty) {
                recordQuestRecommendedPartySafe(args.finishCtx)
            }
            const steamRobotMissionId = trackSteamRobotChallengeMission({
                playerId: args.finishCtx.playerId,
                questCategory: args.finishCtx.questCategory,
                questId: args.finishCtx.questId,
                questAccomplished: args.finishCtx.questAccomplished,
                clearRank: args.finishCtx.clearRank,
                statistics: args.finishCtx.statistics,
            })
            if (steamRobotMissionId !== null) {
                console.log(
                    `[MISSION] steam robot challenge cleared: player=${args.finishCtx.playerId}`
                    + ` quest=${args.finishCtx.questId} mission=${steamRobotMissionId}`,
                )
            }
            const rewardCharacterExpResult = givePlayerCharactersExpSync(
                args.finishCtx.playerId,
                args.partyCharacterIdsArray,
                args.characterExpReward,
                args.fixedParty,
            )
            return { missionBattleFacts, steamRobotMissionId, rewardCharacterExpResult }
        },
    ),
)

registerWriterCommand<SingleSettleFinishArgs, SingleSettleFinishResult>(
    SINGLE_SETTLE_FINISH,
    args => runPersistenceTransactionSync(
        { domain: "single-quest", playerId: args.playerId, operation: "finish" },
        () => settleSingleQuestFinishInTransaction(args),
    ),
)

registerWriterCommand<MultiSettleFinishArgs, MultiSettleFinishResult>(
    MULTI_SETTLE_FINISH,
    args => runPersistenceTransactionSync(
        { domain: "multi-settlement", playerId: args.playerId, operation: "finish" },
        () => settleMultiQuestFinishInTransaction({ ...args, evaluationTimeMs: getServerDate().getTime() }),
    ),
)
