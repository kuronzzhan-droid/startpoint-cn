import assert from "node:assert/strict";
import Fastify from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const databaseDir = mkdtempSync(path.join(tmpdir(), "wf-shop-degree-"));
process.env.WF_DATABASE_DIR = databaseDir;

const { getDb } = require("../data/db") as typeof import("../data/db");
const { ensurePlayerDegreesTableSync } = require("../data/domains/degree") as typeof import("../data/domains/degree");
const {
    executeShopPurchasesSync,
    ShopPurchaseValidationError,
} = require("../lib/shop-purchase") as typeof import("../lib/shop-purchase");
const { ShopItemRewardType, ShopType } = require("../lib/types") as typeof import("../lib/types");
const shopRoutes = require("../routes/api/shop").default as typeof import("../routes/api/shop").default;

after(() => {
    getDb().close();
    rmSync(databaseDir, { recursive: true, force: true });
});

const PLAYER_ID = 1;
const SHOP_ITEM_ID = 9_700_118;
const DEGREE_ID = 9_900_006;
const VIEWER_ID = 123456;

function resetPlayer(freeVmoney: number = 6_000_000): void {
    const db = getDb();
    ensurePlayerDegreesTableSync();
    db.exec(`
        DELETE FROM players_shop_purchases;
        DELETE FROM players_degrees;
        DELETE FROM players_items;
        DELETE FROM players_equipment;
        DELETE FROM players_characters;
        DELETE FROM sessions;
        DELETE FROM players;
        DELETE FROM accounts;
    `);
    db.prepare(`
        INSERT INTO accounts (
            id, app_id, first_login_time, idp_alias, idp_code, idp_id,
            reg_time, last_login_time, status
        ) VALUES (1, 'app', '2026-01-01', 'test', 'test', 'test',
            '2026-01-01', '2026-01-01', 'active')
    `).run();
    db.prepare(`
        INSERT INTO players (
            id, stamina, stamina_heal_time, boost_point, boss_boost_point,
            transition_state, role, name, last_login_time, comment,
            vmoney, free_vmoney, rank_point, star_crumb, bond_token, exp_pool,
            exp_pooled_time, leader_character_id, party_slot, degree_id, birth,
            free_mana, paid_mana, enable_auto_3x, account_id
        ) VALUES (
            ?, 100, 0, 0, 0, 0, 0, 'shop-test', '2026-01-01', '',
            777, ?, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1000, 0, 0, 1
        )
    `).run(PLAYER_ID, freeVmoney);
    db.prepare(`
        INSERT INTO sessions (token, account_id, expires, type)
        VALUES (?, 1, '2099-01-01', 2)
    `).run(String(VIEWER_ID));
}

function degreeProduct(overrides: Record<string, unknown> = {}) {
    return {
        costs: [],
        rewards: [{ type: ShopItemRewardType.DEGREE, id: DEGREE_ID, count: 1 }],
        userCost: { type: 0, amount: 5_000_000 },
        availableFrom: "2000-01-01 00:00:00",
        availableUntil: "2099-12-31 23:59:59",
        stock: 1,
        ...overrides,
    };
}

function buy(product = degreeProduct()) {
    return executeShopPurchasesSync({
        playerId: PLAYER_ID,
        shopType: ShopType.EVENT_ITEM,
        purchases: [{ shopItemId: SHOP_ITEM_ID, count: 1 }],
        resolveShopItem: (_shopType: number, shopItemId: number) =>
            shopItemId === SHOP_ITEM_ID ? product : null,
        now: new Date("2026-08-29T00:00:00Z"),
    });
}

function persistedState() {
    const db = getDb();
    return {
        balances: db.prepare("SELECT vmoney, free_vmoney FROM players WHERE id = ?")
            .get(PLAYER_ID) as { vmoney: number, free_vmoney: number },
        degreeCount: (db.prepare(
            "SELECT COUNT(*) count FROM players_degrees WHERE player_id = ? AND degree_id = ?"
        ).get(PLAYER_ID, DEGREE_ID) as { count: number }).count,
        purchaseCount: (db.prepare(
            "SELECT count FROM players_shop_purchases WHERE player_id = ? AND shop_item_id = ?"
        ).get(PLAYER_ID, SHOP_ITEM_ID) as { count: number } | undefined)?.count ?? 0,
    };
}

