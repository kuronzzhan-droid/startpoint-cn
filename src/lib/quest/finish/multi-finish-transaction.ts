import { getPlayerClientExpTime } from "../../player-time-compat"
import { isSupportedBattleClockVersion } from "../../battle-clock-compatibility"
import type { MultiFinishBody } from "../../../multi/types"
import type { ActiveQuest } from "../../../routes/api/singleBattleQuest"
import type { BattleQuest, PlayerRewardResult } from "../../types"
import { QuestCategory } from "../../types"
import { getPlayerOperationReceiptSync, insertPlayerOperationReceiptSync } from "../../../data/domains/player-operation-receipt"
import { getBattleReplaySync, insertBattleSettlementSync } from "../../../data/domains/battle-settlement-ledger"
import { getPlayerActiveQuestSync, deletePlayerActiveQuestIfPlayIdSync } from "../../../data/domains/quest_active"
import { getPlayerSync, updatePlayerSync, adjustPlayerExpPoolSync } from "../../../data/domains/player"
import { getPlayerSingleQuestProgressSync, insertPlayerQuestProgressSync, updatePlayerQuestProgressSync } from "../../../data/domains/quest"
import { getCharactersEvolutionImgLevels, givePlayerCharactersExpSync } from "../../character"
import { givePlayerRewardSync, givePlayerScoreRewardsSync } from "../../quest"
import { getRankDegree, getMaxStamina } from "../../stamina"
import { calculateFreeManaGrant } from "../../mana"
import { getServerTime, generateDataHeaders, realToVirtual } from "../../../utils"
import { getPlayerMailCountSync } from "../../../data/domains/mail"
import { collectPartyCharacterIds, summarizeBattleStatistics,
    getAwakeBattleMissionIds, mergeMissionSettlementResponse, settleAwakeMissionCandidates,
    settleMissionCategories } from "../../mission"
import { recordBattleMissionDimensions } from "../../mission/battle-dimensions"
import { buildBattleMissionSettlementScopes, getBattleActiveMissionPatterns, recordMissionBattleFacts } from "../../mission/battle-facts"
import { trackSteamRobotChallengeMission } from "../../mission/steam-robot-challenge"
import { reconcileActiveMissionFacts } from "../../mission/active-reconciliation"
import { getContentSnapshot } from "../../../content/runtime/content-snapshot"
import { recordQuestRecommendedPartySafe } from "../recommended-party-history"
import type { FinishContext } from "./types"
import { gameVerboseLog } from "../../game-logging"
import { measureSettlementPhase } from "../../settlement-performance"
import { getEligibleRescueFragmentReward, getRescueFragmentAdditionalReward } from "../../../multi/rescue-fragment-reward"
import { isMode15Quest, settleMode15BattleSync } from "../../mode15-optional"
import { MULTI_FINISH_RECEIPT_OPERATION, isMultiFinishResponse, multiFinishPlayId } from "./multi-finish-identity"

export interface MultiFinishTransactionArgs {
    playerId: number
    viewerId: number
    body: MultiFinishBody
    questCategory: QuestCategory
    questId: number
    questData: BattleQuest
    activeQuestData: ActiveQuest
    /** A frozen registration can settle an older play without consuming a rematch. */
    allowFrozenSnapshot: boolean
    playId: string
    finishedAsHost: boolean
    finishedAsRescueGuest: boolean
    finishedAsRescueFragmentEligible: boolean
    finishedAsNewbieRescueGuest: boolean
    matePlayerResult: Array<Record<string, any>>
    followInfo: unknown[]
    evaluationTimeMs: number
}

export interface MultiFinishTransactionResult {
    response: { data_headers: Record<string, unknown>, data: Record<string, any> } | null
    applied: boolean
}

