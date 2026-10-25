import { recordContentActionFactsSync } from "../../lib/mission/content-action-facts";
import { parseSingleContinueExpectedCount } from "../../lib/quest/single-continue-request";
import { FIVE_BOSS_GAUNTLET, isFiveBossGauntletQuest, isFiveBossHiddenQuest } from "../../multi/five-boss/contract";
import { continueFiveBoss, fiveBossContinueAcknowledgement, FiveBossContinueError,
    isFiveBossContinueRequest } from "../../multi/five-boss/continue-runtime";
import { isFiveBossTicketShortage, sendFiveBossTicketShortage } from "../../multi/five-boss/entry-response";
import { startFiveBossSoloSync, abortFiveBossSoloSync, getFiveBossSoloReceiptSync, isActiveFiveBossSoloSync } from "../../multi/five-boss/solo-runtime";
import { getFiveBossRunByClientSync } from "../../data/domains/fiveBossGauntletRun";
import { getRoomCommandGateway } from "../../multi/coordinator/default-runtime";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { deletePlayerActiveQuestIfPlayIdSync, deletePlayerActiveQuestSync, getPlayerActiveQuestSync, insertPlayerActiveQuestSync, updatePlayerActiveQuestContinueCountIfPlayIdSync } from "../../data/domains/quest_active"
import { clientSerializeDate } from "../../data/utils/date"
import { getBattleClockDate, isSupportedBattleClockVersion } from "../../lib/battle-clock-compatibility"
import { assertBattleCanStartSync, getBattleReplaySync } from "../../data/domains/battle-settlement-ledger"
import { isSingleFinishResponse, singleFinishPlayId } from "../../lib/quest/finish/single-finish-identity"
import { getPlayerDailyChallengePointListSync, getPlayerSync, updatePlayerSync } from "../../data/domains/player"
import { getContentNativeDailyChallengePointId } from "../../lib/content-quest-rules"
import { getPlayerItemSync, updatePlayerItemSync } from "../../data/domains/item"
import { getPlayerEquipmentListSync } from "../../data/domains/equipment"
import { insertPlayerPracticeBattleHistorySync } from "../../data/domains/practice-battle-history"
import { getQuestFromCategorySync } from "../../lib/assets";
import { BattleQuest, QuestCategory } from "../../lib/types";
import { generateDataHeaders, getServerTime, getServerDate, getRealServerDate, realToVirtual } from "../../utils";
import { PartyCategory, UserRushEventPlayedParty } from "../../data/types";
import { computeRealTimeStamina } from "../../lib/stamina";
import { getStaminaCost } from "../../lib/stamina-cost";
import { calculateClearRank } from "../../lib/quest/finish/quest-calc";
import { validateSessionAndPlayer } from "../../lib/quest/finish/session-validator";
import { resolveActiveQuest } from "../../lib/quest/finish/active-quest-resolver";
import { captureBattleRosterSync, isBattleRosterError, normalizeBattleParty, resolveRaidSubStatistics, type BattleRoster } from "../../lib/quest/battle-roster";
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
    SINGLE_SETTLE_FINISH,
    type SingleSettleFinishArgs,
    type SingleSettleFinishResult,
} from "../../lib/persistence/command-names";
import { measureSettlementPhaseAsync } from "../../lib/settlement-performance";
import { recordSingleSettlementBodyTiming } from "../../lib/single-settlement-diagnostics";
import {
    acquireFinishExecution,
    buildFinishResponseCacheKey,
    cacheFinishResponse,
    getCachedFinishPlayId,
} from "../../lib/finish-response-cache";
import { buildPracticeBattleHistoryRecord } from "../../lib/quest/practice-battle-history";
import { isContentQuestOpenAt } from "../../lib/content-operations";
import { canStartAbyssQuestSync } from "../../data/domains/abyss-tower-progress";
import { isAbyssExEndlessQuest } from "../../lib/abyss-modes";
import { addManaSafe, buildBattleManaRewards, isFieldManaError, readFieldMana } from "../../lib/quest/finish/field-mana";
import { isManaCounterError } from "../../data/domains/mana-counter";
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
    sub_statistics?: unknown
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
    is_lose?: boolean
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
    clockVersion?: number
    battleRoster?: BattleRoster | null
}

