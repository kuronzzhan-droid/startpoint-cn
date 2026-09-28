import assert from "node:assert/strict"
import { after, test } from "node:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import Fastify from "fastify"

const databaseDir = mkdtempSync(path.join(tmpdir(), "wf-five-boss-solo-"))
process.env.WF_DATABASE_DIR = databaseDir

const accountDomain = require("../data/domains/account") as typeof import("../data/domains/account")
const playerDomain = require("../data/domains/player") as typeof import("../data/domains/player")
const itemDomain = require("../data/domains/item") as typeof import("../data/domains/item")
const sessionDomain = require("../data/domains/session") as typeof import("../data/domains/session")
const questDomain = require("../data/domains/quest") as typeof import("../data/domains/quest")
const { getDb } = require("../data/db") as typeof import("../data/db")
const singleBattleQuest = require("../routes/api/singleBattleQuest") as typeof import("../routes/api/singleBattleQuest")
const optionRoutes = require("../routes/api/option") as typeof import("../routes/api/option")
const optionDomain = require("../data/domains/option") as typeof import("../data/domains/option")
const { activeQuests } = singleBattleQuest
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
app.register(singleBattleQuest.default)
app.register(optionRoutes.default, { prefix: "/option" })
let identity = 0

async function createPlayer(ticketAmount = 0) {
    identity += 1
    const account = accountDomain.insertAccountSync({
        appId: `five-boss-solo-${identity}`,
        idpAlias: "test",
        idpCode: "test",
        idpId: `five-boss-solo-${identity}`,
        status: "active",
    })
    const playerId = playerDomain.insertDefaultPlayerSync(account.id).id
    const viewerId = 790_000_000 + identity
    await sessionDomain.insertSessionWithToken({
        token: String(viewerId),
        accountId: account.id,
        expires: new Date(),
        type: SessionType.VIEWER,
    })
    itemDomain.setPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET.ticketItemId, ticketAmount)
    // quest_entry_costs "2_1099001" needs 18 stamina; the default fresh-player
    // stamina (10) is not enough, so bump it directly like a real long-lived save would have.
    playerDomain.updatePlayerSync({ id: playerId, stamina: 999, staminaHealTime: new Date() })
    return { playerId, viewerId, playId: `solo-play-${identity}` }
}

function startPayload(player: Awaited<ReturnType<typeof createPlayer>>, overrides: Record<string, unknown> = {}) {
    return {
        viewer_id: player.viewerId,
        quest_id: FIVE_BOSS_GAUNTLET.visibleQuestId,
        category: FIVE_BOSS_GAUNTLET.category,
        party_id: 1,
        use_boost_point: false,
        use_boss_boost_point: false,
        // 「自动续战」开关,与倍率无关;倍率看 players_options.auto_play 的开战快照(solo-ledger)。
        is_auto_start_mode: false,
        play_id: player.playId,
        api_count: 1,
        ...overrides,
    }
}

function finishPayload(player: Awaited<ReturnType<typeof createPlayer>>, overrides: Record<string, unknown> = {}) {
    return {
        viewer_id: player.viewerId,
        quest_id: FIVE_BOSS_GAUNTLET.visibleQuestId,
        category: FIVE_BOSS_GAUNTLET.category,
        play_id: player.playId,
        is_accomplished: true,
        elapsed_time_ms: 12345,
        score: 777,
        add_mana: 0,
        statistics: {
            clear_phase: 0,
            party: {
                characters: [{ id: 1 }],
                unison_characters: [],
                equipments: [],
                ability_soul_ids: [],
            },
        },
        api_count: 2,
        ...overrides,
    }
}

/** Pins Math.random for the duration of fn so the 50%/25% blueprint & five-king-core
 *  reward rolls in buildFiveBossGauntletRewardPlan land deterministically. 0.9 clears both
 *  thresholds (<0.5 and <0.25), leaving only the unconditional deep-crystal/first-clear items. */
async function withPinnedRandom<T>(value: number, fn: () => Promise<T>): Promise<T> {
    const original = Math.random
    Math.random = () => value
    try {
        return await fn()
    } finally {
        Math.random = original
    }
}

after(async () => {
    await app.close()
    for (const playerId of Object.keys(activeQuests)) delete activeQuests[Number(playerId)]
    getDb().close()
    delete process.env.WF_DATABASE_DIR
    const resolved = path.resolve(databaseDir)
    const safeBase = path.resolve(tmpdir())
    assert.ok(resolved.startsWith(`${safeBase}${path.sep}`))
    assert.ok(path.basename(resolved).startsWith("wf-five-boss-solo-"))
    rmSync(resolved, { recursive: true, force: true })
})

