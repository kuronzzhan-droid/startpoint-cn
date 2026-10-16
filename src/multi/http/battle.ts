import { freezeFiveBossLobby } from "../five-boss/lobby-runtime";
import { isFiveBossTicketShortage, sendFiveBossTicketShortage } from "../five-boss/entry-response";
import { continueFiveBoss, fiveBossContinueAcknowledgement, FiveBossContinueError,
    isFiveBossContinueRequest } from "../five-boss/continue-runtime";
import { resolveActiveQuest } from "../../lib/quest/finish/active-quest-resolver";
import { isFiveBossHiddenQuest } from "../five-boss/contract";
import { shouldHandleFiveBossStart, shouldHandleFiveBossMemberRequest,
    handleFiveBossStart, handleFiveBossFinish, handleFiveBossAbort,
    isFiveBossBattleRequestError, logFiveBossRequestFailure } from "./five-boss-battle";
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { MultiStartBody, MultiFinishBody, MultiAbortBody, PlayContinueBody } from "../types";
import { generateDataHeaders, getServerTime, realToVirtual } from "../../utils";
import { getRoom, getRoomMemberPlayerId, isRoomMember, setRoomBattle } from "../room/manager";
import { sessionManager } from "../state/SessionManager";
import { insertActiveQuest, activeQuests, type ActiveQuest } from "../../routes/api/singleBattleQuest";
import {
    deletePlayerActiveQuestIfPlayIdSync,
    getPlayerActiveQuestSync,
    updatePlayerActiveQuestContinueCountIfPlayIdSync,
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
import { getQuestFromCategorySync } from "../../lib/assets";
import { getCharactersEvolutionImgLevels, givePlayerCharactersExpSync } from "../../lib/character";
import { givePlayerRewardsSync, givePlayerRewardSync, givePlayerScoreRewardsSync } from "../../lib/quest";
import { computeRealTimeStamina, getRankDegree, getMaxStamina } from "../../lib/stamina";
import { BattleQuest, EquipmentItemReward, PlayerRewardResult, QuestCategory } from "../../lib/types";
import { getDb } from "../../data/db";
import { collectPartyCharacterIds, recordBattleMissionDimensionsSafe, summarizeBattleStatistics } from "../../lib/mission";
import { getSteamRobotMissionClientChecks, trackSteamRobotChallengeMission } from "../../lib/mission/steam-robot-challenge";
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
    buildFinishExecutionKey,
    buildFinishResponseCacheKey,
    acquireFinishExecution,
    cacheFinishResponse,
    getCachedFinishResponse,
} from "../../lib/finish-response-cache";
import {
    getRescueFragmentAdditionalReward,
    getEligibleRescueFragmentReward,
} from "../rescue-fragment-reward";
import { isMode15RoomClosed } from "../mode15-room-gate";
import { enforceRoomEquipmentReady, exclusiveWirePartyItems,
    freezeEquipmentSelections, selectedPartyId } from "../room/equipment-ready";
import {
    getMode15ExclusiveGlobalPartyItemsSync,
    isMode15EquipmentAllowedQuest,
    isMode15Quest,
    settleMode15BattleSync,
} from "../../lib/mode15-optional";
import { recordSuccessfulQuestNpcParty } from "../npc/player-party-pool";
import { runPersistenceTransaction, runWriterCommand } from "../../lib/persistence-coordinator";
import {
    MULTI_CLEANUP_ACTIVE_QUEST,
    MULTI_RECORD_BATTLE_FACTS,
    type MultiCleanupActiveQuestArgs,
    type MultiRecordBattleFactsArgs,
    type MultiRecordBattleFactsResult,
} from "../../lib/persistence/command-names";
import {
    buildBattleInstanceId,
    getMultiSettlementSnapshot,
    isMultiSettlementSettled,
    markMultiSettlementSettled,
    recordMultiSettlementResponse,
    registerMultiSettlementSnapshot,
    transitionMultiSettlementSnapshot,
} from "../settlement-snapshot";
import { embeddedMultiCoordinator } from "../coordinator/embedded";
import { calculateFreeManaGrant } from "../../lib/mana";
import { getFinishReceiptSync, pruneFinishReceiptsSync, recordFinishReceiptSync } from "../../data/domains/finish-receipt";
import { resolveMultiPlayerContext } from "../player-context";
import { validateRandomRecruitmentAttention } from "../recruitment";
import { recordQuestRecommendedPartySafe } from "../../lib/quest/recommended-party-history";
import { isValidNormalPartySlotSync } from "../../data/domains/party";
import { usesNormalCurrentPartySlot } from "../../lib/party-current-slot";

async function buildFinishFollowInfo(
    requesterPlayerId: number,
    viewerId: number,
    mateResults: Array<{ viewer_id?: number }>,
    fallbackMateIds: number[] = [],
) {
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

        const mateCtx = await resolveMultiPlayerContext(mateViewerId);
        if (!mateCtx) continue;

        const info = buildFollowUserInfoSync(requesterPlayerId, mateCtx.playerId);
        if (info) followInfo.push(info);
    }

    return followInfo;
}

