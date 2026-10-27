const test = require("node:test")
const assert = require("node:assert/strict")
require("ts-node/register/transpile-only")

const { serverItemIds } = require("../src/lib/content-master")
const sale = require("../assets/item_sale.json")
const names = require("../assets/item_lookup_cnmod.json")
const { UNKNOWN_RIVEN_ITEM_ID, FIRST_RIVEN_ITEM_ID, LAST_RIVEN_ITEM_ID, LAST_RESERVED_RIVEN_ITEM_ID, MAX_WEAPON_RIVENS, isWeaponRivenItemId } = require("../src/lib/weapon-riven/constants")
const FRAGMENT_ITEM_ID = 16000900
const FRAGMENT_SHOP_ID = 990099035

test("unknown riven and all 200 instance slots are valid non-saleable soul resources", () => {
    assert.equal(MAX_WEAPON_RIVENS, 20)
    assert.equal(LAST_RIVEN_ITEM_ID - FIRST_RIVEN_ITEM_ID + 1, 200)
    for (let id = UNKNOWN_RIVEN_ITEM_ID; id <= LAST_RIVEN_ITEM_ID; id++) {
        assert.ok(serverItemIds.includes(id), `missing valid item ${id}`)
        assert.deepEqual(sale[String(id)], { category: 5, sale_price: 0, sellable: false })
        assert.equal(names[String(id)], id === UNKNOWN_RIVEN_ITEM_ID ? "未知裂罅" : "武器裂罅")
    }
    // 16000000, 200 instance slots, fragment 16000900, themed unknown 16000901/16000902 (round 2)
    // and 16000903-16000905, 16000907-16000918 (round 3; 16000906 refused, empty pool).
    assert.equal(serverItemIds.filter(id => id >= UNKNOWN_RIVEN_ITEM_ID && id <= 16000999).length, 219)
    assert.equal(serverItemIds.includes(16000906), false)
    for (const [id, name] of [[16000901, "精灵兽裂罅"], [16000902, "深渊裂罅"], [16000903, "幻想裂罅"], [16000904, "诅咒裂罅"],
        [16000905, "领主裂罅"], [16000907, "星光裂罅"], [16000908, "星尘裂罅"], [16000909, "星辉·剑裂罅"], [16000918, "星辉·铳裂罅"]]) {
        assert.ok(serverItemIds.includes(id))
        assert.deepEqual(sale[String(id)], { category: 5, sale_price: 0, sellable: false })
        assert.equal(names[String(id)], name)
    }
    assert.equal(sale[16000201], undefined)
})

test("instance recognition includes reserved expansion IDs but excludes ordinary items and invalid values", () => {
    assert.equal(isWeaponRivenItemId(FIRST_RIVEN_ITEM_ID), true)
    assert.equal(isWeaponRivenItemId(LAST_RIVEN_ITEM_ID), true)
    assert.equal(isWeaponRivenItemId(LAST_RIVEN_ITEM_ID + 1), true)
    assert.equal(isWeaponRivenItemId(LAST_RESERVED_RIVEN_ITEM_ID), true)
    for (const id of [UNKNOWN_RIVEN_ITEM_ID, FRAGMENT_ITEM_ID, 16000901, 16000902, 16000919, LAST_RESERVED_RIVEN_ITEM_ID + 1, FIRST_RIVEN_ITEM_ID + 0.5, String(FIRST_RIVEN_ITEM_ID), NaN, null]) {
        assert.equal(isWeaponRivenItemId(id), false)
    }
})

test("riven fragments are ordinary non-saleable materials with one unlimited general exchange", () => {
    assert.equal(serverItemIds.filter(id => id === FRAGMENT_ITEM_ID).length, 1)
    assert.deepEqual(sale[FRAGMENT_ITEM_ID], { category: 2, sale_price: 0, sellable: false })
    assert.equal(names[FRAGMENT_ITEM_ID], "裂罅碎片")
    const shop = require("../assets/general_shop.json")
    const bossShop = require("../assets/boss_coin_shop.json")
    const categories = require("../assets/boss_coin_shop_item_category_map.json")
    const mirror = require("../assets/cdndata/boss_coin_shop.json")
    const whitelist = require("../assets/cdn_general_shop_whitelist.json")
    const product = shop[FRAGMENT_SHOP_ID]
    assert.equal(whitelist.filter(id => id === FRAGMENT_SHOP_ID).length, 1)
    assert.equal(Object.values(bossShop).some(category => Object.hasOwn(category, FRAGMENT_SHOP_ID)), false)
    assert.equal(categories[FRAGMENT_SHOP_ID], undefined)
    assert.equal(mirror[FRAGMENT_SHOP_ID], undefined)
    assert.deepEqual(product.costs, [{ id: FRAGMENT_ITEM_ID, amount: 10 }])
    assert.deepEqual(product.rewards, [{ type: 0, id: UNKNOWN_RIVEN_ITEM_ID, count: 1 }])
    // Undefined stock is the existing shop protocol's unlimited sentinel.
    assert.equal(Object.hasOwn(product, "stock"), false)
    assert.equal(product.availableUntil, null)
    assert.equal(product.availableFrom, "2000-01-01 00:00:00")
})
