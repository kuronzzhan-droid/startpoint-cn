import type { MultiRoom } from "../../lib/types/multi"
import type { PlayerQuestProgress } from "../../data/types"
import type { ActiveQuest } from "../../routes/api/singleBattleQuest"
import { givePlayerCharactersExpSync } from "../../lib/character"
import { getQuestFromCategorySync } from "../../lib/assets"
import { givePlayerEquipmentSync as givePlayerEquipmentSyncDefault } from "../../lib/equipment"
import type { RewardPlayerCharacterExpResult } from "../../lib/types/character"
import { getDb } from "../../data/db"
import { isRegisteredRescueBattleSync } from "../../lib/mission/rescue-battle-facts"
import { recordPassCompletedRescueBattleFact } from "../../lib/mission/pass-battle-facts"
import { givePlayerItemSync as givePlayerItemSyncDefault } from "../../data/domains/item"
import {
    getPlayerSingleQuestProgressSync,
    insertPlayerQuestProgressSync,
    updatePlayerQuestProgressSync,
} from "../../data/domains/quest"
import {
    deletePlayerActiveQuestIfPlayIdSync,
    getPlayerActiveQuestSync,
    insertPlayerActiveQuestSync,
} from "../../data/domains/quest_active"
import {
    abortMemberSync,
    settleMemberSync,
    startMemberSync,
    type BoundFiveBossGauntletMember,
    type FiveBossGauntletRun,
} from "../../data/domains/fiveBossGauntletRun"
import type { FiveBossHostAdmissionAuthorization } from "./host-admission"
import { FIVE_BOSS_GAUNTLET, isFiveBossGauntletQuest } from "./contract"
import {
    buildFiveBossCursedWeaponDropPlan,
    buildFiveBossGauntletRewardPlan,
    getFiveBossCursedWeaponPool,
    type FiveBossGauntletRewardItem,
} from "./rewards"


export type FiveBossBattleRuntimeErrorCode =
    | "invalid_argument"
    | "request_identity_mismatch"
    | "room_not_in_battle"
    | "missing_frozen_runtime"
    | "invalid_frozen_roster"
    | "participant_not_frozen"
    | "missing_frozen_autoplay"
    | "boost_not_allowed"
    | "run_identity_mismatch"
    | "active_quest_mismatch"

export class FiveBossBattleRuntimeError extends Error {
    constructor(
        public readonly code: FiveBossBattleRuntimeErrorCode,
        message: string,
    ) {
        super(message)
        this.name = "FiveBossBattleRuntimeError"
    }
}

export interface StartFiveBossBattleInput {
    playerId: number
    clientPlayId: string
    room: MultiRoom
    requestRoomNumber: string
    requestCategory: number
    requestQuestId: number
    useBoostPoint: boolean
    useBossBoostPoint: boolean
    /** Deliberately ignored. Auto rewards are pinned by the frozen TCP-lobby snapshot. */
    httpIsAutoStartMode?: unknown
    matePlayerIds?: readonly number[]
    mateComIds?: readonly number[]
    hostAdmissionAuthorization?: FiveBossHostAdmissionAuthorization | null
}

export interface StartFiveBossBattleResult {
    startStatus: "started" | "already_started" | "resumed"
    runId: string
    runStatus: "active" | "settled" | "aborted"
    activeQuest: ActiveQuest
}

interface FiveBossRequestIdentity {
    playerId: number
    clientPlayId: string
    requestRoomNumber: string
    requestCategory: number
    requestQuestId: number
}

export interface FinishFiveBossBattleInput extends FiveBossRequestIdentity {
    accomplished: boolean
    elapsedTimeMs?: number
    highScore?: number
    leaderCharacterId?: number | null
    randomFloat?: () => number
}

export interface AbortFiveBossBattleInput extends FiveBossRequestIdentity {}

export interface FiveBossGrantedRewardItem extends FiveBossGauntletRewardItem {
    total: number
}

export interface FiveBossBattleRewardReceipt {
    characterExp: RewardPlayerCharacterExpResult | null
    firstClear: boolean
    grantedItems: FiveBossGrantedRewardItem[]
    itemTotals: Record<string, number>
    /** 诅咒武器命中顺序；持久化 receipt 重放时不重新掷骰或重复发放。 */
    grantedEquipment: number[]
}

export interface SuccessfulFiveBossBattleFinish {
    kind: "success"
    receiptStatus: "settled" | "already_settled"
    runId: string
    runStatus: "active" | "settled" | "aborted"
    rewardMultiplier: 1 | 2
    reward: FiveBossBattleRewardReceipt
}

