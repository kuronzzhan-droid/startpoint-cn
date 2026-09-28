import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { deletePlayerActiveQuestSync, getPlayerActiveQuestSync, insertPlayerActiveQuestSync, updatePlayerActiveQuestContinueCountSync } from "../../data/domains/quest_active"
import { deletePlayerRushEventPlayedPartyListSync, getPlayerRushEventClearedFoldersSync, getPlayerRushEventPlayedPartiesSync, getPlayerRushEventSync, insertPlayerRushEventClearedFolderSync, insertPlayerRushEventPlayedPartySync, updatePlayerRushEventSync } from "../../data/domains/rushEvent"
import { getPlayerDailyChallengePointListSync, getPlayerSync, updatePlayerDailyChallengePointSync, updatePlayerSync } from "../../data/domains/player"
import { getPlayerItemSync, givePlayerItemSync, updatePlayerItemSync } from "../../data/domains/item"
import { getPlayerSingleQuestProgressSync, insertPlayerQuestProgressSync, updatePlayerQuestProgressSync } from "../../data/domains/quest"
import { getSession } from "../../data/domains/session"
import { incrementPlayerCharacterClearSync } from "../../data/domains/character_clear"
import { updatePlayerEquipmentSync } from "../../data/domains/equipment"
import { upsertPlayerCarnivalEventRecordSync } from "../../data/domains/carnivalEvent"
import { getQuestFromCategorySync, getRushEventFolderClearRewards, getRushEventFolderMaxRounds } from "../../lib/assets";
import { getCharactersEvolutionImgLevels, givePlayerCharactersExpSync } from "../../lib/character";
import { givePlayerRewardsSync, givePlayerRewardSync, givePlayerScoreRewardsSync } from "../../lib/quest";
import { BattleQuest, EquipmentItemReward, PlayerRewardResult, QuestCategory } from "../../lib/types";
import { generateDataHeaders, getServerTime, realToVirtual } from "../../utils";
import { RushEventBattleType, UserRushEventPlayedParty } from "../../data/types";
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { computeRealTimeStamina, getRankDegree, getMaxStamina } from "../../lib/stamina";
import { getStaminaCost } from "../../lib/stamina-cost";
import { handleCarnivalEventFinish } from "../../lib/quest/finish/carnival-handler";
import { handleRushEventFinish } from "../../lib/quest/finish/rush-handler";
import { noteRushRoundFinish } from "../../lib/rush-leaderboard-service";
import { isRushBoardRankingQuest } from "../../lib/rush-leaderboard-ranking-event";
import { buildRushEndlessCardFields } from "../../lib/rush-endless-card";
import { handleRoguePerRoundDrops } from "../../lib/quest/finish/rogue-drops";
import { handleRaidEventFinish } from "../../lib/quest/finish/raid-handler";
import { FIVE_BOSS_GAUNTLET, isFiveBossGauntletFamilyQuest, isFiveBossGauntletQuest } from "../../multi/five-boss/contract";
import { fiveBossSoloRewardMultiplier, grantFiveBossSoloRewardsSync } from "../../multi/five-boss/solo-rewards";
import {
    clearFiveBossSoloStartSync,
    readFiveBossSoloStartSync,
    recordFiveBossSoloStartSync,
} from "../../multi/five-boss/solo-ledger";
import { getPlayerOptionsSync } from "../../data/domains/option";
import { calculateClearRank } from "../../lib/quest/finish/quest-calc";
import { validateSessionAndPlayer } from "../../lib/quest/finish/session-validator";
import { resolveActiveQuest } from "../../lib/quest/finish/active-quest-resolver";
import { handleDailyChallengePoint } from "../../lib/quest/finish/challenge-point";
import { trackCharacterClears } from "../../lib/quest/finish/character-clear-tracker";
import { trackPowerflip } from "../../lib/quest/finish/powerflip-tracker";
import { trackLeaderPowerflip } from "../../lib/quest/finish/leader-powerflip-tracker";
import { trackPartyCoClears } from "../../lib/quest/finish/party-co-clear-tracker";
import { canContinueBattle, canStartQuestByPrerequisites, hasClearedQuestPrerequisiteForCategory, resolveBattleStartEntryCost, resolveBattleStartStaminaCost } from "../../lib/quest/start-handler";
import { collectPartyCharacterIds, recordBattleMissionDimensionsSafe, summarizeBattleStatistics } from "../../lib/mission"
import type { FinishContext } from "../../lib/quest/finish/types";
import { readFileSync, existsSync } from "fs";
import path from "path";
import questEntryCosts from "../../../assets/quest_entry_costs.json";
import scoreAttackBorderRewards from "../../../assets/score_attack_border_reward.json";
import eventChallengePointMap from "../../../assets/event_challenge_point_map.json";
import { dispatchModeQuestStart, dispatchModeRushFinish } from "../../modes/registry";
import { createModeHost, createModeTransactionHost } from "../../modes/host";
import {
    isFantasyGauntletEnabled,
    isFantasyMultiQuest,
    settleFantasyBattleSync,
    withFantasyFolderSentinel,
} from "../../lib/fantasy-gauntlet";