function sendMultiStartUnavailable(
    reply: FastifyReply,
    viewerId: number,
    reason: string,
) {
    console.warn(`[MULTI] start acknowledged as unavailable: viewer=${viewerId} reason=${reason}`)
    reply.header("content-type", "application/x-msgpack")
    return reply.status(200).send({
        data_headers: generateDataHeaders({ viewer_id: viewerId, result_code: 4050 }),
        data: {},
    })
}

function buildTerminalMultiFinishAcknowledgement(
    player: NonNullable<ReturnType<typeof getPlayerSync>>,
    body: MultiFinishBody,
) {
    const dataHeaders = generateDataHeaders({ viewer_id: body.viewer_id })
    return {
        data_headers: dataHeaders,
        data: {
            user_info: {
                free_mana: player.freeMana,
                exp_pool: player.expPool,
                exp_pooled_time: getServerTime(player.expPooledTime),
                free_vmoney: player.freeVmoney,
                rank_point: player.rankPoint,
                degree_id: player.degreeId ?? 1,
                stamina: player.stamina,
                stamina_heal_time: realToVirtual(player.staminaHealTime),
                boost_point: player.boostPoint,
                boss_boost_point: player.bossBoostPoint,
            },
            add_exp_list: [],
            character_list: [],
            bond_token_status_list: [],
            rewards: {
                overflow_pool_exp: 0,
                converted_pool_exp: 0,
                reward_pool_exp: 0,
                reward_mana: 0,
                field_mana: 0,
            },
            old_high_score: 0,
            joined_character_id_list: [],
            before_rank_point: player.rankPoint,
            clear_rank: 0,
            drop_score_reward_ids: [],
            drop_rare_reward_ids: [],
            drop_additional_reward_ids: [],
            drop_periodic_reward_ids: [],
            equipment_list: [],
            category_id: Number(body.category) || 0,
            start_time: dataHeaders.servertime,
            is_multi: "multi",
            quest_name: "",
            item_list: {},
            presigned_quest_category: [],
            mate_player_result: body.mate_player_result ?? [],
            follow_info: [],
            contribution_score: Number(body.contribution_score) || 0,
            host_finished: false,
            aborted_play_id: null,
            unfinished_play_id: null,
            mail_arrived: getPlayerMailCountSync(player.id, true) > 0,
        },
    }
}

function activeQuestFromPersistent(
    quest: NonNullable<ReturnType<typeof getPlayerActiveQuestSync>>,
): ActiveQuest {
    return {
        questId: quest.questId,
        category: quest.category,
        useBossBoostPoint: quest.useBossBoostPoint,
        useBoostPoint: quest.useBoostPoint,
        isAutoStartMode: quest.isAutoStartMode,
        isMulti: quest.isMulti,
        isMultiHost: quest.isMultiHost,
        roomNumber: quest.roomNumber ?? undefined,
        entryItemId: quest.entryItemId ?? undefined,
        eventId: quest.eventId ?? undefined,
        partySlot: quest.partySlot ?? undefined,
        playId: quest.playId,
        continueCount: quest.continueCount,
        startedAtMs: quest.startedAtMs ?? undefined,
        questTimeRevision: quest.questTimeRevision ?? null,
    }
}