export interface FailedFiveBossBattleFinish {
    kind: "failed"
    abortStatus: "member_aborted" | "run_aborted" | "already_aborted" | "already_settled"
    runId: string
    runStatus: "active" | "settled" | "aborted"
}

export type FinishFiveBossBattleResult =
    | SuccessfulFiveBossBattleFinish
    | FailedFiveBossBattleFinish

export interface AbortFiveBossBattleResult {
    abortStatus: "member_aborted" | "run_aborted" | "already_aborted" | "already_settled"
    runId: string
    runStatus: "active" | "settled" | "aborted"
}

export interface FiveBossBattleRuntimeDependencyOverrides {
    givePlayerItemSync?: (playerId: number, itemId: number, amount: number) => number
    givePlayerEquipmentSync?: (playerId: number, equipmentId: number, amount: number) => Object
    cursedWeaponPool?: readonly number[]
}

export interface FiveBossBattleRuntime {
    start(input: StartFiveBossBattleInput): StartFiveBossBattleResult
    finish(input: FinishFiveBossBattleInput): FinishFiveBossBattleResult
    abort(input: AbortFiveBossBattleInput): AbortFiveBossBattleResult
}


function runtimeFail(code: FiveBossBattleRuntimeErrorCode, message: string): never {
    throw new FiveBossBattleRuntimeError(code, message)
}


function positiveInteger(name: string, value: number): number {
    if (!Number.isSafeInteger(value) || value < 1) {
        runtimeFail("invalid_argument", `${name} must be a positive safe integer`)
    }
    return value
}


function normalizedText(name: string, value: string, maxLength = 255): string {
    if (
        typeof value !== "string"
        || value.length < 1
        || value.length > maxLength
        || value.trim() !== value
        || value.includes("\0")
    ) {
        runtimeFail("invalid_argument", `${name} must be normalized non-empty text`)
    }
    return value
}


function optionalNonNegativeInteger(name: string, value: number | undefined): number {
    if (value === undefined) return 0
    if (!Number.isSafeInteger(value) || value < 0) {
        runtimeFail("invalid_argument", `${name} must be a non-negative safe integer`)
    }
    return value
}


function optionalPositiveIntegerOrNull(
    name: string,
    value: number | null | undefined,
): number | null {
    if (value === undefined || value === null) return null
    return positiveInteger(name, value)
}


function assertSpecialRequest(identity: FiveBossRequestIdentity): void {
    positiveInteger("playerId", identity.playerId)
    normalizedText("clientPlayId", identity.clientPlayId)
    normalizedText("requestRoomNumber", identity.requestRoomNumber)
    if (!isFiveBossGauntletQuest(identity.requestCategory, identity.requestQuestId)) {
        runtimeFail("request_identity_mismatch", "request is not the exact five-boss route")
    }
}


function assertRunIdentity(run: FiveBossGauntletRun, identity: FiveBossRequestIdentity): void {
    if (
        run.routeId !== FIVE_BOSS_GAUNTLET.routeId
        || run.roomNumber !== identity.requestRoomNumber
        || run.ticketItemId !== FIVE_BOSS_GAUNTLET.ticketItemId
    ) {
        runtimeFail("run_identity_mismatch", "ledger run does not match the five-boss request")
    }
}


function assertPersistentActiveQuest(
    run: FiveBossGauntletRun,
    member: BoundFiveBossGauntletMember,
    identity: FiveBossRequestIdentity,
): void {
    assertRunIdentity(run, identity)
    const active = getPlayerActiveQuestSync(identity.playerId)
    if (member.resultPendingAt && member.playerId === identity.playerId && member.clientPlayId === identity.clientPlayId
        && member.battleEnteredAt !== null && member.finalizedAt !== null && member.abortedAt === null
        && run.status === "active") return
    if (
        active === null
        || active.playerId !== identity.playerId
        || active.playId !== identity.clientPlayId
        || active.questId !== FIVE_BOSS_GAUNTLET.visibleQuestId
        || active.category !== FIVE_BOSS_GAUNTLET.category
        || active.roomNumber !== run.roomNumber
        || active.isMulti !== true
        || active.useBoostPoint !== false
        || active.useBossBoostPoint !== false
        || active.isAutoStartMode !== member.isAutoMode
    ) {
        runtimeFail("active_quest_mismatch", "persistent active quest does not match the ledger member")
    }
}


