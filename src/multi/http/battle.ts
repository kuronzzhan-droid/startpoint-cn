import { getPlayerClientExpTime } from "../../lib/player-time-compat"
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
import { insertActiveQuest, activeQuests, type ActiveQuest } from "../../routes/api/singleBattleQuest";
import {
    deletePlayerActiveQuestIfPlayIdSync,
    getPlayerActiveQuestSync,
    updatePlayerActiveQuestContinueCountIfPlayIdSync,
} from "../../data/domains/quest_active";
import {
    getPlayerSync,
    updatePlayerSync,
} from "../../data/domains/player";
import { getQuestFromCategorySync } from "../../lib/assets";
import { computeRealTimeStamina } from "../../lib/stamina";
import { BattleQuest, QuestCategory } from "../../lib/types";
import { getSteamRobotMissionClientChecks } from "../../lib/mission/steam-robot-challenge";
import { gameVerboseLog } from "../../lib/game-logging";
import { getPlayerMailCountSync } from "../../data/domains/mail";
import { buildFollowUserInfoSync } from "../../lib/follow";
import { mergeMultiSettlementResults } from "../settlement";
import {
    measureSettlementPhaseAsync,
    recordSettlementPhase,
} from "../../lib/settlement-performance";
import {
    buildFinishResponseCacheKey,
    acquireFinishExecution,
    cacheFinishResponse,
} from "../../lib/finish-response-cache";
import {
    settleMode15BattleSync,
    isMode15Quest,
} from "../../lib/mode15-optional";
import { recordSuccessfulQuestNpcParty } from "../npc/player-party-pool";
import { runPersistenceTransaction, runWriterCommand } from "../../lib/persistence-coordinator";
import {
    MULTI_SETTLE_FINISH,
    type MultiSettleFinishArgs,
    type MultiSettleFinishResult,
} from "../../lib/persistence/command-names";
import { assertBattleCanStartSync, getBattleReplaySync } from "../../data/domains/battle-settlement-ledger";
import { multiFinishPlayId, isMultiFinishResponse, multiFinishMvpFlag } from "../../lib/quest/finish/multi-finish-identity";
import { captureBattleRosterSync, battlePartyFromWire, normalizeBattleParty, isBattleRosterError } from "../../lib/quest/battle-roster";
import { addManaSafe, buildBattleManaRewards, isFieldManaError, readFieldMana } from "../../lib/quest/finish/field-mana";
import { isManaCounterError } from "../../data/domains/mana-counter";
import {
    getMultiSettlementSnapshot,
    registerMultiSettlementSnapshot,
    transitionMultiSettlementSnapshot,
} from "../settlement-snapshot";
import { getRoomCommandGateway, assertRealtimeOwnerEpoch } from "../coordinator/default-runtime";
import { performance } from "node:perf_hooks";
import { publishDurableOwnerDecision } from "../coordinator/durable-owner-event";
import type { StartPrepareResult, BattleQueryResult } from "../coordinator/battle-command-handlers";
import { resolveMultiPlayerContext } from "../player-context";
import { createRoomCommandId } from "../coordinator/command-protocol";
import { isValidNormalPartySlotSync } from "../../data/domains/party";
import { usesNormalCurrentPartySlot } from "../../lib/party-current-slot";

