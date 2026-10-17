// Shop, item and equipment routes must validate balances against the state
// they commit, and must treat equivalent ids in one request as the same id.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const tempRoot = path.resolve(os.tmpdir())
const isolated = fs.mkdtempSync(path.join(tempRoot, "starpoint-economy-consistency-"))
process.env.DATA_DIR = isolated

const Fastify = require("fastify")
const shopRoutes = require("../out/routes/api/shop").default
const itemRoutes = require("../out/routes/api/item").default
const equipmentRoutes = require("../out/routes/api/equipment").default
const sellRoutes = require("../out/routes/api/sell").default
const { insertAccountSync } = require("../out/data/domains/account")
const { insertDefaultPlayerSync, getPlayerSync, updatePlayerSync } = require("../out/data/domains/player")
const { getPlayerItemSync, givePlayerItemSync, setPlayerItemSync } = require("../out/data/domains/item")
const { insertPlayerEquipmentSync, getPlayerEquipmentSync } = require("../out/data/domains/equipment")
const { getPlayerShopPurchaseCountSync } = require("../out/data/domains/shopPurchase")
const { getShopPurchaseKey } = require("../out/lib/shop-sales")
const { insertSessionWithToken } = require("../out/data/domains/session")
const { saveAccountDefaultPlayer } = require("../out/data/activeAccount")
const { calculateDissolveRewards } = require("../out/lib/equipment-dissolve")
const { getConfigSync, getEquipmentCraftSync } = require("../out/lib/assets")
const { getDb } = require("../out/data/db")

const TREASURE_SHOP = 2
const TREASURE_ITEM = 200031 // 200 mana, stock-limited
const STAMINA_ITEM = 101
const EQUIPMENT = 5010004 // max awakening level 5
const SELLABLE_ITEM = 2
const craftItemId = () => getConfigSync().craft_point_item_id || 100000

let nextViewer = 66120000
async function createPlayer(fields = {}) {
    const account = insertAccountSync({ appId: "wf_cn", idpAlias: "", idpCode: "leiting", idpId: "", status: "normal" })
    const player = insertDefaultPlayerSync(account.id)
    saveAccountDefaultPlayer(account.id, player.id)
    updatePlayerSync({ id: player.id, ...fields })
    const viewerId = nextViewer++
    await insertSessionWithToken({
        token: String(viewerId), accountId: account.id, expires: new Date(Date.now() + 86_400_000), type: 2,
    })
    return { playerId: player.id, viewerId }
}

function giveEquipment(playerId, stack, level = 1) {
    insertPlayerEquipmentSync(playerId, EQUIPMENT, { level, enhancementLevel: 0, protection: false, stack })
}

