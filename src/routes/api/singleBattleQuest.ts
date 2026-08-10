import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { deletePlayerActiveQuestSync, getPlayerActiveQuestSync, insertPlayerActiveQuestSync, updatePlayerActiveQuestContinueCountSync } from "../../data/domains/quest_active"
import { deletePlayerRushEventPlayedPartyListSync, getPlayerRushEventPlayedPartiesSync, getPlayerRushEventSync, insertPlayerRushEventClearedFolderSync, insertPlayerRushEventPlayedPartySync, updatePlayerRushEventSync } from "../../data/domains/rushEvent"
import { adjustPlayerExpPoolSync, getPlayerDailyChallengePointListSync, getPlayerSync, updatePlayerDailyChallengePointSync, updatePlayerSync } from "../../data/domains/player"
import { getPlayerItemSync, givePlayerItemSync, updatePlayerItemSync } from "../../data/domains/item"
import { getPlayerSingleQuestProgressSync, insertPlayerQuestProgressSync, updatePlayerQuestProgressSync } from "../../data/domains/quest"
import { repairUnisonUnlockProgressSync } from "../../lib/validate/unison-unlock"
import { getSession } from "../../data/domains/session"
import { getDb } from "../../data/db"
import { incrementPlayerCharacterClearSync } from "../../data/domains/character_clear"
import { updatePlayerEquipmentSync } from "../../data/domains/equipment"
import { getPlayerCarnivalEventRecordsSync, migrateCarnivalEventFolderRecordsSync, upsertPlayerCarnivalEventRecordSync } from "../../data/domains/carnivalEvent"
import { getQuestFromCategorySync, getRushEventFolderClearRewards } from "../../lib/assets";
import { getCharactersEvolutionImgLevels, givePlayerCharactersExpSync } from "../../lib/character";
import { givePlayerRewardsSync, givePlayerRewardSync, givePlayerScoreRewardsSync } from "../../lib/quest";
import { BattleQuest, EquipmentItemReward, PlayerRewardResult, QuestCategory } from "../../lib/types";
import { generateDataHeaders, getServerTime, realToVirtual } from "../../utils";
import { getRushEventFolderMaxRounds } from "./rushEvent";
import { PartyCategory, RushEventBattleType, UserRushEventPlayedParty } from "../../data/types";
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { computeRealTimeStamina, getRankDegree, getMaxStamina } from "../../lib/stamina";
import { getStaminaCost } from "../../lib/stamina-cost";
import { handleCarnivalEventFinish } from "../../lib/quest/finish/carnival-handler";
import { grantCarnivalTotalScoreRewardsSync } from "../../lib/quest/finish/carnival-reward-handler";
import { handleRushEventFinish } from "../../lib/quest/finish/rush-handler";
import { handleRoguePerRoundDrops } from "../../lib/quest/finish/rogue-drops";
import { handleRaidEventFinish } from "../../lib/quest/finish/raid-handler";
import { calculateClearRank } from "../../lib/quest/finish/quest-calc";
import { validateSessionAndPlayer } from "../../lib/quest/finish/session-validator";
import { resolveActiveQuest } from "../../lib/quest/finish/active-quest-resolver";
import { handleDailyChallengePoint } from "../../lib/quest/finish/challenge-point";
import {
    calculateScoreAttackClearRank,
    collectScoreAttackMainCharacterIds,
    resolveNewScoreAttackBorderRewards,
    resolveScoreAttackBorderTiers,
    ScoreAttackBorderTier,
} from "../../lib/quest/finish/score-attack-handler";
import { collectPartyCharacterIds, recordBattleMissionDimensionsSafe, summarizeBattleStatistics } from "../../lib/mission"
import { getSteamRobotMissionClientChecks, trackSteamRobotChallengeMission } from "../../lib/mission/steam-robot-challenge"
import { reconcileAwakeUnlockCharacterList } from "../../lib/mission"
import {
    getAwakeBattleMissionIds,
    mergeMissionSettlementResponse,
    settleAwakeMissionCandidates,
    settleMissionCategories,
} from "../../lib/mission"
import type { MissionSettlementResult } from "../../lib/mission"
import {
    buildBattleMissionSettlementScopes,
    getBattleActiveMissionPatterns,
    recordMissionBattleFacts,
} from "../../lib/mission/battle-facts"
import { recordActiveMissionQuestChallengeFactSync } from "../../lib/mission/active-entry-facts"
import { reconcileActiveMissionFacts } from "../../lib/mission/active-reconciliation"
import { getContentSnapshot } from "../../content/runtime/content-snapshot"
import { getPlayerMailCountSync } from "../../data/domains/mail"
import type { FinishContext } from "../../lib/quest/finish/types";
import { readFileSync, existsSync } from "fs";
import path from "path";
import questEntryCosts from "../../../assets/quest_entry_costs.json";
import scoreAttackBorderRewards from "../../../assets/score_attack_border_reward.json";
import eventChallengePointMap from "../../../assets/event_challenge_point_map.json";
import { gameVerboseLog } from "../../lib/game-logging";
import { measureSettlementPhase } from "../../lib/settlement-performance";
import {
    buildFinishResponseCacheKey,
    cacheFinishResponse,
    getCachedFinishResponse,
} from "../../lib/finish-response-cache";

// Load carnival quest score data
let carnivalScoreLookup: Record<string, { difficulty_score: number, time_limit_ms: number, folder_id: number, event_id: number }> = {}
try {
    const scorePath = path.join(process.cwd(), "assets", "carnival_event_quest_scores.json")
    if (existsSync(scorePath)) {
        carnivalScoreLookup = JSON.parse(readFileSync(scorePath, "utf-8"))
    }
} catch {} // Init failed silently; carnival scoring won't work
import { getSerializedPlayerRushEventPlayedPartiesSync } from "../../lib/rush";
import { grantPlayerSoloTimeAttackDegreesSync } from "../../data/domains/degree";
import {
    getMode15ExclusiveGlobalPartyItemsSync,
    isMode15Quest,
    MODE15_RUSH_EVENT_ID,
    settleMode15BattleSync,
} from "../../lib/mode15-optional";

