import type { FastifyReply } from "fastify"
import type { Player } from "../../data/types"
import type { MultiRoom } from "../../lib/types/multi"
import type { MultiAbortBody, MultiFinishBody, MultiStartBody } from "../types"
import { getPlayerActiveQuestSync } from "../../data/domains/quest_active"
import { FiveBossGauntletRunError, backfillMissingFinalizeSync } from "../../data/domains/fiveBossGauntletRun"
import { getPlayerItemSync } from "../../data/domains/item"
import { getPlayerEquipmentSync } from "../../data/domains/equipment"
import { getPlayerSync, updatePlayerSync } from "../../data/domains/player"
import { getQuestFromCategorySync } from "../../lib/assets"
import { givePlayerCharactersExpSync } from "../../lib/character"
import { clientSerializeEquipment } from "../../lib/equipment"
import type { RewardPlayerCharacterExpResult } from "../../lib/types/character"
import { getRankDegree } from "../../lib/stamina"
import { generateDataHeaders, getServerTime, realToVirtual } from "../../utils"
import { activeQuests } from "../../routes/api/singleBattleQuest"
import { getRoom, disbandRoom } from "../room/manager"
import { sessionManager } from "../state/SessionManager"
import {
    abortFiveBossBattle,
    finishFiveBossBattle,
    FiveBossBattleRuntimeError,
    startFiveBossBattle,
    type FinishFiveBossBattleResult,
} from "../five-boss/battle-runtime"
import { isFiveBossGauntletQuest } from "../five-boss/contract"
import { buildFiveBossAdditionalRewardDrops, buildFiveBossWeaponAdditionalRewardDrops } from "../five-boss/rewards"


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
        // 结算后不再把房间退回 raising_state=1 复用,而是直接解散:
        // V7 客户端补丁 five-boss-random-map 的选图种子 = 房间号,同一房间再战
        // 会抽到同一套变体;解散逼房主重建房间 = 新房号 = 新一轮随机。
        // 代价是结算页点「再战」会提示房间已解散,回到关卡页重建(作者接受随机性优先)。
        console.log(`[MULTI] five-boss settled: disbanding room ${roomNumber} so the next run rerolls its map seed`)
        disbandRoom(roomNumber)
        return
    }
    disbandRoom(roomNumber)
}


/**
 * CN 客户端的 multi finish / abort 请求体**不带 room_number**(官方
 * BattleQuestFinishRealRemote / QuestAbortRealRemote 都没有这个字段),原生多人路径
 * 一直是靠服务端 activeQuests 记住房号。五重 runtime 的冻结契约要求 requestRoomNumber
 * 非空,真机首战(2026-09-04)就因此在结算时连吃 6 个 H400。这里按
 * 请求体 → 内存 activeQuests → 持久化 players_active_quests 的顺序补房号;
 * 全都没有才让 runtime 用原来的 invalid_argument 拒绝。
 */
function resolveFiveBossRoomNumber(bodyRoomNumber: unknown, playerId: number): string {
    if (typeof bodyRoomNumber === "string" && bodyRoomNumber.length > 0) return bodyRoomNumber
    const memory = activeQuests[playerId]
    if (memory && isFiveBossGauntletQuest(memory.category, memory.questId) && memory.roomNumber) {
        return memory.roomNumber
    }
    const persistent = getPlayerActiveQuestSync(playerId)
    if (
        persistent
        && isFiveBossGauntletQuest(persistent.category, persistent.questId)
        && persistent.roomNumber
    ) {
        return persistent.roomNumber
    }
    return ""
}


/**
 * 上一局没结算干净(客户端半路报错退出、房间早已解散)时,玩家身上还挂着旧的
 * 五重持久化 active quest,新一局 start 会被 runtime 以 active_quest_mismatch 拒绝,
 * 玩家从此进不了五重。开新局前把这条"房间已不存在"的旧局按 abort 收掉。
 * 只处理旧 play_id 与本次不同、且房号与本次不同的情况;收不掉就原样交给 runtime 报错。
 */
