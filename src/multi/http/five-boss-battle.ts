import { getPlayerClientExpTime } from "../../lib/player-time-compat"
import type { FastifyReply } from "fastify"
import type { Player } from "../../data/types"
import type { PlayerActiveQuest } from "../../data/types"
import type { MultiRoom } from "../../lib/types/multi"
import type { MultiAbortBody, MultiFinishBody, MultiStartBody } from "../types"
import {
    deletePlayerActiveQuestIfPlayIdSync,
    getPlayerActiveQuestSync,
} from "../../data/domains/quest_active"
import {
    FiveBossGauntletRunError,
    backfillMissingFinalizeSync,
    detachFinalizedFiveBossActiveSync,
    getFiveBossRunByClientSync,
} from "../../data/domains/fiveBossGauntletRun"
import { getPlayerItemSync } from "../../data/domains/item"
import { getPlayerEquipmentSync } from "../../data/domains/equipment"
import { getPlayerSync, updatePlayerSync } from "../../data/domains/player"
import { isValidNormalPartySlotSync } from "../../data/domains/party"
import { clientSerializeEquipment } from "../../lib/equipment"
import type { RewardPlayerCharacterExpResult } from "../../lib/types/character"
import { generateDataHeaders, getServerTime, realToVirtual } from "../../utils"
import { activeQuests } from "../../routes/api/singleBattleQuest"
import { getRoomCommandGateway, assertRealtimeOwnerEpoch } from "../coordinator/default-runtime"
import { publishDurableOwnerDecision } from "../coordinator/durable-owner-event"
import type { FiveBossStartClaim } from "../coordinator/five-boss-command-handlers"
import { RoomCommandError, createRoomCommandId } from "../coordinator/command-protocol"
import { performance } from "perf_hooks"
import {
    abortFiveBossBattle,
    finishFiveBossBattle,
    FiveBossBattleRuntimeError,
    startFiveBossBattle,
    type AbortFiveBossBattleResult,
    type FinishFiveBossBattleResult,
} from "../five-boss/battle-runtime"
import { FIVE_BOSS_GAUNTLET, isFiveBossGauntletQuest } from "../five-boss/contract"
import { buildFiveBossAdditionalRewardDrops, buildFiveBossWeaponAdditionalRewardDrops } from "../five-boss/rewards"
import { abandonFiveBossSoloForMultiSync } from "../five-boss/solo-runtime"
import { getDb } from "../../data/db"
import { measureSettlementPhaseAsync } from "../../lib/settlement-performance"
import { fiveBossDiagnostics } from "../../lib/coalesced-diagnostics"
import { fiveBossConnectionDiagnostics } from "../five-boss/connection-diagnostic"
import { runPersistenceTransaction } from "../../lib/persistence-coordinator"
import { assertBattleCanStartSync, getBattleReplaySync } from "../../data/domains/battle-settlement-ledger"
import { registerAcceptedRescueBattleSync } from "../../lib/mission/rescue-battle-facts"
import { recordContentActionFactsSync } from "../../lib/mission/content-action-facts"
import type { FiveBossHostAdmissionAuthorization } from "../five-boss/host-admission"

/** Small structured evidence, without logging tokens, party data or the full request. */
export function logFiveBossRequestFailure(operation: "start" | "finish" | "abort", body: MultiStartBody | MultiFinishBody | MultiAbortBody,
    playerId: number, error: unknown, acknowledged = false): void {
    const code = (error as { code?: string })?.code
    const message = (error as Error)?.message
    const key = JSON.stringify(["request", operation, playerId, acknowledged, String(body.play_id).slice(0, 255),
        body.category, body.quest_id, code, message?.slice(0, 160)])
    fiveBossDiagnostics.report(key, () => {
        const run = getFiveBossRunByClientSync({ playerId, clientPlayId: body.play_id })
        const member = run ? getDb().prepare(`SELECT started_at, battle_entered_at, aborted_at,
            level_next_at, finalized_at
            FROM five_boss_gauntlet_members WHERE run_id = ? AND player_id = ?`).get(run.runId, playerId) : null
        const active = getPlayerActiveQuestSync(playerId)
        if (run && operation === "finish" && !acknowledged) {
            fiveBossConnectionDiagnostics.memberEvent(run.runId, playerId, "finish_rejected", code)
        }
        return `[${acknowledged ? "FIVE-BOSS-ACK" : "FIVE-BOSS-REJECT"}] ${JSON.stringify({ operation, player: playerId, play: body.play_id,
            category: body.category, quest: body.quest_id, run: run?.runId, room: run?.roomNumber,
            status: run?.status, code, message,
            proof: member, active: active ? {
                play: active.playId,
                category: active.category,
                quest: active.questId,
                multi: active.isMulti,
                room: active.roomNumber,
            } : null,
            transport: run ? fiveBossConnectionDiagnostics.snapshot(run.runId, playerId) : { available: false, reason: "run_not_found" } })}`
    })
}

