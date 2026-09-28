import assert from "node:assert/strict"
import { after, test } from "node:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import Fastify from "fastify"

// POST /equipment/upgrade 觉醒道具白名单端到端:诅咒武器/PARADOX 只收禁忌星铁(每级 1 个 + 锻造石 25),
// 星铁钢被拒且不改任何数据;官方装备仍按稀有度收 12001/12002;重复本体路径不变。
const databaseDir = mkdtempSync(path.join(tmpdir(), "wf-equipment-upgrade-"))
process.env.WF_DATABASE_DIR = databaseDir

const accountDomain = require("../data/domains/account") as typeof import("../data/domains/account")
const playerDomain = require("../data/domains/player") as typeof import("../data/domains/player")
const itemDomain = require("../data/domains/item") as typeof import("../data/domains/item")
const equipmentDomain = require("../data/domains/equipment") as typeof import("../data/domains/equipment")
const sessionDomain = require("../data/domains/session") as typeof import("../data/domains/session")
const { getDb } = require("../data/db") as typeof import("../data/db")
const equipmentRoutes = require("../routes/api/equipment") as typeof import("../routes/api/equipment")
const { SessionType } = require("../data/types") as typeof import("../data/types")

const FORBIDDEN_STAR_STEEL = 10_000_311
const CRYSTAL_4 = 12_001
const CRYSTAL_5 = 12_002
const WRIGHTPIECE = 100_000
const CURSED_KNIFE = 5_910_101
const CURSED_MASK = 5_910_129
const PARADOX = 5_920_001
const OFFICIAL_5 = 5_010_004
const OFFICIAL_4 = 4_010_003
const ABYSS_5 = 8_000_101

const app = Fastify()
app.addHook("onSend", (_request, reply, payload, done) => {
    if (reply.getHeader("content-type") === "application/x-msgpack") {
        done(null, JSON.stringify(payload))
        return
    }
    done(null, payload)
})
app.register(equipmentRoutes.default, { prefix: "/equipment" })

after(async () => {
    await app.close()
    getDb().close()
    rmSync(databaseDir, { recursive: true, force: true })
})

let identity = 0

