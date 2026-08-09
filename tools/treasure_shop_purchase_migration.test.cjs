require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const Database = require("better-sqlite3")
const {
    resetCorruptedTreasureShopPurchases,
    updateAfterInit,
} = require("../src/data/updaters/wdfpData")

const database = new Database(":memory:")
database.exec(`
    CREATE TABLE players_shop_purchases (
        player_id INTEGER NOT NULL,
        shop_item_id INTEGER NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (player_id, shop_item_id)
    );
    INSERT INTO players_shop_purchases (player_id, shop_item_id, count) VALUES
        (1, 200069, 2),
        (1, 200070, 3),
        (1, 200088, 4),
        (2, 200108, 5),
        (2, 200109, 6),
        (2, 300001, 7);
`)

assert.equal(resetCorruptedTreasureShopPurchases(database), 3)
assert.deepEqual(
    database.prepare(`
        SELECT player_id, shop_item_id, count
        FROM players_shop_purchases
        ORDER BY player_id, shop_item_id
    `).all(),
    [
        { player_id: 1, shop_item_id: 200069, count: 2 },
        { player_id: 2, shop_item_id: 200109, count: 6 },
        { player_id: 2, shop_item_id: 300001, count: 7 },
    ]
)

assert.equal(resetCorruptedTreasureShopPurchases(database), 0)
updateAfterInit(database, 8)
assert.equal(database.prepare(`
    SELECT COUNT(*) AS count FROM players_shop_purchases
`).get().count, 3)

database.close()
console.log("treasure_shop_purchase_migration.test.cjs passed")