test("solo start with the ticket deducts it and finish grants the 2x mode materials + a progress row", async () => {
    const player = await createPlayer(1)

    const start = await app.inject({ method: "POST", url: "/start", payload: startPayload(player) })
    assert.equal(start.statusCode, 200, start.body)
    assert.equal(itemDomain.getPlayerItemSync(player.playerId, FIVE_BOSS_GAUNTLET.ticketItemId), 0)
    assert.equal(activeQuests[player.playerId]?.playId, player.playId)
    assert.equal(activeQuests[player.playerId]?.entryItemId, FIVE_BOSS_GAUNTLET.ticketItemId)

    const finish = await withPinnedRandom(0.9, () =>
        app.inject({ method: "POST", url: "/finish", payload: finishPayload(player) }))
    assert.equal(finish.statusCode, 200, finish.body)
    const data = JSON.parse(finish.body).data

    // deep crystal: 2026-09-28 设计稿改为 10 * 2x solo multiplier (manual start)
    assert.equal(data.item_list[String(FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal)], 20)
    // first-clear emblem: fixed amount 1, only on first clear
    assert.equal(data.item_list[String(FIVE_BOSS_GAUNTLET_REWARD_IDS.firstClearEmblem)], 1)
    // five-king-core: 保底 1x倍率 = 2(0.9 错过 25% 加成roll)
    assert.equal(data.item_list[String(FIVE_BOSS_GAUNTLET_REWARD_IDS.fiveKingCore)], 2)

    const drops = data.drop_additional_reward_ids as Array<{ group_id: number, index: number, number: number }>
    const materialDrops = drops.filter(drop => drop.group_id === 590010000)
    assert.ok(materialDrops.some(drop => drop.index === 2 && drop.number === 20), JSON.stringify(drops))
    assert.ok(materialDrops.some(drop => drop.index === 3 && drop.number === 1), JSON.stringify(drops))
    assert.ok(materialDrops.some(drop => drop.index === 4 && drop.number === 2), JSON.stringify(drops))
    // 诅咒武器 5% 掉率,0.9 是稳定的 miss,这条不应产生 590010001 展示行。
    assert.ok(drops.every(drop => drop.group_id === 590010000), JSON.stringify(drops))

    const progress = questDomain.getPlayerSingleQuestProgressSync(
        player.playerId,
        FIVE_BOSS_GAUNTLET.category,
        FIVE_BOSS_GAUNTLET.visibleQuestId,
    )
    assert.equal(progress?.finished, true)

    assert.equal(activeQuests[player.playerId], undefined)
})

test("solo start with AUTO already on (players_options.auto_play) settles at 1x; the auto-repeat flag is irrelevant", async () => {
    const player = await createPlayer(1)
    optionDomain.updatePlayerOptionsSync(player.playerId, { auto_play: true })

    // is_auto_start_mode 是「自动续战」,不是 AUTO:这里故意送 false,倍率仍按 AUTO 快照给 1 倍。
    const start = await app.inject({
        method: "POST",
        url: "/start",
        payload: startPayload(player, { is_auto_start_mode: false }),
    })
    assert.equal(start.statusCode, 200, start.body)
    assert.equal(itemDomain.getPlayerItemSync(player.playerId, FIVE_BOSS_GAUNTLET.ticketItemId), 0)
    // 开局响应带门票新总数,客户端背包立刻刷新
    assert.equal(JSON.parse(start.body).data.item_list[String(FIVE_BOSS_GAUNTLET.ticketItemId)], 0)

    const finish = await withPinnedRandom(0.9, () =>
        app.inject({ method: "POST", url: "/finish", payload: finishPayload(player) }))
    assert.equal(finish.statusCode, 200, finish.body)
    const data = JSON.parse(finish.body).data
    // deep crystal: 2026-09-28 设计稿改为 10 * 1x (AUTO on at start), emblem still 1 on first clear
    assert.equal(data.item_list[String(FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal)], 10)
    assert.equal(data.item_list[String(FIVE_BOSS_GAUNTLET_REWARD_IDS.firstClearEmblem)], 1)
    const drops = data.drop_additional_reward_ids as Array<{ group_id: number, index: number, number: number }>
    assert.ok(drops.some(drop => drop.index === 2 && drop.number === 10), JSON.stringify(drops))
    assert.equal(activeQuests[player.playerId], undefined)
})

test("solo manual start that switches AUTO on mid-battle (option/update_in_battle) settles at 1x", async () => {
    const player = await createPlayer(1)
    assert.notEqual(optionDomain.getPlayerOptionsSync(player.playerId)["auto_play"], true)

    const start = await app.inject({ method: "POST", url: "/start", payload: startPayload(player) })
    assert.equal(start.statusCode, 200, start.body)

    // 单人没有客户端 AUTO 锁:进场再开 AUTO 会走 option/update_in_battle,服务端据此把本局记成 AUTO 局。
    const toggled = await app.inject({
        method: "POST",
        url: "/option/update_in_battle",
        payload: { viewer_id: player.viewerId, api_count: 2, option_params: { auto_play: true } },
    })
    assert.equal(toggled.statusCode, 200, toggled.body)

    const finish = await withPinnedRandom(0.9, () =>
        app.inject({ method: "POST", url: "/finish", payload: finishPayload(player) }))
    assert.equal(finish.statusCode, 200, finish.body)
    const data = JSON.parse(finish.body).data
    assert.equal(data.item_list[String(FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal)], 10)
    assert.equal(activeQuests[player.playerId], undefined)
})

