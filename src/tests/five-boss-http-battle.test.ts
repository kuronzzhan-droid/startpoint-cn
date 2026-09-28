import assert from "node:assert/strict"
import { after, test } from "node:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import Fastify from "fastify"


const databaseDir = mkdtempSync(path.join(tmpdir(), "wf-five-boss-http-"))
process.env.WF_DATABASE_DIR = databaseDir

const accountDomain = require("../data/domains/account") as typeof import("../data/domains/account")
const playerDomain = require("../data/domains/player") as typeof import("../data/domains/player")
const itemDomain = require("../data/domains/item") as typeof import("../data/domains/item")
const sessionDomain = require("../data/domains/session") as typeof import("../data/domains/session")
const questDomain = require("../data/domains/quest") as typeof import("../data/domains/quest")
const runDomain = require("../data/domains/fiveBossGauntletRun") as typeof import("../data/domains/fiveBossGauntletRun")
const { getDb } = require("../data/db") as typeof import("../data/db")
const { createRoom, disbandRoom, getRoom } = require("../multi/room/manager") as typeof import("../multi/room/manager")
const { registerBattleRoutes } = require("../multi/http/battle") as typeof import("../multi/http/battle")
const { activeQuests } = require("../routes/api/singleBattleQuest") as typeof import("../routes/api/singleBattleQuest")
const { FIVE_BOSS_GAUNTLET } = require("../multi/five-boss/contract") as typeof import("../multi/five-boss/contract")
const { FIVE_BOSS_GAUNTLET_REWARD_IDS } = require("../multi/five-boss/rewards") as typeof import("../multi/five-boss/rewards")
const { SessionType } = require("../data/types") as typeof import("../data/types")

const app = Fastify()
app.addHook("onSend", (_request, reply, payload, done) => {
    if (reply.getHeader("content-type") === "application/x-msgpack") {
        done(null, JSON.stringify(payload))
        return
    }
    done(null, payload)
})
registerBattleRoutes(app)
let identity = 0


async function createMember(ticketAmount = 0) {
    identity += 1
    const account = accountDomain.insertAccountSync({
        appId: `five-boss-http-${identity}`,
        idpAlias: "test",
        idpCode: "test",
        idpId: `five-boss-http-${identity}`,
        status: "active",
    })
    const playerId = playerDomain.insertDefaultPlayerSync(account.id).id
    const viewerId = 780_000_000 + identity
    await sessionDomain.insertSessionWithToken({
        token: String(viewerId),
        accountId: account.id,
        expires: new Date(),
        type: SessionType.VIEWER,
    })
    itemDomain.setPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET.ticketItemId, ticketAmount)
    return { playerId, viewerId, playId: `http-play-${identity}` }
}


async function createSoloRun(ticketAmount = 1) {
    const member = await createMember(ticketAmount)
    const room = createRoom(
        member.viewerId,
        member.playerId,
        1,
        FIVE_BOSS_GAUNTLET.category,
        FIVE_BOSS_GAUNTLET.visibleQuestId,
        0,
        1,
    )
    room.raising_state = 4
    room.mates = [{ viewer_id: member.viewerId, com_id: 0, player_id: member.playerId }]
    room.five_boss_runtime = {
        runId: `http-run-${identity}`,
        expectedRealPlayerIds: [member.playerId],
        autoplayModeByPlayerId: { [String(member.playerId)]: false },
        battleIdentityByConnectionId: {},
    }
    return { ...member, room }
}


function startPayload(run: Awaited<ReturnType<typeof createSoloRun>>) {
    return {
        viewer_id: run.viewerId,
        quest_id: FIVE_BOSS_GAUNTLET.visibleQuestId,
        category: FIVE_BOSS_GAUNTLET.category,
        party_id: 1,
        use_boost_point: false,
        use_boss_boost_point: false,
        is_auto_start_mode: true,
        room_number: run.room.room_number,
        mate_player_ids: [],
        mate_party_ids: [],
        play_id: run.playId,
        api_count: 1,
        combat_power: 1,
    }
}


