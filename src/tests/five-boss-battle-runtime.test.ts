import assert from "node:assert/strict"
import { after, test } from "node:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import type { MultiRoom } from "../lib/types/multi"


const databaseDir = mkdtempSync(path.join(tmpdir(), "wf-five-boss-battle-runtime-"))
process.env.WF_DATABASE_DIR = databaseDir

const accountDomain = require("../data/domains/account") as typeof import("../data/domains/account")
const playerDomain = require("../data/domains/player") as typeof import("../data/domains/player")
const itemDomain = require("../data/domains/item") as typeof import("../data/domains/item")
const questDomain = require("../data/domains/quest") as typeof import("../data/domains/quest")
const activeQuestDomain = require("../data/domains/quest_active") as typeof import("../data/domains/quest_active")
const runDomain = require("../data/domains/fiveBossGauntletRun") as typeof import("../data/domains/fiveBossGauntletRun")
const { getDb } = require("../data/db") as typeof import("../data/db")
const runtimeModule = require("../multi/five-boss/battle-runtime") as typeof import("../multi/five-boss/battle-runtime")
const contractModule = require("../multi/five-boss/contract") as typeof import("../multi/five-boss/contract")
const rewardModule = require("../multi/five-boss/rewards") as typeof import("../multi/five-boss/rewards")

const { FIVE_BOSS_GAUNTLET } = contractModule
const { FIVE_BOSS_GAUNTLET_REWARD_IDS } = rewardModule
let identity = 0


function createPlayer(ticketAmount = 0): number {
    identity += 1
    const account = accountDomain.insertAccountSync({
        appId: `five-boss-runtime-test-${identity}`,
        idpAlias: "test",
        idpCode: "test",
        idpId: `five-boss-runtime-test-${identity}`,
        status: "active",
    })
    const playerId = playerDomain.insertDefaultPlayerSync(account.id).id
    itemDomain.setPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET.ticketItemId, ticketAmount)
    return playerId
}


function roomFor(
    runId: string,
    hostPlayerId: number,
    playerIds: readonly number[],
    autoByPlayerId: Readonly<Record<number, boolean>>,
): MultiRoom {
    const autoplayModeByPlayerId: Record<string, boolean> = {}
    for (const playerId of playerIds) {
        const mode = autoByPlayerId[playerId]
        if (typeof mode === "boolean") autoplayModeByPlayerId[String(playerId)] = mode
    }
    return {
        room_number: `room-${runId}`,
        access_token: "test",
        category: FIVE_BOSS_GAUNTLET.category,
        quest_id: FIVE_BOSS_GAUNTLET.visibleQuestId,
        host_viewer_id: hostPlayerId + 100_000,
        host_player_id: hostPlayerId,
        host_party_id: 1,
        host_main_character_id: 1,
        accepted_type: 0,
        created_at: Date.now(),
        raising_state: 4,
        room_sequence: identity,
        host_entry_time: 0,
        mates: [],
        share_room_options: 0,
        is_npc_mode: false,
        npc_count: 0,
        five_boss_runtime: {
            runId,
            expectedRealPlayerIds: [...playerIds],
            autoplayModeByPlayerId,
            battleIdentityByConnectionId: {},
        },
    }
}


function startInput(
    room: MultiRoom,
    playerId: number,
    clientPlayId: string,
    overrides: Partial<import("../multi/five-boss/battle-runtime").StartFiveBossBattleInput> = {},
) {
    return {
        playerId,
        clientPlayId,
        room,
        requestRoomNumber: room.room_number,
        requestCategory: room.category,
        requestQuestId: room.quest_id,
        useBoostPoint: false,
        useBossBoostPoint: false,
        httpIsAutoStartMode: false,
        matePlayerIds: [],
        mateComIds: [],
        ...overrides,
    }
}


