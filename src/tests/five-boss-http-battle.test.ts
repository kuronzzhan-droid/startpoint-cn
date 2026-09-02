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
const { createRoom, disbandRoom } = require("../multi/room/manager") as typeof import("../multi/room/manager")
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

    const premature = await app.inject({
        method: "POST",
        url: "/finish",
        payload: finishPayload(run),
    })
    assert.equal(premature.statusCode, 400, premature.body)
    assert.equal(itemDomain.getPlayerItemSync(
        run.playerId,
        FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal,
    ), null)
    assert.equal(activeQuests[run.playerId]?.playId, run.playId)
    assert.equal(run.room.raising_state, 4)

    completeBattleProof(run)

    const finish = await app.inject({ method: "POST", url: "/finish", payload: finishPayload(run) })
    assert.equal(finish.statusCode, 200, finish.body)
    const data = JSON.parse(finish.body).data
    assert.equal(data.item_list[String(FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal)], 10)
    assert.equal(data.drop_score_reward_ids.length, 0)
    assert.equal(data.drop_rare_reward_ids.length, 0)
    assert.equal(run.room.raising_state, 1)
    assert.equal(run.room.five_boss_runtime, undefined)
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
    assert.equal(room.raising_state, 1)
    assert.equal(room.five_boss_runtime, undefined)
    disbandRoom(room.room_number)
})

