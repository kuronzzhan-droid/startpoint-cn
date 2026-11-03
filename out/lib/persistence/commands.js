"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const command_registry_1 = require("./command-registry");
const utils_1 = require("../../utils");
const command_names_1 = require("./command-names");
const settlement_1 = require("../mission/settlement");
const quest_1 = require("../../data/domains/quest");
const quest_active_1 = require("../../data/domains/quest_active");
const battle_facts_1 = require("../mission/battle-facts");
const steam_robot_challenge_1 = require("../mission/steam-robot-challenge");
const recommended_party_history_1 = require("../quest/recommended-party-history");
const character_1 = require("../character");
const single_finish_transaction_1 = require("../quest/finish/single-finish-transaction");
const multi_finish_transaction_1 = require("../quest/finish/multi-finish-transaction");
const persistence_coordinator_1 = require("../persistence-coordinator");
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
(0, command_registry_1.registerWriterCommand)(command_names_1.MISSION_SETTLE_CATEGORIES, args => (0, settlement_1.settleMissionCategories)(args.playerId, args.categories, (0, utils_1.getServerDate)()));
(0, command_registry_1.registerWriterCommand)(command_names_1.SINGLE_REFRESH_QUEST_PROGRESS, args => (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "single-quest", playerId: args.playerId, operation: "progress_refresh" }, () => (0, quest_1.getPlayerSingleQuestProgressSync)(args.playerId, args.section, args.questId)));
(0, command_registry_1.registerWriterCommand)(command_names_1.MULTI_CLEANUP_ACTIVE_QUEST, args => (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "multi-settlement", playerId: args.playerId, operation: "active_quest_cleanup" }, () => (0, quest_active_1.deletePlayerActiveQuestIfPlayIdSync)(args.playerId, args.expectedPlayId)));
(0, command_registry_1.registerWriterCommand)(command_names_1.MULTI_RECORD_BATTLE_FACTS, args => (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "multi-settlement", playerId: args.finishCtx.playerId, operation: "facts_transaction" }, () => {
    const missionBattleFacts = (0, battle_facts_1.recordMissionBattleFacts)(args.finishCtx, (0, utils_1.getServerDate)());
    if (!args.fixedParty) {
        (0, recommended_party_history_1.recordQuestRecommendedPartySafe)(args.finishCtx);
    }
    const steamRobotMissionId = (0, steam_robot_challenge_1.trackSteamRobotChallengeMission)({
        playerId: args.finishCtx.playerId,
        questCategory: args.finishCtx.questCategory,
        questId: args.finishCtx.questId,
        questAccomplished: args.finishCtx.questAccomplished,
        clearRank: args.finishCtx.clearRank,
        statistics: args.finishCtx.statistics,
    });
    if (steamRobotMissionId !== null) {
        console.log(`[MISSION] steam robot challenge cleared: player=${args.finishCtx.playerId}`
            + ` quest=${args.finishCtx.questId} mission=${steamRobotMissionId}`);
    }
    const rewardCharacterExpResult = (0, character_1.givePlayerCharactersExpSync)(args.finishCtx.playerId, args.partyCharacterIdsArray, args.characterExpReward, args.fixedParty);
    return { missionBattleFacts, steamRobotMissionId, rewardCharacterExpResult };
}));
(0, command_registry_1.registerWriterCommand)(command_names_1.SINGLE_SETTLE_FINISH, args => (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "single-quest", playerId: args.playerId, operation: "finish" }, () => (0, single_finish_transaction_1.settleSingleQuestFinishInTransaction)(args)));
(0, command_registry_1.registerWriterCommand)(command_names_1.MULTI_SETTLE_FINISH, args => (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "multi-settlement", playerId: args.playerId, operation: "finish" }, () => (0, multi_finish_transaction_1.settleMultiQuestFinishInTransaction)(Object.assign(Object.assign({}, args), { evaluationTimeMs: (0, utils_1.getServerDate)().getTime() }))));