/** The registered command owns the encompassing SQLite transaction on both executors. */
export function settleMultiQuestFinishInTransaction(args: MultiFinishTransactionArgs): MultiFinishTransactionResult {
    const { playerId, viewerId, body, questCategory, questId, questData, activeQuestData,
        allowFrozenSnapshot, playId, finishedAsHost, finishedAsRescueGuest,
        finishedAsRescueFragmentEligible, finishedAsNewbieRescueGuest,
        matePlayerResult, followInfo, evaluationTimeMs } = args
    // The permanent cross-mode guard wins over retained room snapshots and
    // memory caches, including after the full response has been pruned.
    const replay = getBattleReplaySync(playerId, "multi", playId)
    if (replay.kind !== "missing") return {
        response: replay.kind === "available" && isMultiFinishResponse(replay.response)
            ? replay.response : null,
        applied: false,
    }
    if (getPlayerOperationReceiptSync(playerId, "clock_migration.abort", playId) !== null) {
        return { response: null, applied: false }
    }
    if (multiFinishPlayId(playId) === null || !activeQuestData.isMulti
        || activeQuestData.playId !== playId || body.play_id !== playId
        || Number(body.quest_id) !== Number(questId) || Number(body.category) !== Number(questCategory)
        || Number(activeQuestData.questId) !== Number(questId)
        || Number(activeQuestData.category) !== Number(questCategory)) {
        return { response: null, applied: false }
    }
    const persisted = getPlayerActiveQuestSync(playerId)
    const persistentMatches = persisted?.isMulti === true && isSupportedBattleClockVersion(persisted.clockVersion) && persisted.playId === playId
        && Number(persisted.questId) === Number(questId) && Number(persisted.category) === Number(questCategory)
    if (!allowFrozenSnapshot && !persistentMatches) return { response: null, applied: false }
    if (!persistentMatches && activeQuestData.clockVersion !== 1) return { response: null, applied: false }
    if (persistentMatches) {
        activeQuestData.startedAtMs = persisted!.startedAtMs ?? undefined
        activeQuestData.clockVersion = persisted!.clockVersion
    }
    const player = getPlayerSync(playerId)
    if (player === null) throw new Error(`Multi finish player no longer exists: ${playerId}`)
    // calculate clear rank
    const clearTime = (body as any).elapsed_time_ms || 0;
    const hasRankThresholds = questData.bRankTime > 0;
    const clearRank = hasRankThresholds ? (
        questData.sPlusRankTime >= clearTime ? 5
            : questData.sRankTime >= clearTime ? 4
                : questData.aRankTime >= clearTime ? 3
                    : questData.bRankTime >= clearTime ? 2
                        : 1
    ) : null;

    const beforeRankPoint = player.rankPoint;
    const displayMode15ManaAsFieldDrop = isMode15Quest(questCategory, questId);
    const newRankPoint = beforeRankPoint + questData.rankPointReward;
    const manaObtained = questData.manaReward + ((body as any).add_mana || 0);
    const newMana = calculateFreeManaGrant(player, manaObtained).freeMana;
    let newBoostPoint = player.boostPoint - (activeQuestData.useBoostPoint ? 1 : 0);
    let newBossBoostPoint = player.bossBoostPoint - (activeQuestData.useBossBoostPoint ? 1 : 0);
    const useBoostPoint = (activeQuestData.useBoostPoint && (newBoostPoint >= 0)) || (activeQuestData.useBossBoostPoint && (newBossBoostPoint >= 0));

    // Refreshing Abyss progress is write-capable and belongs to this transaction.
    const questProgress = getPlayerSingleQuestProgressSync(playerId, questCategory, questId);
    const questPreviouslyCompleted = questProgress !== null;
    const questAccomplished = (body as any).is_accomplished;
    const leaderId = ((body as any).statistics?.party || (body as any).quest_statistics?.party)?.characters?.[0]?.id
    const eligibleRescueFragmentReward = getEligibleRescueFragmentReward(
        questCategory,
        questId,
        questAccomplished,
        finishedAsRescueFragmentEligible,
    );
    const bodyPartyStatistics = (body as any).statistics?.party
        || body.quest_statistics?.party
        || { characters: [], unison_characters: [] };

    let clearReward: PlayerRewardResult | null = null;
    let sPlusClearReward: PlayerRewardResult | null = null;
    let rescueFragmentReward: PlayerRewardResult | null = null;
    let scoreRewardsResult!: ReturnType<typeof givePlayerScoreRewardsSync>;
    const oldRkDegree = getRankDegree(beforeRankPoint);
    const newDegreeId = getRankDegree(newRankPoint);
    const didLevelUp = newDegreeId > oldRkDegree;
    const playerData = player;
    if (questAccomplished) {
        if (questPreviouslyCompleted) {
            const updateData: any = {
                questId: questId,
                finished: true,
                hostFinished: questProgress.hostFinished || finishedAsHost,
                bestElapsedTimeMs: questProgress.bestElapsedTimeMs === undefined || questProgress.bestElapsedTimeMs === null ? clearTime : Math.min(clearTime, questProgress.bestElapsedTimeMs),
                highScore: questProgress.highScore === undefined ? ((body as any).score || 0) : Math.max((body as any).score || 0, questProgress.highScore),
                leaderCharacterId: leaderId ?? null
            };
            if (clearRank !== null) {
                updateData.clearRank = questProgress.clearRank === undefined ? clearRank : Math.max(clearRank, questProgress.clearRank);
            }
            updatePlayerQuestProgressSync(playerId, questCategory, updateData);
        } else {
            insertPlayerQuestProgressSync(playerId, questCategory, {
                questId: questId,
                finished: true,
                hostFinished: finishedAsHost,
                bestElapsedTimeMs: clearTime,
                highScore: (body as any).score || 0,
                clearRank: clearRank ?? 5,
                leaderCharacterId: leaderId ?? null
            });
        }
    }

    updatePlayerSync({
        id: playerId,
        freeMana: newMana,
        rankPoint: newRankPoint,
        boostPoint: newBoostPoint,
        bossBoostPoint: newBossBoostPoint,
        totalManaObtained: (player.totalManaObtained ?? 0) + manaObtained,
        maxComboAchieved: Math.max(player.maxComboAchieved ?? 0, (body as any).statistics?.max_combo_count ?? 0),
        ...(didLevelUp ? { stamina: player.stamina + getMaxStamina(newDegreeId), staminaHealTime: new Date() } : {}),
    });
    if (adjustPlayerExpPoolSync(playerId, questData.poolExpReward, 'multi_battle_base_reward') === null) {
        throw new Error(`Failed to grant multi battle EXP to player ${playerId}`);
    }
    clearReward = !questPreviouslyCompleted && (questData as any).clearReward != null ? givePlayerRewardSync(playerId, (questData as any).clearReward) : null;
    const isExpertSingleEvent = questCategory === QuestCategory.EXPERT_SINGLE_EVENT;
    const shouldGrantSPlusReward = isExpertSingleEvent
        ? questProgress?.sPlusRewardReceived !== true
        : questProgress?.clearRank !== 5;
    sPlusClearReward = (clearRank === 5) && shouldGrantSPlusReward && ((questData as any).sPlusReward !== undefined)
        ? givePlayerRewardSync(playerId, (questData as any).sPlusReward)
        : null;
    if (isExpertSingleEvent && sPlusClearReward !== null) {
        updatePlayerQuestProgressSync(playerId, questCategory, {
            questId,
            sPlusRewardReceived: true,
        });
        console.log(`[EXPERT_SINGLE_EVENT] SS reward granted: player=${playerId} quest=${questId} item=14040 count=3`);
    }
    if (didLevelUp) {
        playerData.stamina = playerData.stamina + getMaxStamina(newDegreeId);
        playerData.staminaHealTime = new Date();
    }

    scoreRewardsResult = givePlayerScoreRewardsSync(
        playerId,
        (questData as any).scoreRewardGroupId || 0,
        (questData as any).scoreRewardGroup,
        useBoostPoint,
        (questData as any).element,
        { questId, mode: "multi" },
    );
    if (eligibleRescueFragmentReward !== null) {
        rescueFragmentReward = givePlayerRewardSync(playerId, eligibleRescueFragmentReward)
        gameVerboseLog(() =>
            `[MULTI] rescue fragment granted: player=${playerId} quest=${questId} `
            + `item=${(eligibleRescueFragmentReward as any).id} count=${(eligibleRescueFragmentReward as any).count}`
        )
    }
    // Mode15 settlement writes the cross-event progress marker and extra
    // rewards. Keep it inside the same transaction as the ordinary multi
    // rewards so this path cannot reopen the main database without the
    // persistence owner.
    const mode15RewardsResult = settleMode15BattleSync(
        playerId,
        questCategory,
        questId,
        questAccomplished,
        {
            rescue: !finishedAsHost,
            playedParty: {
                characterIds: (bodyPartyStatistics.characters || []).map((value: any) => value?.id ?? null),
                unisonCharacterIds: (bodyPartyStatistics.unison_characters || []).map((value: any) => value?.id ?? null),
                equipmentIds: (bodyPartyStatistics.equipments || []).map((value: any) => value?.id ?? null),
                abilitySoulIds: [...(bodyPartyStatistics.ability_soul_ids || [])],
                evolutionImgLevels: getCharactersEvolutionImgLevels(
                    playerId,
                    (bodyPartyStatistics.characters || []).map((value: any) => value?.id ?? null),
                ),
                unisonEvolutionImgLevels: getCharactersEvolutionImgLevels(
                    playerId,
                    (bodyPartyStatistics.unison_characters || []).map((value: any) => value?.id ?? null),
                ),
            },
        },
    );
    const settledClearReward = clearReward as PlayerRewardResult | null;
    const settledSPlusClearReward = sPlusClearReward as PlayerRewardResult | null;
    const settledRescueFragmentReward = rescueFragmentReward as PlayerRewardResult | null;
    const rescueFragmentAdditionalReward = getRescueFragmentAdditionalReward(
        eligibleRescueFragmentReward,
    );

    const partyCharacterIdsArray: number[] = [];
    for (const value of [...(bodyPartyStatistics.characters || []), ...(bodyPartyStatistics.unison_characters || [])]) {
        if (value !== null && (value as any).id !== null && (value as any).id !== undefined) partyCharacterIdsArray.push((value as any).id);
    }

    // Track mission progress (decoupled from core quest mechanics)
    const finishCtx: FinishContext = {
        playerId, questCategory, questId,
        questAccomplished,
        clearTime, clearRank,
        party: bodyPartyStatistics as any,
        statistics: (body as any).statistics || (body as any).quest_statistics || {},
        player,
        questPreviouslyCompleted,
        questProgress,
        partySlot: activeQuestData.partySlot ?? player.partySlot,
        isMulti: true,
        isMultiHost: finishedAsHost,
    }
    const multiBattleParty = collectPartyCharacterIds(finishCtx.party)
    const missionEvaluationTime = new Date(evaluationTimeMs);
    const missionBattleFacts = recordMissionBattleFacts(finishCtx, missionEvaluationTime);
    if (questData.fixedParty === undefined) recordQuestRecommendedPartySafe(finishCtx);
    const steamRobotMissionId = trackSteamRobotChallengeMission({
        playerId, questCategory, questId, questAccomplished, clearRank,
        statistics: finishCtx.statistics,
    });
    const rewardCharacterExpResult = givePlayerCharactersExpSync(
        playerId, partyCharacterIdsArray, questData.characterExpReward || 0,
        questData.fixedParty !== undefined,
    );
    const ownContributionScore = Number((body as any).contribution_score) || 0
    const highestContributionScore = Math.max(
        ownContributionScore,
        ...matePlayerResult.map(result => Number(result.contribution_score) || 0),
    )
    const finishedAsMvp = Boolean(finishCtx.statistics?.is_mvp)
        || ownContributionScore >= highestContributionScore
    recordBattleMissionDimensions({
        type: "battle_finish",
        playerId,
        questCategory,
        questId,
        accomplished: questAccomplished,
        mode: "multi",
        role: finishedAsHost ? "host" : "guest",
        isRescue: finishedAsRescueGuest,
        isNewbieRescue: finishedAsNewbieRescueGuest,
        isMvp: questAccomplished && finishedAsMvp,
        clearRank,
        clearTimeMs: clearTime,
        score: Number((body as any).score) || 0,
        ...multiBattleParty,
        statistics: summarizeBattleStatistics(finishCtx.statistics),
    })
    const characterList = [
        ...rewardCharacterExpResult.character_list as unknown as Record<string, unknown>[],
        ...((settledClearReward?.character_list || []) as Record<string, unknown>[]),
        ...((settledSPlusClearReward?.character_list || []) as Record<string, unknown>[]),
        ...(scoreRewardsResult.character_list as Record<string, unknown>[]),
        ...((mode15RewardsResult?.character_list || []) as Record<string, unknown>[]),
    ];
    const missionSettlement = measureSettlementPhase("multi", "mission", () => (
        settleMissionCategories(
            playerId,
            buildBattleMissionSettlementScopes(
                missionBattleFacts,
                Object.keys({
                    ...(settledClearReward?.items ?? {}),
                    ...(settledSPlusClearReward?.items ?? {}),
                    ...scoreRewardsResult.items,
                    ...(settledRescueFragmentReward?.items ?? {}),
                }).map(Number),
                steamRobotMissionId === null ? [] : [steamRobotMissionId],
                partyCharacterIdsArray,
            ),
            missionEvaluationTime,
        )
    ))
    const awakeMissionSettlement = measureSettlementPhase("multi", "awake_mission", () => (
        settleAwakeMissionCandidates(
            playerId,
            questAccomplished
                ? getAwakeBattleMissionIds(
                    partyCharacterIdsArray,
                    missionBattleFacts.awakeMissionIds,
                )
                : [],
            missionEvaluationTime,
        )
    ))
    const activeMissionSettlement = measureSettlementPhase("multi", "active_mission", () => (
        reconcileActiveMissionFacts({
            playerId,
            repository: getContentSnapshot().repository,
            now: missionEvaluationTime,
            patterns: getBattleActiveMissionPatterns(questCategory),
        })
    ))

    const dataHeaders = generateDataHeaders({ viewer_id: viewerId });
    const finalPlayerData = getPlayerSync(playerId);
    const responseData: Record<string, any> = {
            "user_info": {
                "free_mana": finalPlayerData?.freeMana ?? newMana,
                "exp_pool": finalPlayerData?.expPool ?? rewardCharacterExpResult.exp_pool,
                "exp_pooled_time": getPlayerClientExpTime(playerData),
                "free_vmoney": finalPlayerData?.freeVmoney ?? playerData.freeVmoney,
                "rank_point": newRankPoint,
                "degree_id": playerData.degreeId ?? 1,
                "stamina": playerData.stamina,
                "stamina_heal_time": realToVirtual(playerData.staminaHealTime),
                "boost_point": newBoostPoint,
                "boss_boost_point": newBossBoostPoint
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
                "field_mana": ((body as any).add_mana || 0)
                    + (displayMode15ManaAsFieldDrop ? questData.manaReward : 0)
            },
            "old_high_score": questProgress === null ? 0 : questProgress.highScore || 0,
            "joined_character_id_list": [
                ...(settledClearReward?.joined_character_id_list || []),
                ...(settledSPlusClearReward?.joined_character_id_list || []),
                ...scoreRewardsResult.joined_character_id_list,
                ...(settledRescueFragmentReward?.joined_character_id_list || []),
                ...(mode15RewardsResult?.joined_character_id_list || []),
            ],
            "before_rank_point": beforeRankPoint,
            "clear_rank": clearRank ?? 5,
            "drop_score_reward_ids": scoreRewardsResult.drop_score_reward_ids,
            "drop_rare_reward_ids": scoreRewardsResult.drop_rare_reward_ids,
            "drop_additional_reward_ids": [
                ...(rescueFragmentAdditionalReward === null
                    ? []
                    : [rescueFragmentAdditionalReward]),
                ...(mode15RewardsResult?.mode15_additional_reward_ids ?? []),
            ],
            "drop_periodic_reward_ids": [],
            "equipment_list": [
                ...scoreRewardsResult.equipment_list,
                ...(settledClearReward?.equipment_list || []),
                ...(settledSPlusClearReward?.equipment_list || []),
                ...(settledRescueFragmentReward?.equipment_list || []),
                ...(mode15RewardsResult?.equipment_list || [])
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
            "item_list": {
                ...(settledClearReward?.items ?? {}),
                ...(settledSPlusClearReward?.items ?? {}),
                ...scoreRewardsResult.items,
                ...(settledRescueFragmentReward?.items ?? {}),
                ...(mode15RewardsResult?.items ?? {}),
            },
            "presigned_quest_category": [],
            "mate_player_result": matePlayerResult,
            "follow_info": followInfo,
            "contribution_score": (body as any).contribution_score ?? 0,
            "host_finished": finishedAsHost,
            "aborted_play_id": null,
    }
    mergeMissionSettlementResponse(responseData, missionSettlement, viewerId)
    // Awake settlement re-publishes completed special unlocks itself,
    // including already-persisted rows whose earlier response was lost.
    mergeMissionSettlementResponse(responseData, awakeMissionSettlement, viewerId)
    if (activeMissionSettlement.length > 0) {
        responseData.active_mission_list = activeMissionSettlement
    }
    responseData.mail_arrived = getPlayerMailCountSync(playerId, true) > 0
    const finishResponse = {
        "data_headers": dataHeaders,
        "data": responseData,
    };
    const settlement = insertBattleSettlementSync(playerId, playId, "multi");
    insertPlayerOperationReceiptSync({
        playerId, operation: MULTI_FINISH_RECEIPT_OPERATION, requestKey: playId, response: finishResponse,
    }, settlement.settledAtMs);
    if (persistentMatches) deletePlayerActiveQuestIfPlayIdSync(playerId, playId);
    return { response: finishResponse, applied: true };
}