function finishInput(
    room: MultiRoom,
    playerId: number,
    clientPlayId: string,
    overrides: Partial<import("../multi/five-boss/battle-runtime").FinishFiveBossBattleInput> = {},
) {
    return {
        playerId,
        clientPlayId,
        requestRoomNumber: room.room_number,
        requestCategory: room.category,
        requestQuestId: room.quest_id,
        accomplished: true,
        elapsedTimeMs: 12_345,
        highScore: 777,
        leaderCharacterId: 1,
        randomFloat: () => 0.99,
        ...overrides,
    }
}


function completeBattleProof(room: MultiRoom, playerId: number): void {
    const runId = room.five_boss_runtime!.runId
    runDomain.recordMemberBattleSignalSync({
        runId,
        playerId,
        roomNumber: room.room_number,
        signal: "level_next",
    })
    runDomain.recordMemberBattleSignalSync({
        runId,
        playerId,
        roomNumber: room.room_number,
        signal: "finalize",
    })
}


function assertRuntimeError(code: string, action: () => unknown): void {
    assert.throws(action, (error: unknown) => (
        error instanceof runtimeModule.FiveBossBattleRuntimeError
        && error.code === code
    ))
}


function runStatus(runId: string): string | null {
    const row = getDb().prepare(`
        SELECT status
        FROM five_boss_gauntlet_runs
        WHERE run_id = ?
    `).get(runId) as { status: string } | undefined
    return row?.status ?? null
}


function receiptCount(runId: string): number {
    return (getDb().prepare(`
        SELECT COUNT(*) AS count
        FROM five_boss_gauntlet_receipts
        WHERE run_id = ?
    `).get(runId) as { count: number }).count
}


after(() => {
    getDb().close()
    delete process.env.WF_DATABASE_DIR
    const resolved = path.resolve(databaseDir)
    const safeBase = path.resolve(tmpdir())
    assert.ok(resolved.startsWith(`${safeBase}${path.sep}`))
    assert.ok(path.basename(resolved).startsWith("wf-five-boss-battle-runtime-"))
    rmSync(resolved, { recursive: true, force: true })
})


test("guest-first start charges only the host and trusts frozen lobby Auto, not HTTP Auto", () => {
    const host = createPlayer(2)
    const guest = createPlayer()
    const room = roomFor("runtime-guest-first", host, [host, guest], {
        [host]: false,
        [guest]: true,
    })

    const guestStart = runtimeModule.startFiveBossBattle(startInput(room, guest, "guest-play", {
        httpIsAutoStartMode: false,
    }))
    const hostStart = runtimeModule.startFiveBossBattle(startInput(room, host, "host-play", {
        httpIsAutoStartMode: true,
    }))

    assert.equal(guestStart.activeQuest.isAutoStartMode, true)
    assert.equal(hostStart.activeQuest.isAutoStartMode, false)
    assert.equal(itemDomain.getPlayerItemSync(host, FIVE_BOSS_GAUNTLET.ticketItemId), 1)
    assert.equal(activeQuestDomain.getPlayerActiveQuestSync(guest)?.playId, "guest-play")
    assert.equal(activeQuestDomain.getPlayerActiveQuestSync(host)?.playId, "host-play")
})


test("start rejects non-exact rooms, boosts, outsiders, and missing frozen Auto without spending a ticket", () => {
    const host = createPlayer(3)
    const guest = createPlayer()
    const outsider = createPlayer()
    const room = roomFor("runtime-start-gates", host, [host, guest], {
        [host]: false,
        [guest]: false,
    })

    assertRuntimeError("room_not_in_battle", () => runtimeModule.startFiveBossBattle(
        startInput({ ...room, raising_state: 2 }, guest, "not-battle"),
    ))
    assertRuntimeError("request_identity_mismatch", () => runtimeModule.startFiveBossBattle(
        startInput(room, guest, "wrong-quest", { requestQuestId: room.quest_id + 1 }),
    ))
    assertRuntimeError("boost_not_allowed", () => runtimeModule.startFiveBossBattle(
        startInput(room, guest, "boost", { useBoostPoint: true }),
    ))
    assertRuntimeError("participant_not_frozen", () => runtimeModule.startFiveBossBattle(
        startInput(room, outsider, "outsider"),
    ))
    const missingAutoRoom = roomFor("runtime-missing-auto", host, [host, guest], {
        [host]: false,
    })
    assertRuntimeError("missing_frozen_autoplay", () => runtimeModule.startFiveBossBattle(
        startInput(missingAutoRoom, guest, "missing-auto"),
    ))

    assert.equal(itemDomain.getPlayerItemSync(host, FIVE_BOSS_GAUNTLET.ticketItemId), 3)
})