async function createPlayer(equipment: Record<number, { level: number, stack: number }>, items: Record<number, number>) {
    identity += 1
    const account = accountDomain.insertAccountSync({
        appId: `equipment-upgrade-${identity}`,
        idpAlias: "test",
        idpCode: "test",
        idpId: `equipment-upgrade-${identity}`,
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
    for (const [id, { level, stack }] of Object.entries(equipment)) {
        equipmentDomain.insertPlayerEquipmentSync(playerId, id, { level, stack, enhancementLevel: 0, protection: false })
    }
    for (const [id, amount] of Object.entries(items)) itemDomain.setPlayerItemSync(playerId, id, amount)
    return { playerId, viewerId }
}

function upgrade(viewerId: number, body: Record<string, unknown>) {
    return app.inject({
        method: "POST",
        url: "/equipment/upgrade",
        payload: { viewer_id: viewerId, api_count: 1, upgrade_count: 1, ...body },
    })
}

function snapshot(playerId: number, equipmentIds: number[], itemIds: number[]) {
    return {
        equipment: Object.fromEntries(equipmentIds.map(id => {
            const row = equipmentDomain.getPlayerEquipmentSync(playerId, id)
            return [id, row && { level: row.level, stack: row.stack }]
        })),
        items: Object.fromEntries(itemIds.map(id => [id, itemDomain.getPlayerItemSync(playerId, id)])),
    }
}

const ITEMS = [FORBIDDEN_STAR_STEEL, CRYSTAL_4, CRYSTAL_5, WRIGHTPIECE]

test("cursed weapon awakens with 禁忌星铁: 1 per level plus the 25 wrightpiece fee", async () => {
    const { playerId, viewerId } = await createPlayer(
        { [CURSED_KNIFE]: { level: 1, stack: 0 } },
        { [FORBIDDEN_STAR_STEEL]: 4, [CRYSTAL_5]: 10, [WRIGHTPIECE]: 1000 },
    )

    const one = await upgrade(viewerId, { equipment_id: CURSED_KNIFE, use_stack: false, item_id: FORBIDDEN_STAR_STEEL })
    assert.equal(one.statusCode, 200, one.body)
    const oneBody = JSON.parse(one.body)
    assert.equal(oneBody.data.item_list[FORBIDDEN_STAR_STEEL], 3)
    assert.equal(oneBody.data.item_list[WRIGHTPIECE], 975)
    assert.deepEqual(snapshot(playerId, [CURSED_KNIFE], ITEMS), {
        equipment: { [CURSED_KNIFE]: { level: 2, stack: 0 } },
        items: { [FORBIDDEN_STAR_STEEL]: 3, [CRYSTAL_4]: null, [CRYSTAL_5]: 10, [WRIGHTPIECE]: 975 },
    })

    const three = await upgrade(viewerId, {
        equipment_id: CURSED_KNIFE, use_stack: false, item_id: FORBIDDEN_STAR_STEEL, upgrade_count: 3,
    })
    assert.equal(three.statusCode, 200, three.body)
    assert.deepEqual(snapshot(playerId, [CURSED_KNIFE], ITEMS), {
        equipment: { [CURSED_KNIFE]: { level: 5, stack: 0 } },
        items: { [FORBIDDEN_STAR_STEEL]: 0, [CRYSTAL_4]: null, [CRYSTAL_5]: 10, [WRIGHTPIECE]: 900 },
    })
})

test("cursed weapon and PARADOX refuse 星铁钢 and change nothing", async () => {
    const { playerId, viewerId } = await createPlayer(
        { [CURSED_MASK]: { level: 1, stack: 0 }, [PARADOX]: { level: 1, stack: 0 } },
        { [FORBIDDEN_STAR_STEEL]: 1, [CRYSTAL_4]: 10, [CRYSTAL_5]: 10, [WRIGHTPIECE]: 1000 },
    )
    const before = snapshot(playerId, [CURSED_MASK, PARADOX], ITEMS)

    for (const equipmentId of [CURSED_MASK, PARADOX]) {
        for (const itemId of [CRYSTAL_5, CRYSTAL_4, WRIGHTPIECE, undefined]) {
            const response = await upgrade(viewerId, { equipment_id: equipmentId, use_stack: false, item_id: itemId })
            assert.equal(response.statusCode, 400, `${equipmentId} + ${itemId}`)
        }
    }
    assert.deepEqual(snapshot(playerId, [CURSED_MASK, PARADOX], ITEMS), before)

    const paradox = await upgrade(viewerId, { equipment_id: PARADOX, use_stack: false, item_id: FORBIDDEN_STAR_STEEL })
    assert.equal(paradox.statusCode, 200, paradox.body)
    assert.deepEqual(snapshot(playerId, [PARADOX], [FORBIDDEN_STAR_STEEL, WRIGHTPIECE]), {
        equipment: { [PARADOX]: { level: 2, stack: 0 } },
        items: { [FORBIDDEN_STAR_STEEL]: 0, [WRIGHTPIECE]: 975 },
    })
})

test("official equipment keeps its rarity crystal and refuses 禁忌星铁", async () => {
    const { playerId, viewerId } = await createPlayer(
        {
            [OFFICIAL_5]: { level: 1, stack: 0 },
            [OFFICIAL_4]: { level: 1, stack: 0 },
            [ABYSS_5]: { level: 1, stack: 0 },
        },
        { [FORBIDDEN_STAR_STEEL]: 5, [CRYSTAL_4]: 10, [CRYSTAL_5]: 10, [WRIGHTPIECE]: 1000 },
    )
    const all = [OFFICIAL_5, OFFICIAL_4, ABYSS_5]

    for (const [equipmentId, wrong] of [
        [OFFICIAL_5, FORBIDDEN_STAR_STEEL], [OFFICIAL_5, CRYSTAL_4],
        [OFFICIAL_4, FORBIDDEN_STAR_STEEL], [OFFICIAL_4, CRYSTAL_5],
        [ABYSS_5, FORBIDDEN_STAR_STEEL], [ABYSS_5, CRYSTAL_4],
    ]) {
        const response = await upgrade(viewerId, { equipment_id: equipmentId, use_stack: false, item_id: wrong })
        assert.equal(response.statusCode, 400, `${equipmentId} + ${wrong}`)
    }
    assert.deepEqual(snapshot(playerId, all, ITEMS).items,
        { [FORBIDDEN_STAR_STEEL]: 5, [CRYSTAL_4]: 10, [CRYSTAL_5]: 10, [WRIGHTPIECE]: 1000 })

    for (const [equipmentId, crystal] of [[OFFICIAL_5, CRYSTAL_5], [OFFICIAL_4, CRYSTAL_4], [ABYSS_5, CRYSTAL_5]]) {
        const response = await upgrade(viewerId, { equipment_id: equipmentId, use_stack: false, item_id: crystal })
        assert.equal(response.statusCode, 200, `${equipmentId} + ${crystal}: ${response.body}`)
    }
    const final = snapshot(playerId, all, ITEMS)
    assert.deepEqual(final.equipment, {
        [OFFICIAL_5]: { level: 2, stack: 0 },
        [OFFICIAL_4]: { level: 2, stack: 0 },
        [ABYSS_5]: { level: 2, stack: 0 },
    })
    // 25 (★5) + 20 (★4) + 25 (abyss: id prefix 8 clamps to ★5 fee) wrightpieces, fee rule unchanged.
    assert.deepEqual(final.items, { [FORBIDDEN_STAR_STEEL]: 5, [CRYSTAL_4]: 9, [CRYSTAL_5]: 8, [WRIGHTPIECE]: 930 })
})

test("duplicates still awaken restricted weapons without touching items", async () => {
    const { playerId, viewerId } = await createPlayer(
        { [CURSED_KNIFE]: { level: 1, stack: 2 } },
        { [FORBIDDEN_STAR_STEEL]: 1, [CRYSTAL_5]: 10, [WRIGHTPIECE]: 1000 },
    )
    const response = await upgrade(viewerId, {
        equipment_id: CURSED_KNIFE, use_stack: true, item_id: CRYSTAL_5, upgrade_count: 2,
    })
    assert.equal(response.statusCode, 200, response.body)
    assert.deepEqual(snapshot(playerId, [CURSED_KNIFE], ITEMS), {
        equipment: { [CURSED_KNIFE]: { level: 3, stack: 0 } },
        items: { [FORBIDDEN_STAR_STEEL]: 1, [CRYSTAL_4]: null, [CRYSTAL_5]: 10, [WRIGHTPIECE]: 950 },
    })

    const bulkPlayer = await createPlayer({ [PARADOX]: { level: 2, stack: 5 } }, { [WRIGHTPIECE]: 1000 })
    const bulk = await app.inject({
        method: "POST",
        url: "/equipment/bulk_upgrade",
        payload: { viewer_id: bulkPlayer.viewerId, api_count: 1, equipment_ids: [PARADOX] },
    })
    assert.equal(bulk.statusCode, 200, bulk.body)
    assert.deepEqual(snapshot(bulkPlayer.playerId, [PARADOX], [WRIGHTPIECE]), {
        equipment: { [PARADOX]: { level: 5, stack: 2 } },
        items: { [WRIGHTPIECE]: 925 },
    })
})

test("not enough 禁忌星铁 is refused before anything is spent", async () => {
    const { playerId, viewerId } = await createPlayer(
        { [CURSED_KNIFE]: { level: 1, stack: 0 } },
        { [FORBIDDEN_STAR_STEEL]: 1, [CRYSTAL_5]: 10, [WRIGHTPIECE]: 1000 },
    )
    const response = await upgrade(viewerId, {
        equipment_id: CURSED_KNIFE, use_stack: false, item_id: FORBIDDEN_STAR_STEEL, upgrade_count: 2,
    })
    assert.equal(response.statusCode, 400)
    assert.deepEqual(snapshot(playerId, [CURSED_KNIFE], ITEMS), {
        equipment: { [CURSED_KNIFE]: { level: 1, stack: 0 } },
        items: { [FORBIDDEN_STAR_STEEL]: 1, [CRYSTAL_4]: null, [CRYSTAL_5]: 10, [WRIGHTPIECE]: 1000 },
    })
})