function finishPayload(run: Awaited<ReturnType<typeof createSoloRun>>) {
    return {
        viewer_id: run.viewerId,
        quest_id: FIVE_BOSS_GAUNTLET.visibleQuestId,
        category: FIVE_BOSS_GAUNTLET.category,
        room_number: run.room.room_number,
        play_id: run.playId,
        is_accomplished: true,
        elapsed_time_ms: 12345,
        score: 777,
        statistics: {
            clear_phase: 0,
            party: {
                characters: [{ id: 1 }],
                unison_characters: [],
                equipments: [],
                ability_soul_ids: [],
            },
        },
        mate_player_result: [],
        battle_time: 12345,
        battle_ended_at: Date.now(),
        api_count: 2,
        mate_player_ids: [],
        mate_com_ids: [],
        is_auto_start_mode: true,
        combat_power: 1,
        use_boss_boost_point: false,
        use_boost_point: false,
    }
}


function completeBattleProof(run: Awaited<ReturnType<typeof createSoloRun>>): void {
    const runId = run.room.five_boss_runtime!.runId
    runDomain.recordMemberBattleSignalSync({
        runId,
        playerId: run.playerId,
        roomNumber: run.room.room_number,
        signal: "level_next",
    })
    runDomain.recordMemberBattleSignalSync({
        runId,
        playerId: run.playerId,
        roomNumber: run.room.room_number,
        signal: "finalize",
    })
}


after(async () => {
    await app.close()
    for (const playerId of Object.keys(activeQuests)) delete activeQuests[Number(playerId)]
    getDb().close()
    delete process.env.WF_DATABASE_DIR
    const resolved = path.resolve(databaseDir)
    const safeBase = path.resolve(tmpdir())
    assert.ok(resolved.startsWith(`${safeBase}${path.sep}`))
    assert.ok(path.basename(resolved).startsWith("wf-five-boss-http-"))
    rmSync(resolved, { recursive: true, force: true })
})


test("HTTP start and finish use the custom ledger without a donor quest row", async () => {
    const run = await createSoloRun()
    const start = await app.inject({ method: "POST", url: "/start", payload: startPayload(run) })
    assert.equal(start.statusCode, 200, start.body)
    assert.equal(itemDomain.getPlayerItemSync(
        run.playerId,
        FIVE_BOSS_GAUNTLET.ticketItemId,
    ), 0)
    assert.equal(activeQuests[run.playerId]?.playId, run.playId)
    assert.equal(run.room.raising_state, 4)

    // 2026-09-28 设计稿第 6 节(a):战斗通道没送 level_next/finalize 也按宽容结算,不再 400
    // (这条曾经专门验证"没证据就 400",现改为验证"没证据也照常结算并落一条宽容日志")。
    const finish = await app.inject({ method: "POST", url: "/finish", payload: finishPayload(run) })
    assert.equal(finish.statusCode, 200, finish.body)
    const data = JSON.parse(finish.body).data
    assert.equal(data.item_list[String(FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal)], 20)
    assert.equal(data.drop_score_reward_ids.length, 0)
    assert.equal(data.drop_rare_reward_ids.length, 0)
    // 结算后房间直接解散(随机选图种子=房号,复用房间会抽到同一套变体)。
    assert.equal(getRoom(run.room.room_number), undefined)
    assert.equal(activeQuests[run.playerId], undefined)
    assert.equal(questDomain.getPlayerSingleQuestProgressSync(
        run.playerId,
        FIVE_BOSS_GAUNTLET.category,
        FIVE_BOSS_GAUNTLET.visibleQuestId,
    )?.multiClearCount, 1)

    const beforeReplay = itemDomain.getPlayerItemSync(
        run.playerId,
        FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal,
    )
    itemDomain.setPlayerItemSync(
        run.playerId,
        FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal,
        3,
    )
    const replay = await app.inject({ method: "POST", url: "/finish", payload: finishPayload(run) })
    assert.equal(replay.statusCode, 200, replay.body)
    const replayData = JSON.parse(replay.body).data
    assert.equal(
        replayData.item_list[String(FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal)],
        3,
    )
    assert.equal(itemDomain.getPlayerItemSync(
        run.playerId,
        FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal,
    ), 3)
    assert.notEqual(beforeReplay, 3)
    disbandRoom(run.room.room_number)
})