function updateSuccessfulQuestProgress(
    playerId: number,
    input: FinishFiveBossBattleInput,
    previous: PlayerQuestProgress | null,
): void {
    const elapsedTimeMs = optionalNonNegativeInteger("elapsedTimeMs", input.elapsedTimeMs)
    const highScore = optionalNonNegativeInteger("highScore", input.highScore)
    const leaderCharacterId = optionalPositiveIntegerOrNull("leaderCharacterId", input.leaderCharacterId)
    const bestElapsedTimeMs = previous?.bestElapsedTimeMs == null
        ? elapsedTimeMs
        : Math.min(previous.bestElapsedTimeMs, elapsedTimeMs)
    const bestHighScore = previous?.highScore == null
        ? highScore
        : Math.max(previous.highScore, highScore)
    const bestClearRank = Math.max(previous?.clearRank ?? 0, 5)

    if (previous === null) {
        insertPlayerQuestProgressSync(playerId, FIVE_BOSS_GAUNTLET.category, {
            questId: FIVE_BOSS_GAUNTLET.visibleQuestId,
            finished: true,
            bestElapsedTimeMs,
            highScore: bestHighScore,
            clearRank: bestClearRank,
            leaderCharacterId: leaderCharacterId ?? undefined,
        })
    } else {
        updatePlayerQuestProgressSync(playerId, FIVE_BOSS_GAUNTLET.category, {
            questId: FIVE_BOSS_GAUNTLET.visibleQuestId,
            finished: true,
            bestElapsedTimeMs,
            highScore: bestHighScore,
            clearRank: bestClearRank,
            leaderCharacterId: leaderCharacterId ?? undefined,
        })
    }

    const increment = getDb().prepare(`
        UPDATE players_quest_progress
        SET multi_clear_count = multi_clear_count + 1
        WHERE player_id = ? AND section = ? AND quest_id = ?
    `).run(
        playerId,
        FIVE_BOSS_GAUNTLET.category,
        FIVE_BOSS_GAUNTLET.visibleQuestId,
    )
    if (increment.changes !== 1) {
        runtimeFail("active_quest_mismatch", "quest progress row was not persisted")
    }
}


function validateFrozenStart(input: StartFiveBossBattleInput): {
    runId: string
    rosterPlayerIds: number[]
    isAutoMode: boolean
} {
    assertSpecialRequest(input)
    if (
        input.room.room_number !== input.requestRoomNumber
        || !isFiveBossGauntletQuest(input.room.category, input.room.quest_id)
    ) {
        runtimeFail("request_identity_mismatch", "request and live room identity differ")
    }
    if (input.room.raising_state !== 4) {
        runtimeFail("room_not_in_battle", "five-boss room must be in raising_state 4")
    }
    if (input.useBoostPoint !== false || input.useBossBoostPoint !== false) {
        runtimeFail("boost_not_allowed", "five-boss runs do not accept boost points")
    }

    const frozen = input.room.five_boss_runtime
    if (!frozen) runtimeFail("missing_frozen_runtime", "five-boss room has no frozen runtime")
    const runId = normalizedText("runId", frozen.runId)
    const hostPlayerId = positiveInteger("hostPlayerId", input.room.host_player_id)
    if (
        !Array.isArray(frozen.expectedRealPlayerIds)
        || frozen.expectedRealPlayerIds.length < 1
        || frozen.expectedRealPlayerIds.length > FIVE_BOSS_GAUNTLET.roomMemberLimit
    ) {
        runtimeFail("invalid_frozen_roster", "frozen roster must contain one to three real players")
    }
    const rosterPlayerIds = frozen.expectedRealPlayerIds.map((playerId, index) => (
        positiveInteger(`expectedRealPlayerIds[${index}]`, playerId)
    ))
    if (new Set(rosterPlayerIds).size !== rosterPlayerIds.length || !rosterPlayerIds.includes(hostPlayerId)) {
        runtimeFail("invalid_frozen_roster", "frozen roster must be unique and contain the host")
    }
    if (!rosterPlayerIds.includes(input.playerId)) {
        runtimeFail("participant_not_frozen", "caller is not in the frozen real-player roster")
    }
    for (const playerId of rosterPlayerIds) {
        if (typeof frozen.autoplayModeByPlayerId[String(playerId)] !== "boolean") {
            runtimeFail("missing_frozen_autoplay", `missing frozen Auto mode for player ${playerId}`)
        }
    }
    return {
        runId,
        rosterPlayerIds,
        isAutoMode: frozen.autoplayModeByPlayerId[String(input.playerId)],
    }
}


