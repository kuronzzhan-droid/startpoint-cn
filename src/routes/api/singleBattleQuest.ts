import { FIVE_BOSS_GAUNTLET, isFiveBossGauntletQuest, isFiveBossHiddenQuest } from "../../multi/five-boss/contract";
import { continueFiveBoss, fiveBossContinueAcknowledgement, FiveBossContinueError,
    isFiveBossContinueRequest } from "../../multi/five-boss/continue-runtime";
import { isFiveBossTicketShortage, sendFiveBossTicketShortage } from "../../multi/five-boss/entry-response";
import { startFiveBossSolo, abortFiveBossSoloSync, getFiveBossSoloReceiptSync, isActiveFiveBossSoloSync } from "../../multi/five-boss/solo-runtime";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { deletePlayerActiveQuestSync, insertPlayerActiveQuestSync, updatePlayerActiveQuestContinueCountSync } from "../../data/domains/quest_active"
import { getPlayerSync, updatePlayerSync } from "../../data/domains/player"
import { getPlayerItemSync, updatePlayerItemSync } from "../../data/domains/item"
import { getPlayerEquipmentListSync } from "../../data/domains/equipment"
import { insertPlayerPracticeBattleHistorySync } from "../../data/domains/practice-battle-history"
import { getQuestFromCategorySync } from "../../lib/assets";
import { BattleQuest, QuestCategory } from "../../lib/types";
import { generateDataHeaders, getServerTime, realToVirtual } from "../../utils";
import { PartyCategory, UserRushEventPlayedParty } from "../../data/types";
import { computeRealTimeStamina } from "../../lib/stamina";
import { getStaminaCost } from "../../lib/stamina-cost";
import { calculateClearRank } from "../../lib/quest/finish/quest-calc";
import { validateSessionAndPlayer } from "../../lib/quest/finish/session-validator";
import { resolveActiveQuest } from "../../lib/quest/finish/active-quest-resolver";
import { getAbyssTimeRevision, getAbyssTimeRevisionAtVersion, isAbyssFiniteQuest, isStaleAbyssBattle, isStaleAbyssClient } from "../../lib/abyss-time-revision";
import {
    calculateScoreAttackClearRank,
    resolveScoreAttackBorderTiers,
    ScoreAttackBorderTier,
} from "../../lib/quest/finish/score-attack-handler";
import { getSteamRobotMissionClientChecks } from "../../lib/mission/steam-robot-challenge"
import {
    mergeMissionSettlementResponse,
    settleMissionCategories,
} from "../../lib/mission"
import type { MissionSettlementResult } from "../../lib/mission"
import { recordActiveMissionQuestChallengeFactSync } from "../../lib/mission/active-entry-facts"
import { getPlayerMailCountSync } from "../../data/domains/mail"
import questEntryCosts from "../../../assets/quest_entry_costs.json";
import scoreAttackBorderRewards from "../../../assets/score_attack_border_reward.json";
import { gameVerboseLog } from "../../lib/game-logging";
import { runPersistenceTransaction, runWriterCommand } from "../../lib/persistence-coordinator";
import {
    SINGLE_REFRESH_QUEST_PROGRESS,
    SINGLE_SETTLE_FINISH,
    type SingleRefreshQuestProgressArgs,
    type SingleRefreshQuestProgressResult,
    type SingleSettleFinishArgs,
    type SingleSettleFinishResult,
} from "../../lib/persistence/command-names";
import { measureSettlementPhaseAsync } from "../../lib/settlement-performance";
import { recordSingleSettlementBodyTiming } from "../../lib/single-settlement-diagnostics";
import {
    acquireFinishExecution,
    buildFinishExecutionKey,
    buildFinishResponseCacheKey,
    cacheFinishResponse,
    finishRequestPlayId,
    getCachedFinishResponse,
} from "../../lib/finish-response-cache";
import { getFinishReceiptSync } from "../../data/domains/finish-receipt";
import { buildPracticeBattleHistoryRecord } from "../../lib/quest/practice-battle-history";
import { canStartAbyssQuestSync } from "../../data/domains/abyss-tower-progress";
import { isAbyssExEndlessQuest } from "../../lib/abyss-modes";
import { isValidNormalPartySlotSync } from "../../data/domains/party";
import { usesNormalCurrentPartySlot } from "../../lib/party-current-slot";
import {
    getMode15ExclusiveGlobalPartyItemsSync,
    isMode15EquipmentAllowedQuest,
    isMode15Quest,
    settleMode15BattleSync,
} from "../../lib/mode15-optional";
import { partyCategoryForRushEvent } from "../../lib/rush-party-categories";

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
        damage_deal_total?: number
        members?: ({
            origin_damage?: number
            [key: string]: any
        } | null)[]
        [key: string]: any
    }[]
}

