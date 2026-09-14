import assert from "node:assert/strict";
import Fastify from "fastify";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, mock, test } from "node:test";

// Set the isolated database location before any database-dependent module is imported.
const tempRoot = mkdtempSync(path.join(tmpdir(), "wf-abyss-shop-degree-"));
process.env.WF_DATABASE_DIR = tempRoot;
const configPath = path.join(tempRoot, "activation.json");
const { getDb } = require("../data/db") as typeof import("../data/db");
const degrees = require("../data/domains/degree") as typeof import("../data/domains/degree");
const reward = require("../lib/abyss-shop-degree-reward") as typeof import("../lib/abyss-shop-degree-reward");
const assets = require("../lib/assets") as typeof import("../lib/assets");
const { ShopType } = require("../lib/types") as typeof import("../lib/types");
const shopRoutes = require("../routes/api/shop").default as typeof import("../routes/api/shop").default;
const profileRoutes = require("../routes/api/profile").default as typeof import("../routes/api/profile").default;
const originalGrant = reward.grantAbyssShopDegreeRewardSync;
const originalPurchase = reward.withAbyssShopDegreeRewardSync;
const db = getDb();
const VIEWER = 919_192;
const [SINGLE, TENFOLD] = reward.ABYSS_SHOP_TICKET_IDS;
const DEGREE = reward.ABYSS_SHOP_DEGREE_ID;

function activation(enabled = true) {
    return { schema_version: 1, enabled, degree_id: DEGREE,
        shop_item_ids: [SINGLE, TENFOLD], required_purchases: 9999 };
}
function activate(value: unknown = activation()): void {
    writeFileSync(configPath, JSON.stringify(value));
}
function counts(single: number, tenfold: number, playerId = 1): void {
    const insert = db.prepare(`INSERT INTO players_shop_purchases (player_id, shop_item_id, count)
        VALUES (?, ?, ?) ON CONFLICT(player_id, shop_item_id) DO UPDATE SET count = excluded.count`);
    insert.run(playerId, SINGLE, single); insert.run(playerId, TENFOLD, tenfold);
}
function grant(playerId = 1) { return originalGrant(playerId, { configPath }); }
function owned(playerId = 1) { return degrees.getPlayerDegreeIdsSync(playerId); }
function useFixtureActivation(): void {
    mock.method(reward, "grantAbyssShopDegreeRewardSync", (playerId: number) => grant(playerId));
    mock.method(reward, "withAbyssShopDegreeRewardSync", <T>(playerId: number, shopType: number,
        purchases: readonly { shopItemId: number }[], purchase: () => T) =>
        originalPurchase(playerId, shopType, purchases, purchase, { configPath }));
}
function state() {
    return { purchases: db.prepare("SELECT * FROM players_shop_purchases ORDER BY player_id, shop_item_id").all(),
        items: db.prepare("SELECT * FROM players_items ORDER BY player_id, id").all(), degrees: owned() };
}
async function appFor(plugin: typeof shopRoutes | typeof profileRoutes, prefix: string) {
    const app = Fastify();
    app.addHook("preHandler", async (_request, reply) => { reply.serializer(payload => JSON.stringify(payload)); });
    await app.register(plugin, { prefix });
    return app;
}

beforeEach(() => {
    mock.restoreAll(); degrees.ensurePlayerDegreesTableSync();
    db.exec(`DROP TRIGGER IF EXISTS reject_abyss_degree;
        DELETE FROM players_degrees; DELETE FROM players_shop_purchases; DELETE FROM players_items;
        DELETE FROM sessions; DELETE FROM players; DELETE FROM accounts;`);
    const account = db.prepare(`INSERT INTO accounts (id, app_id, first_login_time, idp_alias, idp_code,
        idp_id, reg_time, last_login_time, status)
        VALUES (?, 'app', '2026-01-01', 'test', 'test', 'test', '2026-01-01', '2026-01-01', 'active')`);
    account.run(1); account.run(2);
    const player = db.prepare(`INSERT INTO players (id, stamina, stamina_heal_time, boost_point,
        boss_boost_point, transition_state, role, name, last_login_time, comment, vmoney,
        free_vmoney, rank_point, star_crumb, bond_token, exp_pool, exp_pooled_time,
        leader_character_id, party_slot, degree_id, birth, free_mana, paid_mana, enable_auto_3x,
        account_id) VALUES (?, 100, 0, 0, 0, 0, 0, 'abyss-degree-test', '2026-01-01', '',
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, ?)`);
    player.run(1, 1); player.run(2, 2);
    db.prepare(`INSERT INTO sessions (token, account_id, expires, type)
        VALUES (?, 1, '2099-01-01', 2)`).run(String(VIEWER));
    db.prepare("INSERT INTO players_items (player_id, id, amount) VALUES (1, 2370099, 100000)").run();
    activate();
});
after(() => { mock.restoreAll(); db.close(); rmSync(tempRoot, { recursive: true, force: true }); });