function buildActiveQuest(
    input: StartFiveBossBattleInput,
    isAutoMode: boolean,
): ActiveQuest {
    return {
        questId: FIVE_BOSS_GAUNTLET.visibleQuestId,
        category: FIVE_BOSS_GAUNTLET.category,
        useBoostPoint: false,
        useBossBoostPoint: false,
        isAutoStartMode: isAutoMode,
        isMulti: true,
        isMultiHost: input.playerId === input.room.host_player_id,
        startedAtMs: Date.now(),
        roomNumber: input.requestRoomNumber,
        matePlayerIds: [...(input.matePlayerIds ?? [])],
        mateComIds: [...(input.mateComIds ?? [])],
        playId: input.clientPlayId,
        continueCount: 0,
    }
}


function samePersistentActive(left: ReturnType<typeof getPlayerActiveQuestSync>, right: ActiveQuest): boolean {
    return left !== null
        && left.playId === right.playId
        && left.questId === right.questId
        && left.category === right.category
        && left.useBossBoostPoint === right.useBossBoostPoint
        && left.useBoostPoint === right.useBoostPoint
        && left.isAutoStartMode === right.isAutoStartMode
        && left.isMulti === right.isMulti
        && left.roomNumber === right.roomNumber
        && left.continueCount === right.continueCount
}


