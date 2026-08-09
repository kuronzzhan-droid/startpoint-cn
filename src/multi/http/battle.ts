import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { MultiStartBody, MultiFinishBody, MultiAbortBody, PlayContinueBody } from "../types";
import { generateDataHeaders, getServerTime, realToVirtual } from "../../utils";
import { getRoom, setRoomBattle, disbandRoom, updateRoomState } from "../room/manager";
import { sessionManager } from "../state/SessionManager";
import { insertActiveQuest, activeQuests } from "../../routes/api/singleBattleQuest";
import {
    deletePlayerActiveQuestSync,
    updatePlayerActiveQuestContinueCountSync,
} from "../../data/domains/quest_active";
import { incrementPlayerCharacterClearSync } from "../../data/domains/character_clear";
import {
    adjustPlayerExpPoolSync,
    getPlayerSync,
    updatePlayerSync,
} from "../../data/domains/player";
import {
    getPlayerSingleQuestProgressSync,
    insertPlayerQuestProgressSync,
    updatePlayerQuestProgressSync,
} from "../../data/domains/quest";
import { getSession } from "../../data/domains/session";
import { getQuestFromCategorySync } from "../../lib/assets";
import { getCharactersEvolutionImgLevels, givePlayerCharactersExpSync } from "../../lib/character";
import { givePlayerRewardsSync, givePlayerRewardSync, givePlayerScoreRewardsSync } from "../../lib/quest";
import { computeRealTimeStamina, getRankDegree, getMaxStamina } from "../../lib/stamina";
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { BattleQuest, EquipmentItemReward, PlayerRewardResult, QuestCategory } from "../../lib/types";
import { getDb } from "../../data/db";
import type { Player } from "../../data/types";
import { collectPartyCharacterIds, recordBattleMissionDimensionsSafe, summarizeBattleStatistics } from "../../lib/mission";
import { getSteamRobotMissionClientChecks, trackSteamRobotChallengeMission } from "../../lib/mission/steam-robot-challenge";
import { reconcileAwakeUnlockCharacterList } from "../../lib/mission";
import { getAwakeBattleMissionIds, mergeMissionSettlementResponse, settleAwakeMissionCandidates, settleMissionCategoriesAsync } from "../../lib/mission";
import { buildBattleMissionSettlementScopes, getBattleActiveMissionPatterns, recordMissionBattleFacts } from "../../lib/mission/battle-facts";
import { reconcileActiveMissionFacts } from "../../lib/mission/active-reconciliation";
import { getContentSnapshot } from "../../content/runtime/content-snapshot";
import { gameVerboseLog } from "../../lib/game-logging";
import { getPlayerMailCountSync } from "../../data/domains/mail";
import type { FinishContext } from "../../lib/quest/finish/types";
import { buildFollowUserInfoSync } from "../../lib/follow";
import { mergeMultiSettlementResults } from "../settlement";
import {
    measureSettlementPhase,
    measureSettlementPhaseAsync,
    recordSettlementPhase,
} from "../../lib/settlement-performance";
import {
    buildFinishResponseCacheKey,
    acquireFinishExecution,
    cacheFinishResponse,
    getCachedFinishResponse,
} from "../../lib/finish-response-cache";
import {
    getRescueFragmentAdditionalReward,
    getRescueFragmentReward,
} from "../rescue-fragment-reward";
import { isMode15RoomClosed } from "../mode15-room-gate";
import { getMode15ExclusiveGlobalPartyItemsSync, isMode15Quest, settleMode15BattleSync } from "../../lib/mode15-optional";
import { recordSuccessfulQuestNpcParty } from "../npc/player-party-pool";
import { runImmediateTransactionWithRetry, withPlayerWriteQueue } from "../../lib/sqlite-write-coordinator";
import {
    buildBattleInstanceId,
    getMultiSettlementSnapshot,
    registerMultiSettlementSnapshot,
    transitionMultiSettlementSnapshot,
} from "../settlement-snapshot";

interface PlayerContext { playerId: number; player: Player }