test("fixed native products are the two abyss tickets with cumulative stock 9999", () => {
    assert.equal(DEGREE, 9911001);
    for (const [shopItemId, itemId] of [[SINGLE, 999013], [TENFOLD, 999014]]) {
        const item = assets.getShopItemSync(ShopType.EVENT_ITEM, shopItemId)!;
        assert.equal(item.stock, 9999);
        assert.deepEqual(item.rewards, [{ type: 0, id: itemId, count: 1 }]);
        assert.equal(item.dailyStock, undefined); assert.equal(item.monthlyStock, undefined);
    }
    for (const pair of [[9999, 9998], [9998, 9999], [0, 19998], [NaN, 9999], [Infinity, 9999], [-1, 9999], [9999.5, 9999]]) {
        assert.equal(reward.isAbyssShopDegreeEligible(pair[0], pair[1]), false);
    }
    assert.equal(reward.isAbyssShopDegreeEligible(9999, 9999), true);
    assert.equal(reward.isAbyssShopDegreeEligible(10000, 9999), true);
});

test("missing, disabled, malformed or changed activation never opens a reward transaction", () => {
    counts(9999, 9999);
    assert.equal(reward.abyssShopDegreeRewardEnabled(path.join(tempRoot, "missing.json")), false);
    const cases = [activation(false), {}, { ...activation(), enabled: "true" },
        { ...activation(), degree_id: 9900006 }, { ...activation(), required_purchases: 1 },
        { ...activation(), shop_item_ids: [SINGLE, SINGLE] }];
    mock.method(db, "transaction", () => { throw new Error("unexpected reward transaction"); });
    for (const value of cases) { activate(value); assert.deepEqual(grant(), []); }
    writeFileSync(configPath, "{"); assert.deepEqual(grant(), []);
});

test("two persisted purchase counters are both required; current ticket inventory does not qualify", () => {
    db.prepare("INSERT INTO players_items (player_id, id, amount) VALUES (1, ?, 999999)").run(999013);
    db.prepare("INSERT INTO players_items (player_id, id, amount) VALUES (1, ?, 999999)").run(999014);
    counts(9999, 9998); assert.deepEqual(grant(), []);
    counts(9998, 9999); assert.deepEqual(grant(), []);
    db.prepare("UPDATE players_items SET amount = 0 WHERE id IN (999013, 999014)").run();
    counts(9999, 9999); assert.deepEqual(grant(), [DEGREE]);
    assert.deepEqual(grant(), []); assert.deepEqual(owned(), [DEGREE]);
});

test("account isolation, invalid players and unrelated shop counters cannot unlock the degree", () => {
    counts(9999, 9999, 2); counts(0, 0, 1);
    db.prepare("INSERT INTO players_shop_purchases VALUES (1, 9700118, 99999)").run();
    assert.deepEqual(grant(1), []); assert.deepEqual(grant(2), [DEGREE]);
    for (const playerId of [0, -1, 999, NaN, Infinity]) assert.deepEqual(grant(playerId), []);
    assert.deepEqual(owned(1), []);
});

test("unrelated shop purchases and disabled deployment keep the existing execution path", () => {
    let called = 0;
    const purchase = () => { called += 1; assert.equal(db.inTransaction, false); return "ok"; };
    for (const [type, id] of [[ShopType.BOSS_COIN, SINGLE], [ShopType.EVENT_ITEM, 9700118]]) {
        assert.equal(originalPurchase(1, type, [{ shopItemId: id }], purchase, { configPath }), "ok");
    }
    activate(activation(false));
    assert.equal(originalPurchase(1, ShopType.EVENT_ITEM, [{ shopItemId: SINGLE }], purchase, { configPath }), "ok");
    assert.equal(called, 3); assert.deepEqual(owned(), []);
});