test("HTTP start without a host ticket still plays and finishes with an empty reward list", async () => {
    const run = await createSoloRun(0)
    const start = await app.inject({ method: "POST", url: "/start", payload: startPayload(run) })
    assert.equal(start.statusCode, 200, start.body)
    assert.equal(itemDomain.getPlayerItemSync(run.playerId, FIVE_BOSS_GAUNTLET.ticketItemId) ?? 0, 0)
    assert.equal(activeQuests[run.playerId]?.playId, run.playId)
    completeBattleProof(run)

    const finish = await app.inject({ method: "POST", url: "/finish", payload: finishPayload(run) })
    assert.equal(finish.statusCode, 200, finish.body)
    const data = JSON.parse(finish.body).data
    assert.deepEqual(data.drop_additional_reward_ids, [])
    assert.deepEqual(data.item_list, {})
    assert.equal(data.clear_rank, 5)
    assert.equal(itemDomain.getPlayerItemSync(run.playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal), null)
    assert.equal(questDomain.getPlayerSingleQuestProgressSync(
        run.playerId,
        FIVE_BOSS_GAUNTLET.category,
        FIVE_BOSS_GAUNTLET.visibleQuestId,
    ), null)
    assert.equal(getRoom(run.room.room_number), undefined)
    assert.equal(activeQuests[run.playerId], undefined)
})


test("HTTP abort ends a host run without rewards or a ticket refund", async () => {
    const run = await createSoloRun(2)
    const start = await app.inject({ method: "POST", url: "/start", payload: startPayload(run) })
    assert.equal(start.statusCode, 200, start.body)

    const aborted = await app.inject({
        method: "POST",
        url: "/abort",
        payload: {
            viewer_id: run.viewerId,
            quest_id: FIVE_BOSS_GAUNTLET.visibleQuestId,
            category: FIVE_BOSS_GAUNTLET.category,
            room_number: run.room.room_number,
            play_id: run.playId,
            api_count: 2,
        },
    })
    assert.equal(aborted.statusCode, 200, aborted.body)
    assert.equal(itemDomain.getPlayerItemSync(
        run.playerId,
        FIVE_BOSS_GAUNTLET.ticketItemId,
    ), 1)
    assert.equal(itemDomain.getPlayerItemSync(
        run.playerId,
        FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal,
    ), null)
    assert.equal(activeQuests[run.playerId], undefined)
})


test("HTTP keeps a three-player room in battle until the last frozen real receipt", async () => {
    const host = await createMember(1)
    const guestA = await createMember()
    const guestB = await createMember()
    const members = [host, guestA, guestB]
    const room = createRoom(
        host.viewerId,
        host.playerId,
        1,
        FIVE_BOSS_GAUNTLET.category,
        FIVE_BOSS_GAUNTLET.visibleQuestId,
        0,
        1,
    )
    room.raising_state = 4
    room.mates = members.map(member => ({
        viewer_id: member.viewerId,
        com_id: 0,
        player_id: member.playerId,
    }))
    room.five_boss_runtime = {
        runId: `http-run-${identity}-triple`,
        expectedRealPlayerIds: members.map(member => member.playerId),
        autoplayModeByPlayerId: Object.fromEntries(
            members.map(member => [String(member.playerId), false]),
        ),
        battleIdentityByConnectionId: {},
    }
    const runs = members.map(member => ({ ...member, room }))

    for (const run of [runs[1], runs[0], runs[2]]) {
        const started = await app.inject({ method: "POST", url: "/start", payload: startPayload(run) })
        assert.equal(started.statusCode, 200, started.body)
    }
    for (const run of runs) completeBattleProof(run)
    assert.equal(itemDomain.getPlayerItemSync(host.playerId, FIVE_BOSS_GAUNTLET.ticketItemId), 0)

    for (const run of runs.slice(0, 2)) {
        const finished = await app.inject({ method: "POST", url: "/finish", payload: finishPayload(run) })
        assert.equal(finished.statusCode, 200, finished.body)
        assert.equal(room.raising_state, 4)
        assert.ok(room.five_boss_runtime)
    }

    const final = await app.inject({ method: "POST", url: "/finish", payload: finishPayload(runs[2]) })
    assert.equal(final.statusCode, 200, final.body)
    // 最后一份结算后房间直接解散(terminalRoomTransition:随机选图种子=房号,复用会重复)。
    assert.equal(room.five_boss_runtime, undefined)
    assert.equal(getRoom(room.room_number), undefined)
})


function abortPayload(run: { viewerId: number, room: { room_number: string }, playId: string }) {
    return {
        viewer_id: run.viewerId,
        quest_id: FIVE_BOSS_GAUNTLET.visibleQuestId,
        category: FIVE_BOSS_GAUNTLET.category,
        room_number: run.room.room_number,
        play_id: run.playId,
        api_count: 2,
    }
}