test("start rolls back its new run and host ticket when a different persistent active quest exists", () => {
    const host = createPlayer(1)
    const guest = createPlayer()
    const room = roomFor("runtime-start-active-conflict", host, [host, guest], {
        [host]: false,
        [guest]: false,
    })
    activeQuestDomain.insertPlayerActiveQuestSync(guest, {
        playerId: guest,
        playId: "different-play",
        questId: 1,
        category: 1,
        useBossBoostPoint: false,
        useBoostPoint: false,
        isAutoStartMode: false,
        isMulti: false,
        roomNumber: null,
        entryItemId: null,
        eventId: null,
        continueCount: 0,
    })

    assertRuntimeError("active_quest_mismatch", () => runtimeModule.startFiveBossBattle(
        startInput(room, guest, "conflicting-start"),
    ))

    assert.equal(itemDomain.getPlayerItemSync(host, FIVE_BOSS_GAUNTLET.ticketItemId), 1)
    assert.equal(runStatus(room.five_boss_runtime!.runId), null)
    assert.equal(activeQuestDomain.getPlayerActiveQuestSync(guest)?.playId, "different-play")
})


test("manual rewards are 2x, auto rewards are 1x, and only the last real receipt settles the run", () => {
    const host = createPlayer(1)
    const autoGuest = createPlayer()
    const manualGuest = createPlayer()
    const players = [host, autoGuest, manualGuest]
    const room = roomFor("runtime-three-finish", host, players, {
        [host]: false,
        [autoGuest]: true,
        [manualGuest]: false,
    })
    runtimeModule.startFiveBossBattle(startInput(room, autoGuest, "auto-play"))
    runtimeModule.startFiveBossBattle(startInput(room, host, "host-play"))
    runtimeModule.startFiveBossBattle(startInput(room, manualGuest, "manual-play"))
    for (const playerId of players) completeBattleProof(room, playerId)

    const hostFinish = runtimeModule.finishFiveBossBattle(finishInput(room, host, "host-play"))
    const autoFinish = runtimeModule.finishFiveBossBattle(finishInput(room, autoGuest, "auto-play"))
    assert.equal(hostFinish.kind, "success")
    assert.equal(autoFinish.kind, "success")
    assert.equal(hostFinish.runStatus, "active")
    assert.equal(autoFinish.runStatus, "active")
    assert.equal(hostFinish.rewardMultiplier, 2)
    assert.equal(autoFinish.rewardMultiplier, 1)
    // 2026-09-28 设计稿第 5 节:深界结晶 5→10 × 倍率。
    assert.equal(itemDomain.getPlayerItemSync(host, FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal), 20)
    assert.equal(itemDomain.getPlayerItemSync(autoGuest, FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal), 10)

    const final = runtimeModule.finishFiveBossBattle(finishInput(room, manualGuest, "manual-play"))
    assert.equal(final.kind, "success")
    assert.equal(final.runStatus, "settled")
    assert.equal(final.rewardMultiplier, 2)
    assert.equal(runStatus(room.five_boss_runtime!.runId), "settled")

    const totalBeforeReplay = itemDomain.getPlayerItemSync(manualGuest, FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal)
    const replay = runtimeModule.finishFiveBossBattle(finishInput(room, manualGuest, "manual-play", {
        randomFloat: () => 0,
    }))
    assert.equal(replay.kind, "success")
    if (replay.kind !== "success") throw new Error("expected successful receipt replay")
    assert.equal(replay.receiptStatus, "already_settled")
    assert.equal(replay.runStatus, "settled")
    assert.equal(itemDomain.getPlayerItemSync(manualGuest, FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal), totalBeforeReplay)
    assert.equal(receiptCount(room.five_boss_runtime!.runId), 3)

    for (const playerId of players) {
        const progress = questDomain.getPlayerSingleQuestProgressSync(
            playerId,
            FIVE_BOSS_GAUNTLET.category,
            FIVE_BOSS_GAUNTLET.visibleQuestId,
        )
        assert.equal(progress?.finished, true)
        assert.equal(progress?.multiClearCount, 1)
        assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.firstClearEmblem), 1)
        assert.equal(activeQuestDomain.getPlayerActiveQuestSync(playerId), null)
    }
})