test("single purchase quantity uses native accumulated units and grants on the exact last exchange", async () => {
    counts(9989, 9999); useFixtureActivation();
    const app = await appFor(shopRoutes, "/shop");
    try {
        const res = await app.inject({ method: "POST", url: "/shop/buy", payload: {
            viewer_id: VIEWER, shop_type: ShopType.EVENT_ITEM, shop_item_id: SINGLE, number: 10 } });
        assert.equal(res.statusCode, 200); assert.deepEqual(owned(), [DEGREE]);
        assert.equal((db.prepare("SELECT count FROM players_shop_purchases WHERE player_id = 1 AND shop_item_id = ?")
            .get(SINGLE) as { count: number }).count, 9999);
        assert.equal(res.json().data.item_list[999013], 10);
        const before = state();
        const retry = await app.inject({ method: "POST", url: "/shop/buy", payload: {
            viewer_id: VIEWER, shop_type: ShopType.EVENT_ITEM, shop_item_id: SINGLE, number: 1 } });
        assert.equal(retry.statusCode, 400); assert.deepEqual(state(), before);
    } finally { await app.close(); }
});

test("bulk purchase reaches both thresholds atomically", async () => {
    counts(9998, 9998); useFixtureActivation();
    const app = await appFor(shopRoutes, "/shop");
    try {
        const res = await app.inject({ method: "POST", url: "/shop/bulk_buy", payload: {
            viewer_id: VIEWER, shop_type: ShopType.EVENT_ITEM, buy_item_list: { [SINGLE]: 1, [TENFOLD]: 1 } } });
        assert.equal(res.statusCode, 200); assert.deepEqual(owned(), [DEGREE]);
        assert.equal(res.json().data.item_list[999013], 1); assert.equal(res.json().data.item_list[999014], 1);
    } finally { await app.close(); }
});

test("degree insertion failure rolls back currency, ticket inventory and both native purchase counters", async () => {
    counts(9998, 9998); useFixtureActivation();
    db.exec(`CREATE TRIGGER reject_abyss_degree BEFORE INSERT ON players_degrees
        WHEN NEW.degree_id = ${DEGREE} BEGIN SELECT RAISE(ABORT, 'test degree failure'); END;`);
    const before = state(); const app = await appFor(shopRoutes, "/shop");
    try {
        const res = await app.inject({ method: "POST", url: "/shop/bulk_buy", payload: {
            viewer_id: VIEWER, shop_type: ShopType.EVENT_ITEM, buy_item_list: { [SINGLE]: 1, [TENFOLD]: 1 } } });
        assert.equal(res.statusCode, 500); assert.deepEqual(state(), before);
    } finally { await app.close(); }
});

test("failed unaffordable purchase does not grant or change prior eligible progress", async () => {
    counts(9998, 9999); useFixtureActivation();
    db.prepare("UPDATE players_items SET amount = 0 WHERE id = 2370099").run();
    const before = state(); const app = await appFor(shopRoutes, "/shop");
    try {
        const res = await app.inject({ method: "POST", url: "/shop/buy", payload: {
            viewer_id: VIEWER, shop_type: ShopType.EVENT_ITEM, shop_item_id: SINGLE, number: 1 } });
        assert.equal(res.statusCode, 400); assert.deepEqual(state(), before);
    } finally { await app.close(); }
});

test("old eligible players are backfilled by either profile endpoint without inventory or request counters", async () => {
    counts(9999, 9999); useFixtureActivation();
    const app = await appFor(profileRoutes, "/profile");
    try {
        const list = await app.inject({ method: "POST", url: "/profile/get_degree_list", payload: { viewer_id: VIEWER } });
        assert.equal(list.statusCode, 200); assert.deepEqual(list.json().data.degree_ids, [1, DEGREE]);
        db.prepare("DELETE FROM players_degrees").run();
        const profile = await app.inject({ method: "POST", url: "/profile/get_my_profile", payload: { viewer_id: VIEWER } });
        assert.equal(profile.statusCode, 200); assert.equal(profile.json().data.profile_info.owned_degree_count, 2);
        assert.deepEqual(owned(), [DEGREE]); assert.deepEqual(grant(), []);
        counts(0, 0, 1); db.prepare("DELETE FROM players_degrees").run();
        const fake = await app.inject({ method: "POST", url: "/profile/get_degree_list", payload: {
            viewer_id: VIEWER, single_count: 9999, tenfold_count: 9999, player_id: 2 } });
        assert.deepEqual(fake.json().data.degree_ids, [1]);
    } finally { await app.close(); }
});