test("HTTP: host abort mid-fight no longer 400s the teammates; the room disbands only once the last one is done", async () => {
    // 2026-09-28 设计稿第 6 节(b):房主放弃只作废房主本人,不整局 aborted、不当场解散仍在
    // 战斗的房间;票已在开局扣掉,放弃不退;房间只在最后一个成员落定后解散。
    const host = await createMember(1)
    const guestA = await createMember()
    const guestB = await createMember()
    const members = [host, guestA, guestB]
    const room = createRoom(
        host.viewerId,
        host.playerId,
        1,
        FIVE_BOSS_GAUNTLET.category,
        FIVE_BOSS_GAUNTLET.visibleQuestId,
        0,
        1,
    )
    room.raising_state = 4
    room.mates = members.map(member => ({
        viewer_id: member.viewerId,
        com_id: 0,
        player_id: member.playerId,
    }))
    room.five_boss_runtime = {
        runId: `http-run-${identity}-host-abort`,
        expectedRealPlayerIds: members.map(member => member.playerId),
        autoplayModeByPlayerId: Object.fromEntries(
            members.map(member => [String(member.playerId), false]),
        ),
        battleIdentityByConnectionId: {},
    }
    const runs = members.map(member => ({ ...member, room }))
    const [hostRun, guestARun, guestBRun] = runs

    for (const run of runs) {
        const started = await app.inject({ method: "POST", url: "/start", payload: startPayload(run) })
        assert.equal(started.statusCode, 200, started.body)
    }
    assert.equal(itemDomain.getPlayerItemSync(host.playerId, FIVE_BOSS_GAUNTLET.ticketItemId), 0)

    const hostAbort = await app.inject({ method: "POST", url: "/abort", payload: abortPayload(hostRun) })
    assert.equal(hostAbort.statusCode, 200, hostAbort.body)
    // 房主放弃不解散、不终结:房间与 run 都还在,队友能继续。
    assert.ok(getRoom(room.room_number))
    assert.ok(room.five_boss_runtime)
    assert.equal(itemDomain.getPlayerItemSync(host.playerId, FIVE_BOSS_GAUNTLET.ticketItemId), 0) // 放弃不退票

    completeBattleProof(guestARun)
    const guestAFinish = await app.inject({ method: "POST", url: "/finish", payload: finishPayload(guestARun) })
    assert.equal(guestAFinish.statusCode, 200, guestAFinish.body)
    const guestAData = JSON.parse(guestAFinish.body).data
    assert.equal(guestAData.item_list[String(FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal)], 20)
    // guestB 还没落定,房间不解散。
    assert.ok(getRoom(room.room_number))
    assert.ok(room.five_boss_runtime)

    completeBattleProof(guestBRun)
    const guestBFinish = await app.inject({ method: "POST", url: "/finish", payload: finishPayload(guestBRun) })
    assert.equal(guestBFinish.statusCode, 200, guestBFinish.body)
    const guestBData = JSON.parse(guestBFinish.body).data
    assert.equal(guestBData.item_list[String(FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal)], 20)
    // 最后一人(guestB)落定:房间才解散。
    assert.equal(room.five_boss_runtime, undefined)
    assert.equal(getRoom(room.room_number), undefined)
})


test("HTTP: a room where every member aborts (nobody settles) still disbands once the last one gives up", async () => {
    const host = await createMember(1)
    const guest = await createMember()
    const members = [host, guest]
    const room = createRoom(
        host.viewerId,
        host.playerId,
        1,
        FIVE_BOSS_GAUNTLET.category,
        FIVE_BOSS_GAUNTLET.visibleQuestId,
        0,
        1,
    )
    room.raising_state = 4
    room.mates = members.map(member => ({ viewer_id: member.viewerId, com_id: 0, player_id: member.playerId }))
    room.five_boss_runtime = {
        runId: `http-run-${identity}-all-abandoned`,
        expectedRealPlayerIds: members.map(member => member.playerId),
        autoplayModeByPlayerId: Object.fromEntries(members.map(member => [String(member.playerId), false])),
        battleIdentityByConnectionId: {},
    }
    const runs = members.map(member => ({ ...member, room }))

    for (const run of runs) {
        const started = await app.inject({ method: "POST", url: "/start", payload: startPayload(run) })
        assert.equal(started.statusCode, 200, started.body)
    }

    const hostAbort = await app.inject({ method: "POST", url: "/abort", payload: abortPayload(runs[0]) })
    assert.equal(hostAbort.statusCode, 200, hostAbort.body)
    assert.ok(getRoom(room.room_number))

    const guestAbort = await app.inject({ method: "POST", url: "/abort", payload: abortPayload(runs[1]) })
    assert.equal(guestAbort.statusCode, 200, guestAbort.body)
    // 全员放弃、无人结算:房间在最后一人放弃后也照样解散。
    // (注:aborted 分支的 terminalRoomTransition 只 disbandRoom,不像 settled 分支那样先
    // delete room.five_boss_runtime——这是既有行为,不在本次改动范围,这里只断言真正生效的
    // 信号 getRoom() === undefined,不依赖那个不做保证的字段。)
    assert.equal(getRoom(room.room_number), undefined)
})