async function createShopApp() {
    const app = Fastify();
    app.addHook("preHandler", async (_request, reply) => {
        reply.serializer(payload => JSON.stringify(payload));
    });
    await app.register(shopRoutes, { prefix: "/shop" });
    return app;
}

async function injectBuy(app: Awaited<ReturnType<typeof createShopApp>>, number: number = 1) {
    return app.inject({
        method: "POST",
        url: "/shop/buy",
        payload: {
            viewer_id: VIEWER_ID,
            shop_type: ShopType.EVENT_ITEM,
            api_count: 1,
            shop_item_id: SHOP_ITEM_ID,
            number,
        },
    });
}

async function injectBulkBuy(app: Awaited<ReturnType<typeof createShopApp>>, count: number = 1) {
    return app.inject({
        method: "POST",
        url: "/shop/bulk_buy",
        payload: {
            viewer_id: VIEWER_ID,
            shop_type: ShopType.EVENT_ITEM,
            buy_item_list: { [SHOP_ITEM_ID]: count },
        },
    });
}

test("single buy deducts freeVmoney once and directly grants the degree", () => {
    resetPlayer();

    const result = buy();

    assert.deepEqual(persistedState(), {
        balances: { vmoney: 777, free_vmoney: 1_000_000 },
        degreeCount: 1,
        purchaseCount: 1,
    });
    assert.equal(result.freeVmoney, 1_000_000);
    assert.equal(JSON.stringify(result).includes(String(DEGREE_ID)), false);
    assert.equal(JSON.stringify(result).includes(`\"type\":${ShopItemRewardType.DEGREE}`), false);
});

test("owned degree and replay are rejected without a second deduction", () => {
    resetPlayer();
    buy();
    const committed = persistedState();

    assert.throws(() => buy(), (error: unknown) => {
        assert.ok(error instanceof ShopPurchaseValidationError);
        assert.equal(error.message.includes(String(DEGREE_ID)), false);
        return true;
    });
    assert.deepEqual(persistedState(), committed);
});

test("invalid degree ids, count, unknown rewards, and closed dates fail with zero writes", () => {
    const invalidRewards = [
        [{ type: ShopItemRewardType.DEGREE, id: 0, count: 1 }],
        [{ type: ShopItemRewardType.DEGREE, id: -1, count: 1 }],
        [{ type: ShopItemRewardType.DEGREE, id: Number.MAX_SAFE_INTEGER + 1, count: 1 }],
        [{ type: ShopItemRewardType.DEGREE, id: DEGREE_ID, count: 2 }],
        [{ type: 99, id: DEGREE_ID, count: 1 }],
        [{ type: ShopItemRewardType.ITEM, id: 123, count: 0 }],
        [{ type: ShopItemRewardType.EQUIPMENT, id: 123, count: -1 }],
        [{ type: ShopItemRewardType.MANA, count: Number.MAX_SAFE_INTEGER + 1 }],
    ];
    for (const rewards of invalidRewards) {
        resetPlayer();
        const before = persistedState();
        assert.throws(() => buy(degreeProduct({ rewards })), ShopPurchaseValidationError);
        assert.deepEqual(persistedState(), before);
    }

    resetPlayer();
    const before = persistedState();
    assert.throws(() => buy(degreeProduct({
        availableFrom: "2099-01-01 00:00:00",
    })), ShopPurchaseValidationError);
    assert.deepEqual(persistedState(), before);
});

test("exceptions before grant, after grant, and before the ledger roll back every write", () => {
    const db = getDb();
    const injections = [
        {
            name: "fail_before_degree_grant",
            sql: `CREATE TRIGGER fail_before_degree_grant
                BEFORE INSERT ON players_degrees
                BEGIN SELECT RAISE(ABORT, 'before degree grant'); END`,
        },
        {
            name: "fail_after_degree_grant",
            sql: `CREATE TRIGGER fail_after_degree_grant
                AFTER INSERT ON players_degrees
                BEGIN SELECT RAISE(ABORT, 'after degree grant'); END`,
        },
        {
            name: "fail_before_purchase_ledger",
            sql: `CREATE TRIGGER fail_before_purchase_ledger
                BEFORE INSERT ON players_shop_purchases
                BEGIN SELECT RAISE(ABORT, 'before purchase ledger'); END`,
        },
    ];

    for (const injection of injections) {
        resetPlayer();
        const before = persistedState();
        db.exec(injection.sql);
        try {
            assert.throws(() => buy(), /degree grant|purchase ledger/);
            assert.deepEqual(persistedState(), before);
        } finally {
            db.exec(`DROP TRIGGER IF EXISTS ${injection.name}`);
        }
    }
});