interface StartBody {
    quest_id: number
    use_boss_boost_point: boolean
    use_boost_point: boolean
    category: number
    viewer_id: number
    play_id: string
    is_auto_start_mode: boolean
    party_id: number
    api_count: number
}

interface QuestStatistics {
    clear_phase: number,
    party: {
        unison_characters: ({ id: (number | null) } | null)[],
        characters: ({ id: (number | null) } | null)[],
        equipments: ({ id: (number | null) } | null)[],
        ability_soul_ids: (number | null)[],
        leader?: ({ id: (number | null) } | null)
    }
    zones?: {
        use_power_flip_count?: number
        use_dash_count?: number
        use_skill_count?: number
        [key: string]: any
    }[]
}

export interface FinishBody {
    is_restored: boolean
    continue_count: number
    elapsed_time_ms: number
    quest_id: number
    category: number
    score: number
    viewer_id: number
    add_mana: number
    is_accomplished: boolean
    statistics: QuestStatistics
    api_count: number
}

interface PlayContinueBody {
    api_count: number | string,
    payment_type: number | string,
    quest_id: number | string,
    viewer_id: number | string,
    // The production client has shipped both spellings. Keep the legacy typo
    // while accepting the correctly-spelled field as well.
    paly_id?: string,
    play_id?: string,
    category: number | string
}

interface AbortBody {
    api_count: number,
    finish_kind: number,
    statistics: QuestStatistics,
    viewer_id: number,
    quest_id: number,
    play_id: string,
    category: number
}

interface ReturnRushEvent {
    rush_battle_reward_list: {
        kind: number,
        kind_id: number,
        number: number
    }[],
    rush_battle_played_party_list: Record<number, UserRushEventPlayedParty> | null,
    endless_battle_played_party_list: Record<number, UserRushEventPlayedParty> | null,
    is_out_of_period: boolean,
    endless_battle_next_round: number | null,
    endless_battle_max_round: number | null,
    high_score: number | null,
    best_elapsed_time_ms: number | null,
    old_endless_battle_max_round: number | null,
    old_best_elapsed_time_ms: number | null
}

export interface ActiveQuest {
    questId: number,
    category: QuestCategory,
    useBossBoostPoint: boolean,
    useBoostPoint: boolean,
    isAutoStartMode: boolean,
    isMulti: boolean,
    isMultiHost?: boolean,
    roomNumber?: string,
    matePlayerIds?: number[],
    mateComIds?: number[],
    entryItemId?: number,
    eventId?: number,
    // Captured by multiplayer starts for the quest-specific NPC snapshot.
    partySlot?: number,
    playId: string,
    continueCount: number
}

const continueVmoneyCost = 50;

export const activeQuests: Record<number, ActiveQuest> = {}

export function insertActiveQuest(playerId: number, quest: ActiveQuest) {
    activeQuests[playerId] = quest
    // Persist to DB for battle recovery across server restarts
    insertPlayerActiveQuestSync(playerId, {
        playerId,
        playId: quest.playId,
        questId: quest.questId,
        category: quest.category,
        useBossBoostPoint: quest.useBossBoostPoint,
        useBoostPoint: quest.useBoostPoint,
        isAutoStartMode: quest.isAutoStartMode,
        isMulti: quest.isMulti,
        isMultiHost: quest.isMultiHost ?? false,
        roomNumber: quest.roomNumber ?? null,
        entryItemId: quest.entryItemId ?? null,
        eventId: quest.eventId ?? null,
        continueCount: quest.continueCount
    })
}