/**
 * Codes that mean this client is closing out a run the server already ended
 * (settled/aborted) or a play id that is no longer bound to any run. The CN
 * client turns any HTTP 400 on finish/abort into a fatal H400 dialog and
 * drops to login, so these stale requests are acknowledged as a terminal,
 * reward-less outcome instead of an error.
 */
const STALE_MEMBER_REQUEST_CODES = new Set<string>([
    "run_not_active",
    "member_not_active",
    "client_play_not_found",
    "active_quest_mismatch",
    "battle_proof_missing",
])

export function isStaleFiveBossMemberRequestError(error: unknown): boolean {
    const code = (error as { code?: string })?.code
    return typeof code === "string" && STALE_MEMBER_REQUEST_CODES.has(code)
}


type FollowInfoBuilder = (
    viewerId: number,
    mateResults: Array<{ viewer_id?: number }>,
    fallbackMateIds?: number[],
) => Promise<unknown[]>


export function isFiveBossBattleRequestError(error: unknown): boolean {
    return error instanceof FiveBossBattleRuntimeError
        || error instanceof FiveBossGauntletRunError
        || (error as { code?: string })?.code === "BATTLE_ALREADY_SETTLED"
        || (error as { code?: string })?.code === "BATTLE_CLOCK_ABORTED"
}


export function shouldHandleFiveBossStart(body: MultiStartBody): boolean {
    return isFiveBossGauntletQuest(body.category, body.quest_id)
}