test("HTTP start ignores client boost flags instead of rejecting the run (2026-09-04 H400 regression)", async () => {
    const run = await createSoloRun()
    const payload = { ...startPayload(run), use_boss_boost_point: true, use_boost_point: true }
    const start = await app.inject({ method: "POST", url: "/start", payload })
    assert.equal(start.statusCode, 200, start.body)
    assert.equal(itemDomain.getPlayerItemSync(
        run.playerId,
        FIVE_BOSS_GAUNTLET.ticketItemId,
    ), 0)
    assert.equal(activeQuests[run.playerId]?.playId, run.playId)
    assert.equal(activeQuests[run.playerId]?.useBossBoostPoint, false)
    assert.equal(activeQuests[run.playerId]?.useBoostPoint, false)
    assert.equal(run.room.raising_state, 4)
})


test("HTTP finish resolves the room from the active quest when the client omits room_number (CN client never sends it)", async () => {
    const run = await createSoloRun()
    const start = await app.inject({ method: "POST", url: "/start", payload: startPayload(run) })
    assert.equal(start.statusCode, 200, start.body)
    completeBattleProof(run)

    // 高 rank 玩家:rank 号(250 档)不是 degree 表的键,结算响应必须回玩家持久化的 degreeId。
    playerDomain.updatePlayerSync({ id: run.playerId, rankPoint: 90_012_553 })

    const { room_number: _omitted, ...payloadWithoutRoom } = finishPayload(run)
    // 图纸 60%/诅咒武器每次掷骰 15% 都是概率掉,HTTP 路径没有 randomFloat 注入口:
    // 钉住 Math.random 让本条断言确定(0.1 同时落在两个概率之内,材料与武器都必定命中)。
    const originalRandom = Math.random
    Math.random = () => 0.1
    let finish
    try {
        finish = await app.inject({ method: "POST", url: "/finish", payload: payloadWithoutRoom })
    } finally {
        Math.random = originalRandom
    }
    assert.equal(finish.statusCode, 200, finish.body)
    const data = JSON.parse(finish.body).data
    assert.equal(data.user_info.degree_id, playerDomain.getPlayerSync(run.playerId)?.degreeId ?? 1)
    assert.notEqual(data.user_info.degree_id, 250)
    // 结算页展示走 additional_reward 组 590010000(材料):图纸(1)与深界结晶(2)必在,顺序与账本一致。
    const drops = data.drop_additional_reward_ids as Array<{ group_id: number, index: number, number: number }>
    const materialDrops = drops.filter(d => d.group_id === 590010000)
    assert.ok(materialDrops.length >= 2, JSON.stringify(drops))
    assert.ok(materialDrops.every(d => d.number > 0))
    // 夹具冻结的是 Auto=false ⇒ 2 倍结算,深界结晶 10×2。
    assert.deepEqual(materialDrops.slice(0, 2).map(d => [d.index, d.number]), [[1, 1], [2, 20]])
    assert.equal(data.item_list[String(FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal)], 20)
    // Math.random 钉在 0.1 < 15% 掉率,诅咒武器必定命中一把,走独立展示组 590010001。
    assert.ok(drops.some(d => d.group_id === 590010001 && d.number === 1), JSON.stringify(drops))
    assert.ok(Array.isArray(data.equipment_list) && data.equipment_list.length >= 1, JSON.stringify(data.equipment_list))
    // 结算页经验卡按队伍逐角色查 add_exp_list,缺条目就 C2620(真机 2026-09-04)。
    assert.equal(data.add_exp_list.length, 1)
    assert.equal(data.add_exp_list[0].character_id, 1)
    assert.ok(Object.prototype.hasOwnProperty.call(data.bond_token_status_list, "1"))
    // 结算后房间直接解散(随机选图种子=房号,复用房间会抽到同一套变体)。
    assert.equal(getRoom(run.room.room_number), undefined)
    assert.equal(activeQuests[run.playerId], undefined)
})


