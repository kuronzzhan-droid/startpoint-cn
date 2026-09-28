import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";

const databaseDir = mkdtempSync(path.join(tmpdir(), "wf-shop-enhancement-"));
process.env.WF_DATABASE_DIR = databaseDir;

const { getDb } = require("../data/db") as typeof import("../data/db");
const { ensurePlayerDegreesTableSync } = require("../data/domains/degree") as typeof import("../data/domains/degree");
const {
    executeShopPurchasesSync,
    getEnhancementStageRange,
    ShopPurchaseValidationError,
} = require("../lib/shop-purchase") as typeof import("../lib/shop-purchase");
const { ShopType } = require("../lib/types") as typeof import("../lib/types");
type ShopItem = import("../lib/types").ShopItem;

after(() => {
    getDb().close();
    rmSync(databaseDir, { recursive: true, force: true });
});

const PLAYER_ID = 1;
// PARADOX (5920001) has no degree reward, so grantEquipmentDegreeRewardsSync stays a no-op here.
const EQUIPMENT_ID = 5_920_001;
const SHARD = 10_000_301;
const CORE = 10_000_302;

function stage(stageNumber: number, cap: number, costs: { id: number, amount: number }[]): ShopItem {
    return {
        costs,
        rewards: [],
        availableFrom: "2000-01-01 00:00:00",
        availableUntil: null,
        stock: -1,
        shopCategoryId: 6,
        groupId: EQUIPMENT_ID,
        stage: stageNumber,
        equipmentId: EQUIPMENT_ID,
        enhancementMaxLevel: cap,
        requireAwakeningLevel: 5,
    };
}

// Stages 6–10 of PARADOX as in assets/equipment_enhancement_shop.json (592000106–110); key = shop item id.
const STAGES: Record<number, ShopItem> = {
    592000106: stage(6, 120, [{ id: 10_000_147, amount: 3 }, { id: 10_000_144, amount: 2 }]),
    592000107: stage(7, 159, [{ id: SHARD, amount: 3 }]),
    592000108: stage(8, 160, [{ id: SHARD, amount: 10 }, { id: CORE, amount: 1 }]),
    592000109: stage(9, 199, [{ id: SHARD, amount: 5 }]),
    592000110: stage(10, 200, [{ id: CORE, amount: 3 }]),
};

function resetPlayer(enhancementLevel: number, items: Record<number, number>): void {
    const db = getDb();
    ensurePlayerDegreesTableSync();
    db.exec(`
        DELETE FROM players_shop_purchases;
        DELETE FROM players_degrees;
        DELETE FROM players_items;
        DELETE FROM players_equipment;
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
            ?, 100, 0, 0, 0, 0, 0, 'enhancement-test', '2026-01-01', '',
            0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1
        )
    `).run(PLAYER_ID);
    db.prepare(`
        INSERT INTO players_equipment (player_id, id, level, enhancement_level, protection, stack)
        VALUES (?, ?, 5, ?, 0, 0)
    `).run(PLAYER_ID, EQUIPMENT_ID, enhancementLevel);
    const insertItem = db.prepare("INSERT INTO players_items (player_id, id, amount) VALUES (?, ?, ?)");
    for (const [id, amount] of Object.entries(items)) insertItem.run(PLAYER_ID, Number(id), amount);
}

function buy(shopItemId: number, count: number) {
    return executeShopPurchasesSync({
        playerId: PLAYER_ID,
        shopType: ShopType.TREASURE_EQUIPMENT,
        purchases: [{ shopItemId, count }],
        resolveShopItem: (_shopType, id) => STAGES[id] ?? null,
        resolveEnhancementStages: () => Object.values(STAGES),
        now: new Date("2026-09-28T00:00:00Z"),
    });
}

function state() {
    const db = getDb();
    const equipment = db.prepare("SELECT enhancement_level FROM players_equipment WHERE player_id = ? AND id = ?")
        .get(PLAYER_ID, EQUIPMENT_ID) as { enhancement_level: number };
    const items = Object.fromEntries((db.prepare("SELECT id, amount FROM players_items WHERE player_id = ? ORDER BY id")
        .all(PLAYER_ID) as { id: number, amount: number }[]).map(row => [row.id, row.amount]));
    const purchases = (db.prepare("SELECT COALESCE(SUM(count), 0) total FROM players_shop_purchases WHERE player_id = ?")
        .get(PLAYER_ID) as { total: number }).total;
    return { level: equipment.enhancement_level, items, purchases };
}

beforeEach(() => resetPlayer(120, { [SHARD]: 1000, [CORE]: 10 }));