function abandonStaleFiveBossRun(body: MultiStartBody, playerId: number): void {
    const stale = getPlayerActiveQuestSync(playerId)
    if (
        !stale
        || !isFiveBossGauntletQuest(stale.category, stale.questId)
        || stale.playId === body.play_id
        || stale.roomNumber === body.room_number
    ) {
        return
    }
    try {
        const aborted = abortFiveBossBattle({
            playerId,
            clientPlayId: stale.playId,
            requestRoomNumber: stale.roomNumber ?? "",
            requestCategory: stale.category,
            requestQuestId: stale.questId,
        })
        clearMatchingMemoryActive(playerId, stale.playId)
        console.log(`[MULTI] five-boss start: abandoned stale run for player ${playerId}`
            + ` room=${stale.roomNumber} play=${stale.playId}`
            + ` status=${aborted.abortStatus}/${aborted.runStatus}`)
    } catch (error) {
        console.warn(`[MULTI] five-boss start: could not abandon stale run for player ${playerId}`
            + ` room=${stale.roomNumber}: ${(error as Error).message}`)
    }
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


/**
 * receipt 里的诅咒武器 id 列表。升级前(lens0909 / 347efb99)落盘的 receipt 没有
 * grantedEquipment 字段,而 settleMemberSync 重放时是原样 JSON.parse 读回、不补默认值;
 * 这类 receipt 按"当年没有掉武器"处理,否则 for…of / map 会抛 TypeError,finish 变 500。
 */
function receiptGrantedEquipment(result: FinishFiveBossBattleResult): number[] {
    if (result.kind !== "success") return []
    const granted: unknown = result.reward.grantedEquipment
    return Array.isArray(granted) ? granted : []
}


/**
 * 诅咒武器掉落序列化,镜像 finishItemList 的现查作风:receipt 里只留 grantedEquipment
 * (id 列表,重放时原样读回),equipment_list 的每一条状态(level/stack/护佑)在响应组装时
 * 现查数据库——重放遇到期间被其它途径改动过的持有状态,与 item_list 表现一致。
 * 按 id 去重(同一把命中两次只需一条最终状态)。
 */
function finishEquipmentList(
    result: FinishFiveBossBattleResult,
    playerId: number,
): Object[] {
    if (result.kind !== "success") return []

    const seen = new Set<number>()
    const list: Object[] = []
    for (const equipmentId of receiptGrantedEquipment(result)) {
        if (seen.has(equipmentId)) continue
        seen.add(equipmentId)
        const owned = getPlayerEquipmentSync(playerId, equipmentId)
        if (owned) list.push(clientSerializeEquipment(equipmentId, owned))
    }
    return list
}


/**
 * 结算页的经验卡(ExperienceCardPartyCharacter)会对**队伍里每个角色**调
 * QuestClearResult.getExperienceVariation(id),add_exp_list 里没有这个 id 就抛 C2620
 * 「キャラの経験値不明」(真机 2026-09-04,第二场景打完即崩)。所以哪怕五重的奖励走
 * 自己的账本,角色经验/羁绊状态也必须像普通多人一样按队伍逐个回填——
 * 官方 helper 对未持有的 id 也会补占位条目,这里直接复用。
 */
function rewardFiveBossPartyExp(
    playerId: number,
    party: { characters?: Array<{ id?: unknown } | null>, unison_characters?: Array<{ id?: unknown } | null> } | undefined,
    body: MultiFinishBody,
    accomplished: boolean,
    rewardsEnabled: boolean,
): RewardPlayerCharacterExpResult | null {
    const ids: number[] = []
    for (const entry of [...(party?.characters ?? []), ...(party?.unison_characters ?? [])]) {
        const id = Number(entry?.id)
        if (Number.isSafeInteger(id) && id > 0 && !ids.includes(id)) ids.push(id)
    }
    if (ids.length === 0) return null
    const questRow = getQuestFromCategorySync(body.category, body.quest_id) as { characterExpReward?: number } | null
    // 房主无票局(rewardsEnabled=false)角色经验也归零,但占位条目必须保留(C2620)。
    const expReward = accomplished && rewardsEnabled ? (questRow?.characterExpReward ?? 0) : 0
    return givePlayerCharactersExpSync(playerId, ids, expReward, false)
}


function buildFinishData(
    player: Player,
    body: MultiFinishBody,
    result: FinishFiveBossBattleResult,
    dataHeaders: ReturnType<typeof generateDataHeaders>,
    matePlayerResult: Array<{ viewer_id?: number }>,
    followInfo: unknown[],
    exp: RewardPlayerCharacterExpResult | null,
) {
    return {
        user_info: {
            free_mana: player.freeMana,
            exp_pool: player.expPool,
            exp_pooled_time: getServerTime(player.expPooledTime),
            free_vmoney: player.freeVmoney,
            rank_point: player.rankPoint,
            // getRankDegree 算出来的是玩家 **rank**(高 rank 号如 250),不是称号表 degree 的键;
            // 结算页 MVP 卡会拿 user_info.degree_id 去查 master/degree/degree,查不到就 C8601
            // 「指定的Key不存在 key=250」(真机 2026-09-04)。普通多人/关注列表都用玩家持久化的 degreeId。
            degree_id: player.degreeId || 1,
            stamina: player.stamina,
            stamina_heal_time: realToVirtual(player.staminaHealTime),
            boost_point: player.boostPoint,
            boss_boost_point: player.bossBoostPoint,
        },
        add_exp_list: exp?.add_exp_list ?? [],
        character_list: exp?.character_list ?? [],
        bond_token_status_list: exp?.bond_token_status_list ?? [],
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
        drop_additional_reward_ids: result.kind === "success"
            ? [
                ...buildFiveBossAdditionalRewardDrops(result.reward.grantedItems),
                ...buildFiveBossWeaponAdditionalRewardDrops(receiptGrantedEquipment(result)),
            ]
            : [],
        drop_periodic_reward_ids: [],
        equipment_list: finishEquipmentList(result, player.id),
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

    // 五重决战不消耗、不结算任何强化点:客户端在"降临讨伐"页签建房时会按官方 boss 战
    // 习惯默认勾上领主强化点(use_boss_boost_point=true),真机实测直接被 runtime 的
    // boost_not_allowed 拒成 H400 进不了战斗(2026-09-04)。这里把两个开关一律当 false
    // 交给 runtime(冻结契约不变:runtime 仍只接受 false),只留一行日志说明被忽略。
    if (body.use_boost_point === true || body.use_boss_boost_point === true) {
        console.log(`[MULTI] five-boss start: ignoring client boost flags`
            + ` viewer=${body.viewer_id} room=${body.room_number}`
            + ` boost=${body.use_boost_point}/${body.use_boss_boost_point}`)
    }
    abandonStaleFiveBossRun(body, playerId)

    const result = startFiveBossBattle({
        playerId,
        clientPlayId: body.play_id,
        room,
        requestRoomNumber: body.room_number,
        requestCategory: body.category,
        requestQuestId: body.quest_id,
        useBoostPoint: false,
        useBossBoostPoint: false,
        httpIsAutoStartMode: body.is_auto_start_mode,
        matePlayerIds: body.mate_player_ids,
        mateComIds: room.mates.map(mate => mate.com_id),
    })
    activeQuests[playerId] = result.activeQuest
    updatePlayerSync({ id: playerId, partySlot: body.party_id })
    if (!result.rewardsEnabled) {
        console.log(`[MULTI] five-boss start: host had no ticket, run ${result.runId} plays without rewards`
            + ` viewer=${body.viewer_id} room=${body.room_number} status=${result.startStatus}`)
    }

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
    const roomNumber = resolveFiveBossRoomNumber(body.room_number, playerId)
    const party = body.statistics?.party ?? body.quest_statistics?.party
    if (body.is_accomplished === true && typeof body.play_id === "string" && body.play_id.length > 0) {
        const backfill = backfillMissingFinalizeSync({ playerId, clientPlayId: body.play_id })
        if (backfill.backfilled) {
            console.warn(`[MULTI] five-boss finish: finalize signal never reached the battle channel;`
                + ` backfilled from HTTP finish player=${playerId} run=${backfill.runId} room=${backfill.roomNumber}`)
        }
    }
    const result = finishFiveBossBattle({
        playerId,
        clientPlayId: body.play_id,
        requestRoomNumber: roomNumber,
        requestCategory: body.category,
        requestQuestId: body.quest_id,
        accomplished: body.is_accomplished as boolean,
        elapsedTimeMs: body.elapsed_time_ms ?? body.battle_time ?? 0,
        highScore: body.score ?? 0,
        leaderCharacterId: party?.characters?.[0]?.id ?? null,
    })
    clearMatchingMemoryActive(playerId, body.play_id)
    terminalRoomTransition(roomNumber, result.runId, result.runStatus)
    if (result.kind === "success" && !result.rewardsEnabled) {
        console.log(`[MULTI] five-boss finish: no rewards (host started without a ticket)`
            + ` player=${playerId} run=${result.runId} receipt=${result.receiptStatus}`)
    }
    if (result.kind === "success" && result.receiptStatus === "settled" && !result.reward.proofComplete) {
        // 设计稿 2026-09-28 第 6 节(a):战斗信号证据不全(仍在 R0 就被隔离、之后单机打完
        // 才发 finish,或 finalize 丢在已关闭的战斗通道上)不再拒绝,按其自身倍率正常结算,
        // 只留一条日志说明这是宽容结算。
        console.log(`[MULTI] five-boss finish: lenient settlement (missing BothBoss level-next/`
            + `finalize proof) player=${playerId} run=${result.runId} multiplier=${result.rewardMultiplier}`)
    }

    const matePlayerResult = body.mate_player_result ?? []
    const followInfo = await buildFollowInfo(
        body.viewer_id,
        matePlayerResult,
        memoryBeforeFinish?.matePlayerIds ?? body.mate_player_ids ?? [],
    )
    const dataHeaders = generateDataHeaders({ viewer_id: body.viewer_id })
    const exp = rewardFiveBossPartyExp(
        playerId,
        party,
        body,
        result.kind === "success",
        result.kind === "success" && result.rewardsEnabled,
    )
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
            exp,
        ),
    })
}


export function handleFiveBossAbort(
    body: MultiAbortBody,
    playerId: number,
    reply: FastifyReply,
) {
    const roomNumber = resolveFiveBossRoomNumber(body.room_number, playerId)
    const result = abortFiveBossBattle({
        playerId,
        clientPlayId: body.play_id,
        requestRoomNumber: roomNumber,
        requestCategory: body.category,
        requestQuestId: body.quest_id,
    })
    clearMatchingMemoryActive(playerId, body.play_id)
    terminalRoomTransition(roomNumber, result.runId, result.runStatus)

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