import { isContentQuestOpenAt } from "../../lib/content-operations";
import { registerAcceptedRescueBattleSync } from "../../lib/mission/rescue-battle-facts";

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
                exp_pooled_time: getPlayerClientExpTime(player),
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
        clockVersion: quest.clockVersion,
        battleRoster: quest.battleRoster,
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

        if (isNaN(viewer_id) || isNaN(party_id) || isNaN(quest_id) || isNaN(category) || multiFinishPlayId(play_id) === null || typeof use_boost_point !== "boolean" || typeof use_boss_boost_point !== "boolean" || is_auto_start_mode === undefined) {
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
        const attentionProjection = room_number ? await getRoomCommandGateway().execute("battle.query", {
            roomNumber: room_number, viewerId: viewer_id,
            ...(body.attention_key ? { attentionKey: body.attention_key } : {}),
        }) as BattleQueryResult : undefined
        const alreadyRoomMember = attentionProjection?.member === true
        if (body.attention_key
            && !alreadyRoomMember
            && !attentionProjection?.attentionValid) {
            return sendMultiStartUnavailable(reply, viewer_id, "attention_expired")
        }

        if (isFiveBossHiddenQuest(category, quest_id)) {
            return reply.status(400).send({ error: "Bad Request", message: "Internal five-boss scene is not an entry quest." });
        }
        const questData = getQuestFromCategorySync(category, quest_id) as BattleQuest | null;
        if (questData === null || !('rankPointReward' in questData)) {
            return sendMultiStartUnavailable(reply, viewer_id, "quest_missing")
        }

        const prepareId = createRoomCommandId();
        const durableQuest = getPlayerActiveQuestSync(ctx.playerId), durableSnapshot = getMultiSettlementSnapshot(ctx.playerId, play_id);
        const durableStart = durableQuest?.isMulti && durableQuest.playId === play_id && durableQuest.roomNumber === room_number
            && durableQuest.category === category && durableQuest.questId === quest_id
            && durableSnapshot?.lifecycle === "BATTLE" && durableSnapshot.roomInstanceId
            && durableSnapshot.viewerId === viewer_id && durableSnapshot.roomNumber === room_number
            ? { roomInstanceId: durableSnapshot.roomInstanceId, battleSessionId: durableSnapshot.battleInstanceId,
                playId: play_id, playerId: ctx.playerId, viewerId: viewer_id } : undefined;
        if (!durableStart && !isContentQuestOpenAt(category, quest_id)) return sendMultiStartUnavailable(reply, viewer_id, "content_operations_closed");
        let roomStart: StartPrepareResult;
        try {
            roomStart = await getRoomCommandGateway().execute("battle.start.prepare", {
                body, playerId: ctx.playerId, fixedParty: questData.fixedParty !== undefined,
                ...(durableStart ? { durableStart } : {}),
            }, { commandId: prepareId }) as StartPrepareResult;
        } catch (error) {
            // No persistence callback has run. Cancel this exact attempt, including a delayed Prepare.
            try { await getRoomCommandGateway().execute("battle.start.cancelAttempt", {
                prepareId, roomNumber: room_number, viewerId: viewer_id, playerId: ctx.playerId, playId: play_id,
            }); } catch (cancelError) { console.error("[MULTI] prepare cancellation unresolved", cancelError); }
            throw error;
        }
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


        const mateComIds = roomStart.mateComIds;
        const activeQuest: ActiveQuest = {
            questId: quest_id,
            category,
            useBoostPoint: use_boost_point,
            useBossBoostPoint: use_boss_boost_point,
            isAutoStartMode: is_auto_start_mode,
            isMulti: true,
            isMultiHost: roomStart.isHost,
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
        let previousActiveQuest: ActiveQuest | undefined, insertedActiveQuest: ActiveQuest | undefined;
        let repeatedPendingStart = false;
        const startDeadline = performance.now() + Math.max(0, roomStart.remainingMs - 100);
        try {
            await runPersistenceTransaction({
                domain: "multi-settlement", playerId: ctx.playerId, operation: "start",
            }, () => {
                if (performance.now() >= startDeadline) throw new Error("START_CLAIM_EXPIRED");
                assertRealtimeOwnerEpoch(roomStart.ownerEpoch, roomStart.claimToken ?? undefined, true);
                assertBattleCanStartSync(ctx.playerId, play_id);
                previousActiveQuest = activeQuests[ctx.playerId];
                const pending = getPlayerActiveQuestSync(ctx.playerId);
                if (pending?.playId === play_id) {
                    if (!pending.isMulti || pending.category !== category || pending.questId !== quest_id
                        || pending.roomNumber !== room_number || pending.useBoostPoint !== use_boost_point
                        || pending.useBossBoostPoint !== use_boss_boost_point || pending.isAutoStartMode !== is_auto_start_mode
                        || (questData.fixedParty === undefined && pending.partySlot !== party_id)) {
                        throw new Error("Battle start does not match the pending play.");
                    }
                    Object.assign(activeQuest, activeQuestFromPersistent(pending));
                    registerAcceptedRescueBattleSync({ playerId: ctx.playerId, viewerId: viewer_id,
                        playId: play_id, category, questId: quest_id, roomNumber: room_number,
                        roomInstanceId: roomStart.roomInstanceId, battleSessionId: roomStart.battleSessionId,
                        isHost: roomStart.isHost, isRescueGuest: roomStart.isRescueGuest,
                        isRescueFragmentEligible: roomStart.isRescueFragmentEligible });
                    repeatedPendingStart = true;
                    return;
                }
                if (!durableStart && !isContentQuestOpenAt(category, quest_id)) throw new Error("QUEST_OPERATIONS_CLOSED");
                activeQuest.battleRoster = captureBattleRosterSync({ playerId: ctx.playerId,
                    questCategory: category, questId: quest_id, partyId: party_id, fixedParty: questData.fixedParty,
                    party: questData.fixedParty === undefined ? battlePartyFromWire(roomStart.battleParty) : undefined });
                activeQuest.battleRoster.multi = { battleInstanceId: roomStart.battleSessionId,
                    roomInstanceId: roomStart.roomInstanceId, roomGeneration: roomStart.roomGeneration,
                    participants: roomStart.participants.map(mate => ({ ...mate })),
                    expectedRealViewerIds: [...roomStart.expectedRealViewerIds],
                    isRescueGuest: roomStart.isRescueGuest,
                    isRescueFragmentEligible: roomStart.isRescueFragmentEligible,
                    isNewbieRescueGuest: roomStart.isNewbieRescueGuest };
                insertActiveQuest(ctx.playerId, activeQuest);
                insertedActiveQuest = activeQuests[ctx.playerId];
                registerAcceptedRescueBattleSync({ playerId: ctx.playerId, viewerId: viewer_id,
                    playId: play_id, category, questId: quest_id, roomNumber: room_number,
                    roomInstanceId: roomStart.roomInstanceId, battleSessionId: roomStart.battleSessionId,
                    isHost: roomStart.isHost, isRescueGuest: roomStart.isRescueGuest,
                    isRescueFragmentEligible: roomStart.isRescueFragmentEligible });
                if (questData.fixedParty === undefined
                    && usesNormalCurrentPartySlot(category)
                    && isValidNormalPartySlotSync(ctx.playerId, party_id)) {
                    updatePlayerSync({ id: ctx.playerId, partySlot: party_id });
                }
            });
        } catch (error) {
            if (insertedActiveQuest && activeQuests[ctx.playerId] === insertedActiveQuest) {
                if (previousActiveQuest) activeQuests[ctx.playerId] = previousActiveQuest;
                else delete activeQuests[ctx.playerId];
            }
            try {
                await getRoomCommandGateway().execute("battle.play.cancel", {
                    roomNumber: room_number, roomInstanceId: roomStart.roomInstanceId,
                    battleSessionId: roomStart.battleSessionId, viewerId: viewer_id,
                    playerId: ctx.playerId, playId: play_id,
                    claimToken: roomStart.claimToken,
                });
            } catch (cancelError) {
                console.error(`[MULTI] failed start claim cancellation: play=${play_id}`, cancelError);
            }
            if (error instanceof Error && error.message === "QUEST_OPERATIONS_CLOSED") return sendMultiStartUnavailable(reply, viewer_id, "content_operations_closed");
            const code = (error as { code?: string })?.code;
            if (code === "BATTLE_ALREADY_SETTLED" || code === "BATTLE_CLOCK_ABORTED"
                || isBattleRosterError(error)
                || (error as Error).message === "Battle start does not match the pending play.") {
                return reply.status(400).send({ error: "Bad Request", message: (error as Error).message });
            }
            throw error;
        }
        if (!repeatedPendingStart || !getMultiSettlementSnapshot(ctx.playerId, play_id)) registerMultiSettlementSnapshot({
            battleInstanceId: roomStart.battleSessionId,
            roomInstanceId: roomStart.roomInstanceId,
            playerId: ctx.playerId,
            viewerId: viewer_id,
            playId: play_id,
            roomNumber: room_number,
            roomGeneration: roomStart.roomGeneration,
            activeQuest,
            participants: roomStart.participants,
            expectedRealViewerIds: roomStart.expectedRealViewerIds,
            npcPartySnapshot: roomStart.npcPartySnapshot,
            isHost: roomStart.isHost,
            isRescueGuest: roomStart.isRescueGuest,
            isRescueFragmentEligible: roomStart.isRescueFragmentEligible,
            isNewbieRescueGuest: roomStart.isNewbieRescueGuest,
        });
        try {
            await publishDurableOwnerDecision("battle.play.commit", {
                roomNumber: room_number, roomInstanceId: roomStart.roomInstanceId,
                battleSessionId: roomStart.battleSessionId, viewerId: viewer_id,
                playerId: ctx.playerId, playId: play_id,
                claimToken: roomStart.claimToken,
            });
        } catch (commitError) {
            // The active play already committed. Keep its durable identity and
            // reply; failure to publish state must not reclassify that write.
            console.error(`[MULTI] room play commit confirmation failed: play=${play_id}`, commitError);
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
        const playId = multiFinishPlayId(body.play_id);
        if (playId === null) return reply.status(400).send({
            error: "Bad Request", message: "A multiplayer play id is required.",
        });
        // Check before the special-mode dispatch as well: changing the quest
        // category cannot route a generic settled play around its ledger.
        const initialReplay = getBattleReplaySync(playerId, "multi", playId);
        if (initialReplay.kind !== "missing") {
            if (initialReplay.kind !== "available" || !isMultiFinishResponse(initialReplay.response)) {
                return reply.status(400).send({ error: "Bad Request", message: "Battle result cannot be replayed. Please reload." });
            }
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send(initialReplay.response);
        }
        if (shouldHandleFiveBossMemberRequest(body, playerId)) {
            try { return await handleFiveBossFinish(body, playerId, reply,
                (viewer, mates, fallback) => buildFinishFollowInfo(playerId, viewer, mates, fallback)); }
            catch (error) {
                if (!isFiveBossBattleRequestError(error)) throw error;
                logFiveBossRequestFailure("finish", body, playerId, error);
                return reply.status(400).send({ error: "Bad Request", message: (error as Error).message });
            }
        }

        try {
            multiFinishMvpFlag(body.statistics || body.quest_statistics || {});
        } catch (error) {
            if (!(error instanceof TypeError) && !isBattleRosterError(error)) throw error;
            return reply.status(400).send({ error: "Bad Request", message: error.message });
        }

        const finishCacheKey = buildFinishResponseCacheKey(
            "multi",
            viewerId,
            body as unknown as Record<string, unknown>,
        );
        const executionWaitStartedAt = process.hrtime.bigint();
        const releaseFinishExecution = await acquireFinishExecution(`multi:${playerId}`);
        recordSettlementPhase(
            "multi", "finish_execution_wait",
            Number(process.hrtime.bigint() - executionWaitStartedAt) / 1_000_000,
        );
        try {
            const replay = getBattleReplaySync(playerId, "multi", playId);
            if (replay.kind !== "missing") {
                if (replay.kind !== "available" || !isMultiFinishResponse(replay.response)) return reply.status(400).send({
                    error: "Bad Request", message: "Battle result cannot be replayed. Please reload.",
                });
                reply.header("content-type", "application/x-msgpack");
                return reply.status(200).send(replay.response);
            }

            const settlementSnapshot = getMultiSettlementSnapshot(playerId, body.play_id);
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
            if (!activeQuestData.isMulti || activeQuestData.playId !== playId
                || Number(body.quest_id) !== Number(activeQuestData.questId)
                || Number(body.category) !== Number(activeQuestData.category)) {
                return reply.status(400).send({ error: "Bad Request", message: "Finish does not match the multiplayer play." });
            }

            const finishProjection = activeQuestData.roomNumber ? await getRoomCommandGateway().execute("battle.query", {
                roomNumber: activeQuestData.roomNumber, viewerId, playerId, playId,
            }) as BattleQueryResult : undefined;
            const finishRoom = finishProjection?.room;
            const frozenMulti = activeQuestData.battleRoster?.multi;
            const settlementGeneration = frozenMulti?.roomGeneration ?? settlementSnapshot?.roomGeneration ?? finishProjection?.binding?.generation ?? 0;
            const settlementKey = frozenMulti?.battleInstanceId ?? settlementSnapshot?.battleInstanceId
                ?? finishProjection?.binding?.battleSessionId
                ?? `${activeQuestData.roomNumber || body.room_number || "missing"}:${settlementGeneration}:${body.play_id}`;
            const settlementParticipants = frozenMulti?.participants ?? settlementSnapshot?.participants ?? (finishRoom?.mates || [])
                .map(mate => ({
                    viewerId: Number(mate.viewer_id),
                    comId: Number(mate.com_id || 0),
                }))
                .filter(mate => Number.isFinite(mate.viewerId) && mate.viewerId > 0);
            const expectedRealViewerIds = frozenMulti?.expectedRealViewerIds ?? settlementSnapshot?.expectedRealViewerIds ?? (finishRoom?.expected_real_viewer_ids || [])
                .map(Number)
                .filter(expectedViewerId => Number.isFinite(expectedViewerId) && expectedViewerId > 0);
            const finishedAsRescueGuest = frozenMulti?.isRescueGuest ?? settlementSnapshot?.isRescueGuest ?? (activeQuestData.roomNumber
                ? Boolean(finishProjection?.isRescueGuest)
                : false);
            const finishedAsRescueFragmentEligible = frozenMulti?.isRescueFragmentEligible ?? settlementSnapshot?.isRescueFragmentEligible ?? (activeQuestData.roomNumber
                ? Boolean(finishProjection?.isRescueFragmentEligible)
                : false);
            const finishedAsNewbieRescueGuest = frozenMulti?.isNewbieRescueGuest ?? settlementSnapshot?.isNewbieRescueGuest ?? (activeQuestData.roomNumber
                ? Boolean(finishProjection?.isNewbieRescueGuest)
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

            try {
                addManaSafe(questData.manaReward, readFieldMana(body.add_mana));
                buildBattleManaRewards(questData.manaReward, readFieldMana(body.add_mana), isMode15Quest(questCategory, questId));
                normalizeBattleParty((body.statistics || body.quest_statistics)?.party
                    ?? { characters: [], unison_characters: [] }, questData.fixedParty !== undefined);
            } catch (error) {
                if (!isBattleRosterError(error) && !isFieldManaError(error) && !isManaCounterError(error)) throw error;
                return reply.status(400).send({ error: "Bad Request", message: error.message });
            }
            const finishedAsHost = settlementSnapshot?.isHost ?? (frozenMulti
                ? activeQuestData.isMultiHost === true : activeQuestData.roomNumber
                ? finishRoom?.host_player_id === playerId
                : false);

            const questAccomplished = Boolean((body as any).is_accomplished);
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
                restrictParticipants: frozenMulti !== undefined || settlementParticipants.length > 0,
                // Preserve the original repaired 1.2-second compatibility
                // barrier.  mergeMultiSettlementResults still returns early as
                // soon as every real participant has submitted.
                waitMs: parseInt(process.env.MULTI_SETTLEMENT_BARRIER_MS || "1200", 10),
            }));
            const postBarrierStartedAt = process.hrtime.bigint();
            const matePlayerResult = settlementResult.mateResults;
            gameVerboseLog(() =>
                `[MULTI] settlement roster: room=${activeQuestData.roomNumber || body.room_number || "missing"} `
                + `generation=${settlementGeneration} viewer=${viewerId} `
                + `submitted=${settlementResult.submittedCount}/${settlementResult.expectedCount} `
                + `returned=${matePlayerResult.length} synthesized=${settlementResult.synthesizedViewerIds.join(",") || "none"}`
            );
            const followInfo = await buildFinishFollowInfo(playerId, viewerId, matePlayerResult,
                frozenMulti ? frozenMulti.participants.map(mate => mate.viewerId) : activeQuestData.matePlayerIds || []);
            const settled = await measureSettlementPhaseAsync("multi", "transaction", () => (
                runWriterCommand<MultiSettleFinishArgs, MultiSettleFinishResult>(
                    MULTI_SETTLE_FINISH,
                    {
                        playerId, viewerId, body, questCategory, questId, questData, activeQuestData,
                        allowFrozenSnapshot: settlementSnapshot !== undefined,
                        playId, finishedAsHost, finishedAsRescueGuest, finishedAsRescueFragmentEligible,
                        finishedAsNewbieRescueGuest, matePlayerResult, followInfo,
                        evaluationTimeMs: getServerTime() * 1000,
                    },
                    { domain: "multi-settlement", playerId, operation: "finish" },
                )
            )).catch(error => {
                if (!isBattleRosterError(error) && !isFieldManaError(error) && !isManaCounterError(error)) throw error;
                reply.status(400).send({ error: "Bad Request", message: error.message });
                return null;
            });
            if (settled === null) return;
            if (settled.response === null) {
                return reply.status(400).send({ error: "Bad Request", message: "No unsettled multiplayer play." });
            }
            const finishResponse = settled.response;
            cacheFinishResponse(finishCacheKey, finishResponse);
            if (settled.applied) {
                const stillOwnSnapshot = getMultiSettlementSnapshot(playerId, playId) === settlementSnapshot;
                if (stillOwnSnapshot) transitionMultiSettlementSnapshot(playerId, playId, "SETTLING");
                const committedRunId = settlementSnapshot?.battleInstanceId ?? finishProjection?.binding?.battleSessionId;
                const committedInstanceId = settlementSnapshot?.roomInstanceId ?? finishProjection?.binding?.roomInstanceId;
                if (activeQuestData.roomNumber && stillOwnSnapshot && committedRunId && committedInstanceId) {
                    try {
                        const roomResult = await publishDurableOwnerDecision("battle.settlement.committed", {
                            roomNumber: activeQuestData.roomNumber,
                            roomInstanceId: committedInstanceId,
                            battleSessionId: committedRunId,
                            generation: settlementGeneration, viewerId, playerId, playId,
                        }) as { applied: boolean; snapshotPhase?: "LOBBY" | "RETURN_PENDING"; reason?: string } | undefined;
                        if (roomResult?.applied && roomResult.snapshotPhase) {
                            transitionMultiSettlementSnapshot(playerId, playId, roomResult.snapshotPhase);
                        }
                    } catch (error) {
                        // Payment and its replayable response already committed.
                        console.error(`[MULTI] settlement return failed after commit: player=${playerId} play=${playId}`, error);
                    }
                }

            }
            if (settled.applied && questAccomplished) {
                try {
                    recordSuccessfulQuestNpcParty(settlementSnapshot?.npcPartySnapshot);
                } catch (error) {
                    console.error(`[MULTI] NPC clear record failed after commit: player=${playerId} play=${playId}`, error);
                }
            }
            if (getMultiSettlementSnapshot(playerId, playId) === settlementSnapshot) {
                transitionMultiSettlementSnapshot(playerId, playId, "RETURN_PENDING");
            }
            // The database cleanup already committed with rewards and the receipt.
            if (activeQuests[playerId]?.isMulti && activeQuests[playerId]?.playId === activeQuestData.playId
                && Number(activeQuests[playerId]?.questId) === Number(questId)
                && Number(activeQuests[playerId]?.category) === Number(questCategory)) {
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
            reply.header("content-type", "application/x-msgpack");
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
            const abortProjection = abortRoomNumber ? await getRoomCommandGateway().execute("battle.query", {
                roomNumber: abortRoomNumber, viewerId, playerId, playId: activeQuestData.playId,
            }) as BattleQueryResult : undefined;
            const abortRoom = abortProjection?.room;
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
                if (abortProjection?.binding) await publishDurableOwnerDecision("battle.abort.committed", {
                    roomNumber: activeQuestData.roomNumber, roomInstanceId: abortProjection.binding.roomInstanceId,
                    battleSessionId: abortProjection.binding.battleSessionId, viewerId, playerId, playId: abortedPlayId,
                });
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