export function shouldHandleFiveBossMemberRequest(
    body: Pick<MultiFinishBody | MultiAbortBody, "category" | "quest_id" | "play_id">,
    playerId: number,
): boolean {
    if (isFiveBossGauntletQuest(body.category, body.quest_id)) return true
    if (getFiveBossRunByClientSync({ playerId, clientPlayId: body.play_id })) return true
    const memory = activeQuests[playerId]
    if (memory?.playId === body.play_id
        && isFiveBossGauntletQuest(memory.category, memory.questId)) return true
    const persistent = getPlayerActiveQuestSync(playerId)
    return persistent !== null
        && persistent.playId === body.play_id
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


async function terminalRoomTransition(
    roomNumber: string,
    runId: string,
    runStatus: "active" | "settled" | "aborted",
): Promise<void> {
    if (runStatus === "active") return
    await publishDurableOwnerDecision("fiveBoss.terminal", { roomNumber, runId, runStatus })
}


function afterResponse(reply: FastifyReply, operation: () => void | Promise<void>): void {
    let completed = false
    const run = () => {
        if (completed) return
        completed = true
        try { void Promise.resolve(operation()).catch(error => console.error("[MULTI] five-boss post-response cleanup failed", error)) }
        catch (error) {
            console.error(`[MULTI] five-boss post-response cleanup failed: ${(error as Error).message}`)
        }
    }
    reply.raw.once("finish", run)
    reply.raw.once("close", run)
}


/**
 * CN 客户端的 multi finish / abort 请求体**不带 room_number**(官方
 * BattleQuestFinishRealRemote / QuestAbortRealRemote 都没有这个字段),原生多人路径
 * 一直是靠服务端 activeQuests 记住房号。五重 runtime 的冻结契约要求 requestRoomNumber
 * 非空,真机首战(2026-09-04)就因此在结算时连吃 6 个 H400。这里按
 * 请求体 → 此玩家/对局的不可变账本 → 内存 activeQuests → 持久化活动记录补房号;
 * 全都没有才让 runtime 用原来的 invalid_argument 拒绝。
 */
function resolveFiveBossRoomNumber(bodyRoomNumber: unknown, playerId: number, playId: string,
    boundRun?: ReturnType<typeof getFiveBossRunByClientSync>): string {
    if (typeof bodyRoomNumber === "string" && bodyRoomNumber.length > 0) return bodyRoomNumber
    const run = boundRun === undefined ? getFiveBossRunByClientSync({ playerId, clientPlayId: playId }) : boundRun
    if (run) return run.roomNumber
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
 * 按整轮身份区别同房号的新旧局；活动房间仍属于旧局时不清理。
 * 此函数与新局 start 同处一个事务，开新局失败时旧局保持原状。
 */
function abandonStaleFiveBossRun(body: MultiStartBody, playerId: number, authorization: FiveBossStartClaim["oldPlayRecovery"]): void {
    const stale = getPlayerActiveQuestSync(playerId)
    if (!stale || stale.playId === body.play_id) return
    // Finalize ends gameplay, but is not a successful finish. Preserve this
    // member's exact result entitlement instead of aborting a shared run.
    if (stale.isMulti && authorization?.playId === stale.playId && !authorization.recoverable
        && detachFinalizedFiveBossActiveSync(playerId, stale.playId)) {
        clearMatchingMemoryActive(playerId, stale.playId)
        return
    }
    try {
        if (!stale.isMulti) {
            if (!isFiveBossGauntletQuest(stale.category, stale.questId)) {
                if (deletePlayerActiveQuestIfPlayIdSync(playerId, stale.playId)) {
                    if (activeQuests[playerId]?.playId === stale.playId) {
                        delete activeQuests[playerId]
                    }
                    console.log(`[MULTI] five-boss start: abandoned stale ordinary solo`
                        + ` player=${playerId} play=${stale.playId}`
                        + ` category=${stale.category} quest=${stale.questId}`)
                }
                return
            }
            if (abandonFiveBossSoloForMultiSync(playerId, stale.playId)) {
                clearMatchingMemoryActive(playerId, stale.playId)
                console.log(`[MULTI] five-boss start: abandoned previous solo player=${playerId} play=${stale.playId}`)
            }
            return
        }
        const oldRun = getFiveBossRunByClientSync({ playerId, clientPlayId: stale.playId })
        const oldRoomNumber = oldRun?.roomNumber ?? stale.roomNumber
        if (!authorization || authorization.playId !== stale.playId || authorization.recoverable
            || ("retained" in authorization && authorization.retained)) return
        if (!oldRun || !oldRoomNumber || !isFiveBossGauntletQuest(stale.category, stale.questId)) {
            if (deletePlayerActiveQuestIfPlayIdSync(playerId, stale.playId)) {
                if (activeQuests[playerId]?.playId === stale.playId) {
                    delete activeQuests[playerId]
                }
                console.log(`[MULTI] five-boss start: abandoned orphan active quest`
                    + ` player=${playerId} play=${stale.playId}`
                    + ` reason=${authorization.reason}`)
            }
            return
        }
        // Recover only a missing room field from this exact persisted player/play binding.
        if (!stale.roomNumber) {
            getDb().prepare(`UPDATE players_active_quests SET room_number = ?
                WHERE player_id = ? AND play_id = ? AND is_multi = 1 AND (room_number IS NULL OR room_number = '')`)
                .run(oldRoomNumber, playerId, stale.playId)
        }
        const aborted = abortFiveBossBattle({
            playerId,
            clientPlayId: stale.playId,
            requestRoomNumber: oldRoomNumber,
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


/** 旧 receipt 在武器掉落字段加入前已经落盘；缺失时按当年无武器处理。 */
function receiptGrantedEquipment(result: FinishFiveBossBattleResult): number[] {
    if (result.kind !== "success") return []
    const granted: unknown = result.reward.grantedEquipment
    return Array.isArray(granted) ? granted : []
}


/** 按 receipt 的命中顺序去重，回读当前持有状态，保证重放不重复发放。 */
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
            exp_pooled_time: getPlayerClientExpTime(player),
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


/** A receipt/run alone does not prove this player's active original start. */
function readCurrentDurableFiveBossStart(body: MultiStartBody, playerId: number): {
    runId: string; activeQuest: PlayerActiveQuest
} | null {
    if (getDb().inTransaction) throw new Error("FIVE_BOSS_DURABILITY_UNRESOLVED")
    const run = getFiveBossRunByClientSync({ playerId, clientPlayId: body.play_id })
    const activeQuest = getPlayerActiveQuestSync(playerId)
    if (!run || run.status !== "active" || run.roomNumber !== body.room_number
        || !activeQuest?.isMulti || activeQuest.playId !== body.play_id || activeQuest.roomNumber !== body.room_number
        || Number(activeQuest.category) !== Number(body.category) || Number(activeQuest.questId) !== Number(body.quest_id)) return null
    const member = getDb().prepare(`SELECT started_at, aborted_at FROM five_boss_gauntlet_members
        WHERE run_id = ? AND player_id = ? AND client_play_id = ?`).get(run.runId, playerId, body.play_id) as {
        started_at: string | null; aborted_at: string | null
    } | undefined
    return member?.started_at && !member.aborted_at ? { runId: run.runId, activeQuest } : null
}

export async function handleFiveBossStart(
    body: MultiStartBody,
    playerId: number,
    reply: FastifyReply,
) {
    const staleQuest = getPlayerActiveQuestSync(playerId)
    const staleRun = staleQuest ? getFiveBossRunByClientSync({ playerId, clientPlayId: staleQuest.playId }) : null
    const durableStart = readCurrentDurableFiveBossStart(body, playerId)
    const prepareId = createRoomCommandId()
    let prepared: FiveBossStartClaim | { status: "unavailable" }
    try { prepared = await getRoomCommandGateway().execute("fiveBoss.start.prepare", JSON.parse(JSON.stringify({
        body, playerId, ...(staleQuest ? { staleQuest } : {}),
        ...(staleRun ? { staleFrozenRunId: staleRun.runId } : {}),
        ...(durableStart ? { durableRunId: durableStart.runId } : {}),
    })), { commandId: prepareId }) as FiveBossStartClaim | { status: "unavailable" } }
    catch (error) {
        // No SQL has started. A known per-attempt token can safely resolve a
        // late Prepare without releasing any concurrent request's claim.
        try { await getRoomCommandGateway().execute("fiveBoss.start.cancel", {
            token: prepareId, playerId, playId: body.play_id, roomNumber: body.room_number,
        }) } catch (cancelError) { console.error("[FIVE-BOSS] prepare cancellation unresolved", cancelError) }
        throw error
    }
    if (prepared.status !== "ready") {
        console.warn(`[MULTI] five-boss start acknowledged as unavailable:`
            + ` viewer=${body.viewer_id} room=${body.room_number} reason=room_missing_after_gate`)
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({
                viewer_id: body.viewer_id,
                result_code: 4050,
            }),
            data: {},
        })
    }
    const claim = prepared
    const room = claim.room
    const claimDeadline = performance.now() + claim.remainingMs

    // 五重决战不消耗、不结算任何强化点:客户端在"降临讨伐"页签建房时会按官方 boss 战
    // 习惯默认勾上领主强化点(use_boss_boost_point=true),真机实测直接被 runtime 的
    // boost_not_allowed 拒成 H400 进不了战斗(2026-09-04)。这里把两个开关一律当 false
    // 交给 runtime(冻结契约不变:runtime 仍只接受 false),只留一行日志说明被忽略。
    if (body.use_boost_point === true || body.use_boss_boost_point === true) {
        console.log(`[MULTI] five-boss start: ignoring client boost flags`
            + ` viewer=${body.viewer_id} room=${body.room_number}`
            + ` boost=${body.use_boost_point}/${body.use_boss_boost_point}`)
    }
    let memoryBeforeCleanup: typeof activeQuests[number] | undefined = undefined
    let memoryAfterCleanup: typeof activeQuests[number] | undefined = undefined
    let cleanupChanged = false
    let hostActiveBeforeAdmission: PlayerActiveQuest | null = null
    const clearCommittedHostMemory = () => {
        if (hostActiveBeforeAdmission && getPlayerActiveQuestSync(room.host_player_id)?.playId !== hostActiveBeforeAdmission.playId) {
            clearMatchingMemoryActive(room.host_player_id, hostActiveBeforeAdmission.playId)
        }
    }
    let hostAdmissionAuthorization: FiveBossHostAdmissionAuthorization | null = null
    let result: ReturnType<typeof startFiveBossBattle>
    try {
        // The owner supplies a live recovery decision; the payment transaction
        // rechecks the exact durable host play before the first ticket debit.
        const hostActive = getPlayerActiveQuestSync(room.host_player_id)
        const hostRun = hostActive ? getFiveBossRunByClientSync({ playerId: room.host_player_id, clientPlayId: hostActive.playId }) : null
        hostAdmissionAuthorization = hostActive?.isMulti
            ? await getRoomCommandGateway().execute("fiveBoss.recovery", {
                staleQuest: hostActive, playerId: room.host_player_id,
                ...(hostRun ? { staleFrozenRunId: hostRun.runId } : {}),
            }) as FiveBossHostAdmissionAuthorization : null
        const oldResults = [
            { run: staleRun, memberId: playerId, authorization: claim.oldPlayRecovery },
            { run: hostRun, memberId: room.host_player_id, authorization: hostAdmissionAuthorization },
        ]
        const waited = new Set<string>()
        for (const old of oldResults) {
            if (!old.run || old.run.roomNumber === room.room_number || old.authorization?.recoverable !== false) continue
            const key = `${old.run.runId}:${old.memberId}`
            if (waited.has(key)) continue
            waited.add(key)
            const barrier = await getRoomCommandGateway().execute("fiveBoss.proof.barrier", {
                runId: old.run.runId, playerId: old.memberId, roomNumber: old.run.roomNumber,
            }) as { ok: boolean }
            if (!barrier.ok) throw new RoomCommandError("PROOF_PERSISTENCE_UNAVAILABLE", "Previous result proof is not durably acknowledged", body.play_id, true)
        }
    } catch (error) {
        // This attempt has not entered SQL. An unknown read-only observation
        // cannot represent a paid start, so its own pin can be cancelled.
        try { await getRoomCommandGateway().execute("fiveBoss.start.cancel", { token: claim.token, playerId, playId: body.play_id }) }
        catch (cancelError) { console.error("[FIVE-BOSS] admission cancellation unresolved", cancelError) }
        throw error
    }
    try {
        result = await runPersistenceTransaction({
            domain: "multi-settlement", playerId, operation: "five_boss_start",
        }, () => {
            assertBattleCanStartSync(playerId, body.play_id)
            // The copied room is input, not a live guard. The owner pins the
            // exact generation until this token is explicitly resolved.
            try {
                assertRealtimeOwnerEpoch(claim.ownerEpoch, claim.token)
                if (performance.now() >= claimDeadline) throw new Error("Claim deadline elapsed")
            } catch { throw new FiveBossBattleRuntimeError("run_identity_mismatch", "Realtime start claim is no longer valid") }
            memoryBeforeCleanup = activeQuests[playerId]
            abandonStaleFiveBossRun(body, playerId, claim.oldPlayRecovery)
            memoryAfterCleanup = activeQuests[playerId]
            cleanupChanged = memoryBeforeCleanup !== memoryAfterCleanup
            hostActiveBeforeAdmission = getPlayerActiveQuestSync(room.host_player_id)
            const previousHostStaminaUsed = getPlayerSync(room.host_player_id)?.totalStaminaUsed ?? 0
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
                hostAdmissionAuthorization,
            })
            const staminaDelta = (getPlayerSync(room.host_player_id)?.totalStaminaUsed ?? previousHostStaminaUsed) - previousHostStaminaUsed
            if (staminaDelta > 0) recordContentActionFactsSync(room.host_player_id, {
                kind: "stamina_spend", amount: staminaDelta, dedupeKey: `five_boss_start:${result.runId}`,
            })
            registerAcceptedRescueBattleSync({ playerId, viewerId: body.viewer_id, playId: body.play_id,
                category: FIVE_BOSS_GAUNTLET.category, questId: FIVE_BOSS_GAUNTLET.visibleQuestId,
                roomNumber: room.room_number, roomInstanceId: claim.roomInstanceId, battleSessionId: claim.battleSessionId,
                isHost: playerId === room.host_player_id, isRescueGuest: claim.isRescueGuest === true,
                isRescueFragmentEligible: claim.isRescueFragmentEligible === true })
            // Keep the selected party update inside the same persistence owner as
            // the run ledger and active quest writes.
            if (isValidNormalPartySlotSync(playerId, body.party_id)) {
                updatePlayerSync({ id: playerId, partySlot: body.party_id })
            }
            return result
        })
    } catch (error) {
        let durableAfterFailure: ReturnType<typeof readCurrentDurableFiveBossStart> = null
        let readFailed = false
        try { durableAfterFailure = readCurrentDurableFiveBossStart(body, playerId) }
        catch { readFailed = true }
        if (durableAfterFailure?.runId === claim.frozenRunId) {
            // A committed original start can survive a lost result or a later
            // observer failure. Reconcile it without executing payment again.
            const persisted = durableAfterFailure.activeQuest
            activeQuests[playerId] = { ...persisted, roomNumber: body.room_number,
                entryItemId: persisted.entryItemId ?? undefined, eventId: persisted.eventId ?? undefined,
                partySlot: persisted.partySlot ?? undefined, startedAtMs: persisted.startedAtMs ?? undefined }
            clearCommittedHostMemory()
            try { await publishDurableOwnerDecision("fiveBoss.start.commit", {
                token: claim.token, playerId, playId: body.play_id, runId: durableAfterFailure.runId,
            }) } catch (commitError) { console.error("[FIVE-BOSS] durable start reconciliation unresolved", commitError) }
        } else if (readFailed || (error as { outcomeUnknown?: boolean })?.outcomeUnknown === true) {
            // An ambiguous durable result is not permission to unlock lifecycle
            // or retry payment. Keep the original token for explicit reconciliation.
            console.error("[FIVE-BOSS] persistence outcome unknown; start remains pinned", error)
        } else {
            try { await getRoomCommandGateway().execute("fiveBoss.start.cancel", { token: claim.token, playerId, playId: body.play_id }) }
            catch (cancelError) { console.error("[FIVE-BOSS] start cancellation unresolved; owner remains pinned", cancelError) }
            // Restore only the stale cleanup performed by this transaction.
            // A concurrent successful same-play request may already own memory.
            if (cleanupChanged && activeQuests[playerId] === memoryAfterCleanup) {
                if (memoryBeforeCleanup) activeQuests[playerId] = memoryBeforeCleanup
                else delete activeQuests[playerId]
            }
        }
        throw error
    }
    activeQuests[playerId] = result.activeQuest
    clearCommittedHostMemory()
    try {
        const committed = await publishDurableOwnerDecision("fiveBoss.start.commit", {
            token: claim.token, playerId, playId: body.play_id, runId: result.runId,
        }) as { applied: boolean } | undefined
        if (committed?.applied === false) console.error("[FIVE-BOSS] paid start awaits owner reconciliation", { playerId, playId: body.play_id })
    } catch (error) {
        // The durable original run/play remains authoritative for payment.
        // Never cancel or rerun a paid decision because the owner ACK was lost.
        console.error("[FIVE-BOSS] paid start commit outcome unknown", error)
    }
    fiveBossConnectionDiagnostics.memberEvent(result.runId, playerId, "http_start", result.startStatus)
    const player = requirePlayer(playerId)

    reply.header("content-type", "application/x-msgpack")
    return reply.status(200).send({
        data_headers: generateDataHeaders({ viewer_id: body.viewer_id }),
        data: {
            is_multi: "multi",
            play_id: body.play_id,
            user_info: { stamina: player.stamina, stamina_heal_time: realToVirtual(player.staminaHealTime) },
            item_list: { [FIVE_BOSS_GAUNTLET.ticketItemId]: getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET.ticketItemId) ?? 0 },
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
    const boundRun = getFiveBossRunByClientSync({ playerId, clientPlayId: body.play_id })
    const alreadyPaid = !!boundRun && !!getDb().prepare("SELECT 1 FROM five_boss_gauntlet_receipts WHERE run_id = ? AND player_id = ?")
        .get(boundRun.runId, playerId)
    if (boundRun) fiveBossConnectionDiagnostics.memberEvent(boundRun.runId, playerId, "http_finish",
        body.is_accomplished === true ? "success_requested" : "failure_requested")
    const roomNumber = resolveFiveBossRoomNumber(body.room_number, playerId, body.play_id, boundRun)
    const party = body.statistics?.party ?? body.quest_statistics?.party
    let result: FinishFiveBossBattleResult
    try {
        result = await measureSettlementPhaseAsync("multi", "five_boss_settlement", async () => {
            // Failed finishes become aborts and do not need successful battle
            // proof.  Waiting here would make an abort depend on an unrelated
            // proof write that may be queued behind a closing socket.
            if (boundRun?.status === "active" && !alreadyPaid && body.is_accomplished === true) {
                const barrier = await getRoomCommandGateway().execute("fiveBoss.proof.barrier", {
                    runId: boundRun.runId, playerId, roomNumber,
                }) as { ok: boolean }
                if (!barrier.ok) throw new RoomCommandError("PROOF_PERSISTENCE_UNAVAILABLE", "Accepted proof is not durably acknowledged", body.play_id, true)
            }
            return runPersistenceTransaction({
                domain: "multi-settlement", playerId, operation: "five_boss_finish",
            }, () => {
                // A generic settled identity may never be paid through the
                // specialized runtime, even if its full payload has expired.
                // Its own dedicated receipts retain their original replay path.
                if (getBattleReplaySync(playerId, "multi", body.play_id).kind !== "missing") {
                    throw new FiveBossBattleRuntimeError("run_identity_mismatch", "Battle identity already settled.")
                }
                if (body.is_accomplished === true && isFiveBossGauntletQuest(body.category, body.quest_id)
                    && boundRun?.roomNumber === roomNumber) {
                    const backfill = backfillMissingFinalizeSync({ playerId, clientPlayId: body.play_id })
                    if (backfill.backfilled) {
                        fiveBossConnectionDiagnostics.memberEvent(boundRun.runId, playerId, "finalize_recorded", "http_backfill")
                        console.warn(`[MULTI] five-boss finish: finalize signal never reached the battle channel;`
                            + ` backfilled from HTTP finish player=${playerId} run=${backfill.runId} room=${backfill.roomNumber}`)
                    }
                }
                return finishFiveBossBattle({
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
            })
        })
    } catch (error) {
        if (!isFiveBossBattleRequestError(error) || !isStaleFiveBossMemberRequestError(error)) throw error
        // The run settled or aborted while this client was still finishing its
        // local battle, or the authenticated battle proof never completed.
        // Answer with a reward-less failed finish instead of a 400: the CN
        // client renders that error as a fatal H400 and logs out.
        if ((error as { code?: string }).code === "battle_proof_missing" && boundRun) {
            try {
                const aborted = await runPersistenceTransaction({
                    domain: "multi-settlement",
                    playerId,
                    operation: "five_boss_missing_proof_abort",
                }, () => abortFiveBossBattle({
                    playerId,
                    clientPlayId: body.play_id,
                    requestRoomNumber: roomNumber,
                    requestCategory: FIVE_BOSS_GAUNTLET.category,
                    requestQuestId: FIVE_BOSS_GAUNTLET.visibleQuestId,
                }))
                afterResponse(reply, () => terminalRoomTransition(
                    roomNumber,
                    aborted.runId,
                    aborted.runStatus,
                ))
            } catch (abortError) {
                if (!isFiveBossBattleRequestError(abortError)
                    || !isStaleFiveBossMemberRequestError(abortError)) {
                    console.error(`[MULTI] five-boss missing-proof cleanup failed:`
                        + ` player=${playerId} play=${body.play_id}`, abortError)
                }
            }
        }
        logFiveBossRequestFailure("finish", body, playerId, error, true)
        clearMatchingMemoryActive(playerId, body.play_id)
        if (boundRun && boundRun.status !== "active") {
            afterResponse(reply, () => terminalRoomTransition(roomNumber, boundRun.runId, boundRun.status))
        }
        const matePlayerResult = body.mate_player_result ?? []
        const followInfo = await measureSettlementPhaseAsync("multi", "five_boss_follow", () => buildFollowInfo(
            body.viewer_id,
            matePlayerResult,
            memoryBeforeFinish?.matePlayerIds ?? body.mate_player_ids ?? [],
        ))
        const dataHeaders = generateDataHeaders({ viewer_id: body.viewer_id })
        const player = requirePlayer(playerId)
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: dataHeaders,
            data: buildFinishData(player, body, {
                kind: "failed",
                abortStatus: "already_aborted",
                runId: boundRun?.runId ?? "",
                runStatus: boundRun?.status ?? "aborted",
            }, dataHeaders, matePlayerResult, followInfo, null),
        })
    }
    clearMatchingMemoryActive(playerId, body.play_id)
    if (result.kind === "success") {
        try { await publishDurableOwnerDecision("fiveBoss.terminal", {
            roomNumber, runId: result.runId, runStatus: "active", playerId, viewerId: body.viewer_id, playId: body.play_id,
        }) } catch (error) { console.error("[FIVE-BOSS] durable settlement room event unresolved", error) }
    }
    if (result.runStatus !== "active") {
        afterResponse(reply, () => terminalRoomTransition(roomNumber, result.runId, result.runStatus))
    }

    const matePlayerResult = body.mate_player_result ?? []
    const followInfo = await measureSettlementPhaseAsync("multi", "five_boss_follow", () => buildFollowInfo(
        body.viewer_id,
        matePlayerResult,
        memoryBeforeFinish?.matePlayerIds ?? body.mate_player_ids ?? [],
    ))
    const dataHeaders = generateDataHeaders({ viewer_id: body.viewer_id })
    const exp = result.kind === "success" ? result.reward.characterExp : null
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


export async function handleFiveBossAbort(
    body: MultiAbortBody,
    playerId: number,
    reply: FastifyReply,
) {
    const boundRun = getFiveBossRunByClientSync({ playerId, clientPlayId: body.play_id })
    const roomNumber = resolveFiveBossRoomNumber(body.room_number, playerId, body.play_id, boundRun)
    // QuestAbortRealRemote builds a smaller payload than finish on some CN
    // clients. Recover only omitted route fields from this exact player/play
    // ledger binding; explicitly supplied wrong values must still be rejected.
    const requestCategory = body.category == null && boundRun
        ? FIVE_BOSS_GAUNTLET.category
        : body.category
    const requestQuestId = body.quest_id == null && boundRun
        ? FIVE_BOSS_GAUNTLET.visibleQuestId
        : body.quest_id
    let result: AbortFiveBossBattleResult
    try {
        result = await runPersistenceTransaction({
            domain: "multi-settlement", playerId, operation: "five_boss_abort",
        }, () => abortFiveBossBattle({
            playerId,
            clientPlayId: body.play_id,
            requestRoomNumber: roomNumber,
            requestCategory,
            requestQuestId,
        }))
    } catch (error) {
        if (!isFiveBossBattleRequestError(error) || !isStaleFiveBossMemberRequestError(error)) throw error
        // Retiring a run the server no longer tracks (already settled/aborted,
        // or an unrecognized play id) must not 400: the CN client would show a
        // fatal H400. It is already gone, so answer with the empty terminal
        // payload the client expects from a successful abort.
        logFiveBossRequestFailure("abort", body, playerId, error, true)
        clearMatchingMemoryActive(playerId, body.play_id)
        const headers = generateDataHeaders({ viewer_id: body.viewer_id })
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: headers,
            data: {
                user_info: {},
                category_id: requestCategory,
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
    clearMatchingMemoryActive(playerId, body.play_id)
    if (result.runStatus !== "active") {
        afterResponse(reply, () => terminalRoomTransition(roomNumber, result.runId, result.runStatus))
    }

    const headers = generateDataHeaders({ viewer_id: body.viewer_id })
    reply.header("content-type", "application/x-msgpack")
    return reply.status(200).send({
        data_headers: headers,
        data: {
            user_info: {},
            category_id: requestCategory,
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