test("reward multiplier stays bound to battle-start Auto after later lobby or client changes", () => {
    const host = createPlayer(1)
    const autoGuest = createPlayer()
    const room = roomFor("runtime-auto-snapshot-immutable", host, [host, autoGuest], {
        [host]: false,
        [autoGuest]: true,
    })

    runtimeModule.startFiveBossBattle(startInput(room, host, "snapshot-manual"))
    runtimeModule.startFiveBossBattle(startInput(room, autoGuest, "snapshot-auto"))

    // 这里只模拟进场后客户端/UI 状态改变。结算权威必须仍是已写入运行记录的开战快照。
    room.five_boss_runtime!.autoplayModeByPlayerId[String(host)] = true
    room.five_boss_runtime!.autoplayModeByPlayerId[String(autoGuest)] = false
    for (const playerId of [host, autoGuest]) completeBattleProof(room, playerId)

    const manualFinish = runtimeModule.finishFiveBossBattle(
        finishInput(room, host, "snapshot-manual"),
    )
    const autoFinish = runtimeModule.finishFiveBossBattle(
        finishInput(room, autoGuest, "snapshot-auto"),
    )

    assert.equal(manualFinish.kind, "success")
    assert.equal(autoFinish.kind, "success")
    assert.equal(manualFinish.rewardMultiplier, 2)
    assert.equal(autoFinish.rewardMultiplier, 1)
})


test("cursed-weapon drops are rolled alongside materials, granted via the injectable dependency, and replay without re-rolling", () => {
    const host = createPlayer(1)
    const room = roomFor("runtime-weapon-drop", host, [host], { [host]: true }) // Auto -> 1 次掷骰
    runtimeModule.startFiveBossBattle(startInput(room, host, "weapon-play"))
    completeBattleProof(room, host)

    const grantedEquipmentCalls: Array<[number, number, number]> = []
    const weaponRuntime = runtimeModule.createFiveBossBattleRuntime({
        cursedWeaponPool: [5910101, 5910102],
        givePlayerEquipmentSync(playerId, equipmentId, amount) {
            grantedEquipmentCalls.push([playerId, equipmentId, amount])
            return { equipment_id: equipmentId, protection: false, level: 1, enhancement_level: 0, stack: 0 }
        },
    })

    // 材料两次判定都 miss/base-only,武器唯一一次掷骰(Auto=倍率1)命中(掉率 5%)并抽到 index0。
    const values = [0.9, 0.9, 0.01, 0]
    const finish = weaponRuntime.finish(finishInput(room, host, "weapon-play", {
        randomFloat: () => values.shift() as number,
    }))
    assert.equal(finish.kind, "success")
    if (finish.kind !== "success") throw new Error("expected success")
    assert.deepEqual(finish.reward.grantedEquipment, [5910101])
    assert.deepEqual(grantedEquipmentCalls, [[host, 5910101, 1]])

    const replay = weaponRuntime.finish(finishInput(room, host, "weapon-play"))
    assert.equal(replay.kind, "success")
    if (replay.kind !== "success") throw new Error("expected success")
    assert.equal(replay.receiptStatus, "already_settled")
    assert.deepEqual(replay.reward.grantedEquipment, [5910101])
    // 重放走 already_settled 快速路径,不重新掷骰、不重新发放。
    assert.equal(grantedEquipmentCalls.length, 1)
})