export interface FinishBody {
    play_id?: string
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
    statistics?: unknown,
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
    statistics?: QuestStatistics | null,
    viewer_id: number,
    quest_id: number,
    // Some shipped clients omit play_id when the player explicitly leaves a
    // practice battle from the recovery dialog. The active row is the
    // authoritative identity in that case; an empty/missing value must not
    // turn a valid abort into the next-login H400 loop.
    play_id?: string,
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
    continueCount: number,
    startedAtMs?: number
    questTimeRevision?: string | null
}

const continueVmoneyCost = 50;

export const activeQuests: Record<number, ActiveQuest> = {}

export function insertActiveQuest(playerId: number, quest: ActiveQuest) {
    const startedAtMs = quest.startedAtMs ?? getServerTime() * 1000
    const questTimeRevision = isAbyssFiniteQuest(quest.category, quest.questId)
        ? getAbyssTimeRevision(Math.floor(quest.questId / 1000)) : null
    activeQuests[playerId] = { ...quest, startedAtMs, questTimeRevision }
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
        continueCount: quest.continueCount,
        startedAtMs,
        partySlot: quest.partySlot ?? null,
        questTimeRevision,
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
        const cachedFinishResponse = getFiveBossSoloReceiptSync(playerId, finishCacheKey)
            ?? getCachedFinishResponse(finishCacheKey)
        if (cachedFinishResponse !== undefined) {
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send(cachedFinishResponse)
        }
        // One finish per player at a time. Retries and concurrent duplicates
        // wait here and then observe the first request's cached response.
        const releaseFinishExecution = await acquireFinishExecution(
            buildFinishExecutionKey("single", playerId, body as unknown as Record<string, unknown>),
        )
        // Released when this handler's own work ends, never on socket
        // events: a closed client must neither leak the lock nor let a
        // retry run beside a settlement that is still in progress.
        try {
            const coalescedFinishResponse = getFiveBossSoloReceiptSync(playerId, finishCacheKey)
                ?? getCachedFinishResponse(finishCacheKey)
            if (coalescedFinishResponse !== undefined) {
                reply.header("content-type", "application/x-msgpack")
                return reply.status(200).send(coalescedFinishResponse)
            }
            // A play id is settled at most once. Replay its durable receipt (at
            // any age within retention) instead of resolving it as a new play.
            const requestPlayId = finishRequestPlayId(body as unknown as Record<string, unknown>)
            const replayDuplicate = (reason: string) => {
                console.warn(`[FINISH] duplicate finish ignored: playerId=${playerId} play=${requestPlayId ?? "-"} reason=${reason}`)
                const receipt = requestPlayId === null ? null : getFinishReceiptSync(playerId, "single", requestPlayId)
                const replay = getFiveBossSoloReceiptSync(playerId, finishCacheKey)
                    ?? getCachedFinishResponse(finishCacheKey)
                    ?? receipt?.response
                    ?? undefined
                if (replay !== undefined) {
                    cacheFinishResponse(finishCacheKey, replay)
                    reply.header("content-type", "application/x-msgpack")
                    return reply.status(200).send(replay)
                }
                return reply.status(400).send({
                    "error": "Bad Request",
                    "message": "No active quest to finish."
                })
            }
            if (requestPlayId !== null && getFinishReceiptSync(playerId, "single", requestPlayId) !== null) {
                if (activeQuests[playerId]?.playId === requestPlayId) delete activeQuests[playerId]
                return replayDuplicate("receipt")
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
            if (isFiveBossHiddenQuest(questCategory, questId)) {
                return reply.status(400).send({ error: "Bad Request", message: "Internal five-boss scene cannot settle separately." })
            }
            const fiveBossSoloQuest = isFiveBossGauntletQuest(questCategory, questId)
            if (fiveBossSoloQuest && (activeQuestData.isMulti || resolvedActiveQuest?.source === "rebuilt"
                || !finishCacheKey || !isActiveFiveBossSoloSync(playerId, activeQuestData.playId))) {
                return reply.status(400).send({ error: "Bad Request", message: "No registered five-boss solo run." })
            }

            if (resolvedActiveQuest?.source === "rebuilt" && isAbyssFiniteQuest(questCategory, questId)) {
                // Preserve the patched client's no-/start recovery, but never
                // assume a missing registration belongs to the newly published tower.
                activeQuestData.questTimeRevision = getAbyssTimeRevisionAtVersion(request.headers.res_ver, Math.floor(questId / 1000))
            }
            // A restored/late finish from the old tower cannot seed the new record.
            if (isStaleAbyssBattle(activeQuestData) || isStaleAbyssClient(questCategory, questId, request.headers.res_ver)
                || !canStartAbyssQuestSync(playerId, questCategory, questId)) {
                deletePlayerActiveQuestSync(playerId)
                delete activeQuests[playerId]
                reply.header("content-type", "application/x-msgpack")
                return reply.status(200).send({
                    data_headers: generateDataHeaders({ viewer_id: viewerId, asset_update: true, result_code: 4050 }),
                    data: {},
                })
            }
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

            // calculate player rewards. Player totals (rank point, mana, boost
            // points, stamina) are re-read and written inside the settlement
            // transaction so a concurrent write is never overwritten.
            const displayMode15ManaAsFieldDrop = isMode15Quest(questCategory, questId)
            const manaObtained = isAbyssExEndlessQuest(questCategory, questId) ? 0 : questData.manaReward + body.add_mana

            // check current quest progress
            // This lookup refreshes published Abyss best-time revisions and is
            // therefore a write-capable operation. Keep it under the same
            // persistence coordinator as settlement preparation.
            // 深渊最好成绩刷新是"读+写"，整段按注册命令执行：开启写线程时在写线程内
            // 完成，关闭时保持原进程内语义。结算事务内会再读一次进度行作为发奖依据。
            await measureSettlementPhaseAsync("single", "progress_refresh", () => (
                runWriterCommand<SingleRefreshQuestProgressArgs, SingleRefreshQuestProgressResult>(
                    SINGLE_REFRESH_QUEST_PROGRESS,
                    { playerId, section: questCategory, questId },
                    { domain: "single-quest", playerId, operation: "progress_refresh" },
                )
            ));

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

            const finishResponse = await measureSettlementPhaseAsync("single", "transaction", () => (
                runWriterCommand<SingleSettleFinishArgs, SingleSettleFinishResult>(
                    SINGLE_SETTLE_FINISH,
                    {
                        playerId, viewerId, questCategory, questId, questData, playerData, activeQuestData, body,
                        clearTime, clearRank, questAccomplished,
                        // The patched client may skip /start; a rebuilt active quest must
                        // not seed Abyss records as a registered run.
                        fiveBossSoloQuest, registered: resolvedActiveQuest?.source !== "rebuilt",
                        scoreAttackBorderTiers, manaObtained, displayMode15ManaAsFieldDrop,
                        finishCacheKey,
                        receiptPlayIds: [...new Set([
                            requestPlayId,
                            resolvedActiveQuest?.source !== "rebuilt" ? activeQuestData.playId : null,
                        ].filter((id): id is string => typeof id === "string" && id.length > 0))],
                    },
                    { domain: "single-quest", playerId, operation: "finish" },
                )
            ))
            if (finishResponse.timing !== null) recordSingleSettlementBodyTiming(finishResponse.timing)
            if (finishResponse.response === null) {
                // The play was already settled (receipt, or its registration was
                // consumed): nothing was written. Replay the earlier response when
                // it is still available; otherwise report that no play is active.
                if (activeQuests[playerId]?.playId === activeQuestData.playId) delete activeQuests[playerId]
                return replayDuplicate("settled")
            }

            delete activeQuests[playerId]
            cacheFinishResponse(finishCacheKey, finishResponse.response)
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send(finishResponse.response)
        } finally {
            releaseFinishExecution()
        }
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
        let practiceHistoryRecord: ReturnType<typeof buildPracticeBattleHistoryRecord> | null = null
        if (abortQuest?.category === QuestCategory.PRACTICE) {
            const requestedPlayId = typeof body.play_id === "string" ? body.play_id.trim() : ""
            const categoryMatches = body.category === undefined || body.category === abortQuest.category
            const questMatches = body.quest_id === undefined || body.quest_id === abortQuest.questId
            const playMatches = requestedPlayId.length === 0 || requestedPlayId === abortQuest.playId
            if (
                !categoryMatches
                || !questMatches
                || !playMatches
            ) {
                // Keep the diagnostic bounded to identifiers; never log
                // statistics or session material. This distinguishes a real
                // stale quest from the legacy empty-play-id abort shape.
                console.warn(
                    `[PRACTICE-ABORT] request does not match active quest: `
                    + `player=${playerId} request=${body.category}/${body.quest_id}/${requestedPlayId || "(empty)"} `
                    + `active=${abortQuest.category}/${abortQuest.questId}/${abortQuest.playId}`,
                )
                return reply.status(400).send({
                    "error": "Bad Request",
                    "message": "Active practice quest does not match abort request.",
                })
            }
            if (body.statistics == null) {
                // QuestAbortRealRemote omits playStatistics when the player
                // declines recovery after a crash. History is optional here:
                // rejecting abandonment leaves the persisted quest active and
                // traps every later login in the same H400 recovery loop.
                console.warn(
                    `[PRACTICE-HISTORY] abort history skipped because statistics are unavailable: `
                    + `player=${playerId} quest=${abortQuest.questId}`,
                )
            } else if (abortQuest.startedAtMs === undefined) {
                console.warn(
                    `[PRACTICE-HISTORY] abort history skipped because start time is unavailable: `
                    + `player=${playerId} quest=${abortQuest.questId} play=${abortQuest.playId}`,
                )
            } else {
                const abortedAtMs = getServerTime() * 1000
                try {
                    practiceHistoryRecord = buildPracticeBattleHistoryRecord({
                        playerId,
                        playId: abortQuest.playId,
                        categoryId: abortQuest.category,
                        questId: abortQuest.questId,
                        finishKind: body.finish_kind,
                        createdAt: new Date(),
                        elapsedTimeMs: Math.max(0, abortedAtMs - abortQuest.startedAtMs),
                        score: null,
                        clearRank: null,
                        party: body.statistics.party,
                        statistics: body.statistics,
                        equipmentList: getPlayerEquipmentListSync(playerId),
                    })
                } catch (error) {
                    console.warn(
                        `[PRACTICE-HISTORY] invalid abort history payload: player=${playerId} `
                        + `quest=${abortQuest.questId} error=${(error as Error).message}`,
                    )
                    // Invalid optional telemetry must not prevent leaving a
                    // matched battle. Keep strict history validation and omit
                    // the row instead of inventing damage/party data.
                }
            }
        }

        // Keep the failure transition, history row, and active-quest deletion
        // atomic so a partial settlement cannot erase the recoverable battle.
        await runPersistenceTransaction({
            domain: "single-quest", playerId, operation: "abort",
        }, () => {
            if (abortQuest && !abortQuest.isMulti && isFiveBossGauntletQuest(abortQuest.category, abortQuest.questId)) {
                abortFiveBossSoloSync(playerId, abortQuest.playId)
            }
            if (abortQuest && isMode15Quest(abortQuest.category, abortQuest.questId)) {
                settleMode15BattleSync(
                    playerId,
                    abortQuest.category,
                    abortQuest.questId,
                    false,
                )
            }
            if (practiceHistoryRecord !== null) {
                insertPlayerPracticeBattleHistorySync(practiceHistoryRecord)
            }
            deletePlayerActiveQuestSync(playerId)
        })

        delete activeQuests[playerId]
        if (abortQuest && isMode15Quest(abortQuest.category, abortQuest.questId)) {
            console.log(
                `[MODE15] single battle aborted; run reset: player=${playerId} category=${abortQuest.category} quest=${abortQuest.questId}`,
            )
        }

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



        if (isStaleAbyssClient(category, questId, request.headers.res_ver)
            || !canStartAbyssQuestSync(playerId, category, questId)) {
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                data_headers: generateDataHeaders({ viewer_id: viewerId, asset_update: true, result_code: 4050 }),
                data: {},
            })
        }

        if (!isMode15EquipmentAllowedQuest(category, questId)) {
            // Carnival quests use their own saved party category.  Looking up
            // NORMAL here allowed Mode15-exclusive equipment in Carnival even
            // though the selected Carnival party actually contained it.
            const partyCategory = category === QuestCategory.CARNIVAL_EVENT
                ? PartyCategory.CARNIVAL
                : category === QuestCategory.RUSH_EVENT
                    ? partyCategoryForRushEvent(Math.floor(Number(questId) / 1000))
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

        if (isFiveBossHiddenQuest(category, questId)) {
            return reply.status(400).send({ error: "Bad Request", message: "Internal five-boss scene is not an entry quest." })
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

        if (isFiveBossGauntletQuest(category, questId)) {
            const previousMemory = activeQuests[playerId]
            let mission: MissionSettlementResult | undefined
            try {
                await startFiveBossSolo(playerId, body.play_id, () => {
                    insertActiveQuest(playerId, {
                        questId, category, useBoostPoint: false, useBossBoostPoint: false,
                        isAutoStartMode, isMulti: false,
                        entryItemId: FIVE_BOSS_GAUNTLET.ticketItemId,
                        partySlot: partyId,
                        playId: body.play_id, continueCount: 0,
                    })
                    if (usesNormalCurrentPartySlot(category)
                        && isValidNormalPartySlotSync(playerId, partyId)) {
                        updatePlayerSync({ id: playerId, partySlot: partyId })
                    }
                    recordActiveMissionQuestChallengeFactSync(playerId, category)
                    mission = settleMissionCategories(playerId, [1, 2, 10], new Date(getServerTime() * 1000))
                    return true
                })
            } catch (error) {
                if (previousMemory) activeQuests[playerId] = previousMemory
                else delete activeQuests[playerId]
                if (isFiveBossTicketShortage(error)) return sendFiveBossTicketShortage(reply, viewerId)
                return reply.status(400).send({ error: "Bad Request", message: (error as Error).message })
            }
            const latest = getPlayerSync(playerId)!
            const headers = generateDataHeaders({ viewer_id: viewerId })
            const data: Record<string, any> = {
                user_info: { last_main_quest_id: questId, stamina: latest.stamina,
                    stamina_heal_time: realToVirtual(latest.staminaHealTime) },
                item_list: { [FIVE_BOSS_GAUNTLET.ticketItemId]: getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET.ticketItemId) ?? 0 },
                category_id: category, is_multi: "single", start_time: headers.servertime,
                quest_name: "", client_checks: getSteamRobotMissionClientChecks(category, questId),
                mail_arrived: getPlayerMailCountSync(playerId, true) > 0,
            }
            if (mission) mergeMissionSettlementResponse(data, mission, viewerId)
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({ data_headers: headers, data })
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
        }

        // Deduct stamina cost
        const staminaCost = 0
        if (staminaCost > 0) {
            const currentStamina = computeRealTimeStamina(player)
            if (currentStamina < staminaCost) {
                console.warn(`[BATTLE-START] player ${playerId} stamina insufficient: ${currentStamina} < ${staminaCost}`)
                return reply.status(400).send({
                    "error": "Bad Request",
                    "message": "Insufficient stamina."
                })
            }
        }

        const previousMemory = activeQuests[playerId]
        const activeQuest: ActiveQuest = {
            questId: questId,
            category: category,
            useBoostPoint: useBoostPoint,
            useBossBoostPoint: useBossBoostPoint,
            isAutoStartMode: isAutoStartMode,
            isMulti: false,
            entryItemId: entryCost?.itemId,
            partySlot: questData.fixedParty === undefined ? partyId : undefined,
            playId: body.play_id,
            continueCount: 0,
            startedAtMs: getServerTime() * 1000,
        }

        let afterStamina = 0
        let missionSettlement: MissionSettlementResult | undefined
        try {
            await runPersistenceTransaction({
                domain: "single-quest", playerId, operation: "start",
            }, () => {
                const currentPlayer = getPlayerSync(playerId) ?? player
                if (entryCost && entryCost.itemId > 0) {
                    const playerItemCount = getPlayerItemSync(playerId, entryCost.itemId) ?? 0
                    if (playerItemCount < entryCost.itemCount) {
                        throw new Error(
                            `Not enough entry items (need ${entryCost.itemCount} of ${entryCost.itemId}, have ${playerItemCount}).`,
                        )
                    }
                    updatePlayerItemSync(playerId, entryCost.itemId, playerItemCount - entryCost.itemCount)
                }

                const playerUpdate: any = {
                    id: playerId,
                    totalStaminaUsed: (currentPlayer.totalStaminaUsed ?? 0) + nominalStaminaCost,
                }
                if (staminaCost > 0) {
                    const currentStamina = computeRealTimeStamina(currentPlayer)
                    if (currentStamina < staminaCost) {
                        throw new Error("Insufficient stamina.")
                    }
                    const newStamina = Math.max(0, currentStamina - staminaCost)
                    playerUpdate.stamina = newStamina
                    playerUpdate.staminaHealTime = new Date()
                    playerUpdate.totalStaminaUsed = (currentPlayer.totalStaminaUsed ?? 0) + staminaCost
                    afterStamina = newStamina
                    gameVerboseLog(() => `[BATTLE-START] stamina: ${currentStamina} -> ${newStamina} (cost: ${staminaCost}, rate: ${staminaInfo.rate})`)
                } else {
                    afterStamina = currentPlayer.stamina ?? 0
                }
                if (questData.fixedParty === undefined
                    && usesNormalCurrentPartySlot(category)
                    && isValidNormalPartySlotSync(playerId, partyId)) {
                    playerUpdate.partySlot = partyId
                }
                updatePlayerSync(playerUpdate)

                activeQuests[playerId] = activeQuest
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
                    startedAtMs: activeQuest.startedAtMs ?? null,
                    partySlot: activeQuest.partySlot ?? null,
                })
                recordActiveMissionQuestChallengeFactSync(playerId, category)
                missionSettlement = settleMissionCategories(
                    playerId,
                    [1, 2, 10],
                    new Date(getServerTime() * 1000),
                )
            })
        } catch (error) {
            if (previousMemory) activeQuests[playerId] = previousMemory
            else delete activeQuests[playerId]
            const message = error instanceof Error ? error.message : String(error)
            if (message === "Insufficient stamina." || message.startsWith("Not enough entry items")) {
                return reply.status(400).send({ error: "Bad Request", message })
            }
            throw error
        }

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
        // Some legacy builds submit this endpoint as GET, while newer builds
        // use POST. Normalize both forms so a revive is not treated as an
        // unknown route by the client.
        const raw = ((request.method === "GET" ? request.query : request.body) ?? {}) as Partial<PlayContinueBody>
        const viewerId = Number(raw.viewer_id)
        const questId = Number(raw.quest_id)
        const category = Number(raw.category)
        const playId = raw.play_id ?? raw.paly_id
        if (
            !Number.isSafeInteger(viewerId)
            || !Number.isSafeInteger(questId)
            || !Number.isSafeInteger(category)
        ) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        })

        const sessionResult = await validateSessionAndPlayer(viewerId)
        if (!sessionResult) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid viewer id."
        })
        const { playerId, playerData: player } = sessionResult

        if (isFiveBossContinueRequest(playerId, category, questId, playId)) {
            try {
                const data = await continueFiveBoss({ playerId, category, questId, playId,
                    isMulti: false, apiCount: raw.api_count, statistics: raw.statistics })
                const recovered = resolveActiveQuest({ playerId, hint: { category, quest_id: questId, play_id: playId },
                    memory: activeQuests, allowRebuild: false })
                if (recovered && recovered.quest.playId === playId) recovered.quest.continueCount = data.continue_count
                reply.header("content-type", "application/x-msgpack")
                return reply.status(200).send({ data_headers: generateDataHeaders({ viewer_id: viewerId }), data })
            } catch (error) {
                if (!(error instanceof FiveBossContinueError)) throw error
                if (error.stale) {
                    // The solo run already ended; a 400 here makes the CN
                    // client show a fatal H400 and drop to login. Acknowledge
                    // without charging so the client can leave the battle.
                    gameVerboseLog(() => `[MULTI] play_continue: stale ack viewer=${viewerId}`
                        + ` quest=${questId} reason=${error.message}`)
                    reply.header("content-type", "application/x-msgpack")
                    return reply.status(200).send({
                        data_headers: generateDataHeaders({ viewer_id: viewerId }),
                        data: fiveBossContinueAcknowledgement(playerId),
                    })
                }
                return reply.status(400).send({ error: "Bad Request", message: error.message })
            }
        }

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

        }
    })
}

export default routes;