export function createFiveBossBattleRuntime(
    overrides: FiveBossBattleRuntimeDependencyOverrides = {},
): FiveBossBattleRuntime {
    const givePlayerItemSync = overrides.givePlayerItemSync ?? givePlayerItemSyncDefault
    const givePlayerEquipmentSync = overrides.givePlayerEquipmentSync ?? givePlayerEquipmentSyncDefault
    const cursedWeaponPool = overrides.cursedWeaponPool

    function start(input: StartFiveBossBattleInput): StartFiveBossBattleResult {
        const frozen = validateFrozenStart(input)
        const result = startMemberSync({
            runId: frozen.runId,
            hostPlayerId: input.room.host_player_id,
            routeId: FIVE_BOSS_GAUNTLET.routeId,
            roomNumber: input.requestRoomNumber,
            ticketItemId: FIVE_BOSS_GAUNTLET.ticketItemId,
            hostStaminaCost: FIVE_BOSS_GAUNTLET.staminaCost,
            rosterPlayerIds: frozen.rosterPlayerIds,
            playerId: input.playerId,
            clientPlayId: input.clientPlayId,
            isAutoMode: frozen.isAutoMode,
            hostAdmissionAuthorization: input.hostAdmissionAuthorization,
        }, context => {
            const activeQuest = buildActiveQuest(input, context.member.isAutoMode)
            activeQuest.startedAtMs = Date.parse(context.member.startedAt)
            const existing = getPlayerActiveQuestSync(input.playerId)
            if (context.isReplay && existing?.playId === input.clientPlayId) {
                activeQuest.continueCount = existing.continueCount
            }
            if (existing !== null && !samePersistentActive(existing, activeQuest)) {
                runtimeFail("active_quest_mismatch", "player already has a different persistent active quest")
            }
            insertPlayerActiveQuestSync(input.playerId, {
                playerId: input.playerId,
                playId: activeQuest.playId,
                questId: activeQuest.questId,
                category: activeQuest.category,
                useBossBoostPoint: activeQuest.useBossBoostPoint,
                useBoostPoint: activeQuest.useBoostPoint,
                isAutoStartMode: activeQuest.isAutoStartMode,
                isMulti: activeQuest.isMulti,
                isMultiHost: activeQuest.isMultiHost === true,
                startedAtMs: activeQuest.startedAtMs ?? null,
                roomNumber: activeQuest.roomNumber ?? null,
                entryItemId: activeQuest.entryItemId ?? null,
                eventId: activeQuest.eventId ?? null,
                continueCount: activeQuest.continueCount,
            })
            if (!context.isReplay) {
                const ids = input.room.five_boss_runtime?.partyCharacterIdsByPlayerId[String(input.playerId)] ?? []
                getDb().prepare(`UPDATE five_boss_gauntlet_members
                    SET party_character_ids_json = ? WHERE run_id = ? AND player_id = ?`)
                    .run(JSON.stringify(ids), context.run.runId, input.playerId)
            }
            return activeQuest
        })
        assertRunIdentity(result.run, input)
        return {
            startStatus: result.status,
            runId: result.run.runId,
            runStatus: result.run.status,
            activeQuest: result.persisted,
        }
    }

    function abort(input: AbortFiveBossBattleInput): AbortFiveBossBattleResult {
        assertSpecialRequest(input)
        const result = abortMemberSync({
            playerId: input.playerId,
            clientPlayId: input.clientPlayId,
        }, context => {
            assertPersistentActiveQuest(context.run, context.member, input)
            deletePlayerActiveQuestIfPlayIdSync(input.playerId, input.clientPlayId)
            return true
        })
        assertRunIdentity(result.run, input)
        return {
            abortStatus: result.status,
            runId: result.run.runId,
            runStatus: result.run.status,
        }
    }

    function finish(input: FinishFiveBossBattleInput): FinishFiveBossBattleResult {
        assertSpecialRequest(input)
        if (typeof input.accomplished !== "boolean") {
            runtimeFail("invalid_argument", "accomplished must be a boolean")
        }
        if (!input.accomplished) {
            const aborted = abort(input)
            return {
                kind: "failed",
                ...aborted,
            }
        }

        const result = settleMemberSync({
            playerId: input.playerId,
            clientPlayId: input.clientPlayId,
        }, context => {
            assertPersistentActiveQuest(context.run, context.member, input)
            const previous = getPlayerSingleQuestProgressSync(
                input.playerId,
                FIVE_BOSS_GAUNTLET.category,
                FIVE_BOSS_GAUNTLET.visibleQuestId,
            )
            const firstClear = previous?.finished !== true
            const plan = buildFiveBossGauntletRewardPlan({
                firstClear,
                rewardMultiplier: context.rewardMultiplier,
                randomFloat: input.randomFloat,
            })
            const itemTotals: Record<string, number> = {}
            const grantedItems = plan.items.map(item => {
                const total = givePlayerItemSync(input.playerId, item.itemId, item.amount)
                itemTotals[String(item.itemId)] = total
                return { ...item, total }
            })

            // 武器与材料共用本次结算的随机序列；命中 id 写入 receipt，重放时由 HTTP
            // 层读取并序列化当前持有状态，避免重复发放。
            const weaponPlan = buildFiveBossCursedWeaponDropPlan({
                rewardMultiplier: context.rewardMultiplier,
                availableEquipmentIds: cursedWeaponPool ?? getFiveBossCursedWeaponPool(),
                randomFloat: input.randomFloat,
            })
            for (const equipmentId of weaponPlan.equipmentIds) {
                givePlayerEquipmentSync(input.playerId, equipmentId, 1)
            }

            const storedParty = getDb().prepare(`SELECT party_character_ids_json
                FROM five_boss_gauntlet_members WHERE run_id = ? AND player_id = ?`)
                .get(context.run.runId, input.playerId) as { party_character_ids_json: string }
            const ids = JSON.parse(storedParty.party_character_ids_json) as number[]
            const quest = getQuestFromCategorySync(FIVE_BOSS_GAUNTLET.category,
                FIVE_BOSS_GAUNTLET.visibleQuestId) as { characterExpReward?: number } | null
            const characterExp = ids.length
                ? givePlayerCharactersExpSync(input.playerId, ids, quest?.characterExpReward ?? 0, false)
                : null
            updateSuccessfulQuestProgress(input.playerId, { ...input, leaderCharacterId: ids[0] ?? null }, previous)
            recordPassCompletedRescueBattleFact({ playerId: input.playerId, questAccomplished: true, isMulti: true,
                isMultiHost: input.playerId === context.run.hostPlayerId,
                isRegisteredRescue: input.playerId !== context.run.hostPlayerId && isRegisteredRescueBattleSync({
                    playerId: input.playerId, playId: input.clientPlayId, category: FIVE_BOSS_GAUNTLET.category,
                    questId: FIVE_BOSS_GAUNTLET.visibleQuestId, roomNumber: context.run.roomNumber,
                }) }, new Date())
            deletePlayerActiveQuestIfPlayIdSync(input.playerId, input.clientPlayId)
            return {
                firstClear,
                grantedItems,
                itemTotals,
                characterExp,
                grantedEquipment: weaponPlan.equipmentIds,
            }
        })
        assertRunIdentity(result.run, input)
        return {
            kind: "success",
            receiptStatus: result.status,
            runId: result.run.runId,
            runStatus: result.run.status,
            rewardMultiplier: result.rewardMultiplier,
            reward: result.reward,
        }
    }

    return { start, finish, abort }
}


const defaultRuntime = createFiveBossBattleRuntime()

export const startFiveBossBattle = defaultRuntime.start
export const finishFiveBossBattle = defaultRuntime.finish
export const abortFiveBossBattle = defaultRuntime.abort