test("finish leniently settles a member whose BothBoss level-next/finalize proof never arrived", () => {
    // 2026-09-28 设计稿第 6 节(a):仍在 R0 就被隔离、之后单机打完才发 finish——不再 400。
    const host = createPlayer(1)
    const room = roomFor("runtime-lenient-no-proof", host, [host], { [host]: false })
    runtimeModule.startFiveBossBattle(startInput(room, host, "lenient-no-proof"))
    // 故意不调用 completeBattleProof。

    const finish = runtimeModule.finishFiveBossBattle(finishInput(room, host, "lenient-no-proof"))
    assert.equal(finish.kind, "success")
    if (finish.kind !== "success") throw new Error("expected a lenient success")
    assert.equal(finish.reward.proofComplete, false)
    assert.equal(finish.runStatus, "settled")
    assert.equal(itemDomain.getPlayerItemSync(host, FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal), 20)
})


test("finish leniently settles a member who reached level-next but never finalize", () => {
    const host = createPlayer(1)
    const room = roomFor("runtime-lenient-partial-proof", host, [host], { [host]: true })
    runtimeModule.startFiveBossBattle(startInput(room, host, "lenient-partial-proof"))
    runDomain.recordMemberBattleSignalSync({
        runId: room.five_boss_runtime!.runId,
        playerId: host,
        roomNumber: room.room_number,
        signal: "level_next",
    })

    const finish = runtimeModule.finishFiveBossBattle(finishInput(room, host, "lenient-partial-proof"))
    assert.equal(finish.kind, "success")
    if (finish.kind !== "success") throw new Error("expected a lenient success")
    assert.equal(finish.reward.proofComplete, false)
    assert.equal(finish.rewardMultiplier, 1)
})


test("host abort no longer blocks a teammate's normal settlement; the run stays active until both are done", () => {
    // 2026-09-28 设计稿第 6 节(b):房主放弃只作废房主本人,不再让队友 finish 命中 run_not_active。
    const host = createPlayer(1)
    const guest = createPlayer()
    const room = roomFor("runtime-host-abort-lenient", host, [host, guest], { [host]: false, [guest]: false })
    runtimeModule.startFiveBossBattle(startInput(room, host, "abort-lenient-host"))
    runtimeModule.startFiveBossBattle(startInput(room, guest, "abort-lenient-guest"))

    const hostAbort = runtimeModule.abortFiveBossBattle({
        playerId: host,
        clientPlayId: "abort-lenient-host",
        requestRoomNumber: room.room_number,
        requestCategory: room.category,
        requestQuestId: room.quest_id,
    })
    assert.equal(hostAbort.abortStatus, "member_aborted")
    assert.equal(hostAbort.runStatus, "active")

    completeBattleProof(room, guest)
    const guestFinish = runtimeModule.finishFiveBossBattle(finishInput(room, guest, "abort-lenient-guest"))
    assert.equal(guestFinish.kind, "success")
    if (guestFinish.kind !== "success") throw new Error("expected guest settlement to succeed")
    assert.equal(guestFinish.runStatus, "settled")
    assert.equal(itemDomain.getPlayerItemSync(guest, FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal), 20)
})