// Read-only host for entry checks; writable host for settlement extensions.
// Both are inert when the loader has not registered any mode.
const singleBattleModeHost = createModeHost(message => console.log(message));
const settlementModeHost = createModeTransactionHost(message => console.log(message));

// Load carnival quest score data
let carnivalScoreLookup: Record<string, { difficulty_score: number, time_limit_ms: number, folder_id: number, event_id: number }> = {}
try {
    const scorePath = path.join(process.cwd(), "assets", "carnival_event_quest_scores.json")
    if (existsSync(scorePath)) {
        carnivalScoreLookup = JSON.parse(readFileSync(scorePath, "utf-8"))
    }
} catch {} // Init failed silently; carnival scoring won't work
import { getSerializedPlayerRushEventPlayedPartiesSync } from "../../lib/rush";

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
    api_count: number,
    payment_type: number,
    quest_id: number,
    viewer_id: number,
    paly_id: string,
    category: number
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
    roomNumber?: string,
    matePlayerIds?: number[],
    mateComIds?: number[],
    entryItemId?: number,
    eventId?: number,
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
        roomNumber: quest.roomNumber ?? null,
        entryItemId: quest.entryItemId ?? null,
        eventId: quest.eventId ?? null,
        continueCount: quest.continueCount
    })
}

