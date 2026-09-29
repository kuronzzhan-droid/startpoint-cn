import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";

const databaseDir = mkdtempSync(path.join(tmpdir(), "wf-shop-enhancement-bond-"));
process.env.WF_DATABASE_DIR = databaseDir;

const { getDb } = require("../data/db") as typeof import("../data/db");
const { ensurePlayerDegreesTableSync } = require("../data/domains/degree") as typeof import("../data/domains/degree");
const {
    executeShopPurchasesSync,
    ShopPurchaseValidationError,
} = require("../lib/shop-purchase") as typeof import("../lib/shop-purchase");
const { ShopType } = require("../lib/types") as typeof import("../lib/types");
const { getShopItemSync } = require("../lib/assets") as typeof import("../lib/assets");
type ShopItem = import("../lib/types").ShopItem;

after(() => {
    getDb().close();
    rmSync(databaseDir, { recursive: true, force: true });
});

// 官方羁绊武器强化（mod-tools/wf_bond_weapon_enhance.py）：8 把，类目 7，6 阶（一份 = 1 级）。
// 深渊代币 2370099 每级 12、单级节点 30；羁绊证（AMITY_SCROLL，userCost.type = 2）只放 Lv70/99/120 三个节点：10/15/25，合计 50。
//
// 数据来源：EXPECTED 由下面的 ROUTE 表按「武器 ID × 阶段」生成，与生成器常量（STAGE_CAPS / COIN_* / TOKENS_AT）是两份独立抄录。
// 它同时是：① 购买规则测试的商店数据；② 对已发布的 assets/equipment_enhancement_shop.json 的漂移检查
// （见最后一个 test：发布后 48 键必须逐键等于 EXPECTED；发布前允许 0 键，不允许残缺；
// 设 WF_BOND_SHOP_JSON=<暂存的 equipment_enhancement_shop.json> 可在发布前对暂存文件做同一检查，此时必须 48 键齐全）。
const PLAYER_ID = 1;
const COIN = 2_370_099;
const AMITY_SCROLL = 2;

const WEAPONS = [
    { id: 5_010_005, name: "杜兰德尔" },
    { id: 5_030_005, name: "马尔特" },
    { id: 5_040_022, name: "米斯特汀" },
    { id: 5_020_024, name: "帕拉修" },
    { id: 5_070_027, name: "波利克斯" },
    { id: 5_050_026, name: "太平清领" },
    { id: 5_020_041, name: "金刚镰" },
    { id: 5_060_044, name: "酒神权杖" },
] as const;
const MALTE = 5_030_005;

type Route = readonly [stage: number, cap: number, coinPerUnit: number, scrollsPerUnit: number];

// [阶段, 本阶等级上限, 深渊币/份, 羁绊证/份]：Lv1–69、Lv70、Lv71–98、Lv99、Lv100–119、Lv120
const ROUTE: readonly Route[] = [
    [1, 69, 12, 0],
    [2, 70, 30, 10],
    [3, 98, 12, 0],
    [4, 99, 30, 15],
    [5, 119, 12, 0],
    [6, 120, 30, 25],
];
const ROUTE_COINS = 12 * 69 + 30 + 12 * 28 + 30 + 12 * 20 + 30;   // 1494
const ROUTE_TOKENS = 10 + 15 + 25;                                // 50

// shop item id = <weapon id><stage 2 digits>，与 assets/equipment_enhancement_shop.json 的键一致
function sid(equipmentId: number, stageNumber: number): number {
    return equipmentId * 100 + stageNumber;
}

function stageItem(equipmentId: number, [stageNumber, cap, coin, scrolls]: Route): ShopItem {
    const item: ShopItem = {
        costs: [{ id: COIN, amount: coin }],
        rewards: [],
        availableFrom: "2000-01-01 00:00:00",
        availableUntil: null,
        stock: -1,
        shopCategoryId: 7,
        groupId: equipmentId,
        stage: stageNumber,
        equipmentId,
        enhancementMaxLevel: cap,
        requireAwakeningLevel: 1,
    };
    if (scrolls > 0) item.userCost = { type: AMITY_SCROLL, amount: scrolls } as ShopItem["userCost"];
    return item;
}