test("reward callback failure rolls back items, progress, active deletion, and receipt", () => {
    const host = createPlayer(1)
    const room = roomFor("runtime-callback-rollback", host, [host], { [host]: false })
    runtimeModule.startFiveBossBattle(startInput(room, host, "rollback-play"))
    completeBattleProof(room, host)
    const failingRuntime = runtimeModule.createFiveBossBattleRuntime({
        givePlayerItemSync(playerId, itemId, amount) {
            itemDomain.givePlayerItemSync(playerId, itemId, amount)
            throw new Error("injected reward writer failure")
        },
    })

    assert.throws(
        () => failingRuntime.finish(finishInput(room, host, "rollback-play")),
        /injected reward writer failure/,
    )

    assert.equal(itemDomain.getPlayerItemSync(host, FIVE_BOSS_GAUNTLET_REWARD_IDS.blueprintFragment), null)
    assert.equal(questDomain.getPlayerSingleQuestProgressSync(
        host,
        FIVE_BOSS_GAUNTLET.category,
        FIVE_BOSS_GAUNTLET.visibleQuestId,
    ), null)
    assert.equal(activeQuestDomain.getPlayerActiveQuestSync(host)?.playId, "rollback-play")
    assert.equal(receiptCount(room.five_boss_runtime!.runId), 0)
    assert.equal(runStatus(room.five_boss_runtime!.runId), "active")
})


test("failed finish and explicit abort grant nothing, delete only exact active state, and never refund", () => {
    const host = createPlayer(2)
    const guest = createPlayer()
    const room = roomFor("runtime-failed-finish", host, [host, guest], {
        [host]: false,
        [guest]: false,
    })
    runtimeModule.startFiveBossBattle(startInput(room, guest, "failed-guest"))
    runtimeModule.startFiveBossBattle(startInput(room, host, "aborted-host"))

    const failed = runtimeModule.finishFiveBossBattle(finishInput(room, guest, "failed-guest", {
        accomplished: false,
    }))
    assert.equal(failed.kind, "failed")
    assert.equal(failed.abortStatus, "member_aborted")
    assert.equal(failed.runStatus, "active")
    assert.equal(activeQuestDomain.getPlayerActiveQuestSync(guest), null)
    assert.equal(itemDomain.getPlayerItemSync(guest, FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal), null)

    const aborted = runtimeModule.abortFiveBossBattle({
        playerId: host,
        clientPlayId: "aborted-host",
        requestRoomNumber: room.room_number,
        requestCategory: room.category,
        requestQuestId: room.quest_id,
    })
    assert.equal(aborted.abortStatus, "run_aborted")
    assert.equal(aborted.runStatus, "aborted")
    assert.equal(activeQuestDomain.getPlayerActiveQuestSync(host), null)
    assert.equal(itemDomain.getPlayerItemSync(host, FIVE_BOSS_GAUNTLET.ticketItemId), 1)
    assert.equal(receiptCount(room.five_boss_runtime!.runId), 0)
})