/** 与 givePlayerScoreRewardsSync 同形的"什么都没发"结果,给五重无票局用。 */
function emptyScoreRewardsResult(): ReturnType<typeof givePlayerScoreRewardsSync> {
    return {
        drop_score_reward_ids: [],
        drop_rare_reward_ids: [],
        user_info: { free_mana: 0, free_vmoney: 0, exp_pool: 0 },
        character_list: [],
        joined_character_id_list: [],
        equipment_list: [],
        items: {},
    }
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

        // get active quest data
        const resolved = resolveActiveQuest({ playerId, hint: body, memory: activeQuests })
        const activeQuestData = resolved?.quest
        console.log(`[FINISH] req: playerId=${playerId} questId=${body.quest_id} category=${body.category} activeExists=${activeQuestData !== undefined} source=${resolved?.source ?? 'none'} multi=${activeQuestData?.isMulti ?? false}`)
        if (resolved === null || activeQuestData === undefined) return reply.status(400).send({
            "error": "Bad Request",
            "message": "No active quest to finish."
        })
        if (resolved.source !== "memory") {
            console.warn(`[FINISH] recovered active quest from ${resolved.source}: playerId=${playerId} questId=${activeQuestData.questId} category=${activeQuestData.category}`)
        }

        const questCategory = activeQuestData.category
        const questId = activeQuestData.questId
        console.log(`[FINISH] active: category=${questCategory} questId=${questId}`)
        const questData = getQuestFromCategorySync(questCategory, questId) as BattleQuest | null
        if (questData === null || !('rankPointReward' in questData)) {
            console.log(`[BATTLE] finish failed: category=${questCategory} questId=${questId} found=${!!questData} hasRankReward=${questData ? ('rankPointReward' in questData) : 'N/A'}`)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Quest doesn't exist."
            })
        }

        // delete the active quest data from global record
        delete activeQuests[playerId]
        deletePlayerActiveQuestSync(playerId)

        // calculate clear rank
        const clearTime = body.elapsed_time_ms
        const clearRank = calculateClearRank(clearTime, questData)

        // 五重决战单人(2026-09-09 作者规则):开局时没扣到凭证(entryItemId 为空)= 本局零奖励 ——
        // 模式材料、首通/S+ 通关奖励、通关记录、关卡基础魔那/池经验/rank、score reward 组、角色经验一律不给,
        // 只留结算页需要的占位条目。体力已在开局扣掉,不退。
        // 从请求体重建的 active quest(内存与持久化都丢了)不带 entryItemId,按无票处理(fail-closed,天然幂等)。
        const isFiveBossSoloQuest = !activeQuestData.isMulti && isFiveBossGauntletQuest(questCategory, questId)
        const fiveBossTicketConsumed = activeQuestData.entryItemId === FIVE_BOSS_GAUNTLET.ticketItemId
        const fiveBossUnrewarded = isFiveBossSoloQuest && !fiveBossTicketConsumed
        if (isFiveBossSoloQuest && resolved.source === "rebuilt") {
            console.warn(`[FIVE-BOSS] solo finish on a rebuilt active quest: treating as ticketless (no rewards) player=${playerId}`)
        }
        const questPoolExpReward = fiveBossUnrewarded ? 0 : questData.poolExpReward
        const questRankPointReward = fiveBossUnrewarded ? 0 : questData.rankPointReward
        const questManaReward = fiveBossUnrewarded ? 0 : questData.manaReward
        const fieldMana = fiveBossUnrewarded ? 0 : body.add_mana

        // calculate player rewards
        const newExpPool = playerData.expPool + questPoolExpReward
        const beforeRankPoint = playerData.rankPoint
        const newRankPoint = beforeRankPoint + questRankPointReward
        let newMana = playerData.freeMana + questManaReward + fieldMana
        const manaObtained = questManaReward + fieldMana

        // calculate boost point
        let newBoostPoint = playerData.boostPoint - (activeQuestData.useBoostPoint ? 1 : 0)
        let newBossBoostPoint = playerData.bossBoostPoint - (activeQuestData.useBossBoostPoint ? 1 : 0)
        let useBoostPoint = (activeQuestData.useBoostPoint && (newBoostPoint >= 0)) || (activeQuestData.useBossBoostPoint && (newBossBoostPoint >= 0))

        // check current quest progress
        const questProgress = getPlayerSingleQuestProgressSync(playerId, questCategory, questId);
        const questPreviouslyCompleted = questProgress !== null

        // Score attack: accomplished determined by border reward minimum tier (from CDN)
        let questAccomplished = body.is_accomplished
        if (questCategory === QuestCategory.SCORE_ATTACK_EVENT) {
            const eventId = questData.eventId
            const folderId = questData.folderId
            if (eventId !== undefined && folderId !== undefined) {
                const borderTiers = (scoreAttackBorderRewards as Record<string, {score: number}[]>)[`${eventId}_${folderId}`]
                if (borderTiers && borderTiers.length > 0) {
                    questAccomplished = body.score >= borderTiers[0].score
                }
            }
        }

        // 五重决战单人通关:模式材料(图纸/结晶/证/心核)不走 five-boss runtime,在这里按同一张
        // reward plan 发(倍率与多人同口径:开战 Auto 关闭=2 倍、开启=1 倍)。多人房的 finish 早在
        // multi_battle_quest 那条路上被拦走,这里只会是单人。无票局(fiveBossUnrewarded)一件不发。
        if (fiveBossUnrewarded && questAccomplished) {
            console.log(`[FIVE-BOSS] solo finish without ticket: no mode rewards / no clear record player=${playerId}`)
        }
        const fiveBossSoloSnapshot = isFiveBossSoloQuest
            ? readFiveBossSoloStartSync(playerId, activeQuestData.playId)
            : null
        if (isFiveBossSoloQuest) {
            clearFiveBossSoloStartSync(playerId)
            if (fiveBossTicketConsumed && questAccomplished) {
                console.log(`[FIVE-BOSS] solo finish: player=${playerId} autoAtStart=${fiveBossSoloSnapshot?.autoAtStart ?? "n/a"}`
                    + ` autoUsed=${fiveBossSoloSnapshot?.autoUsed ?? "n/a"} multiplier=${fiveBossSoloRewardMultiplier(fiveBossSoloSnapshot)}`)
            }
        }
        const fiveBossSolo = questAccomplished && isFiveBossSoloQuest && fiveBossTicketConsumed
            ? grantFiveBossSoloRewardsSync({
                playerId,
                firstClear: !questPreviouslyCompleted,
                rewardMultiplier: fiveBossSoloRewardMultiplier(fiveBossSoloSnapshot),
            })
            : null
        const clearReward = !fiveBossUnrewarded && !questPreviouslyCompleted && questData.clearReward !== undefined ? givePlayerRewardSync(playerId, questData.clearReward) : null
        const sPlusClearReward = !fiveBossUnrewarded && (clearRank === 5) && (questProgress?.clearRank !== 5) && (questData.sPlusReward !== undefined) ? givePlayerRewardSync(playerId, questData.sPlusReward) : null
        const leaderId = body.statistics.party.characters[0]?.id
        if (questAccomplished && !fiveBossUnrewarded) {
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
        }

        // update player
        const oldRkDegree = getRankDegree(beforeRankPoint)
        const newDegreeId = getRankDegree(newRankPoint)
        const didLevelUp = newDegreeId > oldRkDegree
        updatePlayerSync({
            id: playerId,
            freeMana: newMana,
            expPool: newExpPool,
            rankPoint: newRankPoint,
            boostPoint: newBoostPoint,
            bossBoostPoint: newBossBoostPoint,
            totalManaObtained: (playerData.totalManaObtained ?? 0) + manaObtained,
            maxComboAchieved: Math.max(playerData.maxComboAchieved ?? 0, (body as any).statistics?.max_combo_count ?? 0),
            ...(didLevelUp ? { stamina: playerData.stamina + getMaxStamina(newDegreeId), staminaHealTime: new Date() } : {}),
        })
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
        if (questCategory === QuestCategory.SCORE_ATTACK_EVENT) {
            console.log(`[SCORE_ATTACK] questId=${questId} body={score:${body.score}, elapsed:${body.elapsed_time_ms}, accomplished:${body.is_accomplished}, addMana:${body.add_mana}, continue:${body.continue_count}}`)
            console.log(`[SCORE_ATTACK] questData={groupId:${questData.scoreRewardGroupId}, groupLen:${questData.scoreRewardGroup?.length ?? 'null'}, bRank:${questData.bRankTime}, aRank:${questData.aRankTime}, sRank:${questData.sRankTime}, sPlus:${questData.sPlusRankTime}, rankPt:${questData.rankPointReward}, charExp:${questData.characterExpReward}, mana:${questData.manaReward}, poolExp:${questData.poolExpReward}, clearReward:${questData.clearReward?.id ?? 'none'}}`)
        }
        console.log(`[BATTLE] scoreReward groupId=${questData.scoreRewardGroupId} groupLen=${questData.scoreRewardGroup?.length ?? 'null'} questId=${questId} category=${questCategory}`)
        const scoreRewardsResult = fiveBossUnrewarded ? emptyScoreRewardsResult() : givePlayerScoreRewardsSync(playerId, questData.scoreRewardGroupId, questData.scoreRewardGroup, useBoostPoint, questData.element, {
            clearRank,
            rankItemCounts: questData.rankItemCounts,
        })
        let scoreAttackRewardIds: number[] = []
        if (questCategory === QuestCategory.SCORE_ATTACK_EVENT) {
            // Look up border rewards for score attack events
            const eventId = questData.eventId
            const folderId = questData.folderId
            if (eventId !== undefined && folderId !== undefined) {
                const borderKey = `${eventId}_${folderId}`
                const borderTiers = (scoreAttackBorderRewards as Record<string, {score: number, rewardItemId: number, rewardCount: number, coinItemId: number, coinCount: number}[]>)[borderKey]
                if (borderTiers) {
                    // Find highest tier the player's score qualifies for
                    let matched: typeof borderTiers[0] | null = null
                    for (const tier of borderTiers) {
                        if (body.score >= tier.score) {
                            matched = tier
                        }
                    }
                    if (matched) {
                        console.log(`[SCORE_ATTACK] borderReward matched: score=${body.score} tierScore=${matched.score} coinItem=${matched.coinItemId}x${matched.coinCount}`)
                        // Give coin item only (rewardItemId=16001 does not exist in CDN)
                        if (matched.coinItemId > 0 && matched.coinCount > 0) {
                            givePlayerItemSync(playerId, matched.coinItemId, matched.coinCount)
                            scoreRewardsResult.items[String(matched.coinItemId)] = (scoreRewardsResult.items[String(matched.coinItemId)] ?? 0) + matched.coinCount
                            scoreAttackRewardIds.push(matched.coinItemId)
                        }
                    }
                }
            }
            console.log(`[SCORE_ATTACK] afterReward: dropIds=${JSON.stringify(scoreRewardsResult.drop_score_reward_ids)}, drops=${scoreRewardsResult.drop_score_reward_ids.length}, items=${JSON.stringify(scoreRewardsResult.items)}, equipList=${scoreRewardsResult.equipment_list?.length ?? 0}`)
            console.log(`[SCORE_ATTACK] response: accomplished=${questAccomplished}, clearRank=${clearRank}, score=${body.score}, elapsed=${body.elapsed_time_ms}, items=${JSON.stringify(scoreRewardsResult.items)}, clientCategory=${questCategory}`)
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

        // Track mission progress (decoupled from core quest mechanics)
        trackCharacterClears(finishCtx)
        trackLeaderPowerflip(finishCtx)
        trackPartyCoClears(finishCtx)
        trackPowerflip(finishCtx)
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
        const partyCharacterIdsArray: number[] = []
        for (const value of partyCharacterIds.values()) {
            if (value !== null && value.id !== null) partyCharacterIdsArray.push(value.id);
        }
        const addExpAmount = fiveBossUnrewarded ? 0 : questData.characterExpReward

        const rewardCharacterExpResult = givePlayerCharactersExpSync(
            playerId,
            partyCharacterIdsArray,
            addExpAmount,
            questData.fixedParty !== undefined
        )

        const dataHeaders = generateDataHeaders({
            viewer_id: viewerId
        })

        // handle event quest-specific data & rewards
        // folder max rounds derived per event: folder ids repeat across events,
        // the flat hardcoded map capped every folder at 2 rounds (700007 超级
        // is actually 3, custom events can be longer)
        // 幻想连战(700098)的 folder 1 上限被顶到 16(> 第 15 关):原生 folder
        // 通关路径只发一次奖励并把 folder 关掉,而这套 15 关设计成可反复刷。
        // 全通奖励改由 settleFantasyBattleSync 每轮发一份 —— 这就是「二选一」,
        // 两条路不会同时触发。其余事件(含深渊 700099)原样返回派生结果。
        const derivedFolderMaxRounds = withFantasyFolderSentinel(
            questData.rushEventId ?? 0,
            getRushEventFolderMaxRounds(questData.rushEventId ?? 0),
        )
        const rushFinishParams: Parameters<typeof handleRushEventFinish>[0] = {
            questCategory,
            questData,
            clearTime,
            party: bodyPartyStatistics,
            playerId,
            questId,
            getEvoLevels: (pid, chars) => getCharactersEvolutionImgLevels(pid, chars),
            folderMaxRounds: derivedFolderMaxRounds,
            getRushEvent: (pid, eid) => getPlayerRushEventSync(pid, eid),
            updateRushEvent: (pid, data) => updatePlayerRushEventSync(pid, data),
            insertParty: (pid, eid, p) => insertPlayerRushEventPlayedPartySync(pid, eid, p),
            insertClearedFolder: (pid, eid, fid) => insertPlayerRushEventClearedFolderSync(pid, eid, fid),
            deletePartyList: (pid, eid, bt) => deletePlayerRushEventPlayedPartyListSync(pid, eid, bt),
            getSerializedParties: (pid, eid) => getSerializedPlayerRushEventPlayedPartiesSync(pid, eid),
            getFolderRewards: (eid, fid) => getRushEventFolderClearRewards(eid, fid),
            giveRewards: (pid, r) => givePlayerRewardsSync(pid, r),
            getClearedFolders: (pid, eid) => getPlayerRushEventClearedFoldersSync(pid, eid),
        }
        const { rushEventData, rushEventRewardsResult } = handleRushEventFinish(rushFinishParams)
        const modeRushExtension = dispatchModeRushFinish(rushFinishParams, settlementModeHost)
        if (modeRushExtension?.rush_battle_reward_list?.length && rushEventData) {
            rushEventData.rush_battle_reward_list.push(
                ...modeRushExtension.rush_battle_reward_list,
            )
        }

        // 排行榜:累计这一关的净战斗时间;打完最终关就收榜(见 lib/rush-leaderboard)
        if (questCategory === QuestCategory.RUSH_EVENT
            && questData.rushEventId !== undefined
            && questData.rushEventFolderId !== undefined
            && questData.rushEventRound !== undefined) {
            noteRushRoundFinish({
                playerId,
                eventId: questData.rushEventId,
                folderId: questData.rushEventFolderId,
                round: questData.rushEventRound,
                accomplished: questAccomplished,
                elapsedMs: clearTime,
                characterIds: bodyPartyStatistics.characters.map(val => val?.id ?? null),
                unisonCharacterIds: bodyPartyStatistics.unison_characters.map(val => val?.id ?? null)
            })
        }

        // mod: folder 1 的 master quest_kind 已改成 2,客户端会走原生「无尽战斗」记录卡
        // 分支去读 high_score / best_elapsed_time_ms 等字段;而服务端仍按 rushEventRound
        // 判定为 FOLDER 战斗、把这些字段填 null。这里用排行榜的数据补上,让记录卡有内容。
        // 必须排在 noteRushRoundFinish 之后 —— 记录卡的「本次用时」直接读
        // active.battleMs(2026-08-28 口径),写在前面就是稳定少算一整关。
        // 旧口径下这里读的是 Date.now()-startedAtMs,顺序错了误差很小,现在是硬依赖。
        if (rushEventData !== null
            && questCategory === QuestCategory.RUSH_EVENT
            && questData.rushEventId !== undefined
            && questData.rushEventFolderId !== undefined
            && questData.rushEventRound !== undefined) {
            const endlessCard = buildRushEndlessCardFields({
                playerId,
                eventId: questData.rushEventId,
                folderId: questData.rushEventFolderId,
                round: questData.rushEventRound,
                totalRounds: derivedFolderMaxRounds[questData.rushEventFolderId] ?? 0,
                accomplished: questAccomplished
            })
            if (endlessCard !== null) {
                rushEventData.high_score = endlessCard.high_score
                rushEventData.best_elapsed_time_ms = endlessCard.best_elapsed_time_ms
                rushEventData.old_best_elapsed_time_ms = endlessCard.old_best_elapsed_time_ms
                rushEventData.endless_battle_max_round = endlessCard.endless_battle_max_round
                rushEventData.old_endless_battle_max_round = endlessCard.old_endless_battle_max_round
                rushEventData.endless_battle_next_round = endlessCard.endless_battle_next_round
                console.log(`[RUSH-LB] endless card: round=${questData.rushEventRound}`
                    + ` maxRound=${endlessCard.endless_battle_max_round}`
                    + ` high=${endlessCard.high_score}ms best=${endlessCard.best_elapsed_time_ms}ms`
                    + ` oldBest=${endlessCard.old_best_elapsed_time_ms}ms`)
            }
        }

        // roguelike rush mod: per-round loot drops (assets/rogue_event.json)
        const rogueDrops = handleRoguePerRoundDrops({
            questCategory,
            questAccomplished,
            playerId,
            questData,
            folderMaxRounds: derivedFolderMaxRounds,
            partyCharacterIds: partyCharacterIdsArray,
        })
        if (rogueDrops !== null && rushEventData !== null && rogueDrops.showInRewardList) {
            rushEventData.rush_battle_reward_list = [
                ...rushEventData.rush_battle_reward_list,
                ...rogueDrops.rewardListEntries
            ]
        }

        // Record played party for RAID_EVENT
        handleRaidEventFinish({
            questCategory,
            activeEventId: activeQuestData.eventId,
            party: bodyPartyStatistics,
            playerId,
            questId,
            getEvoLevelsFn: (pid, chars) => getCharactersEvolutionImgLevels(pid, chars),
            insertPartyFn: (pid, eid, p) => insertPlayerRushEventPlayedPartySync(pid, eid, p),
        })

        // handle carnival event score & records
        const carnivalEventData = handleCarnivalEventFinish({
            questCategory,
            questAccomplished,
            questId,
            clearTime,
            party: bodyPartyStatistics,
            playerId,
            carnivalLookup: carnivalScoreLookup,
            upsertFn: (pid, eid, fid, score, chars, unisons) => upsertPlayerCarnivalEventRecordSync(pid, eid, fid, score, chars, unisons),
        })

        // 幻想连战的跨事件结算。放在这里的理由:必须排在普通关卡结算写完通关
        // 记录、rush-handler 写完 played-party 标记之后 —— 顺序门与全通判定都
        // 读那两张表。不是 700098 的关一律返回 null,深渊 700099 不受影响。
        const fantasySettlement = settleFantasyBattleSync(
            playerId,
            questCategory,
            questId,
            questAccomplished,
        )

        const itemList = {
            ...(activeQuestData.entryItemId ? { [activeQuestData.entryItemId]: getPlayerItemSync(playerId, activeQuestData.entryItemId) ?? 0 } : {}),
            ...scoreRewardsResult.items,
            ...(rushEventRewardsResult?.items ?? {}),
            ...(rogueDrops?.rewardResult.items ?? {}),
            ...(fantasySettlement?.items ?? {}),
            ...(fiveBossSolo?.items ?? {})
        }
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": dataHeaders,
            "data": {
                "user_info": {
                    "free_mana": newMana + (clearReward?.user_info.free_mana || 0) + (sPlusClearReward?.user_info.free_mana || 0) + scoreRewardsResult.user_info.free_mana,
                    "exp_pool": (rogueDrops?.expPoolAbsolute ?? rewardCharacterExpResult.exp_pool) + (clearReward?.user_info.exp_pool || 0) + scoreRewardsResult.user_info.exp_pool,
                    "exp_pooled_time": getServerTime(playerData.expPooledTime),
                    "free_vmoney": playerData.freeVmoney + (clearReward?.user_info.free_vmoney || 0) + (sPlusClearReward?.user_info.free_vmoney || 0) + scoreRewardsResult.user_info.free_vmoney,
                    "rank_point": newRankPoint,
                    "degree_id": 1,
                    "stamina": playerData.stamina,
                    "stamina_heal_time": realToVirtual(playerData.staminaHealTime),
                    "boost_point": newBoostPoint,
                    "boss_boost_point": newBossBoostPoint
                },
                "add_exp_list": [
                    ...rewardCharacterExpResult.add_exp_list,
                    ...(rogueDrops?.addExpList || [])
                ],
                "character_list": [
                    ...rewardCharacterExpResult.character_list,
                    ...(clearReward?.character_list || []),
                    ...(sPlusClearReward?.character_list || []),
                    ...scoreRewardsResult.character_list,
                    ...(rushEventRewardsResult?.character_list || []),
                    // full entry (with entry_count/bond_token_list) must precede
                    // the exp-updated entry so the client registers the new
                    // character before skipping already-owned entries
                    ...(rogueDrops?.rewardResult.character_list || []),
                    ...(rogueDrops?.expCharacterList || []),
                    ...(fantasySettlement?.character_list || [])
                ],
                "bond_token_status_list": {
                    ...rewardCharacterExpResult.bond_token_status_list,
                    ...(rogueDrops?.bondTokenStatusList || {})
                },
                "rewards": {
                    "overflow_pool_exp": 0,
                    "converted_pool_exp": 0,
                    "reward_pool_exp": questPoolExpReward,
                    "reward_mana": questManaReward,
                    "field_mana": body.add_mana
                },
                "old_high_score": questProgress === null ? 0 : questProgress.highScore || 0,
                "joined_character_id_list": [
                    ...(clearReward?.joined_character_id_list || []),
                    ...(sPlusClearReward?.joined_character_id_list || []),
                    ...scoreRewardsResult.joined_character_id_list,
                    ...(fantasySettlement?.joined_character_id_list || [])
                ],
                "before_rank_point": beforeRankPoint,
                "clear_rank": clearRank ?? 5,
                "drop_score_reward_ids": scoreRewardsResult.drop_score_reward_ids,
                "drop_rare_reward_ids": scoreRewardsResult.drop_rare_reward_ids,
                "drop_additional_reward_ids": [
                    ...(fantasySettlement?.fantasy_additional_reward_ids ?? []),
                    ...(fiveBossSolo?.dropAdditionalRewardIds ?? [])
                ],
                "drop_periodic_reward_ids": [],
                "equipment_list": [
                    ...scoreRewardsResult.equipment_list,
                    ...(clearReward?.equipment_list || []),
                    ...(sPlusClearReward?.equipment_list || []),
                    ...(rushEventRewardsResult?.equipment_list || []),
                    ...(rogueDrops?.rewardResult.equipment_list || []),
                    ...(fantasySettlement?.equipment_list || [])
                ],
                "category_id": body.category,
                "start_time": dataHeaders['servertime'],
                "is_multi": "single",
                "quest_name": "",
                "item_list": itemList,
                "rush_event": rushEventData,
                "carnival_event": carnivalEventData,
                "user_daily_challenge_point_list": dailyChallengePointList ?? [],
                "presigned_quest_category": []
            }
        })

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

        // delete existing active quest
        delete activeQuests[playerId]
        deletePlayerActiveQuestSync(playerId)
        clearFiveBossSoloStartSync(playerId)

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

        // get quest data
        const questData = getQuestFromCategorySync(category, questId) as BattleQuest | null
        if (questData === null || !('rankPointReward' in questData)) {
            console.log(`[BATTLE] start failed: category=${category} questId=${questId} found=${!!questData} hasRankReward=${questData ? ('rankPointReward' in questData) : 'N/A'}`)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Quest doesn't exist."
            })
        }

        // Loaded modes may veto entry before any ticket, stamina, or active
        // quest state is changed. No loaded modes means a strict no-op.
        try {
            dispatchModeQuestStart(
                { playerId, questId, questCategory: category },
                singleBattleModeHost,
            )
        } catch (error) {
            return reply.status(400).send({
                "error": "Bad Request",
                "message": (error as Error).message,
            })
        }

        // 幻想连战的第 5/10/15 关是三人联机关。从单人入口开起来只会进一场没有队友
        // 的空战斗,还会占掉 active quest。modes.d 的 fantasy-gauntlet 模块也会
        // 否决这一步(文案可配),这里是**即使那个模块被停用也仍然生效**的硬底线。
        // 只认 300098 的三个 quest id,别的关一律不经过。
        if (isFantasyGauntletEnabled() && isFantasyMultiQuest(category, questId)) {
            console.log(`[FANTASY] solo entry rejected: player=${playerId} quest=${questId}`)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "幻想连战的第5/10/15关为联机关卡，请从联机房间进入。"
            })
        }

        // mod(深渊连战排行榜): 被征用成「榜」的排名活动只能看,不能打 —— 它没有真关卡,
        // 真开起来是一场没有数据的空战斗。客户端侧关卡行自己的时间窗早过期(2022),
        // 这里再兜一道,确保就算点进去也只是一句错误提示,不会掉进坏战斗。
        if (isRushBoardRankingQuest(category, questId)) {
            console.log(`[RUSH-LB] blocked start of board-only ranking quest: questId=${questId}`)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "This ranking event is a leaderboard view only."
            })
        }

        const prerequisiteCheck = canStartQuestByPrerequisites(questData, (requiredQuestId) =>
            hasClearedQuestPrerequisiteForCategory(category, requiredQuestId, (section, id) =>
                getPlayerSingleQuestProgressSync(playerId, section, id)
            )
        )
        if (!prerequisiteCheck.ok) {
            return reply.status(400).send({
                "error": "Bad Request",
                "message": prerequisiteCheck.message
            })
        }

        // Deduct entry cost (ticket/item)
        const questKey = `${category}_${questId}`
        const configuredEntryCost = (questEntryCosts as Record<string, {itemId: number, itemCount: number, stamina: number}>)[questKey]
        const staminaInfo = getStaminaCost(questKey)
        const entryCost = resolveBattleStartEntryCost(questData, configuredEntryCost)
        console.log(`[BATTLE] start entry: questId=${questId} questKey=${questKey} entryCost=${JSON.stringify(entryCost)} discountRate=${staminaInfo.rate} baseStamina=${staminaInfo.baseCost}→${staminaInfo.cost}`)
        // 五重决战(2026-09-09 作者规则):凭证是"可选"的 —— 没票也能开局,只是本局不发模式奖励。
        // 多人房同款规则在 fiveBossGauntletRun.startMemberSync(只扣房主、扣不到就 rewards_enabled=0)。
        const entryItemOptional = isFiveBossGauntletFamilyQuest(category, questId)
        let entryItemConsumed = false
        if (entryCost && entryCost.itemId > 0) {
            const playerItemCount = getPlayerItemSync(playerId, entryCost.itemId) ?? 0
            console.log(`[BATTLE] start deduct: itemId=${entryCost.itemId} playerHas=${playerItemCount} need=${entryCost.itemCount}`)
            if (playerItemCount < entryCost.itemCount) {
                if (!entryItemOptional) {
                    return reply.status(400).send({
                        "error": "Bad Request",
                        "message": `Not enough entry items (need ${entryCost.itemCount} of ${entryCost.itemId}, have ${playerItemCount}).`
                    })
                }
                console.log(`[FIVE-BOSS] solo start without ticket: playing for no rewards player=${playerId} questId=${questId}`)
            } else {
                updatePlayerItemSync(playerId, entryCost.itemId, playerItemCount - entryCost.itemCount)
                entryItemConsumed = true
            }
        }

        // Deduct stamina cost
        const staminaCost = resolveBattleStartStaminaCost(questData, staminaInfo)
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
            console.log(`[BATTLE-START] stamina: ${currentStamina} -> ${newStamina} (cost: ${staminaCost}, rate: ${staminaInfo.rate})`)
        } else {
            // No stamina deduction, read current stamina for response
            const player = getPlayerSync(playerId)
            afterStamina = player?.stamina ?? 0
        }

        // add to active quests table (persisted, so finish survives a restart)
        insertActiveQuest(playerId, {
            questId: questId,
            category: category,
            useBoostPoint: useBoostPoint,
            useBossBoostPoint: useBossBoostPoint,
            isAutoStartMode: isAutoStartMode,
            isMulti: false,
            entryItemId: entryItemConsumed ? entryCost?.itemId : undefined,
            playId: body.play_id,
            continueCount: 0
        })

        // 单人五重:记开战 AUTO 快照(players_options.auto_play,编成页开关会先 option/update 同步上来)。
        // 只在真扣了票时才记;没票的局本来就不发奖,不需要倍率。
        if (isFiveBossGauntletQuest(category, questId)) {
            if (entryItemConsumed) {
                const autoAtStart = getPlayerOptionsSync(playerId)["auto_play"] === true
                recordFiveBossSoloStartSync(playerId, body.play_id, autoAtStart)
                console.log(`[FIVE-BOSS] solo start: player=${playerId} autoAtStart=${autoAtStart}`)
            } else {
                clearFiveBossSoloStartSync(playerId)
            }
        }

        // update player last party slot
        if (questData.fixedParty === undefined) {
            updatePlayerSync({
                id: playerId,
                partySlot: partyId
            })
        }

        const dataHeaders = generateDataHeaders({
            viewer_id: viewerId
        })

        // 扣了入场道具就把新总数带回去:客户端 RealRemoteService 会读可选的 item_list 刷背包数字,
        // 否则门票数字要到 finish 才更新(结算前中途退出会一直显示旧数)。
        const startItemList = entryItemConsumed && entryCost
            ? { [String(entryCost.itemId)]: getPlayerItemSync(playerId, entryCost.itemId) ?? 0 }
            : undefined

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": dataHeaders,
            "data": {
                ...(startItemList ? { "item_list": startItemList } : {}),
                "user_info": {
                    "last_main_quest_id": body.quest_id,
                    "stamina": afterStamina,
                    "stamina_heal_time": realToVirtual(new Date())
                },
                "category_id": body.category,
                "is_multi": "single",
                "start_time": dataHeaders['servertime'],
                "quest_name": ""
            }
        })
    })

    fastify.post("/play_continue", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as PlayContinueBody

        const viewerId = body.viewer_id
        if (isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        })

        const sessionResult = await validateSessionAndPlayer(viewerId)
        if (!sessionResult) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid viewer id."
        })
        const { playerId, playerData: player } = sessionResult

        // get active quest data
        const resolvedContinue = resolveActiveQuest({
            playerId,
            hint: { quest_id: body.quest_id, category: body.category, play_id: body.paly_id },
            memory: activeQuests
        })
        if (resolvedContinue === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": "No active quest to continue."
        })
        const activeQuestData = resolvedContinue.quest
        if (resolvedContinue.source === "rebuilt") {
            // Register it so the finish that follows resolves from memory.
            insertActiveQuest(playerId, activeQuestData)
        }

        const questData = getQuestFromCategorySync(activeQuestData.category, activeQuestData.questId) as BattleQuest | null
        if (questData === null || !('rankPointReward' in questData)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Quest doesn't exist."
        })

        const continueCheck = canContinueBattle(questData, activeQuestData.continueCount)
        if (!continueCheck.ok) return reply.status(400).send({
            "error": "Bad Request",
            "message": continueCheck.message
        })

        const freeVmoney = player.freeVmoney
        const newFreeVmoney = freeVmoney - continueVmoneyCost
        const vmoney = player.vmoney
        const newVmoney = 0 > newFreeVmoney ? vmoney - continueVmoneyCost : vmoney
        if (0 > newFreeVmoney && 0 > newVmoney) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Not enough vmoney to continue"
        })

        // update the player's vmoney balances
        const setNewFreeVmoney = 0 > newFreeVmoney ? freeVmoney : newFreeVmoney
        updatePlayerSync({
            id: playerId,
            freeVmoney: setNewFreeVmoney,
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
                    "free_vmoney": setNewFreeVmoney,
                    "vmoney": newVmoney
                },
                "mail_arrived": false
            }
        })

    })
}

export default routes;