async function clearMatchingMultiActiveQuest(
    playerId: number,
    playId: unknown,
    operation: string,
): Promise<boolean> {
    if (typeof playId !== "string" || playId.length === 0) return false
    let deleted = false
    await runPersistenceTransaction({
        domain: "multi-settlement",
        playerId,
        operation,
    }, () => {
        const persisted = getPlayerActiveQuestSync(playerId)
        if (persisted?.isMulti && persisted.playId === playId) {
            deleted = deletePlayerActiveQuestIfPlayIdSync(playerId, playId)
        }
    })
    if (activeQuests[playerId]?.isMulti && activeQuests[playerId]?.playId === playId) {
        delete activeQuests[playerId]
        deleted = true
    }
    return deleted
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

        const ctx = await resolveMultiPlayerContext(viewer_id);
        if (!ctx) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid viewer id or no player bound."
            });
        }

        // A rescue guest who already entered the room keeps the client-side
        // attention key, but the key's stopped-notice grace can expire during
        // a long lobby wait. Room membership is the stronger proof at this
        // point, so only validate the key for viewers who are not members yet.
        const attentionRoom = room_number ? getRoom(room_number) : undefined
        const alreadyRoomMember = !!attentionRoom && isRoomMember(attentionRoom, viewer_id)
        if (body.attention_key
            && !alreadyRoomMember
            && !validateRandomRecruitmentAttention(room_number, viewer_id, body.attention_key)) {
            return sendMultiStartUnavailable(reply, viewer_id, "attention_expired")
        }

        if (isFiveBossHiddenQuest(category, quest_id)) {
            return reply.status(400).send({ error: "Bad Request", message: "Internal five-boss scene is not an entry quest." });
        }
        const questData = getQuestFromCategorySync(category, quest_id) as BattleQuest | null;
        if (questData === null || !('rankPointReward' in questData)) {
            return sendMultiStartUnavailable(reply, viewer_id, "quest_missing")
        }

        const roomStart = await embeddedMultiCoordinator.enqueueRoomCommand(room_number, () => {
            const currentRoom = getRoom(room_number);
            if (!currentRoom) return { status: "missing" as const };
            if (currentRoom.category !== category || currentRoom.quest_id !== quest_id) {
                return { status: "quest_mismatch" as const };
            }
            if (!isRoomMember(currentRoom, viewer_id)) {
                return { status: "forbidden" as const };
            }
            const recordedPlayerId = getRoomMemberPlayerId(currentRoom, viewer_id);
            if (recordedPlayerId !== null && recordedPlayerId !== ctx.playerId) {
                return { status: "player_mismatch" as const };
            }
            if (isMode15RoomClosed(currentRoom)) {
                return { status: "mode15_closed" as const, room: currentRoom };
            }
            if (currentRoom.lifecycle.phase === "LOBBY") {
                // Validate the entire roster before HTTP can beat TCP to BATTLE.
                if (!enforceRoomEquipmentReady(currentRoom)) return { status: "unavailable" as const };
                const peers = sessionManager.getClientsInRoom(room_number, currentRoom.lobby_generation)
                    .filter(peer => !peer.isBattle && peer.enterData !== null && peer.yourself);
                if (peers.some(peer => peer.yourself.state?.[0] !== 1)) {
                    return { status: "unavailable" as const };
                }
                const requester = peers.find(peer => peer.viewerId === viewer_id);
                if (requester && selectedPartyId(requester) !== party_id) {
                    return { status: "unavailable" as const };
                }
            }
            if (!isMode15EquipmentAllowedQuest(category, quest_id)) {
                const frozenPartyId = currentRoom.equipmentPartyIds?.[viewer_id];
                // A later save must not invalidate a battle already approved
                // for the same selection. Explicit request forgery still fails.
                if ((frozenPartyId !== undefined && frozenPartyId !== party_id)
                    || exclusiveWirePartyItems(body.client_battle_party).length > 0
                    || body.mate_party_ids?.some(party => exclusiveWirePartyItems(party).length > 0)
                    || (frozenPartyId === undefined
                        && getMode15ExclusiveGlobalPartyItemsSync(ctx.playerId, 1, party_id).length > 0)) {
                    return { status: "unavailable" as const };
                }
            }
            if (!freezeFiveBossLobby(currentRoom)) return { status: "unavailable" as const };
            const sourceGeneration = currentRoom.lifecycle.phase === "BATTLE"
                ? Math.max(0, currentRoom.lobby_generation - 1) : currentRoom.lobby_generation;
            if (!setRoomBattle(room_number)) {
                return { status: "unavailable" as const };
            }
            if (!currentRoom.equipmentPartyIds) freezeEquipmentSelections(currentRoom, sourceGeneration);
            return { status: "ready" as const, room: currentRoom };
        });
        if (roomStart.status === "forbidden") {
            return reply.status(403).send({
                error: "Forbidden",
                message: "Room permission denied.",
            })
        }
        if (roomStart.status === "player_mismatch") {
            return reply.status(400).send({
                error: "Bad Request",
                message: "Room player mismatch.",
            })
        }
        if (roomStart.status === "missing"
            || roomStart.status === "unavailable"
            || roomStart.status === "quest_mismatch") {
            return sendMultiStartUnavailable(reply, viewer_id, roomStart.status)
        }

        // The host's first successful settlement advances Mode15 immediately.
        // A legacy client may keep the old room and request another battle, so
        // validate the room owner again at the final HTTP start boundary.
        if (roomStart.status === "mode15_closed") {
            console.log(
                `[MODE15] multi start denied: completed host room=${room_number} host=${roomStart.room.host_player_id}`,
            );
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                "data_headers": generateDataHeaders({ viewer_id, result_code: 4507 }),
                "data": {},
            });
        }

        const room = roomStart.room;
        if (shouldHandleFiveBossStart(body)) {
            try { return await handleFiveBossStart(body, ctx.playerId, reply); }
            catch (error) {
                if (!isFiveBossBattleRequestError(error)) throw error;
                logFiveBossRequestFailure("start", body, ctx.playerId, error);
                if (isFiveBossTicketShortage(error)) return sendFiveBossTicketShortage(reply, viewer_id);
                return sendMultiStartUnavailable(
                    reply,
                    viewer_id,
                    `five_boss_${(error as { code?: string }).code ?? "rejected"}`,
                )
            }
        }


        const mateComIds = room.mates.map(m => m.com_id);
        const activeQuest = {
            questId: quest_id,
            category,
            useBoostPoint: use_boost_point,
            useBossBoostPoint: use_boss_boost_point,
            isAutoStartMode: is_auto_start_mode,
            isMulti: true,
            isMultiHost: room.host_viewer_id === viewer_id,
            roomNumber: room_number,
            matePlayerIds: mate_player_ids,
            mateComIds,
            partySlot: party_id,
            playId: play_id,
            continueCount: 0,
        };
        // The active quest is part of the same durable start command as the
        // selected party. Keeping this write outside the coordinator lets a
        // busy settlement or checkpoint race it and surface SQLITE_BUSY on
        // /multi_battle_quest/start.
        const previousActiveQuest = activeQuests[ctx.playerId];
        try {
            await runPersistenceTransaction({
                domain: "multi-settlement", playerId: ctx.playerId, operation: "start",
            }, () => {
                insertActiveQuest(ctx.playerId, activeQuest);
                if (questData.fixedParty === undefined
                    && usesNormalCurrentPartySlot(category)
                    && isValidNormalPartySlotSync(ctx.playerId, party_id)) {
                    updatePlayerSync({ id: ctx.playerId, partySlot: party_id });
                }
            });
        } catch (error) {
            if (previousActiveQuest) activeQuests[ctx.playerId] = previousActiveQuest;
            else delete activeQuests[ctx.playerId];
            throw error;
        }
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
            isHost: room.host_viewer_id === viewer_id,
            isRescueGuest: sessionManager.isRescueGuest(room_number, viewer_id),
            isRescueFragmentEligible: sessionManager.isRescueFragmentEligibleGuest(room_number, viewer_id),
            isNewbieRescueGuest: sessionManager.isNewbieRescueGuest(room_number, viewer_id),
        });

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
        const finishHandlerStartedAt = process.hrtime.bigint();
        const body = request.body as MultiFinishBody;
        const viewerId = body.viewer_id;
        gameVerboseLog(() => `[MULTI] finish: viewer=${viewerId} quest=${body.quest_id} category=${body.category} room=${body.room_number}`);

        if (!viewerId || isNaN(viewerId)) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        }

        const ctx = await resolveMultiPlayerContext(viewerId);
        if (!ctx || !ctx.player) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid viewer id."
            });
        }

        const { playerId, player } = ctx;
        if (shouldHandleFiveBossMemberRequest(body, playerId)) {
            try { return await handleFiveBossFinish(body, playerId, reply,
                (viewer, mates, fallback) => buildFinishFollowInfo(playerId, viewer, mates, fallback)); }
            catch (error) {
                if (!isFiveBossBattleRequestError(error)) throw error;
                logFiveBossRequestFailure("finish", body, playerId, error);
                return reply.status(400).send({ error: "Bad Request", message: (error as Error).message });
            }
        }

        const finishCacheKey = buildFinishResponseCacheKey(
            "multi",
            viewerId,
            body as unknown as Record<string, unknown>,
            { playerId },
        );
        const cachedFinishResponse = getCachedFinishResponse(finishCacheKey);
        if (cachedFinishResponse !== undefined) {
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send(cachedFinishResponse);
        }
        const executionWaitStartedAt = process.hrtime.bigint();
        const releaseFinishExecution = await acquireFinishExecution(
            buildFinishExecutionKey("multi", playerId, body as unknown as Record<string, unknown>),
        );
        recordSettlementPhase(
            "multi",
            "finish_execution_wait",
            Number(process.hrtime.bigint() - executionWaitStartedAt) / 1_000_000,
        );
        // Released when this handler's own work ends, never on socket
        // events: a closed client must neither leak the lock nor let a
        // retry run beside a settlement that is still in progress.
        try {
            // A matching request may have completed while this one waited.
            const coalescedFinishResponse = getCachedFinishResponse(finishCacheKey);
            if (coalescedFinishResponse !== undefined) {
                reply.header("content-type", "application/x-msgpack");
                return reply.status(200).send(coalescedFinishResponse);
            }

            // A play id is settled at most once; its durable receipt outlives the
            // response cache and the frozen settlement snapshot.
            const receiptPlayId = typeof body.play_id === "string" ? body.play_id : "";
            const settledReceipt = receiptPlayId === "" ? null : getFinishReceiptSync(playerId, "multi", receiptPlayId);
            if (settledReceipt !== null) {
                const replay = settledReceipt.response
                    ?? getMultiSettlementSnapshot(playerId, receiptPlayId)?.settledResponse
                    ?? buildTerminalMultiFinishAcknowledgement(getPlayerSync(playerId) ?? player, body);
                cacheFinishResponse(finishCacheKey, replay);
                console.warn(`[MULTI] duplicate finish acknowledged: viewer=${viewerId}`
                    + ` play=${body.play_id} reason=receipt`);
                reply.header("content-type", "application/x-msgpack");
                return reply.status(200).send(replay);
            }
            const settlementSnapshot = getMultiSettlementSnapshot(playerId, body.play_id);
            if (settlementSnapshot?.settled) {
                // This play already paid out (for example a retry after the
                // response cache entry was evicted). Replay, never settle again.
                const replay = settlementSnapshot.settledResponse
                    ?? buildTerminalMultiFinishAcknowledgement(getPlayerSync(playerId) ?? player, body);
                cacheFinishResponse(finishCacheKey, replay);
                console.warn(`[MULTI] duplicate finish acknowledged: viewer=${viewerId}`
                    + ` play=${body.play_id} reason=already_settled`);
                reply.header("content-type", "application/x-msgpack");
                return reply.status(200).send(replay);
            }
            const currentActiveQuest = activeQuests[playerId];
            const persistentActiveQuest = getPlayerActiveQuestSync(playerId);
            // A delayed finish from the previous generation must use its frozen
            // snapshot. Taking the current active quest first can settle or clear a
            // rematch that merely happens to belong to the same player.
            const persistentMatches = persistentActiveQuest?.isMulti
                && persistentActiveQuest.playId === body.play_id
            const activeQuestData: ActiveQuest | undefined = settlementSnapshot?.activeQuest
                ?? (persistentMatches
                    ? activeQuestFromPersistent(persistentActiveQuest)
                    : persistentActiveQuest === null
                        && currentActiveQuest?.playId === body.play_id
                        ? currentActiveQuest
                        : undefined);
            if (activeQuestData === undefined) {
                const terminal = buildTerminalMultiFinishAcknowledgement(player, body)
                cacheFinishResponse(finishCacheKey, terminal)
                console.warn(`[MULTI] stale finish acknowledged: viewer=${viewerId}`
                    + ` play=${body.play_id} reason=active_quest_missing`)
                reply.header("content-type", "application/x-msgpack")
                return reply.status(200).send(terminal)
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
            const finishedAsRescueFragmentEligible = settlementSnapshot?.isRescueFragmentEligible ?? (activeQuestData.roomNumber
                ? sessionManager.isRescueFragmentEligibleGuest(activeQuestData.roomNumber, viewerId)
                : false);
            const finishedAsNewbieRescueGuest = settlementSnapshot?.isNewbieRescueGuest ?? (activeQuestData.roomNumber
                ? sessionManager.isNewbieRescueGuest(activeQuestData.roomNumber, viewerId)
                : false);

            const questCategory = activeQuestData.category;
            const questId = activeQuestData.questId;
            const questData = getQuestFromCategorySync(questCategory, questId) as BattleQuest | null;
            if (questData === null || !('rankPointReward' in questData)) {
                await clearMatchingMultiActiveQuest(
                    playerId,
                    body.play_id,
                    "stale_finish_unknown_quest",
                )
                const terminal = buildTerminalMultiFinishAcknowledgement(player, body)
                cacheFinishResponse(finishCacheKey, terminal)
                console.warn(`[MULTI] stale finish acknowledged: viewer=${viewerId}`
                    + ` play=${body.play_id} reason=quest_missing category=${questCategory} quest=${questId}`)
                reply.header("content-type", "application/x-msgpack")
                return reply.status(200).send(terminal)
            }

            recordSettlementPhase(
                "multi",
                "preflight",
                Number(process.hrtime.bigint() - finishHandlerStartedAt) / 1_000_000,
            );
            const coreStartedAt = process.hrtime.bigint();
            const settlementWasAlreadyInLobby = settlementSnapshot?.lifecycle === "LOBBY";
            const settlingSnapshot = transitionMultiSettlementSnapshot(playerId, body.play_id, "SETTLING");

            const finishedAsHost = settlementSnapshot?.isHost ?? (activeQuestData.roomNumber
                ? getRoom(activeQuestData.roomNumber)?.host_player_id === playerId
                : false);

            if (activeQuestData.roomNumber) {
                await embeddedMultiCoordinator.enqueueRoomCommand(activeQuestData.roomNumber, () => {
                    const room = getRoom(activeQuestData.roomNumber!);
                    const matchesBattleGeneration = room?.lobby_generation === settlementGeneration;
                    const lifecycleAllowsRoomMutation = settlementSnapshot === undefined
                        || (!settlementWasAlreadyInLobby && settlingSnapshot?.lifecycle !== "LOBBY");
                    if (room && matchesBattleGeneration && lifecycleAllowsRoomMutation) {
                        const wasPending = room.settlement_return_pending;
                        const transition = embeddedMultiCoordinator.beginSettlementReturn(room, settlementGeneration);
                        if (!transition.ok) {
                            console.warn(`[MULTI-SETTLEMENT] lifecycle rejected finish room=${room.room_number}`
                                + ` viewer=${viewerId} reason=${transition.reason}`);
                            return;
                        }
                        sessionManager.clearBattleExpectedCount(activeQuestData.roomNumber!);
                        if (!wasPending) sessionManager.beginSettlementReturnGrace(room.room_number);
                        transitionMultiSettlementSnapshot(playerId, body.play_id, "RETURN_PENDING");
                        gameVerboseLog(() => `[MULTI] finish: room ${activeQuestData.roomNumber}`
                            + ` entered RETURNING by viewer=${viewerId}`);
                    } else if (room) {
                        console.warn(`[MULTI-SETTLEMENT] skipped stale finish room mutation: room=${room.room_number}`
                            + ` viewer=${viewerId} finishGeneration=${settlementGeneration}`
                            + ` currentGeneration=${room.lobby_generation} lifecycle=${settlementSnapshot?.lifecycle ?? "missing"}`);
                    }
                });
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

            const displayMode15ManaAsFieldDrop = isMode15Quest(questCategory, questId);
            const manaObtained = questData.manaReward + ((body as any).add_mana || 0);
            // Player totals and quest progress are re-read inside the reward
            // transaction below; these are assigned there.
            let playerData = player;
            let beforeRankPoint = player.rankPoint;
            let newRankPoint = beforeRankPoint + questData.rankPointReward;
            let newMana = player.freeMana;
            let newBoostPoint = player.boostPoint;
            let newBossBoostPoint = player.bossBoostPoint;

            // quest progress
            // Abyss progress refresh can update legacy best-time rows. It must
            // share the persistence owner with the rest of the finish path;
            // otherwise this apparently read-only lookup races another writer and
            // becomes the SQLITE_BUSY stack seen in cloud logs.
            let questProgress = await measureSettlementPhaseAsync("multi", "progress_refresh", () => (
                runPersistenceTransaction({
                    domain: "multi-settlement", playerId, operation: "progress_refresh",
                }, () => getPlayerSingleQuestProgressSync(playerId, questCategory, questId))
            ));
            let questPreviouslyCompleted = questProgress !== null;
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
            const latchPlayId = typeof body.play_id === "string" ? body.play_id : "";
            let alreadySettled = false;
            const mode15RewardsResult = await measureSettlementPhaseAsync("multi", "reward_transaction", () => runPersistenceTransaction({
                domain: "multi-settlement", playerId, operation: "reward_transaction",
            }, () => {
            // Checked under the player's persistence queue; set after COMMIT below.
            alreadySettled = isMultiSettlementSettled(playerId, latchPlayId)
                || (latchPlayId !== "" && getFinishReceiptSync(playerId, "multi", latchPlayId) !== null);
            if (alreadySettled) return null;
            playerData = getPlayerSync(playerId) ?? player;
            questProgress = getPlayerSingleQuestProgressSync(playerId, questCategory, questId);
            questPreviouslyCompleted = questProgress !== null;
            beforeRankPoint = playerData.rankPoint;
            newRankPoint = beforeRankPoint + questData.rankPointReward;
            newMana = calculateFreeManaGrant(playerData, manaObtained).freeMana;
            newBoostPoint = playerData.boostPoint - (activeQuestData.useBoostPoint ? 1 : 0);
            newBossBoostPoint = playerData.bossBoostPoint - (activeQuestData.useBossBoostPoint ? 1 : 0);
            const useBoostPoint = (activeQuestData.useBoostPoint && (newBoostPoint >= 0)) || (activeQuestData.useBossBoostPoint && (newBossBoostPoint >= 0));
            const oldRkDegree = getRankDegree(beforeRankPoint);
            const newDegreeId = getRankDegree(newRankPoint);
            const didLevelUp = newDegreeId > oldRkDegree;
            if (questAccomplished) {
                if (questProgress !== null) {
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
                totalManaObtained: (playerData.totalManaObtained ?? 0) + manaObtained,
                maxComboAchieved: Math.max(playerData.maxComboAchieved ?? 0, (body as any).statistics?.max_combo_count ?? 0),
                ...(didLevelUp ? { stamina: playerData.stamina + getMaxStamina(newDegreeId), staminaHealTime: new Date() } : {}),
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
                playerData = {
                    ...playerData,
                    stamina: playerData.stamina + getMaxStamina(newDegreeId),
                    staminaHealTime: new Date(),
                };
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
            if (latchPlayId !== "") {
                // Written with the payout; the response is filled in once built.
                recordFinishReceiptSync(playerId, "multi", latchPlayId, null);
                pruneFinishReceiptsSync(playerId);
            }
            return settleMode15BattleSync(
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
            }, {
                afterCommit: () => {
                    if (!alreadySettled) markMultiSettlementSettled(playerId, latchPlayId);
                },
            }));
            if (alreadySettled) {
                const latest = getMultiSettlementSnapshot(playerId, latchPlayId);
                const replay = latest?.settledResponse
                    ?? (latchPlayId === "" ? null : getFinishReceiptSync(playerId, "multi", latchPlayId)?.response)
                    ?? buildTerminalMultiFinishAcknowledgement(getPlayerSync(playerId) ?? player, body);
                cacheFinishResponse(finishCacheKey, replay);
                console.warn(`[MULTI] duplicate finish acknowledged: viewer=${viewerId}`
                    + ` play=${body.play_id} reason=already_settled_in_transaction`);
                reply.header("content-type", "application/x-msgpack");
                return reply.status(200).send(replay);
            }
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
                player: playerData,
                questPreviouslyCompleted,
                questProgress,
                partySlot: activeQuestData.partySlot ?? playerData.partySlot,
                isMulti: true,
                isMultiHost: finishedAsHost,
            }
            const multiBattleParty = collectPartyCharacterIds(finishCtx.party)
            const missionEvaluationTime = new Date(getServerTime() * 1000)
            let missionBattleFacts!: ReturnType<typeof recordMissionBattleFacts>;
            let steamRobotMissionId: number | null = null;
            let rewardCharacterExpResult!: ReturnType<typeof givePlayerCharactersExpSync>;
            await measureSettlementPhaseAsync("multi", "facts_transaction", async () => {
                const factsResult = await runWriterCommand<MultiRecordBattleFactsArgs, MultiRecordBattleFactsResult>(
                    MULTI_RECORD_BATTLE_FACTS,
                    {
                        finishCtx,
                        partyCharacterIdsArray,
                        characterExpReward: questData.characterExpReward || 0,
                        fixedParty: questData.fixedParty !== undefined,
                        evaluationTimeMs: missionEvaluationTime.getTime(),
                    },
                    { domain: "multi-settlement", playerId, operation: "facts_transaction" },
                )
                missionBattleFacts = factsResult.missionBattleFacts as ReturnType<typeof recordMissionBattleFacts>
                steamRobotMissionId = factsResult.steamRobotMissionId
                rewardCharacterExpResult = factsResult.rewardCharacterExpResult as ReturnType<typeof givePlayerCharactersExpSync>
            });

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
            const postBarrierStartedAt = process.hrtime.bigint();
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
                score: Number((body as any).score) || 0,
                ...multiBattleParty,
                statistics: summarizeBattleStatistics(finishCtx.statistics),
            })
            gameVerboseLog(() =>
                `[MULTI] settlement roster: room=${activeQuestData.roomNumber || body.room_number || "missing"} `
                + `generation=${settlementGeneration} viewer=${viewerId} `
                + `submitted=${settlementResult.submittedCount}/${settlementResult.expectedCount} `
                + `returned=${matePlayerResult.length} synthesized=${settlementResult.synthesizedViewerIds.join(",") || "none"}`
            );
            const followInfo = await buildFinishFollowInfo(playerId, viewerId, matePlayerResult, activeQuestData.matePlayerIds || []);
            const finalPlayerData = getPlayerSync(playerId);
            const characterList = [
                ...rewardCharacterExpResult.character_list as unknown as Record<string, unknown>[],
                ...((settledClearReward?.character_list || []) as Record<string, unknown>[]),
                ...((settledSPlusClearReward?.character_list || []) as Record<string, unknown>[]),
                ...(scoreRewardsResult.character_list as Record<string, unknown>[]),
                ...((mode15RewardsResult?.character_list || []) as Record<string, unknown>[]),
            ];
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
            if (questAccomplished) {
                recordSuccessfulQuestNpcParty(
                    playerId,
                    questCategory,
                    questId,
                    activeQuestData.partySlot ?? player.partySlot,
                );
            }
            cacheFinishResponse(finishCacheKey, finishResponse);
            recordMultiSettlementResponse(playerId, latchPlayId, finishResponse);
            transitionMultiSettlementSnapshot(playerId, body.play_id, "RETURN_PENDING");
            // Clear only the quest that produced this response.  A late retry from
            // the previous battle must never delete a newer rematch's active quest.
            await measureSettlementPhaseAsync("multi", "active_quest_cleanup", () => runWriterCommand<MultiCleanupActiveQuestArgs, boolean>(
                MULTI_CLEANUP_ACTIVE_QUEST,
                {
                    playerId,
                    expectedPlayId: activeQuestData.playId,
                    ...(latchPlayId !== "" ? { receipt: { playId: latchPlayId, response: finishResponse } } : {}),
                },
                { domain: "multi-settlement", playerId, operation: "active_quest_cleanup" },
            ));
            if (activeQuests[playerId]?.playId === activeQuestData.playId) {
                delete activeQuests[playerId];
            }
            recordSettlementPhase(
                "multi",
                "post_barrier",
                Number(process.hrtime.bigint() - postBarrierStartedAt) / 1_000_000,
            );
            const responseStartedAt = process.hrtime.bigint();
            let responseFlushRecorded = false;
            const recordResponseFlush = () => {
                if (responseFlushRecorded) return;
                responseFlushRecorded = true;
                recordSettlementPhase(
                    "multi",
                    "response_flush",
                    Number(process.hrtime.bigint() - responseStartedAt) / 1_000_000,
                );
            };
            reply.raw.once("finish", recordResponseFlush);
            reply.raw.once("close", recordResponseFlush);
            return reply.status(200).send(finishResponse);
        } finally {
            releaseFinishExecution();
        }
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

        const ctx = await resolveMultiPlayerContext(viewerId);
        if (!ctx) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid viewer id or no player bound."
            });
        }

        const { playerId, player } = ctx;
        if (shouldHandleFiveBossMemberRequest(body, playerId)) {
            try { return await handleFiveBossAbort(body, playerId, reply); }
            catch (error) {
                if (!isFiveBossBattleRequestError(error)) throw error;
                logFiveBossRequestFailure("abort", body, playerId, error);
                return reply.status(400).send({ error: "Bad Request", message: (error as Error).message });
            }
        }

        const memoryActiveQuest = activeQuests[playerId];
        const persistedActiveQuest = getPlayerActiveQuestSync(playerId);
        const activeQuestData = memoryActiveQuest?.isMulti
            && memoryActiveQuest.playId === body.play_id
            ? memoryActiveQuest
            : persistedActiveQuest?.isMulti
                && persistedActiveQuest.playId === body.play_id
                ? activeQuestFromPersistent(persistedActiveQuest)
                : undefined;

        if (activeQuestData) {
            const abortRoomNumber = activeQuestData.roomNumber;
            const abortRoom = abortRoomNumber ? getRoom(abortRoomNumber) : undefined;
            const hostAborted = abortRoom?.host_player_id === playerId;
            const abortedPlayId = activeQuestData.playId;
            let abortedCurrentPlay = false;
            await runPersistenceTransaction({
                domain: "multi-settlement", playerId, operation: "abort",
            }, () => {
                abortedCurrentPlay = deletePlayerActiveQuestIfPlayIdSync(
                    playerId,
                    abortedPlayId,
                );
                // A multiplayer defeat is reported by the legacy client
                // through /abort rather than /finish(is_accomplished=false).
                // Mode15 boundary aborts clear only this battle; the settlement
                // runtime preserves the current 5/10/15 stage without rewards.
                if (abortedCurrentPlay && hostAborted) {
                    settleMode15BattleSync(
                        playerId,
                        activeQuestData.category,
                        activeQuestData.questId,
                        false,
                    );
                }
            });
            if (abortedCurrentPlay && activeQuests[playerId]?.playId === abortedPlayId) {
                delete activeQuests[playerId];
            }
            if (abortedCurrentPlay && hostAborted && abortRoomNumber) {
                // Retiring as the host no longer dissolves the room. The host
                // is treated as a leaving member: closing its battle socket
                // retires the seat (publishing Leave to the peers), the
                // remaining members keep fighting and settle normally, and the
                // hostless room is dissolved by its own settlement-return or
                // abandoned-battle watchdog.
                gameVerboseLog(() => `[MULTI] abort: host ${viewerId} left room ${abortRoomNumber};`
                    + ` remaining members continue`);
            }
            if (abortedCurrentPlay && activeQuestData.roomNumber) {
                sessionManager.clearBattleExpectedCount(activeQuestData.roomNumber);
            }
            if (!abortedCurrentPlay) {
                console.warn(`[MULTI] stale abort acknowledged: viewer=${viewerId}`
                    + ` play=${body.play_id} reason=persistent_play_replaced`)
            }
        } else {
            console.warn(`[MULTI] stale abort acknowledged: viewer=${viewerId}`
                + ` play=${body.play_id} reason=active_quest_missing_or_replaced`)
        }

        const headers = generateDataHeaders({ viewer_id: viewerId });
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": headers,
            "data": {
                "user_info": {},
                "category_id": activeQuestData?.category ?? body.category ?? 0,
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

        const ctx = await resolveMultiPlayerContext(viewerId);
        if (!ctx || !ctx.player) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid viewer id or no player bound."
            });
        }

        const { playerId } = ctx;

        if (isFiveBossContinueRequest(playerId, Number(body.category), Number(body.quest_id), body.play_id)) {
            try {
                const data = await continueFiveBoss({ playerId, category: Number(body.category), questId: Number(body.quest_id),
                    playId: body.play_id, isMulti: true, apiCount: body.api_count, statistics: body.statistics })
                const recovered = resolveActiveQuest({ playerId, hint: body, memory: activeQuests, allowRebuild: false })
                if (recovered?.quest.playId === body.play_id) recovered.quest.continueCount = data.continue_count
                reply.header("content-type", "application/x-msgpack")
                return reply.status(200).send({ data_headers: generateDataHeaders({ viewer_id: viewerId }), data })
            } catch (error) {
                if (!(error instanceof FiveBossContinueError)) throw error
                if (error.stale) {
                    // The run ended before this client recovered it. The CN
                    // client treats a 400 here as a fatal H400 and logs out,
                    // so acknowledge without charging or reviving anything.
                    gameVerboseLog(() => `[MULTI] play_continue: stale ack viewer=${viewerId}`
                        + ` quest=${body.quest_id} reason=${error.message}`)
                    reply.header("content-type", "application/x-msgpack")
                    return reply.status(200).send({
                        data_headers: generateDataHeaders({ viewer_id: viewerId }),
                        data: fiveBossContinueAcknowledgement(playerId),
                    })
                }
                gameVerboseLog(() => `[MULTI] play_continue: rejected viewer=${viewerId}`
                    + ` quest=${body.quest_id} reason=${error.message}`)
                return reply.status(400).send({ error: "Bad Request", message: error.message })
            }
        }

        const persisted = getPlayerActiveQuestSync(playerId)
        let activeData: ActiveQuest | undefined = persisted?.isMulti
            && persisted.playId === body.play_id
            ? activeQuests[playerId]?.playId === body.play_id
                ? activeQuests[playerId]
                : activeQuestFromPersistent(persisted)
            : undefined
        if (activeData) activeQuests[playerId] = activeData
        if (!activeData) {
            console.warn(`[MULTI] stale continue acknowledged: viewer=${viewerId}`
                + ` play=${body.play_id} reason=active_quest_missing_or_replaced`)
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                data_headers: generateDataHeaders({ viewer_id: viewerId }),
                data: { continue_count: 0 },
            })
        }
        const nextContinueCount = activeData.continueCount + 1;
        const updated = await runPersistenceTransaction({
            domain: "multi-settlement", playerId, operation: "continue",
        }, () => updatePlayerActiveQuestContinueCountIfPlayIdSync(
            playerId,
            activeData!.playId,
            nextContinueCount,
        ));
        if (!updated) {
            if (activeQuests[playerId]?.playId === body.play_id) {
                delete activeQuests[playerId]
            }
            console.warn(`[MULTI] stale continue acknowledged after race: viewer=${viewerId}`
                + ` play=${body.play_id}`)
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                data_headers: generateDataHeaders({ viewer_id: viewerId }),
                data: { continue_count: 0 },
            })
        }
        activeData.continueCount = nextContinueCount;

        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                continue_count: nextContinueCount,
            }
        });
    });
}