test("host without a ticket: everyone plays, nobody is rewarded, and the first ticketed clear still counts as first clear", () => {
    const host = createPlayer(0)
    const guest = createPlayer(5)
    const room = roomFor("runtime-host-no-ticket", host, [host, guest], { [host]: false, [guest]: false })

    const guestStart = runtimeModule.startFiveBossBattle(startInput(room, guest, "nt-guest"))
    const hostStart = runtimeModule.startFiveBossBattle(startInput(room, host, "nt-host"))
    assert.equal(guestStart.rewardsEnabled, false)
    assert.equal(hostStart.rewardsEnabled, false)
    assert.equal(hostStart.runStatus, "active")
    assert.equal(itemDomain.getPlayerItemSync(host, FIVE_BOSS_GAUNTLET.ticketItemId) ?? 0, 0)
    assert.equal(itemDomain.getPlayerItemSync(guest, FIVE_BOSS_GAUNTLET.ticketItemId), 5)
    for (const playerId of [host, guest]) completeBattleProof(room, playerId)

    const guestFinish = runtimeModule.finishFiveBossBattle(finishInput(room, guest, "nt-guest", { randomFloat: () => 0 }))
    const hostFinish = runtimeModule.finishFiveBossBattle(finishInput(room, host, "nt-host", { randomFloat: () => 0 }))
    for (const finish of [guestFinish, hostFinish]) {
        assert.equal(finish.kind, "success")
        if (finish.kind !== "success") throw new Error("expected a successful finish")
        assert.equal(finish.rewardsEnabled, false)
        assert.deepEqual(finish.reward.grantedItems, [])
        assert.deepEqual(finish.reward.itemTotals, {})
        assert.equal(finish.reward.firstClear, false)
    }
    assert.equal(hostFinish.runStatus, "settled")
    assert.equal(receiptCount(room.five_boss_runtime!.runId), 2)
    for (const playerId of [host, guest]) {
        assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal), null)
        assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.blueprintFragment), null)
        assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.firstClearEmblem), null)
        assert.equal(questDomain.getPlayerSingleQuestProgressSync(
            playerId,
            FIVE_BOSS_GAUNTLET.category,
            FIVE_BOSS_GAUNTLET.visibleQuestId,
        ), null)
        assert.equal(activeQuestDomain.getPlayerActiveQuestSync(playerId), null)
    }
    assert.equal(itemDomain.getPlayerItemSync(guest, FIVE_BOSS_GAUNTLET.ticketItemId), 5)

    // 同一房主随后拿到票再开一局:这次扣票、发奖,而且仍按首通发证。
    itemDomain.setPlayerItemSync(host, FIVE_BOSS_GAUNTLET.ticketItemId, 1)
    const rematch = roomFor("runtime-host-ticket-rematch", host, [host, guest], { [host]: false, [guest]: false })
    const rematchStart = runtimeModule.startFiveBossBattle(startInput(rematch, host, "rt-host"))
    runtimeModule.startFiveBossBattle(startInput(rematch, guest, "rt-guest"))
    assert.equal(rematchStart.rewardsEnabled, true)
    assert.equal(itemDomain.getPlayerItemSync(host, FIVE_BOSS_GAUNTLET.ticketItemId), 0)
    assert.equal(itemDomain.getPlayerItemSync(guest, FIVE_BOSS_GAUNTLET.ticketItemId), 5)
    for (const playerId of [host, guest]) completeBattleProof(rematch, playerId)
    const rematchFinish = runtimeModule.finishFiveBossBattle(finishInput(rematch, host, "rt-host"))
    assert.equal(rematchFinish.kind, "success")
    if (rematchFinish.kind !== "success") throw new Error("expected a successful rematch finish")
    assert.equal(rematchFinish.rewardsEnabled, true)
    assert.equal(rematchFinish.reward.firstClear, true)
    assert.equal(itemDomain.getPlayerItemSync(host, FIVE_BOSS_GAUNTLET_REWARD_IDS.firstClearEmblem), 1)
    assert.equal(itemDomain.getPlayerItemSync(host, FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal), 20)
    assert.equal(questDomain.getPlayerSingleQuestProgressSync(
        host,
        FIVE_BOSS_GAUNTLET.category,
        FIVE_BOSS_GAUNTLET.visibleQuestId,
    )?.finished, true)
})


test("finish fails closed on request or persistent-active identity mismatch", () => {
    const host = createPlayer(2)
    const room = roomFor("runtime-identity-mismatch", host, [host], { [host]: false })
    runtimeModule.startFiveBossBattle(startInput(room, host, "identity-play"))
    completeBattleProof(room, host)

    assertRuntimeError("run_identity_mismatch", () => runtimeModule.finishFiveBossBattle(
        finishInput(room, host, "identity-play", { requestRoomNumber: `${room.room_number}-wrong` }),
    ))
    getDb().prepare(`
        UPDATE players_active_quests
        SET room_number = ?
        WHERE player_id = ?
    `).run("wrong-persistent-room", host)
    assertRuntimeError("active_quest_mismatch", () => runtimeModule.finishFiveBossBattle(
        finishInput(room, host, "identity-play"),
    ))

    assert.equal(itemDomain.getPlayerItemSync(host, FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal), null)
    assert.equal(receiptCount(room.five_boss_runtime!.runId), 0)
    assert.equal(runStatus(room.five_boss_runtime!.runId), "active")
    assert.equal(itemDomain.getPlayerItemSync(host, FIVE_BOSS_GAUNTLET.ticketItemId), 1)
})