const EXPECTED: Record<number, ShopItem> = {};
for (const weapon of WEAPONS) {
    for (const route of ROUTE) EXPECTED[sid(weapon.id, route[0])] = stageItem(weapon.id, route);
}

function resetPlayer(equipmentId: number, enhancementLevel: number, bondToken: number, coins: number): void {
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
            ?, 100, 0, 0, 0, 0, 0, 'bond-enhancement-test', '2026-01-01', '',
            0, 0, 0, 0, ?, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1
        )
    `).run(PLAYER_ID, bondToken);
    // 羁绊武器不可觉醒：level（觉醒）恒为 1
    db.prepare(`
        INSERT INTO players_equipment (player_id, id, level, enhancement_level, protection, stack)
        VALUES (?, ?, 1, ?, 0, 0)
    `).run(PLAYER_ID, equipmentId, enhancementLevel);
    db.prepare("INSERT INTO players_items (player_id, id, amount) VALUES (?, ?, ?)").run(PLAYER_ID, COIN, coins);
}

// 商店里放全部 8 把 × 6 阶 = 48 行：阶段范围按 equipmentId 过滤，别的武器的行不能串进来。
function buy(shopItemId: number, count: number) {
    return executeShopPurchasesSync({
        playerId: PLAYER_ID,
        shopType: ShopType.TREASURE_EQUIPMENT,
        purchases: [{ shopItemId, count }],
        resolveShopItem: (_shopType, id) => EXPECTED[id] ?? null,
        resolveEnhancementStages: () => Object.values(EXPECTED),
        now: new Date("2026-09-29T00:00:00Z"),
    });
}

function state(equipmentId: number) {
    const db = getDb();
    const level = (db.prepare("SELECT enhancement_level FROM players_equipment WHERE player_id = ? AND id = ?")
        .get(PLAYER_ID, equipmentId) as { enhancement_level: number }).enhancement_level;
    const coins = (db.prepare("SELECT amount FROM players_items WHERE player_id = ? AND id = ?")
        .get(PLAYER_ID, COIN) as { amount: number }).amount;
    const tokens = (db.prepare("SELECT bond_token FROM players WHERE id = ?")
        .get(PLAYER_ID) as { bond_token: number }).bond_token;
    const purchases = (db.prepare("SELECT COALESCE(SUM(count), 0) total FROM players_shop_purchases WHERE player_id = ?")
        .get(PLAYER_ID) as { total: number }).total;
    return { level, coins, tokens, purchases };
}

beforeEach(() => resetPlayer(MALTE, 0, 60, 2000));

test("the route table itself adds up to 1494 abyss coins, 50 amity scrolls and 120 levels", () => {
    assert.equal(ROUTE_COINS, 1494);
    assert.equal(ROUTE_TOKENS, 50);
    let previous = 0;
    let coins = 0;
    let scrolls = 0;
    for (const [, cap, coin, scroll] of ROUTE) {
        coins += (cap - previous) * coin;
        scrolls += (cap - previous) * scroll;
        previous = cap;
    }
    assert.equal(previous, 120);
    assert.equal(coins, 1494);
    assert.equal(scrolls, 50);
    assert.equal(Object.keys(EXPECTED).length, 48);
});

for (const weapon of WEAPONS) {
    test(`${weapon.name} (${weapon.id}): the whole 0 to 120 route costs exactly 1494 abyss coins and 50 amity scrolls`, () => {
        resetPlayer(weapon.id, 0, 60, 2000);
        const counts = [69, 1, 28, 1, 20, 1];
        ROUTE.forEach(([stageNumber], index) => buy(sid(weapon.id, stageNumber), counts[index]));
        const end = state(weapon.id);
        assert.equal(end.level, 120);
        assert.equal(2000 - end.coins, ROUTE_COINS);
        assert.equal(60 - end.tokens, ROUTE_TOKENS);
        assert.equal(end.purchases, 120);
    });

    test(`${weapon.name} (${weapon.id}): stages are strictly ordered and each node needs its own amity scrolls`, () => {
        resetPlayer(weapon.id, 0, 60, 2000);
        // 第 2 阶（Lv70）不能跳过第 1 阶；第 1 阶只能买到 69
        assert.throws(() => buy(sid(weapon.id, 2), 1), /not the current enhancement stage/);
        assert.throws(() => buy(sid(weapon.id, 1), 70), /Purchase count exceeds/);
        // 缺 1 张羁绊证：整笔回滚
        resetPlayer(weapon.id, 69, 9, 2000);
        const before = state(weapon.id);
        assert.throws(() => buy(sid(weapon.id, 2), 1), (error: unknown) =>
            error instanceof ShopPurchaseValidationError && /amity scrolls/.test(error.message));
        assert.deepEqual(state(weapon.id), before);
        // 节点：Lv70/99/120 各收 10/15/25
        for (const [level, stageNumber, scrolls] of [[69, 2, 10], [98, 4, 15], [119, 6, 25]] as const) {
            resetPlayer(weapon.id, level, 50, 1000);
            buy(sid(weapon.id, stageNumber), 1);
            assert.equal(state(weapon.id).tokens, 50 - scrolls);
            assert.equal(state(weapon.id).level, level + 1);
        }
    });
}

test("multi-level stages charge coins only; amity scrolls are untouched", () => {
    buy(sid(MALTE, 1), 40);
    assert.deepEqual(state(MALTE), { level: 40, coins: 2000 - 480, tokens: 60, purchases: 40 });
});

test("a node stage charges its amity scrolls and coins per unit", () => {
    resetPlayer(MALTE, 69, 10, 30);
    const result = buy(sid(MALTE, 2), 1);
    assert.deepEqual(state(MALTE), { level: 70, coins: 0, tokens: 0, purchases: 1 });
    assert.equal(result.bondTokens, 0);
});

test("not enough abyss coins rejects the node without side effects", () => {
    resetPlayer(MALTE, 69, 50, 29);
    const before = state(MALTE);
    assert.throws(() => buy(sid(MALTE, 2), 1), /Not enough of item/);
    assert.deepEqual(state(MALTE), before);
});

test("a single-level node cannot be bought twice or out of order", () => {
    resetPlayer(MALTE, 69, 50, 1000);
    const before = state(MALTE);
    assert.throws(() => buy(sid(MALTE, 2), 2), /Purchase count exceeds/);
    assert.throws(() => buy(sid(MALTE, 4), 1), /not the current enhancement stage/);
    assert.throws(() => buy(sid(MALTE, 6), 1), /not the current enhancement stage/);
    assert.deepEqual(state(MALTE), before);
    buy(sid(MALTE, 2), 1);
    assert.throws(() => buy(sid(MALTE, 2), 1), /already enhanced/);
});

// 已发布数据的漂移检查：assets/equipment_enhancement_shop.json（或 WF_BOND_SHOP_JSON 指向的暂存文件）里的 48 个羁绊键
// 必须逐键等于 EXPECTED。发布前 assets 里还没有这 48 键：允许 0 键，不允许残缺（只发了一部分 = 买不了/买错价）。
const STAGED_FILE = process.env.WF_BOND_SHOP_JSON;
const STAGED: Record<string, ShopItem> | null = STAGED_FILE
    ? JSON.parse(readFileSync(STAGED_FILE, "utf-8")) as Record<string, ShopItem>
    : null;

function shipped(shopItemId: number): ShopItem | null {
    if (STAGED) return STAGED[String(shopItemId)] ?? null;
    return getShopItemSync(ShopType.TREASURE_EQUIPMENT, shopItemId);
}

test("the shipped enhancement shop data carries all 48 bond keys exactly as expected, or none of them", () => {
    const ids = Object.keys(EXPECTED).map(Number);
    const present = ids.filter(id => shipped(id) !== null);
    if (STAGED) {
        assert.equal(present.length, 48, "WF_BOND_SHOP_JSON must carry all 48 bond keys");
    } else {
        assert.ok(present.length === 0 || present.length === 48,
            `partial bond shop data: ${present.length}/48 keys, first missing ${ids.find(id => !present.includes(id))}`);
    }
    for (const id of present) {
        assert.deepEqual(shipped(id), EXPECTED[id], `shop item ${id}`);
    }
});
