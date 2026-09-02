import type { FastifyReply } from "fastify"
import type { Player } from "../../data/types"
import type { MultiRoom } from "../../lib/types/multi"
import type { MultiAbortBody, MultiFinishBody, MultiStartBody } from "../types"
import { getPlayerActiveQuestSync } from "../../data/domains/quest_active"
import { FiveBossGauntletRunError } from "../../data/domains/fiveBossGauntletRun"
import { getPlayerItemSync } from "../../data/domains/item"
import { getPlayerSync, updatePlayerSync } from "../../data/domains/player"
import { getRankDegree } from "../../lib/stamina"
import { generateDataHeaders, getServerTime, realToVirtual } from "../../utils"
import { activeQuests } from "../../routes/api/singleBattleQuest"
import { getRoom, disbandRoom, updateRoomState } from "../room/manager"
import { sessionManager } from "../state/SessionManager"
import {
    abortFiveBossBattle,
    finishFiveBossBattle,
    FiveBossBattleRuntimeError,
    startFiveBossBattle,
    type FinishFiveBossBattleResult,
} from "../five-boss/battle-runtime"
import { isFiveBossGauntletQuest } from "../five-boss/contract"


type FollowInfoBuilder = (
    viewerId: number,
    mateResults: Array<{ viewer_id?: number }>,
    fallbackMateIds?: number[],
) => Promise<unknown[]>


export function isFiveBossBattleRequestError(error: unknown): boolean {
    return error instanceof FiveBossBattleRuntimeError
        || error instanceof FiveBossGauntletRunError
}


export function shouldHandleFiveBossStart(body: MultiStartBody): boolean {
    const room = body.room_number ? getRoom(body.room_number) : undefined
    return isFiveBossGauntletQuest(body.category, body.quest_id)
        || !!room && isFiveBossGauntletQuest(room.category, room.quest_id)
}


export function shouldHandleFiveBossMemberRequest(
    body: Pick<MultiFinishBody | MultiAbortBody, "category" | "quest_id">,
    playerId: number,
): boolean {
    if (isFiveBossGauntletQuest(body.category, body.quest_id)) return true
    const memory = activeQuests[playerId]
    if (memory && isFiveBossGauntletQuest(memory.category, memory.questId)) return true
    const persistent = getPlayerActiveQuestSync(playerId)
    return persistent !== null
        && isFiveBossGauntletQuest(persistent.category, persistent.questId)
}


function clearMatchingMemoryActive(playerId: number, playId: string): void {
    const active = activeQuests[playerId]
    if (
        active?.playId === playId
        && isFiveBossGauntletQuest(active.category, active.questId)
    ) {
        delete activeQuests[playerId]
    }
}


function terminalRoomTransition(
    roomNumber: string,
    runId: string,
    runStatus: "active" | "settled" | "aborted",
): void {
    if (runStatus === "active") return
    const room = getRoom(roomNumber)
    if (
        !room
        || !isFiveBossGauntletQuest(room.category, room.quest_id)
        || room.five_boss_runtime?.runId !== runId
    ) {
        return
    }

    sessionManager.clearBattleExpectedCount(roomNumber)
    if (runStatus === "settled") {
        delete room.five_boss_runtime
        updateRoomState(roomNumber, 1)
        return
    }
    disbandRoom(roomNumber)
}


function requirePlayer(playerId: number): Player {
    const player = getPlayerSync(playerId)
    if (!player) throw new Error(`five-boss player ${playerId} disappeared`)
    return player
}


function finishItemList(
    result: FinishFiveBossBattleResult,
    playerId: number,
): Record<string, number> {
    if (result.kind !== "success") return {}

    return Object.fromEntries(result.reward.grantedItems.map(item => [
        String(item.itemId),
        getPlayerItemSync(playerId, item.itemId) ?? 0,
    ]))
}