async function resolvePlayer(viewerId: number): Promise<PlayerContext | null> {
    const session = await getSession(viewerId.toString());
    if (!session) return null;
    const playerId = resolvePlayerIdSync(session.accountId);
    if (!playerId) return null;
    const player = getPlayerSync(playerId);
    if (!player) return null;
    return { playerId, player };
}

async function buildFinishFollowInfo(
    viewerId: number,
    mateResults: Array<{ viewer_id?: number }>,
    fallbackMateIds: number[] = [],
) {
    const requesterCtx = await resolvePlayer(viewerId);
    if (!requesterCtx) return [];
    const ids = new Set<number>();
    for (const result of mateResults) {
        const mateViewerId = Number(result?.viewer_id);
        if (Number.isFinite(mateViewerId)) ids.add(mateViewerId);
    }
    for (const mateViewerId of fallbackMateIds) {
        if (Number.isFinite(mateViewerId)) ids.add(Number(mateViewerId));
    }

    const followInfo = [];
    for (const mateViewerId of ids) {
        if (mateViewerId === viewerId || mateViewerId >= 900000000) continue;

        const mateCtx = await resolvePlayer(mateViewerId);
        if (!mateCtx) continue;

        const info = buildFollowUserInfoSync(requesterCtx.playerId, mateCtx.playerId);
        if (info) followInfo.push(info);
    }

    return followInfo;
}

