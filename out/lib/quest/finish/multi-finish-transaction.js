"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.settleMultiQuestFinishInTransaction = void 0;
const player_time_compat_1 = require("../../player-time-compat");
const battle_clock_compatibility_1 = require("../../battle-clock-compatibility");
const types_1 = require("../../types");
const player_operation_receipt_1 = require("../../../data/domains/player-operation-receipt");
const battle_settlement_ledger_1 = require("../../../data/domains/battle-settlement-ledger");
const quest_active_1 = require("../../../data/domains/quest_active");
const player_1 = require("../../../data/domains/player");
const quest_1 = require("../../../data/domains/quest");
const character_1 = require("../../character");
const quest_2 = require("../../quest");
const main_story_rewards_1 = require("../../main-story-rewards");
const stamina_1 = require("../../stamina");
const mana_1 = require("../../mana");
const utils_1 = require("../../../utils");
const mail_1 = require("../../../data/domains/mail");
const mission_1 = require("../../mission");
const battle_dimensions_1 = require("../../mission/battle-dimensions");
const battle_facts_1 = require("../../mission/battle-facts");
const steam_robot_challenge_1 = require("../../mission/steam-robot-challenge");
const active_reconciliation_1 = require("../../mission/active-reconciliation");
const content_snapshot_1 = require("../../../content/runtime/content-snapshot");
const recommended_party_history_1 = require("../recommended-party-history");
const game_logging_1 = require("../../game-logging");
const settlement_performance_1 = require("../../settlement-performance");
const rescue_fragment_reward_1 = require("../../../multi/rescue-fragment-reward");
const mode15_optional_1 = require("../../mode15-optional");
const multi_finish_identity_1 = require("./multi-finish-identity");
/** The registered command owns the encompassing SQLite transaction on both executors. */
function settleMultiQuestFinishInTransaction(args) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z;
    const { playerId, viewerId, body, questCategory, questId, questData, activeQuestData, allowFrozenSnapshot, playId, finishedAsHost, finishedAsRescueGuest, finishedAsRescueFragmentEligible, finishedAsNewbieRescueGuest, matePlayerResult, followInfo, evaluationTimeMs } = args;
    // The permanent cross-mode guard wins over retained room snapshots and
    // memory caches, including after the full response has been pruned.
    const replay = (0, battle_settlement_ledger_1.getBattleReplaySync)(playerId, "multi", playId);
    if (replay.kind !== "missing")
        return {
            response: replay.kind === "available" && (0, multi_finish_identity_1.isMultiFinishResponse)(replay.response)
                ? replay.response : null,
            applied: false,
        };
    if ((0, player_operation_receipt_1.getPlayerOperationReceiptSync)(playerId, "clock_migration.abort", playId) !== null) {
        return { response: null, applied: false };
    }
    if ((0, multi_finish_identity_1.multiFinishPlayId)(playId) === null || !activeQuestData.isMulti
        || activeQuestData.playId !== playId || body.play_id !== playId
        || Number(body.quest_id) !== Number(questId) || Number(body.category) !== Number(questCategory)
        || Number(activeQuestData.questId) !== Number(questId)
        || Number(activeQuestData.category) !== Number(questCategory)) {
        return { response: null, applied: false };
    }
    const persisted = (0, quest_active_1.getPlayerActiveQuestSync)(playerId);
    if (Number(questCategory) === types_1.QuestCategory.TOWER_DUNGEON_EVENT
        || Number(body.category) === types_1.QuestCategory.TOWER_DUNGEON_EVENT
        || Number(activeQuestData.category) === types_1.QuestCategory.TOWER_DUNGEON_EVENT
        || Number(persisted === null || persisted === void 0 ? void 0 : persisted.category) === types_1.QuestCategory.TOWER_DUNGEON_EVENT) {
        if ((persisted === null || persisted === void 0 ? void 0 : persisted.isMulti) === true && persisted.playId === playId) {
            (0, quest_active_1.deletePlayerActiveQuestIfPlayIdSync)(playerId, playId);
        }
        return { response: null, applied: false };
    }
    const persistentMatches = (persisted === null || persisted === void 0 ? void 0 : persisted.isMulti) === true && (0, battle_clock_compatibility_1.isSupportedBattleClockVersion)(persisted.clockVersion) && persisted.playId === playId
        && Number(persisted.questId) === Number(questId) && Number(persisted.category) === Number(questCategory);
    if (!allowFrozenSnapshot && !persistentMatches)
        return { response: null, applied: false };
    if (!persistentMatches && activeQuestData.clockVersion !== 1)
        return { response: null, applied: false };
    if (persistentMatches) {
        activeQuestData.startedAtMs = (_a = persisted.startedAtMs) !== null && _a !== void 0 ? _a : undefined;
        activeQuestData.clockVersion = persisted.clockVersion;
    }
    const player = (0, player_1.getPlayerSync)(playerId);
    if (player === null)
        throw new Error(`Multi finish player no longer exists: ${playerId}`);
    // calculate clear rank
    const clearTime = body.elapsed_time_ms || 0;
    const hasRankThresholds = questData.bRankTime > 0;
    const clearRank = hasRankThresholds ? (questData.sPlusRankTime >= clearTime ? 5
        : questData.sRankTime >= clearTime ? 4
            : questData.aRankTime >= clearTime ? 3
                : questData.bRankTime >= clearTime ? 2
                    : 1) : null;
    const beforeRankPoint = player.rankPoint;
    const displayMode15ManaAsFieldDrop = (0, mode15_optional_1.isMode15Quest)(questCategory, questId);
    const newRankPoint = beforeRankPoint + questData.rankPointReward;
    const manaObtained = questData.manaReward + (body.add_mana || 0);
    const newMana = (0, mana_1.calculateFreeManaGrant)(player, manaObtained).freeMana;
    let newBoostPoint = player.boostPoint - (activeQuestData.useBoostPoint ? 1 : 0);
    let newBossBoostPoint = player.bossBoostPoint - (activeQuestData.useBossBoostPoint ? 1 : 0);
    const useBoostPoint = (activeQuestData.useBoostPoint && (newBoostPoint >= 0)) || (activeQuestData.useBossBoostPoint && (newBossBoostPoint >= 0));
    // Refreshing Abyss progress is write-capable and belongs to this transaction.
    const questProgress = (0, quest_1.getPlayerSingleQuestProgressSync)(playerId, questCategory, questId);
    const isMainStory = questCategory === types_1.QuestCategory.MAIN || questCategory === types_1.QuestCategory.EX;
    const questPreviouslyCompleted = isMainStory ? questProgress !== null && questProgress.finished === true : questProgress !== null;
    const questAccomplished = body.is_accomplished;
    const leaderId = (_f = (_e = (_d = (((_b = body.statistics) === null || _b === void 0 ? void 0 : _b.party) || ((_c = body.quest_statistics) === null || _c === void 0 ? void 0 : _c.party))) === null || _d === void 0 ? void 0 : _d.characters) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.id;
    const eligibleRescueFragmentReward = (0, rescue_fragment_reward_1.getEligibleRescueFragmentReward)(questCategory, questId, questAccomplished, finishedAsRescueFragmentEligible);
    const bodyPartyStatistics = ((_g = body.statistics) === null || _g === void 0 ? void 0 : _g.party)
        || ((_h = body.quest_statistics) === null || _h === void 0 ? void 0 : _h.party)
        || { characters: [], unison_characters: [] };
    let clearReward = null;
    let sPlusClearReward = null;
    let rescueFragmentReward = null;
    let scoreRewardsResult;
    const oldRkDegree = (0, stamina_1.getRankDegree)(beforeRankPoint);
    const newDegreeId = (0, stamina_1.getRankDegree)(newRankPoint);
    const didLevelUp = newDegreeId > oldRkDegree;
    const playerData = player;
    if (questAccomplished) {
        if (questProgress !== null) {
            const updateData = {
                questId: questId,
                finished: true,
                hostFinished: questProgress.hostFinished || finishedAsHost,
                bestElapsedTimeMs: questProgress.bestElapsedTimeMs === undefined || questProgress.bestElapsedTimeMs === null ? clearTime : Math.min(clearTime, questProgress.bestElapsedTimeMs),
                highScore: questProgress.highScore === undefined ? (body.score || 0) : Math.max(body.score || 0, questProgress.highScore),
                leaderCharacterId: leaderId !== null && leaderId !== void 0 ? leaderId : null
            };
            if (clearRank !== null) {
                updateData.clearRank = questProgress.clearRank === undefined ? clearRank : Math.max(clearRank, questProgress.clearRank);
            }
            (0, quest_1.updatePlayerQuestProgressSync)(playerId, questCategory, updateData);
        }
        else {
            (0, quest_1.insertPlayerQuestProgressSync)(playerId, questCategory, {
                questId: questId,
                finished: true,
                hostFinished: finishedAsHost,
                bestElapsedTimeMs: clearTime,
                highScore: body.score || 0,
                clearRank: clearRank !== null && clearRank !== void 0 ? clearRank : 5,
                leaderCharacterId: leaderId !== null && leaderId !== void 0 ? leaderId : null
            });
        }
    }
    (0, player_1.updatePlayerSync)(Object.assign({ id: playerId, freeMana: newMana, rankPoint: newRankPoint, boostPoint: newBoostPoint, bossBoostPoint: newBossBoostPoint, totalManaObtained: ((_j = player.totalManaObtained) !== null && _j !== void 0 ? _j : 0) + manaObtained, maxComboAchieved: Math.max((_k = player.maxComboAchieved) !== null && _k !== void 0 ? _k : 0, (_m = (_l = body.statistics) === null || _l === void 0 ? void 0 : _l.max_combo_count) !== null && _m !== void 0 ? _m : 0) }, (didLevelUp ? { stamina: player.stamina + (0, stamina_1.getMaxStamina)(newDegreeId), staminaHealTime: new Date() } : {})));
    if ((0, player_1.adjustPlayerExpPoolSync)(playerId, questData.poolExpReward, 'multi_battle_base_reward') === null) {
        throw new Error(`Failed to grant multi battle EXP to player ${playerId}`);
    }
    clearReward = !questPreviouslyCompleted && (!isMainStory || questAccomplished) && questData.clearReward != null
        ? (0, quest_2.givePlayerRewardsSync)(playerId, (0, main_story_rewards_1.getMainStoryFirstClearRewards)(questCategory, questId, questData))
        : null;
    const isExpertSingleEvent = questCategory === types_1.QuestCategory.EXPERT_SINGLE_EVENT;
    const shouldGrantSPlusReward = isExpertSingleEvent
        ? (questProgress === null || questProgress === void 0 ? void 0 : questProgress.sPlusRewardReceived) !== true
        : (questProgress === null || questProgress === void 0 ? void 0 : questProgress.clearRank) !== 5;
    sPlusClearReward = (!isMainStory || questAccomplished) && (clearRank === 5) && shouldGrantSPlusReward && (questData.sPlusReward !== undefined)
        ? (0, quest_2.givePlayerRewardSync)(playerId, questData.sPlusReward)
        : null;
    if (isExpertSingleEvent && sPlusClearReward !== null) {
        (0, quest_1.updatePlayerQuestProgressSync)(playerId, questCategory, {
            questId,
            sPlusRewardReceived: true,
        });
        console.log(`[EXPERT_SINGLE_EVENT] SS reward granted: player=${playerId} quest=${questId} item=14040 count=3`);
    }
    if (didLevelUp) {
        playerData.stamina = playerData.stamina + (0, stamina_1.getMaxStamina)(newDegreeId);
        playerData.staminaHealTime = new Date();
    }
    scoreRewardsResult = (0, quest_2.givePlayerScoreRewardsSync)(playerId, questData.scoreRewardGroupId || 0, questData.scoreRewardGroup, useBoostPoint, questData.element, { questId, mode: "multi" });
    if (eligibleRescueFragmentReward !== null) {
        rescueFragmentReward = (0, quest_2.givePlayerRewardSync)(playerId, eligibleRescueFragmentReward);
        (0, game_logging_1.gameVerboseLog)(() => `[MULTI] rescue fragment granted: player=${playerId} quest=${questId} `
            + `item=${eligibleRescueFragmentReward.id} count=${eligibleRescueFragmentReward.count}`);
    }
    // Mode15 settlement writes the cross-event progress marker and extra
    // rewards. Keep it inside the same transaction as the ordinary multi
    // rewards so this path cannot reopen the main database without the
    // persistence owner.
    // 开荒编排 19（1104）：协力房主胜利结算时，房间里每有 1 名真人队友发 1 个紫色碎片，直接入背包。
    let hostRealMateReward = null;
    const hostRealMateCount = Math.max(0, Math.trunc(Number(args.hostRealMateCount) || 0));
    if (questAccomplished && finishedAsHost && hostRealMateCount > 0) {
        hostRealMateReward = (0, quest_2.givePlayerRewardSync)(playerId, { type: types_1.RewardType.ITEM, id: 49002, count: hostRealMateCount });
        (0, game_logging_1.gameVerboseLog)(() => `[MULTI] host mate fragment granted: player=${playerId} quest=${questId} count=${hostRealMateCount}`);
    }
    const mode15RewardsResult = (0, mode15_optional_1.settleMode15BattleSync)(playerId, questCategory, questId, questAccomplished, {
        rescue: !finishedAsHost,
        playedParty: {
            characterIds: (bodyPartyStatistics.characters || []).map((value) => { var _a; return (_a = value === null || value === void 0 ? void 0 : value.id) !== null && _a !== void 0 ? _a : null; }),
            unisonCharacterIds: (bodyPartyStatistics.unison_characters || []).map((value) => { var _a; return (_a = value === null || value === void 0 ? void 0 : value.id) !== null && _a !== void 0 ? _a : null; }),
            equipmentIds: (bodyPartyStatistics.equipments || []).map((value) => { var _a; return (_a = value === null || value === void 0 ? void 0 : value.id) !== null && _a !== void 0 ? _a : null; }),
            abilitySoulIds: [...(bodyPartyStatistics.ability_soul_ids || [])],
            evolutionImgLevels: (0, character_1.getCharactersEvolutionImgLevels)(playerId, (bodyPartyStatistics.characters || []).map((value) => { var _a; return (_a = value === null || value === void 0 ? void 0 : value.id) !== null && _a !== void 0 ? _a : null; })),
            unisonEvolutionImgLevels: (0, character_1.getCharactersEvolutionImgLevels)(playerId, (bodyPartyStatistics.unison_characters || []).map((value) => { var _a; return (_a = value === null || value === void 0 ? void 0 : value.id) !== null && _a !== void 0 ? _a : null; })),
        },
    });
    const settledClearReward = clearReward;
    const settledSPlusClearReward = sPlusClearReward;
    const settledRescueFragmentReward = rescueFragmentReward;
    const rescueFragmentAdditionalReward = (0, rescue_fragment_reward_1.getRescueFragmentAdditionalReward)(eligibleRescueFragmentReward);
    const partyCharacterIdsArray = [];
    for (const value of [...(bodyPartyStatistics.characters || []), ...(bodyPartyStatistics.unison_characters || [])]) {
        if (value !== null && value.id !== null && value.id !== undefined)
            partyCharacterIdsArray.push(value.id);
    }
    // Track mission progress (decoupled from core quest mechanics)
    const finishCtx = {
        playerId, questCategory, questId,
        questAccomplished,
        clearTime, clearRank,
        party: bodyPartyStatistics,
        statistics: body.statistics || body.quest_statistics || {},
        player,
        questPreviouslyCompleted,
        questProgress,
        partySlot: (_o = activeQuestData.partySlot) !== null && _o !== void 0 ? _o : player.partySlot,
        isMulti: true,
        isMultiHost: finishedAsHost,
    };
    const multiBattleParty = (0, mission_1.collectPartyCharacterIds)(finishCtx.party);
    const missionEvaluationTime = new Date(evaluationTimeMs);
    const missionBattleFacts = (0, battle_facts_1.recordMissionBattleFacts)(finishCtx, missionEvaluationTime);
    if (questData.fixedParty === undefined)
        (0, recommended_party_history_1.recordQuestRecommendedPartySafe)(finishCtx);
    const steamRobotMissionId = (0, steam_robot_challenge_1.trackSteamRobotChallengeMission)({
        playerId, questCategory, questId, questAccomplished, clearRank,
        statistics: finishCtx.statistics,
    });
    const rewardCharacterExpResult = (0, character_1.givePlayerCharactersExpSync)(playerId, partyCharacterIdsArray, questData.characterExpReward || 0, questData.fixedParty !== undefined);
    const ownContributionScore = Number(body.contribution_score) || 0;
    const highestContributionScore = Math.max(ownContributionScore, ...matePlayerResult.map(result => Number(result.contribution_score) || 0));
    const finishedAsMvp = Boolean((_p = finishCtx.statistics) === null || _p === void 0 ? void 0 : _p.is_mvp)
        || ownContributionScore >= highestContributionScore;
    (0, battle_dimensions_1.recordBattleMissionDimensions)(Object.assign(Object.assign({ type: "battle_finish", playerId,
        questCategory,
        questId, accomplished: questAccomplished, mode: "multi", role: finishedAsHost ? "host" : "guest", isRescue: finishedAsRescueGuest, isNewbieRescue: finishedAsNewbieRescueGuest, isMvp: questAccomplished && finishedAsMvp, clearRank, clearTimeMs: clearTime, score: Number(body.score) || 0 }, multiBattleParty), { statistics: (0, mission_1.summarizeBattleStatistics)(finishCtx.statistics) }));
    const characterList = [
        ...rewardCharacterExpResult.character_list,
        ...((settledClearReward === null || settledClearReward === void 0 ? void 0 : settledClearReward.character_list) || []),
        ...((settledSPlusClearReward === null || settledSPlusClearReward === void 0 ? void 0 : settledSPlusClearReward.character_list) || []),
        ...scoreRewardsResult.character_list,
        ...((mode15RewardsResult === null || mode15RewardsResult === void 0 ? void 0 : mode15RewardsResult.character_list) || []),
    ];
    const missionSettlement = (0, settlement_performance_1.measureSettlementPhase)("multi", "mission", () => {
        var _a, _b, _c;
        return ((0, mission_1.settleMissionCategories)(playerId, (0, battle_facts_1.buildBattleMissionSettlementScopes)(missionBattleFacts, Object.keys(Object.assign(Object.assign(Object.assign(Object.assign({}, ((_a = settledClearReward === null || settledClearReward === void 0 ? void 0 : settledClearReward.items) !== null && _a !== void 0 ? _a : {})), ((_b = settledSPlusClearReward === null || settledSPlusClearReward === void 0 ? void 0 : settledSPlusClearReward.items) !== null && _b !== void 0 ? _b : {})), scoreRewardsResult.items), ((_c = settledRescueFragmentReward === null || settledRescueFragmentReward === void 0 ? void 0 : settledRescueFragmentReward.items) !== null && _c !== void 0 ? _c : {}))).map(Number), steamRobotMissionId === null ? [] : [steamRobotMissionId], partyCharacterIdsArray), missionEvaluationTime));
    });
    const awakeMissionSettlement = (0, settlement_performance_1.measureSettlementPhase)("multi", "awake_mission", () => ((0, mission_1.settleAwakeMissionCandidates)(playerId, questAccomplished
        ? (0, mission_1.getAwakeBattleMissionIds)(partyCharacterIdsArray, missionBattleFacts.awakeMissionIds)
        : [], missionEvaluationTime)));
    const activeMissionSettlement = (0, settlement_performance_1.measureSettlementPhase)("multi", "active_mission", () => ((0, active_reconciliation_1.reconcileActiveMissionFacts)({
        playerId,
        repository: (0, content_snapshot_1.getContentSnapshot)().repository,
        now: missionEvaluationTime,
        patterns: (0, battle_facts_1.getBattleActiveMissionPatterns)(questCategory),
    })));
    const dataHeaders = (0, utils_1.generateDataHeaders)({ viewer_id: viewerId });
    const finalPlayerData = (0, player_1.getPlayerSync)(playerId);
    const responseData = {
        "user_info": {
            "free_mana": (_q = finalPlayerData === null || finalPlayerData === void 0 ? void 0 : finalPlayerData.freeMana) !== null && _q !== void 0 ? _q : newMana,
            "exp_pool": (_r = finalPlayerData === null || finalPlayerData === void 0 ? void 0 : finalPlayerData.expPool) !== null && _r !== void 0 ? _r : rewardCharacterExpResult.exp_pool,
            "exp_pooled_time": (0, player_time_compat_1.getPlayerClientExpTime)(playerData),
            "free_vmoney": (_s = finalPlayerData === null || finalPlayerData === void 0 ? void 0 : finalPlayerData.freeVmoney) !== null && _s !== void 0 ? _s : playerData.freeVmoney,
            "rank_point": newRankPoint,
            "degree_id": (_t = playerData.degreeId) !== null && _t !== void 0 ? _t : 1,
            "stamina": playerData.stamina,
            "stamina_heal_time": (0, utils_1.realToVirtual)(playerData.staminaHealTime),
            "boost_point": newBoostPoint,
            "boss_boost_point": newBossBoostPoint,
            "star_crumb": finalPlayerData === null || finalPlayerData === void 0 ? void 0 : finalPlayerData.starCrumb
        },
        "add_exp_list": rewardCharacterExpResult.add_exp_list,
        "character_list": characterList,
        "bond_token_status_list": rewardCharacterExpResult.bond_token_status_list,
        "rewards": {
            "overflow_pool_exp": 0,
            "converted_pool_exp": 0,
            "reward_pool_exp": questData.poolExpReward,
            // Keep the credited total unchanged, but expose Mode15's
            // fixed Mana through the native visible field-drop slot.
            "reward_mana": displayMode15ManaAsFieldDrop ? 0 : questData.manaReward,
            "field_mana": (body.add_mana || 0)
                + (displayMode15ManaAsFieldDrop ? questData.manaReward : 0)
        },
        "old_high_score": questProgress === null ? 0 : questProgress.highScore || 0,
        "joined_character_id_list": [
            ...((settledClearReward === null || settledClearReward === void 0 ? void 0 : settledClearReward.joined_character_id_list) || []),
            ...((settledSPlusClearReward === null || settledSPlusClearReward === void 0 ? void 0 : settledSPlusClearReward.joined_character_id_list) || []),
            ...scoreRewardsResult.joined_character_id_list,
            ...((settledRescueFragmentReward === null || settledRescueFragmentReward === void 0 ? void 0 : settledRescueFragmentReward.joined_character_id_list) || []),
            ...((mode15RewardsResult === null || mode15RewardsResult === void 0 ? void 0 : mode15RewardsResult.joined_character_id_list) || []),
        ],
        "before_rank_point": beforeRankPoint,
        "clear_rank": clearRank !== null && clearRank !== void 0 ? clearRank : 5,
        "drop_score_reward_ids": scoreRewardsResult.drop_score_reward_ids,
        "drop_rare_reward_ids": scoreRewardsResult.drop_rare_reward_ids,
        "drop_additional_reward_ids": [
            ...(rescueFragmentAdditionalReward === null
                ? []
                : [rescueFragmentAdditionalReward]),
            ...((_u = mode15RewardsResult === null || mode15RewardsResult === void 0 ? void 0 : mode15RewardsResult.mode15_additional_reward_ids) !== null && _u !== void 0 ? _u : []),
        ],
        "drop_periodic_reward_ids": [],
        "equipment_list": [
            ...scoreRewardsResult.equipment_list,
            ...((settledClearReward === null || settledClearReward === void 0 ? void 0 : settledClearReward.equipment_list) || []),
            ...((settledSPlusClearReward === null || settledSPlusClearReward === void 0 ? void 0 : settledSPlusClearReward.equipment_list) || []),
            ...((settledRescueFragmentReward === null || settledRescueFragmentReward === void 0 ? void 0 : settledRescueFragmentReward.equipment_list) || []),
            ...((mode15RewardsResult === null || mode15RewardsResult === void 0 ? void 0 : mode15RewardsResult.equipment_list) || [])
        ],
        "category_id": questCategory,
        // Do not attach the single-player Rush settlement payload to a
        // multiplayer finish response.  The client routes any
        // non-null rush_event through SingleBattleQuestFinishRushEventProcess;
        // the multiplayer payload is not that type and causes F1034
        // (TypeError #1034), most visibly on stage 15 full clear.
        "start_time": dataHeaders['servertime'],
        "is_multi": "multi",
        "quest_name": "",
        "item_list": Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, ((_v = settledClearReward === null || settledClearReward === void 0 ? void 0 : settledClearReward.items) !== null && _v !== void 0 ? _v : {})), ((_w = settledSPlusClearReward === null || settledSPlusClearReward === void 0 ? void 0 : settledSPlusClearReward.items) !== null && _w !== void 0 ? _w : {})), scoreRewardsResult.items), ((_x = settledRescueFragmentReward === null || settledRescueFragmentReward === void 0 ? void 0 : settledRescueFragmentReward.items) !== null && _x !== void 0 ? _x : {})), ((_y = mode15RewardsResult === null || mode15RewardsResult === void 0 ? void 0 : mode15RewardsResult.items) !== null && _y !== void 0 ? _y : {}), (hostRealMateReward === null ? {} : hostRealMateReward.items || {})),
        "presigned_quest_category": [],
        "mate_player_result": matePlayerResult,
        "follow_info": followInfo,
        "contribution_score": (_z = body.contribution_score) !== null && _z !== void 0 ? _z : 0,
        "host_finished": finishedAsHost,
        "aborted_play_id": null,
    };
    (0, mission_1.mergeMissionSettlementResponse)(responseData, missionSettlement, viewerId);
    // Awake settlement re-publishes completed special unlocks itself,
    // including already-persisted rows whose earlier response was lost.
    (0, mission_1.mergeMissionSettlementResponse)(responseData, awakeMissionSettlement, viewerId);
    if (activeMissionSettlement.length > 0) {
        responseData.active_mission_list = activeMissionSettlement;
    }
    responseData.mail_arrived = (0, mail_1.getPlayerMailCountSync)(playerId, true) > 0;
    const finishResponse = {
        "data_headers": dataHeaders,
        "data": responseData,
    };
    const settlement = (0, battle_settlement_ledger_1.insertBattleSettlementSync)(playerId, playId, "multi");
    (0, player_operation_receipt_1.insertPlayerOperationReceiptSync)({
        playerId, operation: multi_finish_identity_1.MULTI_FINISH_RECEIPT_OPERATION, requestKey: playId, response: finishResponse,
    }, settlement.settledAtMs);
    if (persistentMatches)
        (0, quest_active_1.deletePlayerActiveQuestIfPlayIdSync)(playerId, playId);
    return { response: finishResponse, applied: true };
}
exports.settleMultiQuestFinishInTransaction = settleMultiQuestFinishInTransaction;