const routes = async (fastify: FastifyInstance) => {

    fastify.post("/finish", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as FinishBody

        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        })

        const sessionResult = await validateSessionAndPlayer(viewerId)
        if (!sessionResult) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid viewer id."
        })
        const { playerId, playerData } = sessionResult
        const finishCacheKey = buildFinishResponseCacheKey(
            "single",
            viewerId,
            body as unknown as Record<string, unknown>,
        )
        const cachedFinishResponse = getCachedFinishResponse(finishCacheKey)
        if (cachedFinishResponse !== undefined) {
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send(cachedFinishResponse)
        }

        // Resolve the active quest from memory, persisted recovery state, or
        // (for patched clients that skipped /start) a validated request hint.
        const resolvedActiveQuest = resolveActiveQuest({
            playerId,
            hint: body,
            memory: activeQuests,
        })
        const activeQuestData = resolvedActiveQuest?.quest
        gameVerboseLog(() => `[FINISH] req: playerId=${playerId} questId=${body.quest_id} category=${body.category} activeExists=${activeQuestData !== undefined} source=${resolvedActiveQuest?.source ?? "none"} multi=${activeQuestData?.isMulti ?? false}`)
        if (activeQuestData === undefined) return reply.status(400).send({
            "error": "Bad Request",
            "message": "No active quest to finish."
        })
        if (resolvedActiveQuest?.source !== "memory") {
            console.warn(`[FINISH] recovered active quest from ${resolvedActiveQuest?.source}: playerId=${playerId} questId=${activeQuestData.questId} category=${activeQuestData.category}`)
        }

        const questCategory = activeQuestData.category
        const questId = activeQuestData.questId
        gameVerboseLog(() => `[FINISH] active: category=${questCategory} questId=${questId}`)
        const questData = getQuestFromCategorySync(questCategory, questId) as BattleQuest | null
        if (questData === null || !('rankPointReward' in questData)) {
            console.warn(`[BATTLE] finish failed: category=${questCategory} questId=${questId} found=${!!questData} hasRankReward=${questData ? ('rankPointReward' in questData) : 'N/A'}`)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Quest doesn't exist."
            })
        }

        // calculate clear rank
        const clearTime = body.elapsed_time_ms
        const isScoreAttackEvent = questCategory === QuestCategory.SCORE_ATTACK_EVENT
        if (isScoreAttackEvent && (
            questData.bRankScore === undefined
            || questData.aRankScore === undefined
            || questData.sRankScore === undefined
            || questData.ssRankScore === undefined
        )) {
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "Score attack rank thresholds are missing."
            })
        }
        const clearRank = isScoreAttackEvent
            ? calculateScoreAttackClearRank(body.score, {
                bRankScore: questData.bRankScore!,
                aRankScore: questData.aRankScore!,
                sRankScore: questData.sRankScore!,
                ssRankScore: questData.ssRankScore!,
            })
            : calculateClearRank(clearTime, questData)

        // calculate player rewards
        const beforeRankPoint = playerData.rankPoint
        const displayMode15ManaAsFieldDrop = isMode15Quest(questCategory, questId)
        const newRankPoint = beforeRankPoint + questData.rankPointReward
        let newMana = playerData.freeMana + questData.manaReward + body.add_mana
        const manaObtained = questData.manaReward + body.add_mana

        // calculate boost point
        let newBoostPoint = playerData.boostPoint - (activeQuestData.useBoostPoint ? 1 : 0)
        let newBossBoostPoint = playerData.bossBoostPoint - (activeQuestData.useBossBoostPoint ? 1 : 0)
        let useBoostPoint = (activeQuestData.useBoostPoint && (newBoostPoint >= 0)) || (activeQuestData.useBossBoostPoint && (newBossBoostPoint >= 0))

        // check current quest progress
        const questProgress = getPlayerSingleQuestProgressSync(playerId, questCategory, questId);
        const questPreviouslyCompleted = questProgress !== null

        let questAccomplished = body.is_accomplished
        let scoreAttackBorderTiers: ScoreAttackBorderTier[] = []
        if (isScoreAttackEvent) {
            try {
                scoreAttackBorderTiers = resolveScoreAttackBorderTiers(
                    questData.eventId,
                    questData.scoreAttackQuestId,
                    scoreAttackBorderRewards as Record<string, ScoreAttackBorderTier[]>,
                )
            } catch (error) {
                console.error(`[SCORE_ATTACK] invalid configuration: ${(error as Error).message}`)
                return reply.status(500).send({
                    "error": "Internal Server Error",
                    "message": "Score attack reward configuration is missing."
                })
            }
            questAccomplished = body.score >= scoreAttackBorderTiers[0].score
        }

        const finishResponse = measureSettlementPhase("single", "transaction", () => getDb().transaction(() => {
            deletePlayerActiveQuestSync(playerId)
            const missionEvaluationTime = new Date(getServerTime() * 1000)

        let clearReward: PlayerRewardResult | null = null
        let sPlusClearReward: PlayerRewardResult | null = null
        const leaderId = body.statistics.party.characters[0]?.id
        if (questAccomplished) {
            // update quest progress
            if (questPreviouslyCompleted) {
                // simply update the quest progress if it already exists.
                const updateData: any = {
                    questId: questId,
                    finished: true,
                    bestElapsedTimeMs: questProgress.bestElapsedTimeMs === undefined || questProgress.bestElapsedTimeMs === null ? clearTime : Math.min(clearTime, questProgress.bestElapsedTimeMs),
                    highScore: questProgress.highScore === undefined ? body.score : Math.max(body.score, questProgress.highScore),
                    leaderCharacterId: leaderId ?? null
                }
                if (clearRank !== null) {
                    updateData.clearRank = questProgress.clearRank === undefined ? clearRank : Math.max(clearRank, questProgress.clearRank)
                }
                updatePlayerQuestProgressSync(playerId, questCategory, updateData)
            } else {
                // insert if it doesn't already exist.
                const insertData: any = {
                    questId: questId,
                    finished: true,
                    bestElapsedTimeMs: clearTime,
                    highScore: body.score,
                    clearRank: clearRank ?? 5,
                    leaderCharacterId: leaderId ?? null
                }
                insertPlayerQuestProgressSync(playerId, questCategory, insertData)
            }

            // Legacy saves may be missing the 1-6-1 story completion row even
            // though a later main quest was cleared. Repair it immediately so
            // unison becomes available without requiring another login.
            if (questCategory === QuestCategory.MAIN && questId >= 1006001) {
                repairUnisonUnlockProgressSync(playerId)
            }

            if (questCategory === QuestCategory.SOLO_TIME_ATTACK_EVENT) {
                const newDegreeIds = grantPlayerSoloTimeAttackDegreesSync(playerId, questId, clearTime)
                if (newDegreeIds.length > 0) {
                    console.log(`[DEGREE] solo time attack granted: player=${playerId} quest=${questId} elapsed=${clearTime} degrees=${newDegreeIds.join(",")}`)
                }
            }
        }

        // update player
        const oldRkDegree = getRankDegree(beforeRankPoint)
        const newDegreeId = getRankDegree(newRankPoint)
        const didLevelUp = newDegreeId > oldRkDegree
        updatePlayerSync({
            id: playerId,
            freeMana: newMana,
            rankPoint: newRankPoint,
            boostPoint: newBoostPoint,
            bossBoostPoint: newBossBoostPoint,
            totalManaObtained: (playerData.totalManaObtained ?? 0) + manaObtained,
            maxComboAchieved: Math.max(playerData.maxComboAchieved ?? 0, (body as any).statistics?.max_combo_count ?? 0),
            ...(didLevelUp ? { stamina: playerData.stamina + getMaxStamina(newDegreeId), staminaHealTime: new Date() } : {}),
        })
        if (adjustPlayerExpPoolSync(playerId, questData.poolExpReward, 'single_battle_base_reward') === null) {
            throw new Error(`Failed to grant single battle EXP to player ${playerId}`)
        }
        clearReward = !isScoreAttackEvent && !questPreviouslyCompleted && questData.clearReward !== undefined
            ? givePlayerRewardSync(playerId, questData.clearReward)
            : null
        const isExpertSingleEvent = questCategory === QuestCategory.EXPERT_SINGLE_EVENT
        const shouldGrantSPlusReward = isExpertSingleEvent
            ? questProgress?.sPlusRewardReceived !== true
            : questProgress?.clearRank !== 5
        sPlusClearReward = !isScoreAttackEvent && (clearRank === 5)
            && shouldGrantSPlusReward && (questData.sPlusReward !== undefined)
            ? givePlayerRewardSync(playerId, questData.sPlusReward)
            : null
        if (isExpertSingleEvent && sPlusClearReward !== null) {
            updatePlayerQuestProgressSync(playerId, questCategory, {
                questId,
                sPlusRewardReceived: true,
            })
            console.log(`[EXPERT_SINGLE_EVENT] SS reward granted: player=${playerId} quest=${questId} item=14040 count=3`)
        }
        if (didLevelUp) {
            playerData.stamina = playerData.stamina + getMaxStamina(newDegreeId)
            playerData.staminaHealTime = new Date()
            console.log(`[BATTLE-FINISH] player ${playerId} leveled up: ${oldRkDegree} -> ${newDegreeId}, stamina refilled`)
        }

        // Consume daily challenge point
        const dailyChallengePointList = handleDailyChallengePoint({
            questCategory,
            eventId: questData.eventId,
            playerId,
            challengePointMap: eventChallengePointMap as Record<string, number>,
            getEntries: (pid) => getPlayerDailyChallengePointListSync(pid),
            updatePoint: (pid, id, pt) => updatePlayerDailyChallengePointSync(pid, id, pt),
        })

        // reward score rewards
        if (isScoreAttackEvent) {
            gameVerboseLog(() => `[SCORE_ATTACK] questId=${questId} body={score:${body.score}, elapsed:${body.elapsed_time_ms}, accomplished:${body.is_accomplished}, addMana:${body.add_mana}, continue:${body.continue_count}}`)
            gameVerboseLog(() => `[SCORE_ATTACK] questData={localQuest:${questData.scoreAttackQuestId}, bRank:${questData.bRankScore}, aRank:${questData.aRankScore}, sRank:${questData.sRankScore}, ssRank:${questData.ssRankScore}, rankPt:${questData.rankPointReward}, charExp:${questData.characterExpReward}, mana:${questData.manaReward}, poolExp:${questData.poolExpReward}}`)
        }
        gameVerboseLog(() => `[BATTLE] scoreReward groupId=${questData.scoreRewardGroupId} groupLen=${questData.scoreRewardGroup?.length ?? 'null'} questId=${questId} category=${questCategory}`)
        const scoreRewardsResult = givePlayerScoreRewardsSync(playerId, questData.scoreRewardGroupId, questData.scoreRewardGroup, useBoostPoint, questData.element)
        let scoreAttackEventData: { reward_ids: number[], main_character_ids: Record<string, number> } | null = null
        if (isScoreAttackEvent) {
            const previousHighScore = questProgress?.highScore ?? 0
            const mainCharacterIds = collectScoreAttackMainCharacterIds(body.statistics.party.characters)
            const resolved = resolveNewScoreAttackBorderRewards(
                scoreAttackBorderTiers,
                previousHighScore,
                body.score,
            )
            for (const [itemIdText, count] of Object.entries(resolved.itemCounts)) {
                scoreRewardsResult.items[itemIdText] = givePlayerItemSync(playerId, Number(itemIdText), count)
            }
            scoreAttackEventData = {
                reward_ids: resolved.rewardIds,
                main_character_ids: mainCharacterIds,
            }
            gameVerboseLog(() => `[SCORE_ATTACK] borderRewards: event=${questData.eventId} folder=${questData.folderId} oldScore=${previousHighScore} newScore=${body.score} crossed=${resolved.rewardIds.length} items=${JSON.stringify(resolved.itemCounts)}`)
            gameVerboseLog(() => `[SCORE_ATTACK] afterReward: dropIds=${JSON.stringify(scoreRewardsResult.drop_score_reward_ids)}, drops=${scoreRewardsResult.drop_score_reward_ids.length}, items=${JSON.stringify(scoreRewardsResult.items)}, equipList=${scoreRewardsResult.equipment_list?.length ?? 0}`)
            gameVerboseLog(() => `[SCORE_ATTACK] response: accomplished=${questAccomplished}, clearRank=${clearRank}, score=${body.score}, elapsed=${body.elapsed_time_ms}, items=${JSON.stringify(scoreRewardsResult.items)}, clientCategory=${questCategory}`)
        }

        // reward character exp
        const bodyPartyStatistics = body.statistics.party
        const partyCharacterIds = [...bodyPartyStatistics.characters, ...bodyPartyStatistics.unison_characters]

        // Build finish context for mission trackers
        const finishCtx: FinishContext = {
            playerId, questCategory, questId,
            questAccomplished,
            clearTime: body.elapsed_time_ms,
            clearRank,
            party: body.statistics.party as any,
            statistics: (body as any).statistics,
            player: playerData,
            questPreviouslyCompleted,
            questProgress,
        }

        // Mission progress is recorded once by recordMissionBattleFacts below.
        const singleBattleParty = collectPartyCharacterIds(finishCtx.party)
        recordBattleMissionDimensionsSafe({
            type: "battle_finish",
            playerId,
            questCategory,
            questId,
            accomplished: questAccomplished,
            mode: "single",
            clearRank,
            clearTimeMs: clearTime,
            ...singleBattleParty,
            statistics: summarizeBattleStatistics(finishCtx.statistics),
        })
        const missionBattleFacts = recordMissionBattleFacts(finishCtx, missionEvaluationTime)
        const steamRobotMissionId = trackSteamRobotChallengeMission({
            playerId,
            questCategory,
            questId,
            questAccomplished,
            clearRank,
            statistics: finishCtx.statistics,
        })
        if (steamRobotMissionId !== null) {
            console.log(`[MISSION] steam robot challenge cleared: player=${playerId} quest=${questId} mission=${steamRobotMissionId}`)
        }
        const partyCharacterIdsArray: number[] = []
        for (const value of partyCharacterIds.values()) {
            if (value !== null && value.id !== null) partyCharacterIdsArray.push(value.id);
        }
        const addExpAmount = questData.characterExpReward

        const rewardCharacterExpResult = givePlayerCharactersExpSync(
            playerId,
            partyCharacterIdsArray,
            addExpAmount,
            questData.fixedParty !== undefined
        )

        const dataHeaders = generateDataHeaders({
            viewer_id: viewerId
        })

        // At the three solo-to-multiplayer boundaries, do not expose the
        // just-written Rush round in *this* generic quest-result response.
        // The legacy client uses that response to decide whether to draw
        // "Continue challenge"; exposing it would make the 5/10/15
        // placeholder open as a normal single-player Rush quest.
        //
        // The real marker is still persisted by the handler.  Pressing OK
        // returns to the Rush page, whose subsequent summary load receives
        // the real marker and correctly exposes the multiplayer Boss.
        const mode15BoundaryStage = Number(questId) % 1000;
        const withholdMode15BoundaryAdvance = questAccomplished
            && questCategory === QuestCategory.RUSH_EVENT
            && questData.rushEventId === MODE15_RUSH_EVENT_ID
            && (mode15BoundaryStage === 4
                || mode15BoundaryStage === 9
                || mode15BoundaryStage === 14);
        const rushPartiesBeforeBoundaryAdvance = withholdMode15BoundaryAdvance
            ? getSerializedPlayerRushEventPlayedPartiesSync(playerId, MODE15_RUSH_EVENT_ID)
            : null;

        // handle event quest-specific data & rewards
        const { rushEventData, rushEventRewardsResult } = handleRushEventFinish({
            questCategory,
            questAccomplished,
            questData,
            clearTime,
            party: bodyPartyStatistics,
            playerId,
            questId,
            getEvoLevels: (pid, chars) => getCharactersEvolutionImgLevels(pid, chars),
            getFolderMaxRounds: getRushEventFolderMaxRounds,
            getRushEvent: (pid, eid) => getPlayerRushEventSync(pid, eid),
            updateRushEvent: (pid, data) => updatePlayerRushEventSync(pid, data),
            // Never save a content-less marker. The legacy result/quest UI
            // dereferences the first character of every recorded party; a row
            // made entirely of NULL values becomes character id 0 and crashes
            // immediately after boundary floors such as stage 5.
            insertParty: (pid, eid, p) => insertPlayerRushEventPlayedPartySync(pid, eid, p),
            insertClearedFolder: (pid, eid, fid) => insertPlayerRushEventClearedFolderSync(pid, eid, fid),
            deletePartyList: (pid, eid, bt) => deletePlayerRushEventPlayedPartyListSync(pid, eid, bt),
            getSerializedParties: (pid, eid) => getSerializedPlayerRushEventPlayedPartiesSync(pid, eid),
            getFolderRewards: (eid, fid) => getRushEventFolderClearRewards(eid, fid),
            giveRewards: (pid, r) => givePlayerRewardsSync(pid, r),
        })

        if (rushEventData !== null && rushPartiesBeforeBoundaryAdvance !== null) {
            rushEventData.rush_battle_played_party_list = rushPartiesBeforeBoundaryAdvance.folderParties
            rushEventData.endless_battle_played_party_list = rushPartiesBeforeBoundaryAdvance.endlessParties
            console.log(
                `[MODE15] deferred Rush result visibility: player=${playerId} stage=${mode15BoundaryStage}`,
            )
        }

        const rogueFolderMaxRounds: Record<number, number> = {}
        if (
            questData.rushEventId !== undefined
            && questData.rushEventFolderId !== undefined
        ) {
            rogueFolderMaxRounds[questData.rushEventFolderId] =
                getRushEventFolderMaxRounds(
                    questData.rushEventId,
                    questData.rushEventFolderId,
                )
        }
        const rogueDrops = handleRoguePerRoundDrops({
            questCategory,
            questAccomplished,
            playerId,
            questData,
            folderMaxRounds: rogueFolderMaxRounds,
            partyCharacterIds: partyCharacterIdsArray,
        })
        if (
            rogueDrops !== null
            && rushEventData !== null
            && rogueDrops.showInRewardList
        ) {
            rushEventData.rush_battle_reward_list = [
                ...rushEventData.rush_battle_reward_list,
                ...rogueDrops.rewardListEntries,
            ]
        }

        // Record played party for RAID_EVENT
        const raidEventData = handleRaidEventFinish({
            questCategory,
            questAccomplished,
            activeEventId: activeQuestData.eventId,
            playId: activeQuestData.playId,
            party: bodyPartyStatistics,
            playerId,
            questId,
            getEvoLevelsFn: (pid, chars) => getCharactersEvolutionImgLevels(pid, chars),
            insertPartyFn: (pid, eid, p) => insertPlayerRushEventPlayedPartySync(pid, eid, p),
        })

        // handle carnival event score & records
        const carnivalInfo = carnivalScoreLookup[String(questId)]
        if (carnivalInfo) migrateCarnivalEventFolderRecordsSync(carnivalInfo.event_id)
        const carnivalEventData = handleCarnivalEventFinish({
            questCategory,
            questAccomplished,
            questId,
            battleScore: body.score,
            clearTime,
            party: bodyPartyStatistics,
            playerId,
            carnivalLookup: carnivalScoreLookup,
            getRecordsFn: (pid, eid) => getPlayerCarnivalEventRecordsSync(pid, eid),
            upsertFn: (pid, eid, fid, score, chars, unisons) => upsertPlayerCarnivalEventRecordSync(pid, eid, fid, score, chars, unisons),
        })

        let carnivalRewardsResult: PlayerRewardResult | null = null
        if (carnivalEventData && carnivalInfo) {
            const totalBestScore = getPlayerCarnivalEventRecordsSync(playerId, carnivalInfo.event_id)
                .reduce((sum, record) => sum + (record.bestScore ?? 0), 0)
            const granted = grantCarnivalTotalScoreRewardsSync(playerId, carnivalInfo.event_id, totalBestScore)
            carnivalEventData.reward_ids = granted.rewardIds
            carnivalEventData.new_degree_ids = granted.newDegreeIds
            carnivalRewardsResult = granted.rewards
        }

        const mode15RewardsResult = settleMode15BattleSync(
            playerId,
            questCategory,
            questId,
            questAccomplished,
        )

        const itemList = {
            ...(activeQuestData.entryItemId ? { [activeQuestData.entryItemId]: getPlayerItemSync(playerId, activeQuestData.entryItemId) ?? 0 } : {}),
            ...(clearReward?.items ?? {}),
            ...(sPlusClearReward?.items ?? {}),
            ...scoreRewardsResult.items,
            ...(rushEventRewardsResult?.items ?? {}),
            ...(rogueDrops?.rewardResult.items ?? {}),
            ...(carnivalRewardsResult?.items ?? {}),
            ...(mode15RewardsResult?.items ?? {})
        }
        const characterList = reconcileAwakeUnlockCharacterList(playerId, [
            ...rewardCharacterExpResult.character_list as unknown as Record<string, unknown>[],
            ...((clearReward?.character_list || []) as Record<string, unknown>[]),
            ...((sPlusClearReward?.character_list || []) as Record<string, unknown>[]),
            ...(scoreRewardsResult.character_list as Record<string, unknown>[]),
            ...((rogueDrops?.rewardResult.character_list || []) as unknown as Record<string, unknown>[]),
            ...((rogueDrops?.expCharacterList || []) as unknown as Record<string, unknown>[]),
            ...((carnivalRewardsResult?.character_list || []) as Record<string, unknown>[]),
            ...((mode15RewardsResult?.character_list || []) as Record<string, unknown>[]),
        ])
        const missionSettlement = measureSettlementPhase("single", "mission", () => (
            settleMissionCategories(
                playerId,
                buildBattleMissionSettlementScopes(
                    missionBattleFacts,
                    Object.keys(itemList).map(Number),
                    steamRobotMissionId === null ? [] : [steamRobotMissionId],
                    partyCharacterIdsArray,
                ),
                missionEvaluationTime,
            )
        ))
        const awakeMissionSettlement = measureSettlementPhase("single", "awake_mission", () => (
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
        const activeMissionSettlement = measureSettlementPhase("single", "active_mission", () => (
            reconcileActiveMissionFacts({
                playerId,
                repository: getContentSnapshot().repository,
                now: missionEvaluationTime,
                patterns: getBattleActiveMissionPatterns(questCategory),
            })
        ))
        const finalPlayerData = getPlayerSync(playerId)
        const responseData: Record<string, any> = {
                "user_info": {
                    "free_mana": finalPlayerData?.freeMana ?? newMana,
                    "exp_pool": finalPlayerData?.expPool ?? rewardCharacterExpResult.exp_pool,
                    "exp_pooled_time": getServerTime(playerData.expPooledTime),
                    "free_vmoney": finalPlayerData?.freeVmoney ?? playerData.freeVmoney,
                    "rank_point": newRankPoint,
                    "degree_id": playerData.degreeId ?? 1,
                    "stamina": playerData.stamina,
                    "stamina_heal_time": realToVirtual(playerData.staminaHealTime),
                    "boost_point": newBoostPoint,
                    "boss_boost_point": newBossBoostPoint
                },
                "add_exp_list": [
                    ...rewardCharacterExpResult.add_exp_list,
                    ...(rogueDrops?.addExpList || []),
                ],
                "character_list": characterList,
                "bond_token_status_list": {
                    ...rewardCharacterExpResult.bond_token_status_list,
                    ...(rogueDrops?.bondTokenStatusList || {}),
                },
                "rewards": {
                    "overflow_pool_exp": 0,
                    "converted_pool_exp": 0,
                    "reward_pool_exp": questData.poolExpReward,
                    // Rush result panels do not render reward_mana in the
                    // acquired-item area.  Mode15 presents the same credited
                    // amount through the native field-mana slot so the Mana
                    // icon and quantity are visible; user_info.free_mana
                    // remains authoritative and the award is not duplicated.
                    "reward_mana": displayMode15ManaAsFieldDrop ? 0 : questData.manaReward,
                    "field_mana": body.add_mana
                        + (displayMode15ManaAsFieldDrop ? questData.manaReward : 0)
                },
                "old_high_score": questProgress === null ? 0 : questProgress.highScore || 0,
                "joined_character_id_list": [
                    ...(clearReward?.joined_character_id_list || []),
                    ...(sPlusClearReward?.joined_character_id_list || []),
                    ...scoreRewardsResult.joined_character_id_list,
                    ...(carnivalRewardsResult?.joined_character_id_list || []),
                    ...(mode15RewardsResult?.joined_character_id_list || [])
                ],
                "before_rank_point": beforeRankPoint,
                "clear_rank": clearRank ?? 5,
                "drop_score_reward_ids": scoreRewardsResult.drop_score_reward_ids,
                "drop_rare_reward_ids": scoreRewardsResult.drop_rare_reward_ids,
                "drop_additional_reward_ids": [
                    ...(rogueDrops?.additionalRewardEntries ?? []),
                    ...(mode15RewardsResult?.mode15_additional_reward_ids ?? []),
                ],
                "drop_periodic_reward_ids": [],
                "equipment_list": [
                    ...scoreRewardsResult.equipment_list,
                    ...(clearReward?.equipment_list || []),
                    ...(sPlusClearReward?.equipment_list || []),
                    ...(rushEventRewardsResult?.equipment_list || []),
                    ...(rogueDrops?.rewardResult.equipment_list || []),
                    ...(carnivalRewardsResult?.equipment_list || []),
                    ...(mode15RewardsResult?.equipment_list || [])
                ],
                "category_id": body.category,
                "start_time": dataHeaders['servertime'],
                "is_multi": "single",
                "quest_name": "",
                "item_list": itemList,
                "rush_event": rushEventData,
                "raid_event": raidEventData,
                "carnival_event": carnivalEventData,
                "score_attack_event": scoreAttackEventData,
                "user_daily_challenge_point_list": dailyChallengePointList ?? [],
                "presigned_quest_category": []
        }
        mergeMissionSettlementResponse(responseData, missionSettlement, viewerId)
        mergeMissionSettlementResponse(responseData, awakeMissionSettlement, viewerId)
        if (activeMissionSettlement.length > 0) {
            responseData.active_mission_list = activeMissionSettlement
        }
        responseData.mail_arrived = getPlayerMailCountSync(playerId, true) > 0
        return {
            "data_headers": dataHeaders,
            "data": responseData,
        }
        })())

        delete activeQuests[playerId]
        cacheFinishResponse(finishCacheKey, finishResponse)
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send(finishResponse)
    })

    fastify.post("/abort", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as AbortBody

        const viewerId = body.viewer_id
        if (isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        })

        const sessionResult = await validateSessionAndPlayer(viewerId)
        if (!sessionResult) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid viewer id."
        })
        const { playerId } = sessionResult

        const headers = generateDataHeaders({ viewer_id: body.viewer_id })

        // A defeated/abandoned single battle reaches /abort rather than
        // /finish(is_accomplished=false) on the legacy client. Resolve the
        // authoritative active quest before deleting it so Fantasy Rush can
        // apply the same fail-and-reset transition on both paths.
        const resolvedAbortQuest = resolveActiveQuest({
            playerId,
            hint: body,
            memory: activeQuests,
            allowRebuild: false,
        })
        const abortQuest = resolvedAbortQuest?.quest
        if (abortQuest && isMode15Quest(abortQuest.category, abortQuest.questId)) {
            settleMode15BattleSync(
                playerId,
                abortQuest.category,
                abortQuest.questId,
                false,
            )
            console.log(
                `[MODE15] single battle aborted; run reset: player=${playerId} category=${abortQuest.category} quest=${abortQuest.questId}`,
            )
        }

        // delete existing active quest
        delete activeQuests[playerId]
        deletePlayerActiveQuestSync(playerId)

        return reply.status(200).send({
            "data_headers": headers,
            "data": {
                "user_info": {},
                "category_id": body.category,
                "is_multi": "single",
                "start_time": headers['servertime'],
                "quest_name": ""
            }
        })
    })

    fastify.post("/start", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as StartBody

        const viewerId = body.viewer_id
        const partyId = body.party_id
        const questId = body.quest_id
        const category = body.category
        const useBoostPoint = body.use_boost_point
        const useBossBoostPoint = body.use_boss_boost_point
        const isAutoStartMode = body.is_auto_start_mode
        if (isNaN(viewerId) || isNaN(partyId) || isNaN(questId) || isNaN(category) || useBoostPoint === undefined || useBossBoostPoint === undefined || isAutoStartMode === undefined) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        })

        const sessionResult = await validateSessionAndPlayer(viewerId)
        if (!sessionResult) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid viewer id."
        })
        const { playerId, playerData: player } = sessionResult

        if (!isMode15Quest(category, questId)) {
            // Carnival quests use their own saved party category.  Looking up
            // NORMAL here allowed Mode15-exclusive equipment in Carnival even
            // though the selected Carnival party actually contained it.
            const partyCategory = category === QuestCategory.CARNIVAL_EVENT
                ? PartyCategory.CARNIVAL
                : PartyCategory.NORMAL;
            const restricted = getMode15ExclusiveGlobalPartyItemsSync(
                playerId, partyCategory, partyId,
            );
            if (restricted.length > 0) {
                console.log(`[MODE15] exclusive equipment denied in single battle: player=${playerId} quest=${questId} questCategory=${category} partyCategory=${partyCategory} party=${partyId} items=${restricted.join(",")}`);
                reply.header("content-type", "application/x-msgpack");
                return reply.status(200).send({
                    // Quest-start clients natively map 4050 to their normal
                    // "out of period" rejection dialog.  4507 belongs to
                    // create-room failure and causes a fatal client error
                    // when returned from questStart.
                    data_headers: generateDataHeaders({ viewer_id: viewerId, result_code: 4050 }),
                    data: {},
                });
            }
        }

        // get quest data
        const questData = getQuestFromCategorySync(category, questId) as BattleQuest | null
        if (questData === null || !('rankPointReward' in questData)) {
            console.warn(`[BATTLE] start failed: category=${category} questId=${questId} found=${!!questData} hasRankReward=${questData ? ('rankPointReward' in questData) : 'N/A'}`)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Quest doesn't exist."
            })
        }

        // Deduct entry cost (ticket/item)
        const questKey = `${category}_${questId}`
        const configuredEntryCost = (questEntryCosts as Record<string, {itemId: number, itemCount: number, stamina: number}>)[questKey]
        let entryCost: { itemId: number, itemCount: number, stamina: number } | undefined
        const staminaInfo = getStaminaCost(questKey)
        const nominalStaminaCost = Math.max(0, staminaInfo.cost)
        gameVerboseLog(() => `[BATTLE] start free-entry: questId=${questId} questKey=${questKey} nominalEntryCost=${JSON.stringify(configuredEntryCost)} nominalStamina=${nominalStaminaCost}`)
        if (entryCost && entryCost.itemId > 0) {
            const playerItemCount = getPlayerItemSync(playerId, entryCost.itemId) ?? 0
            gameVerboseLog(() => `[BATTLE] start deduct: itemId=${entryCost.itemId} playerHas=${playerItemCount} need=${entryCost.itemCount}`)
            if (playerItemCount < entryCost.itemCount) {
                return reply.status(400).send({
                    "error": "Bad Request",
                    "message": `Not enough entry items (need ${entryCost.itemCount} of ${entryCost.itemId}, have ${playerItemCount}).`
                })
            }
            updatePlayerItemSync(playerId, entryCost.itemId, playerItemCount - entryCost.itemCount)
        }

        // Deduct stamina cost
        const staminaCost = 0
        let afterStamina = 0
        if (staminaCost > 0) {
            const currentStamina = computeRealTimeStamina(player)
            if (currentStamina < staminaCost) {
                console.warn(`[BATTLE-START] player ${playerId} stamina insufficient: ${currentStamina} < ${staminaCost}`)
                return reply.status(400).send({
                    "error": "Bad Request",
                    "message": "Insufficient stamina."
                })
            }
            const newStamina = Math.max(0, currentStamina - staminaCost)
            updatePlayerSync({
                id: playerId,
                stamina: newStamina,
                staminaHealTime: new Date(),
                totalStaminaUsed: (player.totalStaminaUsed ?? 0) + staminaCost
            })
            afterStamina = newStamina
            gameVerboseLog(() => `[BATTLE-START] stamina: ${currentStamina} -> ${newStamina} (cost: ${staminaCost}, rate: ${staminaInfo.rate})`)
        } else {
            // No stamina deduction, read current stamina for response
            const player = getPlayerSync(playerId)
            afterStamina = player?.stamina ?? 0
        }

        // add to active quests table
        delete activeQuests[playerId]
        activeQuests[playerId] = {
            questId: questId,
            category: category,
            useBoostPoint: useBoostPoint,
            useBossBoostPoint: useBossBoostPoint,
            isAutoStartMode: isAutoStartMode,
            isMulti: false,
            entryItemId: entryCost?.itemId,
            playId: body.play_id,
            continueCount: 0
        }

        let missionSettlement: MissionSettlementResult | undefined
        getDb().transaction(() => {
            const playerUpdate: any = {
                id: playerId,
                totalStaminaUsed: (player.totalStaminaUsed ?? 0) + nominalStaminaCost,
            }
            if (questData.fixedParty === undefined) playerUpdate.partySlot = partyId
            updatePlayerSync(playerUpdate)
            const activeQuest = activeQuests[playerId]
            insertPlayerActiveQuestSync(playerId, {
                playerId,
                playId: activeQuest.playId,
                questId: activeQuest.questId,
                category: activeQuest.category,
                useBossBoostPoint: activeQuest.useBossBoostPoint,
                useBoostPoint: activeQuest.useBoostPoint,
                isAutoStartMode: activeQuest.isAutoStartMode,
                isMulti: activeQuest.isMulti,
                isMultiHost: activeQuest.isMultiHost ?? false,
                roomNumber: activeQuest.roomNumber ?? null,
                entryItemId: null,
                eventId: activeQuest.eventId ?? null,
                continueCount: activeQuest.continueCount,
            })
            recordActiveMissionQuestChallengeFactSync(playerId, category)
            missionSettlement = settleMissionCategories(
                playerId,
                [1, 2, 10],
                new Date(getServerTime() * 1000),
            )
        })()

        const dataHeaders = generateDataHeaders({
            viewer_id: viewerId
        })

        reply.header("content-type", "application/x-msgpack")
        const responseData: Record<string, any> = {
                "user_info": {
                    "last_main_quest_id": body.quest_id,
                    "stamina": afterStamina,
                    "stamina_heal_time": realToVirtual(new Date())
                },
                "item_list": {},
                "category_id": body.category,
                "is_multi": "single",
                "start_time": dataHeaders['servertime'],
                "quest_name": "",
                "client_checks": getSteamRobotMissionClientChecks(category, questId)
        }
        if (missionSettlement) {
            mergeMissionSettlementResponse(responseData, missionSettlement, viewerId)
        }
        responseData.mail_arrived = getPlayerMailCountSync(playerId, true) > 0
        return reply.status(200).send({
            "data_headers": dataHeaders,
            "data": responseData,
        })
    })

    fastify.route({
        method: ["GET", "POST"],
        url: "/play_continue",
        handler: async (request: FastifyRequest, reply: FastifyReply) => {
        const raw = ((request.method === "GET" ? request.query : request.body) ?? {}) as Partial<PlayContinueBody>
        const viewerId = Number(raw.viewer_id)
        const questId = Number(raw.quest_id)
        const category = Number(raw.category)
        const playId = raw.play_id ?? raw.paly_id
        if (
            !Number.isSafeInteger(viewerId) || viewerId <= 0 ||
            !Number.isSafeInteger(questId) || questId <= 0 ||
            !Number.isSafeInteger(category) || category < 0 ||
            typeof playId !== "string" || playId.length === 0
        ) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        })

        const sessionResult = await validateSessionAndPlayer(viewerId)
        if (!sessionResult) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid viewer id."
        })
        const { playerId, playerData: player } = sessionResult

        // Continue may recover a persisted battle after a restart, but never
        // rebuild one from request data: doing so would create a new revive path.
        const resolvedContinueQuest = resolveActiveQuest({
            playerId,
            hint: {
                quest_id: questId,
                category,
                play_id: playId,
            },
            memory: activeQuests,
            allowRebuild: false,
        })
        const activeQuestData = resolvedContinueQuest?.quest
        if (activeQuestData === undefined) return reply.status(400).send({
            "error": "Bad Request",
            "message": "No active quest to continue."
        })

        const freeVmoney = player.freeVmoney
        const vmoney = player.vmoney
        const freeVmoneyCost = Math.min(freeVmoney, continueVmoneyCost)
        const paidVmoneyCost = continueVmoneyCost - freeVmoneyCost
        if (vmoney < paidVmoneyCost) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Not enough vmoney to continue"
        })

        const newFreeVmoney = freeVmoney - freeVmoneyCost
        const newVmoney = vmoney - paidVmoneyCost

        // update the player's vmoney balances
        updatePlayerSync({
            id: playerId,
            freeVmoney: newFreeVmoney,
            vmoney: newVmoney
        })

        // increment continue count for battle recovery
        activeQuestData.continueCount++
        updatePlayerActiveQuestContinueCountSync(playerId, activeQuestData.continueCount)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "user_info": {
                    "free_vmoney": newFreeVmoney,
                    "vmoney": newVmoney
                },
                "mail_arrived": false
            }
        })

        },
    })
}

export default routes;