export function registerBattleRoutes(fastify: FastifyInstance): void {

    // ---- start ----
    fastify.post("/start", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as MultiStartBody;
        const { viewer_id, quest_id, category, party_id, use_boost_point, use_boss_boost_point, is_auto_start_mode, room_number, mate_player_ids, play_id } = body;
        gameVerboseLog(() => `[MULTI] start: viewer=${viewer_id} quest=${quest_id} category=${category} party=${party_id} room=${room_number}`);

        if (isNaN(viewer_id) || isNaN(party_id) || isNaN(quest_id) || isNaN(category) || use_boost_point === undefined || use_boss_boost_point === undefined || is_auto_start_mode === undefined) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        }

        const ctx = await resolvePlayer(viewer_id);
        if (!ctx) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid viewer id or no player bound."
            });
        }

        const questData = getQuestFromCategorySync(category, quest_id) as BattleQuest | null;
        if (questData === null || !('rankPointReward' in questData)) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Quest doesn't exist."
            });
        }

        if (!isMode15Quest(category, quest_id)) {
            const restricted = getMode15ExclusiveGlobalPartyItemsSync(
                ctx.playerId, 1, party_id,
            );
            if (restricted.length > 0) {
                console.log(`[MODE15] exclusive equipment denied in multi start: player=${ctx.playerId} items=${restricted.join(",")}`);
                reply.header("content-type", "application/x-msgpack");
                return reply.status(200).send({
                    data_headers: generateDataHeaders({ viewer_id, result_code: 4050 }),
                    data: {},
                });
            }
        }

        const room = getRoom(room_number);
        if (!room) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Room doesn't exist."
            });
        }

        // The host's first successful settlement advances Mode15 immediately.
        // A legacy client may keep the old room and request another battle, so
        // validate the room owner again at the final HTTP start boundary.
        if (isMode15RoomClosed(room)) {
            console.log(
                `[MODE15] multi start denied: completed host room=${room_number} host=${room.host_player_id}`,
            );
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                "data_headers": generateDataHeaders({ viewer_id, result_code: 4507 }),
                "data": {},
            });
        }

        setRoomBattle(room_number);

        const mateComIds = room.mates.map(m => m.com_id);
        const activeQuest = {
            questId: quest_id,
            category,
            useBoostPoint: use_boost_point,
            useBossBoostPoint: use_boss_boost_point,
            isAutoStartMode: is_auto_start_mode,
            isMulti: true,
            roomNumber: room_number,
            matePlayerIds: mate_player_ids,
            mateComIds,
            partySlot: party_id,
            playId: play_id,
            continueCount: 0,
        };
        insertActiveQuest(ctx.playerId, activeQuest);
        const frozenParticipants = room.mates
            .map(mate => ({
                viewerId: Number(mate.viewer_id),
                comId: Number(mate.com_id || 0),
            }))
            .filter(mate => Number.isFinite(mate.viewerId) && mate.viewerId > 0);
        const frozenExpectedRealViewerIds = room.expected_real_viewer_ids
            .map(Number)
            .filter(expectedViewerId => Number.isFinite(expectedViewerId) && expectedViewerId > 0);
        registerMultiSettlementSnapshot({
            battleInstanceId: buildBattleInstanceId(
                room_number,
                room.lobby_generation,
                category,
                quest_id,
            ),
            playerId: ctx.playerId,
            viewerId: viewer_id,
            playId: play_id,
            roomNumber: room_number,
            roomGeneration: room.lobby_generation,
            activeQuest,
            participants: frozenParticipants,
            expectedRealViewerIds: frozenExpectedRealViewerIds,
            isHost: room.host_player_id === ctx.playerId,
            isRescueGuest: sessionManager.isRescueGuest(room_number, viewer_id),
            isNewbieRescueGuest: sessionManager.isNewbieRescueGuest(room_number, viewer_id),
        });

        if (questData.fixedParty === undefined) {
            updatePlayerSync({ id: ctx.playerId, partySlot: party_id });
        }

        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id }),
            "data": {
                "is_multi": "multi",
                "play_id": play_id,
                "client_checks": getSteamRobotMissionClientChecks(category, quest_id),
            }
        });
    });

    // ---- finish ----
    fastify.post("/finish", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as MultiFinishBody;
        const viewerId = body.viewer_id;
        gameVerboseLog(() => `[MULTI] finish: viewer=${viewerId} quest=${body.quest_id} category=${body.category} room=${body.room_number}`);

        if (!viewerId || isNaN(viewerId)) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        }

        const ctx = await resolvePlayer(viewerId);
        if (!ctx || !ctx.player) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid viewer id."
            });
        }

        const { playerId, player } = ctx;
        const finishCacheKey = buildFinishResponseCacheKey(
            "multi",
            viewerId,
            body as unknown as Record<string, unknown>,
        );
        const cachedFinishResponse = getCachedFinishResponse(finishCacheKey);
        if (cachedFinishResponse !== undefined) {
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send(cachedFinishResponse);
        }
        const releaseFinishExecution = await acquireFinishExecution(finishCacheKey);
        reply.raw.once("finish", releaseFinishExecution);
        reply.raw.once("close", releaseFinishExecution);
        // A matching request may have completed while this one waited.
        const coalescedFinishResponse = getCachedFinishResponse(finishCacheKey);
        if (coalescedFinishResponse !== undefined) {
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send(coalescedFinishResponse);
        }

        const settlementSnapshot = getMultiSettlementSnapshot(playerId, body.play_id);
        const activeQuestData = activeQuests[playerId] ?? settlementSnapshot?.activeQuest;
        if (activeQuestData === undefined) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "No active quest to finish."
            });
        }

        const finishRoom = activeQuestData.roomNumber
            ? getRoom(activeQuestData.roomNumber)
            : undefined;
        const settlementGeneration = settlementSnapshot?.roomGeneration ?? finishRoom?.lobby_generation ?? 0;
        const settlementKey = settlementSnapshot?.battleInstanceId
            ?? `${activeQuestData.roomNumber || body.room_number || "missing"}:${settlementGeneration}:${body.play_id}`;
        const settlementParticipants = settlementSnapshot?.participants ?? (finishRoom?.mates || [])
            .map(mate => ({
                viewerId: Number(mate.viewer_id),
                comId: Number(mate.com_id || 0),
            }))
            .filter(mate => Number.isFinite(mate.viewerId) && mate.viewerId > 0);
        const expectedRealViewerIds = settlementSnapshot?.expectedRealViewerIds ?? (finishRoom?.expected_real_viewer_ids || [])
            .map(Number)
            .filter(expectedViewerId => Number.isFinite(expectedViewerId) && expectedViewerId > 0);
        const finishedAsRescueGuest = settlementSnapshot?.isRescueGuest ?? (activeQuestData.roomNumber
            ? sessionManager.isRescueGuest(activeQuestData.roomNumber, viewerId)
            : false);
        const finishedAsNewbieRescueGuest = settlementSnapshot?.isNewbieRescueGuest ?? (activeQuestData.roomNumber
            ? sessionManager.isNewbieRescueGuest(activeQuestData.roomNumber, viewerId)
            : false);

        const questCategory = activeQuestData.category;
        const questId = activeQuestData.questId;
        const questData = getQuestFromCategorySync(questCategory, questId) as BattleQuest | null;
        if (questData === null || !('rankPointReward' in questData)) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Quest doesn't exist."
            });
        }

        const coreStartedAt = process.hrtime.bigint();
        transitionMultiSettlementSnapshot(playerId, body.play_id, "SETTLING");

        if (activeQuestData.roomNumber) {
            sessionManager.clearBattleExpectedCount(activeQuestData.roomNumber);
        }

        const finishedAsHost = settlementSnapshot?.isHost ?? (activeQuestData.roomNumber
            ? getRoom(activeQuestData.roomNumber)?.host_player_id === playerId
            : false);

        if (activeQuestData.roomNumber) {
            const room = getRoom(activeQuestData.roomNumber);
            if (room) {
                updateRoomState(room.room_number, 1);
                room.settlement_return_pending = true;
                sessionManager.beginSettlementReturnGrace(room.room_number);
                transitionMultiSettlementSnapshot(playerId, body.play_id, "RETURN_PENDING");
                gameVerboseLog(() => `[MULTI] finish: room ${activeQuestData.roomNumber} reset to raising_state=1 by viewer=${viewerId}`);
            }
        }

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
        const newMana = player.freeMana + questData.manaReward + ((body as any).add_mana || 0);
        const manaObtained = questData.manaReward + ((body as any).add_mana || 0);
        let newBoostPoint = player.boostPoint - (activeQuestData.useBoostPoint ? 1 : 0);
        let newBossBoostPoint = player.bossBoostPoint - (activeQuestData.useBossBoostPoint ? 1 : 0);
        const useBoostPoint = (activeQuestData.useBoostPoint && (newBoostPoint >= 0)) || (activeQuestData.useBossBoostPoint && (newBossBoostPoint >= 0));

        // quest progress
        const questProgress = getPlayerSingleQuestProgressSync(playerId, questCategory, questId);
        const questPreviouslyCompleted = questProgress !== null;
        const questAccomplished = (body as any).is_accomplished;
        const leaderId = ((body as any).statistics?.party || (body as any).quest_statistics?.party)?.characters?.[0]?.id

        let clearReward: PlayerRewardResult | null = null;
        let sPlusClearReward: PlayerRewardResult | null = null;
        let rescueFragmentReward: PlayerRewardResult | null = null;
        let scoreRewardsResult!: ReturnType<typeof givePlayerScoreRewardsSync>;
        const oldRkDegree = getRankDegree(beforeRankPoint);
        const newDegreeId = getRankDegree(newRankPoint);
        const didLevelUp = newDegreeId > oldRkDegree;
        const playerData = player;
        await measureSettlementPhaseAsync("multi", "reward_transaction", () => withPlayerWriteQueue(playerId, () => runImmediateTransactionWithRetry(() => {
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

        // Increment multi clear count for event mission tracking
        getDb().prepare(`
        UPDATE players_quest_progress SET multi_clear_count = multi_clear_count + 1
        WHERE player_id = ? AND section = ? AND quest_id = ?
        `).run(playerId, Number(questCategory), Number(questId))
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

        scoreRewardsResult = givePlayerScoreRewardsSync(playerId, (questData as any).scoreRewardGroupId || 0, (questData as any).scoreRewardGroup, useBoostPoint, (questData as any).element);
        if (questAccomplished && finishedAsRescueGuest) {
            const rescueReward = getRescueFragmentReward(questCategory, questId)
            if (rescueReward !== null) {
                rescueFragmentReward = givePlayerRewardSync(playerId, rescueReward)
                gameVerboseLog(() =>
                    `[MULTI] rescue fragment granted: player=${playerId} quest=${questId} `
                    + `item=${(rescueReward as any).id} count=${(rescueReward as any).count}`
                )
            }
        }
        })));
        const settledClearReward = clearReward as PlayerRewardResult | null;
        const settledSPlusClearReward = sPlusClearReward as PlayerRewardResult | null;
        const settledRescueFragmentReward = rescueFragmentReward as PlayerRewardResult | null;
        const rescueFragmentAdditionalReward = getRescueFragmentAdditionalReward(
            questAccomplished && finishedAsRescueGuest
                ? getRescueFragmentReward(questCategory, questId)
                : null,
        );

        const bodyPartyStatistics = (body as any).statistics?.party || body.quest_statistics?.party || { characters: [], unison_characters: [] };
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
            isMulti: true,
            isMultiHost: finishedAsHost,
        }
        const multiBattleParty = collectPartyCharacterIds(finishCtx.party)
        const missionEvaluationTime = new Date(getServerTime() * 1000)
        let missionBattleFacts!: ReturnType<typeof recordMissionBattleFacts>;
        let steamRobotMissionId: number | null = null;
        let rewardCharacterExpResult!: ReturnType<typeof givePlayerCharactersExpSync>;
        await measureSettlementPhaseAsync("multi", "facts_transaction", () => withPlayerWriteQueue(playerId, () => runImmediateTransactionWithRetry(() => {
        missionBattleFacts = recordMissionBattleFacts(finishCtx, missionEvaluationTime)
        steamRobotMissionId = trackSteamRobotChallengeMission({
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

        rewardCharacterExpResult = givePlayerCharactersExpSync(
            playerId, partyCharacterIdsArray, questData.characterExpReward || 0,
            questData.fixedParty !== undefined
        );
        })));

        const mode15RewardsResult = settleMode15BattleSync(
            playerId,
            questCategory,
            questId,
            questAccomplished,
            { rescue: !finishedAsHost },
        );

        const dataHeaders = generateDataHeaders({ viewer_id: viewerId });
        const rawMatePlayerResult = ((body as any).mate_player_result || []) as Array<{ viewer_id?: number }>;
        recordSettlementPhase(
            "multi",
            "core",
            Number(process.hrtime.bigint() - coreStartedAt) / 1_000_000,
        );
        const settlementResult = await measureSettlementPhaseAsync("multi", "barrier", () => mergeMultiSettlementResults({
            key: settlementKey,
            viewerId,
            participants: settlementParticipants,
            expectedRealViewerIds,
            ownScore: (body as any).score || 0,
            ownContributionScore: (body as any).contribution_score || 0,
            mateResults: rawMatePlayerResult,
            // Preserve the original repaired 1.2-second compatibility
            // barrier.  mergeMultiSettlementResults still returns early as
            // soon as every real participant has submitted.
            waitMs: parseInt(process.env.MULTI_SETTLEMENT_BARRIER_MS || "1200", 10),
        }));
        const matePlayerResult = settlementResult.mateResults;
        const ownContributionScore = Number((body as any).contribution_score) || 0
        const highestContributionScore = Math.max(
            ownContributionScore,
            ...matePlayerResult.map(result => Number(result.contribution_score) || 0),
        )
        const finishedAsMvp = Boolean(finishCtx.statistics?.is_mvp)
            || ownContributionScore >= highestContributionScore
        recordBattleMissionDimensionsSafe({
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
            ...multiBattleParty,
            statistics: summarizeBattleStatistics(finishCtx.statistics),
        })
        gameVerboseLog(() =>
            `[MULTI] settlement roster: room=${activeQuestData.roomNumber || body.room_number || "missing"} `
            + `generation=${settlementGeneration} viewer=${viewerId} `
            + `submitted=${settlementResult.submittedCount}/${settlementResult.expectedCount} `
            + `returned=${matePlayerResult.length} synthesized=${settlementResult.synthesizedViewerIds.join(",") || "none"}`
        );
        const followInfo = await buildFinishFollowInfo(viewerId, matePlayerResult, activeQuestData.matePlayerIds || []);
        const finalPlayerData = getPlayerSync(playerId);
        const characterList = reconcileAwakeUnlockCharacterList(playerId, [
            ...rewardCharacterExpResult.character_list as unknown as Record<string, unknown>[],
            ...((settledClearReward?.character_list || []) as Record<string, unknown>[]),
            ...((settledSPlusClearReward?.character_list || []) as Record<string, unknown>[]),
            ...(scoreRewardsResult.character_list as Record<string, unknown>[]),
            ...((mode15RewardsResult?.character_list || []) as Record<string, unknown>[]),
        ]);
        const missionSettlement = await measureSettlementPhaseAsync("multi", "mission", () => (
            settleMissionCategoriesAsync(
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

        reply.header("content-type", "application/x-msgpack");
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
        mergeMissionSettlementResponse(responseData, awakeMissionSettlement, viewerId)
        if (activeMissionSettlement.length > 0) {
            responseData.active_mission_list = activeMissionSettlement
        }
        responseData.mail_arrived = getPlayerMailCountSync(playerId, true) > 0
        const finishResponse = {
            "data_headers": dataHeaders,
            "data": responseData,
        };
        if (questAccomplished) {
            recordSuccessfulQuestNpcParty(
                playerId,
                questCategory,
                questId,
                activeQuestData.partySlot ?? player.partySlot,
            );
        }
        cacheFinishResponse(finishCacheKey, finishResponse);
        transitionMultiSettlementSnapshot(playerId, body.play_id, "RETURN_PENDING");
        // Clear only the quest that produced this response.  A late retry from
        // the previous battle must never delete a newer rematch's active quest.
        if (activeQuests[playerId]?.playId === activeQuestData.playId) {
            delete activeQuests[playerId];
            deletePlayerActiveQuestSync(playerId);
        }
        return reply.status(200).send(finishResponse);
    });

    // ---- abort ----
    fastify.post("/abort", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as MultiAbortBody;
        const viewerId = body.viewer_id;
        gameVerboseLog(() => `[MULTI] abort: viewer=${viewerId} quest=${body.quest_id} category=${body.category}`);

        if (isNaN(viewerId)) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        }

        const ctx = await resolvePlayer(viewerId);
        if (!ctx) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid viewer id or no player bound."
            });
        }

        const { playerId, player } = ctx;
        const activeQuestData = activeQuests[playerId];

        if (activeQuestData) {
            if (activeQuestData.roomNumber) {
                const room = getRoom(activeQuestData.roomNumber);
                if (room && room.host_player_id === playerId) {
                    // A multiplayer defeat is reported by the legacy client
                    // through /abort rather than /finish(is_accomplished=false).
                    // Reset only the room owner's Mode15 run; rescue guests may
                    // leave or fail without changing their own sequence.
                    settleMode15BattleSync(
                        playerId,
                        activeQuestData.category,
                        activeQuestData.questId,
                        false,
                    );
                    disbandRoom(activeQuestData.roomNumber);
                    gameVerboseLog(() => `[MULTI] abort: room ${activeQuestData.roomNumber} disbanded (host abandoned)`);
                }
            }
            delete activeQuests[playerId];
            deletePlayerActiveQuestSync(playerId);
            if (activeQuestData.roomNumber) {
                sessionManager.clearBattleExpectedCount(activeQuestData.roomNumber);
            }
        }

        const headers = generateDataHeaders({ viewer_id: viewerId });
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": headers,
            "data": {
                "user_info": {},
                "category_id": body.category,
                "is_multi": "multi",
                "start_time": headers['servertime'],
                "quest_name": "",
                "aborted_play_id": null,
                "unfinished_play_id": null,
                "drawn_quest": null,
                "party_info": null,
                "presigned_url": null
            }
        });
    });

    // ---- play_continue ----
    fastify.post("/play_continue", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as PlayContinueBody;
        const viewerId = body.viewer_id;
        gameVerboseLog(() => `[MULTI] play_continue: viewer=${viewerId} quest=${body.quest_id} category=${body.category}`);

        if (isNaN(viewerId)) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        }

        const ctx = await resolvePlayer(viewerId);
        if (!ctx || !ctx.player) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid viewer id or no player bound."
            });
        }

        const { playerId } = ctx;

        if (activeQuests[playerId] === undefined) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "No active quest to continue."
            });
        }

        const activeData = activeQuests[playerId];
        activeData.continueCount++;
        updatePlayerActiveQuestContinueCountSync(playerId, activeData.continueCount);

        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                continue_count: activeData.continueCount,
            }
        });
    });
}