test("ordinary item, equipment, character, mana, and exp rewards remain supported", () => {
    resetPlayer();
    const db = getDb();
    db.prepare("INSERT INTO players_items (id, amount, player_id) VALUES (123, 10, ?)")
        .run(PLAYER_ID);
    const product = {
        costs: [{ id: 123, amount: 2 }],
        rewards: [
            { type: ShopItemRewardType.ITEM, id: 124, count: 3 },
            { type: ShopItemRewardType.EXP, count: 10 },
            { type: ShopItemRewardType.MANA, count: 20 },
            { type: ShopItemRewardType.CHARACTER, id: 111001 },
            { type: ShopItemRewardType.EQUIPMENT, id: 5020042, count: 2 },
        ],
        userCost: { type: 0, amount: 100 },
        availableFrom: "2000-01-01 00:00:00",
        availableUntil: null,
        stock: -1,
    };

    const result = executeShopPurchasesSync({
        playerId: PLAYER_ID,
        shopType: ShopType.EVENT_ITEM,
        purchases: [{ shopItemId: 9001, count: 1 }],
        resolveShopItem: () => product,
        now: new Date("2026-08-29T00:00:00Z"),
    });

    assert.deepEqual(db.prepare(
        "SELECT free_vmoney, free_mana, exp_pool FROM players WHERE id = ?"
    ).get(PLAYER_ID), { free_vmoney: 5_999_900, free_mana: 1_020, exp_pool: 10 });
    assert.equal(db.prepare("SELECT amount FROM players_items WHERE player_id = ? AND id = 123")
        .pluck().get(PLAYER_ID), 8);
    assert.equal(db.prepare("SELECT amount FROM players_items WHERE player_id = ? AND id = 124")
        .pluck().get(PLAYER_ID), 3);
    assert.equal(db.prepare("SELECT stack FROM players_equipment WHERE player_id = ? AND id = 5020042")
        .pluck().get(PLAYER_ID), 1);
    assert.equal(db.prepare("SELECT COUNT(*) FROM players_characters WHERE player_id = ? AND id = 111001")
        .pluck().get(PLAYER_ID), 1);
    assert.equal(result.characterList.length, 1);
    assert.equal(result.equipmentList.length, 1);
});

test("treasure equipment purchase keeps its enhancement update atomic", () => {
    resetPlayer();
    const db = getDb();
    db.prepare(`
        INSERT INTO players_equipment
            (id, level, enhancement_level, protection, stack, player_id)
        VALUES (5020042, 1, 10, 0, 0, ?)
    `).run(PLAYER_ID);
    const product = {
        costs: [],
        rewards: [],
        userCost: { type: 1, amount: 100 },
        availableFrom: "2000-01-01 00:00:00",
        availableUntil: null,
        stock: -1,
        equipmentId: 5020042,
        enhancementMaxLevel: 20,
    };

    const result = executeShopPurchasesSync({
        playerId: PLAYER_ID,
        shopType: ShopType.TREASURE_EQUIPMENT,
        purchases: [{ shopItemId: 2001, count: 1 }],
        resolveShopItem: () => product,
        now: new Date("2026-08-29T00:00:00Z"),
    });

    assert.equal(db.prepare("SELECT free_mana FROM players WHERE id = ?").pluck().get(PLAYER_ID), 900);
    assert.equal(db.prepare(
        "SELECT enhancement_level FROM players_equipment WHERE player_id = ? AND id = 5020042"
    ).pluck().get(PLAYER_ID), 20);
    assert.deepEqual(result.equipmentList, [{
        equipment_id: 5020042,
        protection: false,
        level: 1,
        enhancement_level: 20,
        stack: 0,
    }]);
});