function buildFinishData(
    player: Player,
    body: MultiFinishBody,
    result: FinishFiveBossBattleResult,
    dataHeaders: ReturnType<typeof generateDataHeaders>,
    matePlayerResult: Array<{ viewer_id?: number }>,
    followInfo: unknown[],
) {
    return {
        user_info: {
            free_mana: player.freeMana,
            exp_pool: player.expPool,
            exp_pooled_time: getServerTime(player.expPooledTime),
            free_vmoney: player.freeVmoney,
            rank_point: player.rankPoint,
            degree_id: getRankDegree(player.rankPoint),
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
        clear_rank: result.kind === "success" ? 5 : 0,
        drop_score_reward_ids: [],
        drop_rare_reward_ids: [],
        drop_additional_reward_ids: [],
        drop_periodic_reward_ids: [],
        equipment_list: [],
        category_id: body.category,
        start_time: dataHeaders.servertime,
        is_multi: "multi",
        quest_name: "",
        item_list: finishItemList(result, player.id),
        presigned_quest_category: [],
        mate_player_result: matePlayerResult,
        follow_info: followInfo,
        contribution_score: body.contribution_score ?? 0,
        host_finished: true,
        aborted_play_id: null,
    }
}


export function handleFiveBossStart(
    body: MultiStartBody,
    playerId: number,
    reply: FastifyReply,
) {
    const room = getRoom(body.room_number)
    if (!room) {
        return reply.status(400).send({
            error: "Bad Request",
            message: "Room doesn't exist.",
        })
    }

    const result = startFiveBossBattle({
        playerId,
        clientPlayId: body.play_id,
        room,
        requestRoomNumber: body.room_number,
        requestCategory: body.category,
        requestQuestId: body.quest_id,
        useBoostPoint: body.use_boost_point,
        useBossBoostPoint: body.use_boss_boost_point,
        httpIsAutoStartMode: body.is_auto_start_mode,
        matePlayerIds: body.mate_player_ids,
        mateComIds: room.mates.map(mate => mate.com_id),
    })
    activeQuests[playerId] = result.activeQuest
    updatePlayerSync({ id: playerId, partySlot: body.party_id })

    reply.header("content-type", "application/x-msgpack")
    return reply.status(200).send({
        data_headers: generateDataHeaders({ viewer_id: body.viewer_id }),
        data: {
            is_multi: "multi",
            play_id: body.play_id,
        },
    })
}


export async function handleFiveBossFinish(
    body: MultiFinishBody,
    playerId: number,
    reply: FastifyReply,
    buildFollowInfo: FollowInfoBuilder,
) {
    const memoryBeforeFinish = activeQuests[playerId]
    const party = body.statistics?.party ?? body.quest_statistics?.party
    const result = finishFiveBossBattle({
        playerId,
        clientPlayId: body.play_id,
        requestRoomNumber: body.room_number,
        requestCategory: body.category,
        requestQuestId: body.quest_id,
        accomplished: body.is_accomplished as boolean,
        elapsedTimeMs: body.elapsed_time_ms ?? body.battle_time ?? 0,
        highScore: body.score ?? 0,
        leaderCharacterId: party?.characters?.[0]?.id ?? null,
    })
    clearMatchingMemoryActive(playerId, body.play_id)
    terminalRoomTransition(body.room_number, result.runId, result.runStatus)

    const matePlayerResult = body.mate_player_result ?? []
    const followInfo = await buildFollowInfo(
        body.viewer_id,
        matePlayerResult,
        memoryBeforeFinish?.matePlayerIds ?? body.mate_player_ids ?? [],
    )
    const dataHeaders = generateDataHeaders({ viewer_id: body.viewer_id })
    const player = requirePlayer(playerId)
    reply.header("content-type", "application/x-msgpack")
    return reply.status(200).send({
        data_headers: dataHeaders,
        data: buildFinishData(
            player,
            body,
            result,
            dataHeaders,
            matePlayerResult,
            followInfo,
        ),
    })
}


export function handleFiveBossAbort(
    body: MultiAbortBody,
    playerId: number,
    reply: FastifyReply,
) {
    const result = abortFiveBossBattle({
        playerId,
        clientPlayId: body.play_id,
        requestRoomNumber: body.room_number,
        requestCategory: body.category,
        requestQuestId: body.quest_id,
    })
    clearMatchingMemoryActive(playerId, body.play_id)
    terminalRoomTransition(body.room_number, result.runId, result.runStatus)

    const headers = generateDataHeaders({ viewer_id: body.viewer_id })
    reply.header("content-type", "application/x-msgpack")
    return reply.status(200).send({
        data_headers: headers,
        data: {
            user_info: {},
            category_id: body.category,
            is_multi: "multi",
            start_time: headers.servertime,
            quest_name: "",
            aborted_play_id: null,
            unfinished_play_id: null,
            drawn_quest: null,
            party_info: null,
            presigned_url: null,
        },
    })
}