test("an unrelated option update after a manual solo finish does not leak into the next run", async () => {
    const player = await createPlayer(2)
    const first = await app.inject({ method: "POST", url: "/start", payload: startPayload(player) })
    assert.equal(first.statusCode, 200, first.body)
    const firstFinish = await withPinnedRandom(0.9, () =>
        app.inject({ method: "POST", url: "/finish", payload: finishPayload(player) }))
    assert.equal(firstFinish.statusCode, 200, firstFinish.body)
    // 2026-09-28 设计稿:结晶 10×倍率(手动 2 倍)。
    assert.equal(JSON.parse(firstFinish.body).data.item_list[String(FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal)], 20)

    // AUTO 在两局之间开了又关:第二局开局快照是关,且没有在途行可被污染。
    optionDomain.updatePlayerOptionsSync(player.playerId, { auto_play: true })
    optionDomain.updatePlayerOptionsSync(player.playerId, { auto_play: false })
    const second = await app.inject({
        method: "POST",
        url: "/start",
        payload: startPayload(player, { play_id: `${player.playId}-second` }),
    })
    assert.equal(second.statusCode, 200, second.body)
    const secondFinish = await withPinnedRandom(0.9, () =>
        app.inject({ method: "POST", url: "/finish", payload: finishPayload(player, { play_id: `${player.playId}-second` }) }))
    assert.equal(secondFinish.statusCode, 200, secondFinish.body)
    // item_list 是发放后的持有总数(非本次增量):第一局 20 + 第二局再 20 = 40。
    assert.equal(JSON.parse(secondFinish.body).data.item_list[String(FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal)], 40)
})

test("solo start without the ticket still returns 200 and finish grants no mode materials or progress row", async () => {
    const player = await createPlayer(0)
    assert.equal(itemDomain.getPlayerItemSync(player.playerId, FIVE_BOSS_GAUNTLET.ticketItemId), 0)
    const before = playerDomain.getPlayerSync(player.playerId)!

    const start = await app.inject({ method: "POST", url: "/start", payload: startPayload(player) })
    assert.equal(start.statusCode, 200, start.body)
    assert.equal(itemDomain.getPlayerItemSync(player.playerId, FIVE_BOSS_GAUNTLET.ticketItemId), 0)
    assert.equal(activeQuests[player.playerId]?.playId, player.playId)
    assert.equal(activeQuests[player.playerId]?.entryItemId, undefined)

    const finish = await withPinnedRandom(0.9, () =>
        app.inject({ method: "POST", url: "/finish", payload: finishPayload(player) }))
    assert.equal(finish.statusCode, 200, finish.body)
    const data = JSON.parse(finish.body).data

    assert.equal(itemDomain.getPlayerItemSync(player.playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal), null)
    assert.equal(itemDomain.getPlayerItemSync(player.playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.firstClearEmblem), null)
    assert.equal(data.item_list[String(FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal)], undefined)
    assert.deepEqual(data.drop_additional_reward_ids, [])
    // 无票局连关卡基础奖励也不给:魔那 / 池经验 / rank / score reward 组 10054 / 角色经验全部为 0。
    assert.deepEqual(data.drop_score_reward_ids, [])
    assert.deepEqual(data.drop_rare_reward_ids, [])
    assert.deepEqual(data.equipment_list, [])
    assert.equal(data.rewards.reward_mana, 0)
    assert.equal(data.rewards.reward_pool_exp, 0)
    assert.equal(data.user_info.rank_point, before.rankPoint)
    assert.equal(data.user_info.free_mana, before.freeMana)
    const after = playerDomain.getPlayerSync(player.playerId)!
    assert.equal(after.rankPoint, before.rankPoint)
    assert.equal(after.freeMana, before.freeMana)
    assert.equal(after.expPool, before.expPool)

    assert.equal(questDomain.getPlayerSingleQuestProgressSync(
        player.playerId,
        FIVE_BOSS_GAUNTLET.category,
        FIVE_BOSS_GAUNTLET.visibleQuestId,
    ), null)

    assert.equal(activeQuests[player.playerId], undefined)
})

// Case 3 from the task brief (a non-five-boss quest with an item entry cost should still 400
// when the item is missing) is skipped: assets/quest_entry_costs.json only has itemId>0 for
// the three five-boss quest keys (2_1099001/1099002/1099003) -- there is no other quest key in
// that table to exercise the "hard 400" branch through the same configuredEntryCost path.
// (A handful of advent-event quests carry a startableItemIds item cost of their own via
// resolveBattleStartEntryCost's questData fallback, e.g. "200013009"/40314, but those all also
// carry a viewableNeedQuest prerequisite that start-handler checks first, so covering that case
// would require also faking prerequisite quest-progress rows unrelated to this ticket rule.)