test("stage range is (previous cap, this cap] within the group", () => {
    const stages = Object.values(STAGES);
    assert.deepEqual(getEnhancementStageRange(STAGES[592000107], stages), { from: 120, to: 159 });
    assert.deepEqual(getEnhancementStageRange(STAGES[592000110], stages), { from: 199, to: 200 });
    assert.deepEqual(getEnhancementStageRange(STAGES[592000106], [STAGES[592000106]]), { from: 0, to: 120 });
    // Official groups share a groupId across several equipments (e.g. group 21 = 5020040 + 5020042):
    // another equipment's stages never count as this one's previous stage.
    const other = { ...STAGES[592000107], equipmentId: 5_020_042, enhancementMaxLevel: 150 };
    assert.deepEqual(getEnhancementStageRange(STAGES[592000108], [...stages, other]), { from: 159, to: 160 });
    assert.deepEqual(getEnhancementStageRange(STAGES[592000107], [...stages, other]), { from: 120, to: 159 });
});

test("buying 1 unit raises the level by exactly 1 and charges one unit", () => {
    const result = buy(592000107, 1);
    assert.deepEqual(state(), { level: 121, items: { [SHARD]: 997, [CORE]: 10 }, purchases: 1 });
    assert.equal(result.itemList[SHARD], 997);
    const equipment = result.equipmentList.at(-1) as Record<string, unknown>;
    assert.equal(equipment.equipment_id, EQUIPMENT_ID);
    assert.equal(equipment.enhancement_level, 121);
});

test("buying N units raises the level by N and charges N units", () => {
    buy(592000107, 10);
    assert.deepEqual(state(), { level: 130, items: { [SHARD]: 970, [CORE]: 10 }, purchases: 10 });
});

test("buying exactly the remaining levels reaches the stage cap", () => {
    resetPlayer(150, { [SHARD]: 1000, [CORE]: 10 });
    buy(592000107, 9);
    assert.deepEqual(state(), { level: 159, items: { [SHARD]: 973, [CORE]: 10 }, purchases: 9 });
    buy(592000108, 1);
    assert.deepEqual(state(), { level: 160, items: { [SHARD]: 963, [CORE]: 9 }, purchases: 10 });
    resetPlayer(199, { [CORE]: 3 });
    buy(592000110, 1);
    assert.deepEqual(state(), { level: 200, items: { [CORE]: 0 }, purchases: 1 });
});

test("quantity above the remaining levels of the stage is rejected without side effects", () => {
    resetPlayer(150, { [SHARD]: 1000, [CORE]: 10 });
    const before = state();
    assert.throws(() => buy(592000107, 10), ShopPurchaseValidationError);
    assert.deepEqual(state(), before);
    assert.throws(() => buy(592000107, 1000), ShopPurchaseValidationError);
    assert.deepEqual(state(), before);
});

test("buying a later stage before reaching it is rejected", () => {
    const before = state();
    assert.throws(() => buy(592000108, 1), /not the current enhancement stage/);
    assert.throws(() => buy(592000110, 1), /not the current enhancement stage/);
    assert.deepEqual(state(), before);
});

test("buying a finished stage is rejected", () => {
    resetPlayer(160, { [SHARD]: 1000, [CORE]: 10 });
    const before = state();
    assert.throws(() => buy(592000107, 1), /already enhanced/);
    assert.throws(() => buy(592000108, 1), /already enhanced/);
    assert.deepEqual(state(), before);
});

test("consecutive stages in one bulk purchase advance level by level", () => {
    resetPlayer(158, { [SHARD]: 1000, [CORE]: 10 });
    executeShopPurchasesSync({
        playerId: PLAYER_ID,
        shopType: ShopType.TREASURE_EQUIPMENT,
        purchases: [{ shopItemId: 592000107, count: 1 }, { shopItemId: 592000108, count: 1 },
            { shopItemId: 592000109, count: 2 }],
        resolveShopItem: (_shopType, id) => STAGES[id] ?? null,
        resolveEnhancementStages: () => Object.values(STAGES),
        now: new Date("2026-09-28T00:00:00Z"),
    });
    assert.deepEqual(state(), { level: 162, items: { [SHARD]: 1000 - 3 - 10 - 10, [CORE]: 9 }, purchases: 4 });
});

test("not enough materials rejects the purchase", () => {
    resetPlayer(120, { [SHARD]: 2 });
    const before = state();
    assert.throws(() => buy(592000107, 1), /Not enough of item/);
    assert.deepEqual(state(), before);
});