test("/buy routes the live 9700118 product through the atomic degree executor", async () => {
    resetPlayer();
    const app = await createShopApp();
    try {
        const response = await injectBuy(app);

        assert.equal(response.statusCode, 200, response.body);
        assert.deepEqual(persistedState(), {
            balances: { vmoney: 777, free_vmoney: 1_000_000 },
            degreeCount: 1,
            purchaseCount: 1,
        });
        assert.equal(response.body.includes(String(DEGREE_ID)), false);
        assert.equal(response.body.includes(`\"type\":${ShopItemRewardType.DEGREE}`), false);
    } finally {
        await app.close();
    }
});

test("/bulk_buy routes the live 9700118 product through the same atomic degree executor", async () => {
    resetPlayer();
    const app = await createShopApp();
    try {
        const response = await injectBulkBuy(app);

        assert.equal(response.statusCode, 200, response.body);
        assert.deepEqual(persistedState(), {
            balances: { vmoney: 777, free_vmoney: 1_000_000 },
            degreeCount: 1,
            purchaseCount: 1,
        });
        assert.equal(response.body.includes(String(DEGREE_ID)), false);
        assert.equal(response.body.includes(`\"type\":${ShopItemRewardType.DEGREE}`), false);
    } finally {
        await app.close();
    }
});

test("/bulk_buy commits the degree and an ordinary reward together", async () => {
    resetPlayer();
    const db = getDb();
    db.prepare("INSERT INTO players_items (id, amount, player_id) VALUES (2370099, 5, ?)")
        .run(PLAYER_ID);
    const app = await createShopApp();
    try {
        const response = await app.inject({
            method: "POST",
            url: "/shop/bulk_buy",
            payload: {
                viewer_id: VIEWER_ID,
                shop_type: ShopType.EVENT_ITEM,
                buy_item_list: { 9700116: 1, [SHOP_ITEM_ID]: 1 },
            },
        });

        assert.equal(response.statusCode, 200, response.body);
        assert.deepEqual(persistedState(), {
            balances: { vmoney: 777, free_vmoney: 1_000_000 },
            degreeCount: 1,
            purchaseCount: 1,
        });
        assert.equal(db.prepare("SELECT amount FROM players_items WHERE player_id = ? AND id = 2370099")
            .pluck().get(PLAYER_ID), 0);
        assert.equal(db.prepare("SELECT amount FROM players_items WHERE player_id = ? AND id = 999013")
            .pluck().get(PLAYER_ID), 1);
        assert.equal(db.prepare(
            "SELECT count FROM players_shop_purchases WHERE player_id = ? AND shop_item_id = 9700116"
        ).pluck().get(PLAYER_ID), 1);
    } finally {
        await app.close();
    }
});

test("/bulk_buy internal failure rolls back its degree, ordinary reward, costs, and ledgers", async () => {
    resetPlayer();
    const db = getDb();
    db.prepare("INSERT INTO players_items (id, amount, player_id) VALUES (2370099, 5, ?)")
        .run(PLAYER_ID);
    db.exec(`CREATE TRIGGER fail_mixed_bulk_ledger
        BEFORE INSERT ON players_shop_purchases
        BEGIN SELECT RAISE(ABORT, 'mixed bulk ledger'); END`);
    const app = await createShopApp();
    try {
        const response = await app.inject({
            method: "POST",
            url: "/shop/bulk_buy",
            payload: {
                viewer_id: VIEWER_ID,
                shop_type: ShopType.EVENT_ITEM,
                buy_item_list: { 9700116: 1, [SHOP_ITEM_ID]: 1 },
            },
        });

        assert.equal(response.statusCode, 500, response.body);
        assert.deepEqual(persistedState(), {
            balances: { vmoney: 777, free_vmoney: 6_000_000 },
            degreeCount: 0,
            purchaseCount: 0,
        });
        assert.equal(db.prepare("SELECT amount FROM players_items WHERE player_id = ? AND id = 2370099")
            .pluck().get(PLAYER_ID), 5);
        assert.equal(db.prepare("SELECT COUNT(*) FROM players_items WHERE player_id = ? AND id = 999013")
            .pluck().get(PLAYER_ID), 0);
        assert.equal(db.prepare("SELECT COUNT(*) FROM players_shop_purchases WHERE player_id = ?")
            .pluck().get(PLAYER_ID), 0);
    } finally {
        db.exec("DROP TRIGGER IF EXISTS fail_mixed_bulk_ledger");
        await app.close();
    }
});