const continueVmoneyCost = 50;

export const activeQuests: Record<number, ActiveQuest> = {}

export function insertActiveQuest(playerId: number, quest: ActiveQuest) {
    const startedAtMs = quest.startedAtMs ?? getRealServerDate().getTime()
    const questTimeRevision = isAbyssFiniteQuest(quest.category, quest.questId)
        ? getAbyssTimeRevision(Math.floor(quest.questId / 1000)) : null
    // The caller may freeze this same object for a delayed multiplayer finish.
    // Its clock identity must match the committed registration, not only cache.
    quest.startedAtMs = startedAtMs
    quest.questTimeRevision = questTimeRevision
    quest.clockVersion = 1
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
        battleRoster: quest.battleRoster,
    })
    activeQuests[playerId] = { ...quest }
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
        const { playerId } = sessionResult
        const legacyFinishCacheKey = buildFinishResponseCacheKey(
            "single",
            viewerId,
            body as unknown as Record<string, unknown>,
        )
        const releaseFinishExecution = await acquireFinishExecution(`single:${playerId}`)
        try {
            const requestPlayId = singleFinishPlayId(body.play_id)
            const replayReceipt = (playId: string | null): boolean => {
                if (playId === null) return false
                const replay = getBattleReplaySync(playerId, "single", playId)
                if (replay.kind === "missing") return false
                if (replay.kind !== "available" || !isSingleFinishResponse(replay.response)) {
                    reply.status(400).send({ error: "Bad Request", message: "Battle result cannot be replayed. Please reload." })
                } else {
                    reply.header("content-type", "application/x-msgpack")
                    reply.status(200).send(replay.response)
                }
                return true
            }
            // An old explicit play can replay its receipt even while a new battle is active.
            if (replayReceipt(requestPlayId)) return reply
            // Runs settled before generic solo receipts were introduced still
            // have their dedicated five-boss receipt. Replay it before a newer
            // active battle is checked, without consuming the newer registration.
            if (requestPlayId !== null) {
                const legacySoloResponse = getFiveBossSoloReceiptSync(playerId, legacyFinishCacheKey)
                if (legacySoloResponse !== undefined) {
                    if (!isSingleFinishResponse(legacySoloResponse)) {
                        return reply.status(400).send({ error: "Bad Request", message: "Invalid single finish receipt." })
                    }
                    reply.header("content-type", "application/x-msgpack")
                    return reply.status(200).send(legacySoloResponse)
                }
            }

            const persistedQuest = getPlayerActiveQuestSync(playerId)
            const memoryQuest = activeQuests[playerId]
            const currentRegistration = persistedQuest ?? memoryQuest
            if (currentRegistration?.isMulti) {
                return reply.status(400).send({ error: "Bad Request", message: "Multiplayer play cannot settle as single." })
            }
            if (currentRegistration !== undefined && currentRegistration !== null && (
                Number(body.quest_id) !== currentRegistration.questId
                || (requestPlayId !== null && singleFinishPlayId(currentRegistration.playId) !== null
                    && requestPlayId !== currentRegistration.playId)
            )) {
                return reply.status(400).send({ error: "Bad Request", message: "Finish does not match the active quest." })
            }
            // A queued /start can replace the database row before this handler resumes.
            if (persistedQuest && memoryQuest && persistedQuest.playId !== memoryQuest.playId) {
                delete activeQuests[playerId]
            }
            if (!currentRegistration) {
                // api_count is only an alias. Its cached payload cannot bypass
                // an expired or pruned durable replay, even with a long cache TTL.
                const aliasPlayId = getCachedFinishPlayId(legacyFinishCacheKey)
                if (aliasPlayId && replayReceipt(aliasPlayId)) return reply
                const legacySolo = getFiveBossSoloReceiptSync(playerId, legacyFinishCacheKey)
                if (legacySolo !== undefined) {
                    if (!isSingleFinishResponse(legacySolo)) return reply.status(400).send({
                        error: "Bad Request", message: "Invalid single finish receipt.",
                    })
                    reply.header("content-type", "application/x-msgpack")
                    return reply.status(200).send(legacySolo)
                }
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

            const registered = resolvedActiveQuest?.source !== "rebuilt"
            const receiptPlayId = requestPlayId ?? (registered ? singleFinishPlayId(activeQuestData.playId) : null)
            if (replayReceipt(receiptPlayId)) return reply
            // Bind a legacy api_count request to its registered play while that play exists.
            // The unscoped key remains only a short-lived retry alias after consumption.
            const finishCacheKey = buildFinishResponseCacheKey(
                "single", viewerId,
                receiptPlayId === null ? body as unknown as Record<string, unknown>
                    : { ...body, play_id: receiptPlayId },
            )
            const cachedFinishResponse = getFiveBossSoloReceiptSync(playerId, finishCacheKey)
            if (cachedFinishResponse !== undefined) {
                reply.header("content-type", "application/x-msgpack")
                return reply.status(200).send(cachedFinishResponse)
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
                if (registered) deletePlayerActiveQuestIfPlayIdSync(playerId, activeQuestData.playId)
                if (activeQuests[playerId] === activeQuestData) delete activeQuests[playerId]
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

            let manaObtained: number
            try {
                const fieldMana = readFieldMana(body.add_mana)
                buildBattleManaRewards(questData.manaReward, fieldMana, isMode15Quest(questCategory, questId))
                manaObtained = isAbyssExEndlessQuest(questCategory, questId) ? 0 : addManaSafe(questData.manaReward, fieldMana)
                normalizeBattleParty(body.statistics?.party, questData.fixedParty !== undefined)
                resolveRaidSubStatistics(activeQuestData.battleRoster, body.statistics, body.sub_statistics)
            } catch (error) {
                if (!isBattleRosterError(error) && !isFieldManaError(error) && !isManaCounterError(error)) throw error
                return reply.status(400).send({ error: "Bad Request", message: (error as Error).message })
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

            // State-dependent totals and first-clear progress are resolved by the transaction.
            const displayMode15ManaAsFieldDrop = isMode15Quest(questCategory, questId)

            // The native forced-loss main scene advances the story while the
            // battle itself remains a defeat for mission and history facts.
            let questAccomplished = body.is_accomplished
            let battleFactsAccomplished = body.is_accomplished
            if (questCategory === QuestCategory.MAIN && questId === 7014002 && body.is_lose === true) {
                questAccomplished = true
                battleFactsAccomplished = false
            }
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
                battleFactsAccomplished = questAccomplished
            }

            let finishResponse: SingleSettleFinishResult
            try {
                finishResponse = await measureSettlementPhaseAsync("single", "transaction", () => (
                    runWriterCommand<SingleSettleFinishArgs, SingleSettleFinishResult>(
                        SINGLE_SETTLE_FINISH,
                        {
                            playerId, viewerId, questCategory, questId, questData, activeQuestData, body,
                            clearTime, clearRank, questAccomplished, battleFactsAccomplished,
                            // The patched client may skip /start; a rebuilt active quest must
                            // not seed Abyss records as a registered run.
                            fiveBossSoloQuest, registered,
                            scoreAttackBorderTiers, manaObtained, displayMode15ManaAsFieldDrop,
                            finishCacheKey, receiptPlayId,
                        },
                        { domain: "single-quest", playerId, operation: "finish" },
                    )
                ))
            } catch (error) {
                if (!isBattleRosterError(error) && !isFieldManaError(error) && !isManaCounterError(error)) throw error
                return reply.status(400).send({ error: "Bad Request", message: (error as Error).message })
            }
            if (finishResponse.timing !== null) recordSingleSettlementBodyTiming(finishResponse.timing)

            if (activeQuests[playerId] === activeQuestData) delete activeQuests[playerId]
            if (finishResponse.response === null) {
                return reply.status(400).send({ error: "Bad Request", message: "No active quest to finish." })
            }
            cacheFinishResponse(finishCacheKey, finishResponse.response, receiptPlayId ?? undefined)
            cacheFinishResponse(legacyFinishCacheKey, finishResponse.response, receiptPlayId ?? undefined)
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
        if (abortQuest && (
            (body.play_id && body.play_id !== abortQuest.playId)
            || (body.category !== undefined && body.category !== abortQuest.category)
            || (body.quest_id !== undefined && body.quest_id !== abortQuest.questId)
        )) return reply.status(400).send({ error: "Bad Request", message: "Active quest does not match abort request." })
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
                const abortedAtMs = getBattleClockDate(abortQuest.clockVersion ?? 0).getTime()
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
        const aborted = await runPersistenceTransaction({
            domain: "single-quest", playerId, operation: "abort",
        }, () => {
            const current = getPlayerActiveQuestSync(playerId)
            if (!abortQuest || !current || current.playId !== abortQuest.playId || !isSupportedBattleClockVersion(current.clockVersion)) return false
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
                const now = getRealServerDate()
                insertPlayerPracticeBattleHistorySync({ ...practiceHistoryRecord,
                    create_time: clientSerializeDate(new Date(now.getTime() + 8 * 3600_000)),
                    elapsed_time_ms: Math.max(0, getBattleClockDate(current.clockVersion ?? 0).getTime() - current.startedAtMs!),
                })
            }
            return deletePlayerActiveQuestIfPlayIdSync(playerId, abortQuest.playId)
        })

        if (aborted && activeQuests[playerId]?.playId === abortQuest?.playId) delete activeQuests[playerId]
        if (aborted && abortQuest && isMode15Quest(abortQuest.category, abortQuest.questId)) {
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
        if (isNaN(viewerId) || isNaN(partyId) || isNaN(questId) || isNaN(category) || singleFinishPlayId(body.play_id) === null || typeof useBoostPoint !== "boolean" || typeof useBossBoostPoint !== "boolean" || isAutoStartMode === undefined) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        })

        const sessionResult = await validateSessionAndPlayer(viewerId)
        if (!sessionResult) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid viewer id."
        })
        const { playerId, playerData: player } = sessionResult



        if (getPlayerActiveQuestSync(playerId)?.playId !== body.play_id && !isContentQuestOpenAt(category, questId, Date.now())) {
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({ data_headers: generateDataHeaders({ viewer_id: viewerId, result_code: 4050 }), data: {} })
        }
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

        const nativeChallengePointId = getContentNativeDailyChallengePointId(category, questId)
        if (nativeChallengePointId !== null && getPlayerActiveQuestSync(playerId)?.playId !== body.play_id
            && !getPlayerDailyChallengePointListSync(playerId).some(entry => entry.id === nativeChallengePointId && entry.point > 0)) {
            return reply.status(400).send({ error: "Bad Request", message: "Daily challenge points exhausted." })
        }

        if (isFiveBossGauntletQuest(category, questId)) {
            const previousMemory = activeQuests[playerId]
            let insertedMemory: ActiveQuest | undefined
            let mission: MissionSettlementResult | undefined
            try {
                const previous = getPlayerActiveQuestSync(playerId)
                if (previous?.isMulti && previous.playId !== body.play_id && isFiveBossGauntletQuest(previous.category, previous.questId)) {
                    const previousRun = getFiveBossRunByClientSync({ playerId, clientPlayId: previous.playId })
                    const recovery = await getRoomCommandGateway().execute("fiveBoss.recovery", {
                        staleQuest: previous, playerId, ...(previousRun ? { staleFrozenRunId: previousRun.runId } : {}),
                    }) as { recoverable: boolean }
                    if (recovery.recoverable) throw new Error("Finish or abort the multiplayer run before starting solo.")
                    if (previousRun) {
                        const barrier = await getRoomCommandGateway().execute("fiveBoss.proof.barrier", {
                            runId: previousRun.runId, playerId, roomNumber: previousRun.roomNumber,
                        }) as { ok: boolean }
                        if (!barrier.ok) throw new Error("Previous five-boss result proof is not durably acknowledged.")
                    }
                }
                await runPersistenceTransaction({ domain: "single-quest", playerId, operation: "five_boss_solo_start" }, () => {
                    assertBattleCanStartSync(playerId, body.play_id)
                    const pending = getPlayerActiveQuestSync(playerId)
                    if (pending?.playId !== previous?.playId && pending?.playId !== body.play_id) {
                        throw new Error("The current battle changed while preparing solo start.")
                    }
                    const battleRoster = pending?.playId === body.play_id ? pending.battleRoster
                        : captureBattleRosterSync({ playerId, questCategory: category, questId, partyId,
                            fixedParty: questData.fixedParty })
                    return startFiveBossSoloSync(playerId, body.play_id, () => {
                        insertActiveQuest(playerId, {
                            questId, category, useBoostPoint: false, useBossBoostPoint: false,
                            isAutoStartMode, isMulti: false,
                            entryItemId: FIVE_BOSS_GAUNTLET.ticketItemId,
                            partySlot: partyId,
                            playId: body.play_id, continueCount: 0,
                            battleRoster,
                        })
                        insertedMemory = activeQuests[playerId]
                        if (usesNormalCurrentPartySlot(category)
                            && isValidNormalPartySlotSync(playerId, partyId)) {
                            updatePlayerSync({ id: playerId, partySlot: partyId })
                        }
                        recordActiveMissionQuestChallengeFactSync(playerId, category)
                        mission = settleMissionCategories(playerId, [1, 2, 10], new Date(getServerTime() * 1000))
                        return true
                    })
                })
            } catch (error) {
                if (insertedMemory && activeQuests[playerId] === insertedMemory) {
                    if (previousMemory) activeQuests[playerId] = previousMemory
                    else delete activeQuests[playerId]
                }
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
            startedAtMs: getRealServerDate().getTime(),
            clockVersion: 1,
        }

        let afterStamina = 0
        let registeredMemory: ActiveQuest | undefined
        let missionSettlement: MissionSettlementResult | undefined
        try {
            await runPersistenceTransaction({
                domain: "single-quest", playerId, operation: "start",
            }, () => {
                assertBattleCanStartSync(playerId, body.play_id)
                const currentPlayer = getPlayerSync(playerId) ?? player
                const pending = getPlayerActiveQuestSync(playerId)
                if (pending?.playId === body.play_id) {
                    if (pending.isMulti || pending.category !== category || pending.questId !== questId
                        || pending.useBoostPoint !== useBoostPoint || pending.useBossBoostPoint !== useBossBoostPoint
                        || pending.isAutoStartMode !== isAutoStartMode
                        || (questData.fixedParty === undefined && pending.partySlot !== partyId)) {
                        throw new Error("Battle start does not match the pending play.")
                    }
                    // Same-play HTTP retries keep their original clock, fees,
                    // challenge facts and continuation counters unchanged.
                    afterStamina = currentPlayer.stamina
                    return
                }
                if (!isContentQuestOpenAt(category, questId, Date.now())) throw new Error("QUEST_OPERATIONS_CLOSED")
                if (nativeChallengePointId !== null
                    && !getPlayerDailyChallengePointListSync(playerId).some(entry => entry.id === nativeChallengePointId && entry.point > 0)) {
                    throw new Error("Daily challenge points exhausted.")
                }
                activeQuest.battleRoster = captureBattleRosterSync({
                    playerId, questCategory: category, questId, partyId, fixedParty: questData.fixedParty,
                })
                const startedAtMs = getRealServerDate().getTime()
                activeQuest.startedAtMs = startedAtMs
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
                recordContentActionFactsSync(playerId, { kind: "stamina_spend",
                    amount: playerUpdate.totalStaminaUsed - (currentPlayer.totalStaminaUsed ?? 0) })

                activeQuests[playerId] = activeQuest
                registeredMemory = activeQuest
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
                    battleRoster: activeQuest.battleRoster,
                })
                recordActiveMissionQuestChallengeFactSync(playerId, category)
                missionSettlement = settleMissionCategories(
                    playerId,
                    [1, 2, 10],
                    new Date(getServerTime() * 1000),
                )
            })
        } catch (error) {
            if (registeredMemory && activeQuests[playerId] === registeredMemory) {
                if (previousMemory) activeQuests[playerId] = previousMemory
                else delete activeQuests[playerId]
            }
            const message = error instanceof Error ? error.message : String(error)
            const code = (error as { code?: string })?.code
            if (isBattleRosterError(error)) {
                return reply.status(400).send({ error: "Bad Request", message })
            }
            if (message === "QUEST_OPERATIONS_CLOSED") {
                reply.header("content-type", "application/x-msgpack")
                return reply.status(200).send({ data_headers: generateDataHeaders({ viewer_id: viewerId, result_code: 4050 }), data: {} })
            }
            if (code === "BATTLE_ALREADY_SETTLED" || code === "BATTLE_CLOCK_ABORTED"
                || message === "Battle start does not match the pending play."
                || message === "Insufficient stamina." || message === "Daily challenge points exhausted."
                || message.startsWith("Not enough entry items")) {
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
        const expectedContinueCount = parseSingleContinueExpectedCount(raw.statistics)
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
        const { playerId } = sessionResult

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

        if (expectedContinueCount === null) return reply.status(400).send({
            error: "Bad Request", message: "Invalid continue statistics.",
        })

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

        const continued = await runPersistenceTransaction({ domain: "single-quest", playerId, operation: "continue" }, () => {
            const current = getPlayerActiveQuestSync(playerId)
            const freshPlayer = getPlayerSync(playerId)
            if (!current || !freshPlayer || !isSupportedBattleClockVersion(current.clockVersion) || current.isMulti
                || current.playId !== activeQuestData.playId || (playId && playId !== current.playId)
                || current.questId !== questId || current.category !== category) {
                return { ok: false as const, message: "No matching active quest to continue." }
            }
            if (!Number.isSafeInteger(current.continueCount) || current.continueCount < 0
                || !Number.isSafeInteger(freshPlayer.freeVmoney) || freshPlayer.freeVmoney < 0
                || !Number.isSafeInteger(freshPlayer.vmoney) || freshPlayer.vmoney < 0) {
                return { ok: false as const, message: "Invalid continue state." }
            }
            if (current.continueCount !== expectedContinueCount) {
                if (current.continueCount === expectedContinueCount + 1) {
                    return { ok: true as const, newFreeVmoney: freshPlayer.freeVmoney,
                        newVmoney: freshPlayer.vmoney, continueCount: current.continueCount }
                }
                return { ok: false as const, message: "Continue count does not match the active quest." }
            }
            if (current.continueCount === Number.MAX_SAFE_INTEGER) {
                return { ok: false as const, message: "Continue count cannot be incremented." }
            }
            const freeCost = Math.min(freshPlayer.freeVmoney, continueVmoneyCost)
            const paidCost = continueVmoneyCost - freeCost
            if (freshPlayer.vmoney < paidCost) return { ok: false as const, message: "Not enough vmoney to continue" }
            const newFreeVmoney = freshPlayer.freeVmoney - freeCost
            const newVmoney = freshPlayer.vmoney - paidCost
            const continueCount = current.continueCount + 1
            updatePlayerSync({ id: playerId, freeVmoney: newFreeVmoney, vmoney: newVmoney })
            if (!updatePlayerActiveQuestContinueCountIfPlayIdSync(playerId, current.playId, continueCount)) throw new Error("Active play changed during continue.")
            return { ok: true as const, newFreeVmoney, newVmoney, continueCount }
        })
        if (!continued.ok) return reply.status(400).send({ error: "Bad Request", message: continued.message })
        const { newFreeVmoney, newVmoney } = continued
        if (activeQuests[playerId]?.playId === activeQuestData.playId) activeQuests[playerId].continueCount = continued.continueCount

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