test("HTTP start abandons a stale five-boss run left by an unsettled previous room", async () => {
    const run = await createSoloRun(2)
    const first = await app.inject({ method: "POST", url: "/start", payload: startPayload(run) })
    assert.equal(first.statusCode, 200, first.body)
    // 客户端半路崩了:没有 finish/abort,房间随之解散,持久化 active quest 留在玩家身上。
    disbandRoom(run.room.room_number)

    const nextRoom = createRoom(
        run.viewerId,
        run.playerId,
        1,
        FIVE_BOSS_GAUNTLET.category,
        FIVE_BOSS_GAUNTLET.visibleQuestId,
        0,
        1,
    )
    nextRoom.raising_state = 4
    nextRoom.mates = [{ viewer_id: run.viewerId, com_id: 0, player_id: run.playerId }]
    nextRoom.five_boss_runtime = {
        runId: `http-run-stale-${identity}`,
        expectedRealPlayerIds: [run.playerId],
        autoplayModeByPlayerId: { [String(run.playerId)]: false },
        battleIdentityByConnectionId: {},
    }
    const nextPlayId = `${run.playId}-next`
    const second = await app.inject({
        method: "POST",
        url: "/start",
        payload: { ...startPayload(run), room_number: nextRoom.room_number, play_id: nextPlayId },
    })
    assert.equal(second.statusCode, 200, second.body)
    assert.equal(activeQuests[run.playerId]?.playId, nextPlayId)
    assert.equal(itemDomain.getPlayerItemSync(run.playerId, FIVE_BOSS_GAUNTLET.ticketItemId), 0)
})


test("HTTP finish backfills a missing finalize signal when level_next was recorded (battle channel dropped)", async () => {
    const run = await createSoloRun()
    const start = await app.inject({ method: "POST", url: "/start", payload: startPayload(run) })
    assert.equal(start.statusCode, 200, start.body)
    // 只有转场信号到了,Finalize 丢在已关闭的 TCP 战斗通道上(真机 2026-09-05 run 943026)。
    runDomain.recordMemberBattleSignalSync({
        runId: run.room.five_boss_runtime!.runId,
        playerId: run.playerId,
        roomNumber: run.room.room_number,
        signal: "level_next",
    })
    const finish = await app.inject({ method: "POST", url: "/finish", payload: finishPayload(run) })
    assert.equal(finish.statusCode, 200, finish.body)
    const data = JSON.parse(finish.body).data
    assert.equal(data.item_list[String(FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal)], 20)
    assert.equal(activeQuests[run.playerId], undefined)
})


test("HTTP finish is lenient (200, normal rewards) for a run that never reached the second scene", async () => {
    // 2026-09-28 设计稿第 6 节(a):仍在 R0 就被隔离(甚至从未送出过 level_next)、之后单机
    // 打完直接 finish——曾经拒成 400 白打 + 弹回登录,现改为按自身倍率正常结算。
    const run = await createSoloRun()
    const start = await app.inject({ method: "POST", url: "/start", payload: startPayload(run) })
    assert.equal(start.statusCode, 200, start.body)
    const finish = await app.inject({ method: "POST", url: "/finish", payload: finishPayload(run) })
    assert.equal(finish.statusCode, 200, finish.body)
    const data = JSON.parse(finish.body).data
    assert.equal(data.item_list[String(FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal)], 20)
    assert.equal(activeQuests[run.playerId], undefined)
    // 单人 roster 的这一次结算就是最后一人落定,房间随之解散。
    assert.equal(getRoom(run.room.room_number), undefined)
})


test("play_continue survives a server restart (memory table empty, persisted row present)", async () => {
    const run = await createSoloRun()
    const start = await app.inject({ method: "POST", url: "/start", payload: startPayload(run) })
    assert.equal(start.statusCode, 200)
    delete activeQuests[run.playerId]   // simulate a restart between start and the star-stone continue
    const cont = await app.inject({
        method: "POST",
        url: "/play_continue",
        payload: {
            viewer_id: run.viewerId,
            quest_id: FIVE_BOSS_GAUNTLET.visibleQuestId,
            category: FIVE_BOSS_GAUNTLET.category,
            room_number: run.room.room_number,
            play_id: startPayload(run).play_id,
            api_count: 1,
        },
    })
    assert.equal(cont.statusCode, 200, cont.body)
    assert.equal(JSON.parse(cont.body).data.continue_count, 1)
    assert.ok(activeQuests[run.playerId], "memory entry rebuilt from the persisted active quest")
    disbandRoom(run.room.room_number)
})