test("economy routes stay consistent under duplicates and concurrency", async t => {
    const app = Fastify({ logger: false })
    app.addHook("onSend", (_request, reply, payload, done) => done(null,
        String(reply.getHeader("content-type") || "").startsWith("application/x-msgpack") && typeof payload === "object"
            ? JSON.stringify(payload) : payload))
    await app.register(shopRoutes, { prefix: "/shop" })
    await app.register(itemRoutes, { prefix: "/item" })
    await app.register(equipmentRoutes, { prefix: "/equipment" })
    await app.register(sellRoutes, { prefix: "/equipment" })
    await app.ready()
    t.after(async () => {
        await app.close(); getDb().close()
        const target = path.resolve(isolated)
        assert.ok(target.startsWith(tempRoot + path.sep) && target !== tempRoot)
        fs.rmSync(target, { recursive: true, force: true })
    })
    const post = (url, payload) => app.inject({
        method: "POST", url, headers: { "content-type": "application/json" }, payload,
    })
    const parallel = (count, makeRequest) => Promise.all(Array.from({ length: count }, makeRequest))

    await t.test("character purchases reject excessive quantities before expanding rewards", async () => {
        const { playerId, viewerId } = await createPlayer()
        const before = getPlayerSync(playerId)
        const response = await post("/shop/buy", {
            viewer_id: viewerId, api_count: 1,
            shop_type: require("../out/lib/types").ShopType.STAR_GRAIN,
            shop_item_id: 100000, number: Number.MAX_SAFE_INTEGER,
        })
        assert.equal(response.statusCode, 400, response.payload)
        assert.match(response.json().message, /stock|purchase limit/i)
        const after = getPlayerSync(playerId)
        assert.equal(after.freeMana, before.freeMana)
        assert.equal(after.freeVmoney, before.freeVmoney)
        assert.equal(getPlayerShopPurchaseCountSync(playerId,
            getShopPurchaseKey(require("../out/lib/types").ShopType.STAR_GRAIN, 100000)), 0)
    })

    await t.test("concurrent purchases cannot spend the same mana twice", async () => {
        const { playerId, viewerId } = await createPlayer({ freeMana: 1000, paidMana: 0 })
        const results = await parallel(10, () => post("/shop/buy", {
            viewer_id: viewerId, api_count: 1, shop_type: TREASURE_SHOP, shop_item_id: TREASURE_ITEM, number: 1,
        }))
        const ok = results.filter(r => r.statusCode === 200)
        assert.equal(ok.length, 5)
        for (const r of results.filter(r => r.statusCode !== 200)) {
            assert.equal(r.statusCode, 400)
            assert.equal(r.json().message, "Not enough mana to purchase shop item.")
        }
        const player = getPlayerSync(playerId)
        assert.equal(player.freeMana + player.paidMana, 0)
        assert.equal(getPlayerShopPurchaseCountSync(playerId, getShopPurchaseKey(TREASURE_SHOP, TREASURE_ITEM)), 5)
    })

    await t.test("concurrent stamina recovery charges once per recovery", async () => {
        const { playerId, viewerId } = await createPlayer({ freeVmoney: 1000, vmoney: 0, stamina: 0, staminaHealTime: new Date() })
        const config = getConfigSync()
        const results = await parallel(5, () => post("/shop/recover_stamina", { viewer_id: viewerId, api_count: 1 }))
        const recovered = results.filter(r => r.statusCode === 200 && r.json().data.user_info !== undefined).length
        assert.equal(recovered, 5)
        assert.equal(getPlayerSync(playerId).freeVmoney, 1000 - 5 * config.stamina_recovery_virtual_money)
    })

    await t.test("bulk purchase merges equivalent product keys before stock limits", async () => {
        const { playerId, viewerId } = await createPlayer({ freeMana: 100_000, paidMana: 0 })
        const res = await post("/shop/bulk_buy", {
            viewer_id: viewerId, api_count: 1, shop_type: TREASURE_SHOP,
            buy_item_list: { [String(TREASURE_ITEM)]: 30, [`0${TREASURE_ITEM}`]: 30 },
        })
        assert.equal(res.statusCode, 200, res.payload)
        const count = getPlayerShopPurchaseCountSync(playerId, getShopPurchaseKey(TREASURE_SHOP, TREASURE_ITEM))
        assert.equal(count, 30)
        assert.equal(getPlayerSync(playerId).freeMana, 100_000 - 30 * 200)
    })

    await t.test("concurrent bulk purchases respect stock limits", async () => {
        const { playerId, viewerId } = await createPlayer({ freeMana: 100_000, paidMana: 0 })
        const results = await parallel(4, () => post("/shop/bulk_buy", {
            viewer_id: viewerId, api_count: 1, shop_type: TREASURE_SHOP,
            buy_item_list: { [String(TREASURE_ITEM)]: 20 },
        }))
        assert.ok(results.every(r => r.statusCode === 200))
        const count = getPlayerShopPurchaseCountSync(playerId, getShopPurchaseKey(TREASURE_SHOP, TREASURE_ITEM))
        assert.equal(count, 30)
        assert.equal(getPlayerSync(playerId).freeMana, 100_000 - 30 * 200)
    })

    await t.test("repeated item entries are checked against the combined amount", async () => {
        const { playerId, viewerId } = await createPlayer({ stamina: 0, staminaHealTime: new Date() })
        givePlayerItemSync(playerId, STAMINA_ITEM, 1)
        const one = { id: STAMINA_ITEM, number: 1, selectIndex: 0 }
        const res = await post("/item/use_item", { viewer_id: viewerId, api_count: 1, items: [one, one, one, one] })
        assert.equal(res.statusCode, 400)
        assert.equal(res.json().message, "Insufficient items.")
        assert.equal(getPlayerItemSync(playerId, STAMINA_ITEM), 1)
        assert.equal(getPlayerSync(playerId).stamina, 0)

        const results = await parallel(4, () => post("/item/use_item", { viewer_id: viewerId, api_count: 1, items: [one] }))
        assert.equal(results.filter(r => r.statusCode === 200).length, 1)
        assert.equal(getPlayerItemSync(playerId, STAMINA_ITEM), 0)
        assert.equal(getPlayerSync(playerId).stamina, 25)
    })

    await t.test("selling items concurrently cannot sell more than owned", async () => {
        const { playerId, viewerId } = await createPlayer({ freeMana: 0 })
        givePlayerItemSync(playerId, SELLABLE_ITEM, 3)
        const results = await parallel(6, () => post("/item/sell", {
            viewer_id: viewerId, api_count: 1, item_id: SELLABLE_ITEM, sell_number: 1,
        }))
        assert.equal(results.filter(r => r.statusCode === 200).length, 3)
        assert.equal(getPlayerItemSync(playerId, SELLABLE_ITEM), 0)
        assert.equal(getPlayerSync(playerId).freeMana, 3 * 25)
    })

    await t.test("selling equipment ignores duplicate ids in one request", async () => {
        const { playerId, viewerId } = await createPlayer()
        giveEquipment(playerId, 2)
        const craftBefore = getPlayerItemSync(playerId, craftItemId()) ?? 0
        const res = await post("/equipment/sell_equipment", {
            viewer_id: viewerId, api_count: 1,
            equipment_list: [{ equipment_id: EQUIPMENT }, { equipment_id: EQUIPMENT }, { equipment_id: String(EQUIPMENT) }],
        })
        assert.equal(res.statusCode, 200, res.payload)
        assert.equal(getPlayerItemSync(playerId, craftItemId()) - craftBefore, calculateDissolveRewards(EQUIPMENT, 1).craftPoints)
        assert.equal(getPlayerEquipmentSync(playerId, EQUIPMENT).stack, 0)
    })

    await t.test("bulk dismantle treats numeric and string ids as one equipment", async () => {
        const { playerId, viewerId } = await createPlayer()
        giveEquipment(playerId, 3)
        const craftBefore = getPlayerItemSync(playerId, craftItemId()) ?? 0
        const res = await post("/equipment/bulk_sell_stack", {
            viewer_id: viewerId, api_count: 1, equipment_ids: [EQUIPMENT, String(EQUIPMENT)],
        })
        assert.equal(res.statusCode, 200, res.payload)
        assert.equal(getPlayerItemSync(playerId, craftItemId()) - craftBefore, calculateDissolveRewards(EQUIPMENT, 3).craftPoints)
        assert.equal(getPlayerEquipmentSync(playerId, EQUIPMENT).stack, 0)

        const invalid = await post("/equipment/bulk_sell_stack", {
            viewer_id: viewerId, api_count: 1, equipment_ids: [EQUIPMENT, "abc"],
        })
        assert.equal(invalid.statusCode, 400)
    })

    await t.test("partial stack sale aggregates equivalent ids and rejects bad counts", async () => {
        const { playerId, viewerId } = await createPlayer()
        giveEquipment(playerId, 3)
        const over = await post("/equipment/sell_stack", {
            viewer_id: viewerId, api_count: 1,
            equipment_list: [{ equipment_id: EQUIPMENT, number: 2 }, { equipment_id: String(EQUIPMENT), number: 2 }],
        })
        assert.equal(over.statusCode, 400)
        assert.equal(over.json().message, "Attempt to sell more stacks than owned.")
        assert.equal(getPlayerEquipmentSync(playerId, EQUIPMENT).stack, 3)

        for (const number of [0, 1.5, -1, "x"]) {
            const res = await post("/equipment/sell_stack", {
                viewer_id: viewerId, api_count: 1, equipment_list: [{ equipment_id: EQUIPMENT, number }],
            })
            assert.equal(res.statusCode, 400, `number=${number}`)
        }
        assert.equal(getPlayerEquipmentSync(playerId, EQUIPMENT).stack, 3)

        const results = await parallel(5, () => post("/equipment/sell_stack", {
            viewer_id: viewerId, api_count: 1, equipment_list: [{ equipment_id: EQUIPMENT, number: 1 }],
        }))
        assert.equal(results.filter(r => r.statusCode === 200).length, 3)
        assert.equal(getPlayerEquipmentSync(playerId, EQUIPMENT).stack, 0)
    })

    await t.test("awakening validates counts and spends wrightpieces once", async () => {
        const cost = getEquipmentCraftSync(Math.floor(EQUIPMENT / 1000000))?.awakening_craft ?? 25
        const { playerId, viewerId } = await createPlayer()
        giveEquipment(playerId, 4)
        setPlayerItemSync(playerId, craftItemId(), cost * 4)

        for (const upgrade_count of [0, 1.5, "x", -2]) {
            const res = await post("/equipment/upgrade", {
                viewer_id: viewerId, api_count: 1, use_stack: true, upgrade_count, equipment_id: EQUIPMENT,
            })
            assert.equal(res.statusCode, 400, `upgrade_count=${upgrade_count}`)
        }
        assert.deepEqual(
            { level: getPlayerEquipmentSync(playerId, EQUIPMENT).level, stack: getPlayerEquipmentSync(playerId, EQUIPMENT).stack },
            { level: 1, stack: 4 },
        )

        // Enough wrightpieces for two single awakenings; four run concurrently.
        setPlayerItemSync(playerId, craftItemId(), cost * 2)
        const results = await parallel(4, () => post("/equipment/upgrade", {
            viewer_id: viewerId, api_count: 1, use_stack: true, upgrade_count: 1, equipment_id: EQUIPMENT,
        }))
        assert.equal(results.filter(r => r.statusCode === 200).length, 2)
        assert.equal(getPlayerItemSync(playerId, craftItemId()), 0)
        const equipment = getPlayerEquipmentSync(playerId, EQUIPMENT)
        assert.equal(equipment.level, 3)
        assert.equal(equipment.stack, 2)
    })

    await t.test("bulk awakening dedupes ids and checks the shared balance", async () => {
        const cost = getEquipmentCraftSync(Math.floor(EQUIPMENT / 1000000))?.awakening_craft ?? 25
        const { playerId, viewerId } = await createPlayer()
        giveEquipment(playerId, 4)
        setPlayerItemSync(playerId, craftItemId(), cost * 4)
        const results = await parallel(3, () => post("/equipment/bulk_upgrade", {
            viewer_id: viewerId, api_count: 1, equipment_ids: [EQUIPMENT, String(EQUIPMENT)],
        }))
        assert.ok(results.every(r => r.statusCode === 200), results.map(r => r.payload).join("\n"))
        const equipment = getPlayerEquipmentSync(playerId, EQUIPMENT)
        assert.equal(equipment.level, 5)
        assert.equal(equipment.stack, 0)
        assert.equal(getPlayerItemSync(playerId, craftItemId()), 0)

        const invalid = await post("/equipment/bulk_upgrade", {
            viewer_id: viewerId, api_count: 1, equipment_ids: [1.5],
        })
        assert.equal(invalid.statusCode, 400)
    })
})