test("concurrent buy and bulk_buy have one winner and one zero-write loser", async () => {
    resetPlayer();
    const app = await createShopApp();
    try {
        const responses = await Promise.all([injectBuy(app), injectBulkBuy(app)]);
        assert.deepEqual(responses.map(response => response.statusCode).sort(), [200, 400]);
        assert.deepEqual(persistedState(), {
            balances: { vmoney: 777, free_vmoney: 1_000_000 },
            degreeCount: 1,
            purchaseCount: 1,
        });
    } finally {
        await app.close();
    }
});

test("/buy returns 400 with zero writes for insufficient, owned, replay, and zero count", async () => {
    const app = await createShopApp();
    try {
        resetPlayer(4_999_999);
        const insufficientBefore = persistedState();
        const insufficientResponse = await injectBuy(app);
        assert.equal(insufficientResponse.statusCode, 400);
        assert.equal(insufficientResponse.body.includes(String(DEGREE_ID)), false);
        assert.deepEqual(persistedState(), insufficientBefore);

        resetPlayer();
        getDb().prepare(
            "INSERT INTO players_degrees (player_id, degree_id) VALUES (?, ?)"
        ).run(PLAYER_ID, DEGREE_ID);
        const ownedBefore = persistedState();
        const ownedResponse = await injectBuy(app);
        assert.equal(ownedResponse.statusCode, 400);
        assert.equal(ownedResponse.body.includes(String(DEGREE_ID)), false);
        assert.deepEqual(persistedState(), ownedBefore);
        assert.equal(persistedState().purchaseCount, 0);

        resetPlayer();
        const invalidBefore = persistedState();
        assert.equal((await injectBuy(app, 0)).statusCode, 400);
        assert.deepEqual(persistedState(), invalidBefore);

        resetPlayer();
        assert.equal((await injectBuy(app)).statusCode, 200);
        const committed = persistedState();
        assert.equal((await injectBuy(app)).statusCode, 400);
        assert.deepEqual(persistedState(), committed);
    } finally {
        await app.close();
    }
});

test("sales list keeps an owned degree product visible with zero stock", async () => {
    resetPlayer();
    getDb().prepare(
        "INSERT INTO players_degrees (player_id, degree_id) VALUES (?, ?)"
    ).run(PLAYER_ID, DEGREE_ID);
    const app = await createShopApp();
    try {
        const response = await app.inject({
            method: "POST",
            url: "/shop/get_sales_list",
            payload: {
                viewer_id: VIEWER_ID,
                shop_types: [],
                boss_coin_shop_category_ids: [],
                equipment_enhancement_shop_category_ids: [],
                browse_treasure_flag: false,
                event_list: [{ event_type: 11, event_ids: [700099] }],
            },
        });
        assert.equal(response.statusCode, 200, response.body);
        const payload = JSON.parse(response.body);
        const product = payload.data.sales_list.find(
            (entry: { shop_item_id: number }) => entry.shop_item_id === SHOP_ITEM_ID
        );
        assert.notEqual(product, undefined);
        assert.equal(product.stock_quantity, 0);
        assert.equal(product.total_purchase_num, 0);
    } finally {
        await app.close();
    }
});

test("sales list keeps the active 9700101..9700118 order and gives the degree stock one", async () => {
    resetPlayer();
    const app = await createShopApp();
    try {
        const response = await app.inject({
            method: "POST",
            url: "/shop/get_sales_list",
            payload: {
                viewer_id: VIEWER_ID,
                shop_types: [],
                boss_coin_shop_category_ids: [],
                equipment_enhancement_shop_category_ids: [],
                browse_treasure_flag: false,
                event_list: [{ event_type: 11, event_ids: [700099] }],
            },
        });
        assert.equal(response.statusCode, 200, response.body);
        const sales = JSON.parse(response.body).data.sales_list;
        assert.deepEqual(
            sales.map((entry: { shop_item_id: number }) => entry.shop_item_id),
            Array.from({ length: 18 }, (_, index) => 9_700_101 + index),
        );
        assert.equal(sales.at(-1).stock_quantity, 1);
    } finally {
        await app.close();
    }
});

test("degree table ensure is safe after the table is dropped between calls", () => {
    resetPlayer();
    getDb().exec("DROP TABLE players_degrees");

    buy();

    assert.equal(persistedState().degreeCount, 1);
});
