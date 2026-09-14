import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, mock, test } from "node:test";

const tempRoot = mkdtempSync(path.join(tmpdir(), "wf-equipment-degrees-"));
process.env.WF_DATABASE_DIR = tempRoot;
const configPath = path.join(tempRoot, "equipment.json");
const shopConfigPath = path.join(tempRoot, "shop.json");
const { getDb } = require("../data/db") as typeof import("../data/db");
const degrees = require("../data/domains/degree") as typeof import("../data/domains/degree");
const rewards = require("../lib/equipment-degree-rewards") as typeof import("../lib/equipment-degree-rewards");
const { executeShopPurchasesSync } = require("../lib/shop-purchase") as typeof import("../lib/shop-purchase");
const { recordBattleMissionDimensions } = require("../lib/mission/battle-dimensions") as typeof import("../lib/mission/battle-dimensions");
const { QuestCategory, ShopType } = require("../lib/types") as typeof import("../lib/types");
const originalGrant = rewards.grantEquipmentDegreeRewardsSync;
const originalPractice = rewards.grantPracticeExclusiveDegreeRewardsSync;
const db = getDb();
const [ABYSS, DEATH] = rewards.EQUIPMENT_DEGREE_CATALOG;

function activation(enabled = true) {
    return { schema_version: 1, enabled, rewards: rewards.EQUIPMENT_DEGREE_CATALOG };
}
function activate(value: unknown = activation()) { writeFileSync(configPath, JSON.stringify(value)); }
function own(id: number, enhancement = 120, playerId = 1) {
    db.prepare(`INSERT INTO players_equipment (player_id, id, level, enhancement_level, protection, stack)
        VALUES (?, ?, 0, ?, 0, 0) ON CONFLICT(player_id, id)
        DO UPDATE SET enhancement_level = excluded.enhancement_level`).run(playerId, id, enhancement);
}
function allEquipment(playerId = 1) {
    for (const entry of rewards.EQUIPMENT_DEGREE_CATALOG) for (const id of entry.equipment_ids) own(id, 120, playerId);
}
function ownTickets() {
    for (const id of [9700116, 9700117]) {
        db.prepare("INSERT INTO players_shop_purchases (player_id, shop_item_id, count) VALUES (1, ?, 9999)").run(id);
    }
}
function owned(playerId = 1) { return degrees.getPlayerDegreeIdsSync(playerId); }
function grant(playerId = 1, ids?: readonly number[]) { return originalGrant(playerId, ids, { configPath }); }
function practice(overrides: Partial<import("../lib/mission/events").BattleFinishMissionEvent> = {}) {
    return { type: "battle_finish" as const, playerId: 1, questCategory: QuestCategory.PRACTICE,
        questId: 1, accomplished: true, mode: "single" as const, clearTimeMs: 180000,
        partyCharacterIds: [], unisonCharacterIds: [],
        statistics: { dashCount: 0, skillCount: 0, powerFlipCount: 0, maxComboCount: 0 }, ...overrides };
}
function backfill(event = practice()) { return originalPractice(event, { configPath, shopConfigPath }); }
function useFixtureActivation() {
    mock.method(rewards, "grantEquipmentDegreeRewardsSync", (playerId: number, ids?: readonly number[]) => grant(playerId, ids));
    mock.method(rewards, "grantPracticeExclusiveDegreeRewardsSync", (event: ReturnType<typeof practice>) => backfill(event));
}
function enhance(id: number) {
    return executeShopPurchasesSync({ playerId: 1, shopType: ShopType.TREASURE_EQUIPMENT,
        purchases: [{ shopItemId: 880001, count: 1 }],
        resolveShopItem: () => ({ equipmentId: id, enhancementMaxLevel: 120,
            costs: [{ id: 2370099, amount: 5 }], rewards: [], stock: 1,
            availableFrom: "2000-01-01 00:00:00", availableUntil: "2099-12-31 23:59:59" }) });
}
function state() {
    return { equipment: db.prepare("SELECT * FROM players_equipment ORDER BY player_id, id").all(),
        purchases: db.prepare("SELECT * FROM players_shop_purchases ORDER BY player_id, shop_item_id").all(),
        items: db.prepare("SELECT * FROM players_items ORDER BY player_id, id").all(), degrees: owned() };
}

beforeEach(() => {
    mock.restoreAll(); degrees.ensurePlayerDegreesTableSync();
    db.exec(`DROP TRIGGER IF EXISTS reject_equipment_degree; DELETE FROM players_degrees;
        DELETE FROM players_equipment; DELETE FROM players_items; DELETE FROM players_shop_purchases;
        DELETE FROM sessions; DELETE FROM players; DELETE FROM accounts;`);
    const account = db.prepare(`INSERT INTO accounts (id, app_id, first_login_time, idp_alias, idp_code,
        idp_id, reg_time, last_login_time, status)
        VALUES (?, 'app', '2026-01-01', 'test', 'test', 'test', '2026-01-01', '2026-01-01', 'active')`);
    account.run(1); account.run(2);
    const player = db.prepare(`INSERT INTO players (id, stamina, stamina_heal_time, boost_point,
        boss_boost_point, transition_state, role, name, last_login_time, comment, vmoney,
        free_vmoney, rank_point, star_crumb, bond_token, exp_pool, exp_pooled_time,
        leader_character_id, party_slot, degree_id, birth, free_mana, paid_mana, enable_auto_3x,
        account_id) VALUES (?, 100, 0, 0, 0, 0, 0, 'equipment-degree-test', '2026-01-01', '',
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, ?)`);
    player.run(1, 1); player.run(2, 2);
    db.prepare("INSERT INTO players_items (player_id, id, amount) VALUES (1, 2370099, 100000)").run();
    activate();
    writeFileSync(shopConfigPath, JSON.stringify({ schema_version: 1, enabled: true, degree_id: 9911001,
        shop_item_ids: [9700116, 9700117], required_purchases: 9999 }));
});
after(() => { mock.restoreAll(); db.close(); rmSync(tempRoot, { recursive: true, force: true }); });

test("catalog fixes all fifteen abyss weapons and the unchanged deathbringer ID", () => {
    assert.deepEqual(ABYSS.equipment_ids, Array.from({ length: 15 }, (_, i) => 8000101 + i));
    assert.deepEqual(DEATH.equipment_ids, [5900101]);
    assert.deepEqual([ABYSS.degree_id, DEATH.degree_id], [9911002, 9911003]);
    for (const value of [0, 119, 120.5, "120", null, undefined, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        assert.equal(rewards.isEquipmentDegreeEnhancementComplete(value), false);
    }
    for (const value of [120, 121]) assert.equal(rewards.isEquipmentDegreeEnhancementComplete(value), true);
});

test("missing, disabled, malformed or changed configuration opens no reward transaction", () => {
    allEquipment();
    assert.equal(rewards.equipmentDegreeRewardsEnabled(path.join(tempRoot, "missing.json")), false);
    mock.method(db, "transaction", () => { throw new Error("unexpected reward transaction"); });
    for (const value of [activation(false), {}, null, { ...activation(), enabled: 1 },
        { ...activation(), rewards: [{ ...ABYSS, min_enhancement_level: 1 }, DEATH] },
        { ...activation(), rewards: [{ ...ABYSS, equipment_ids: [8000101] }, DEATH] },
        { ...activation(), rewards: [ABYSS, { ...DEATH, degree_id: 1 }] }]) {
        activate(value); assert.deepEqual(grant(), []);
    }
    writeFileSync(configPath, "{"); assert.deepEqual(grant(), []);
});

test("all fifteen persisted rows must be present and enhanced; normal awakening cannot substitute", () => {
    for (const id of ABYSS.equipment_ids.slice(0, 14)) own(id);
    assert.deepEqual(grant(), []);
    own(8000115, 119);
    db.exec("UPDATE players_equipment SET level = 5, stack = 99");
    assert.deepEqual(grant(), []);
    own(8000115, 120); assert.deepEqual(grant(), [ABYSS.degree_id]);
});

test("zero duplicate stack, unawakened and unequipped records still qualify; grants never revoke", () => {
    allEquipment(); assert.deepEqual(grant(), [ABYSS.degree_id, DEATH.degree_id]);
    assert.deepEqual(grant(), []);
    db.exec("UPDATE players_equipment SET enhancement_level = 0");
    assert.deepEqual(grant(), []); assert.deepEqual(owned(), [ABYSS.degree_id, DEATH.degree_id]);
});

test("deathbringer and abyss requirements are independent and player scoped", () => {
    own(5900101); assert.deepEqual(grant(), [DEATH.degree_id]);
    allEquipment(2); assert.deepEqual(grant(2), [ABYSS.degree_id, DEATH.degree_id]);
    assert.deepEqual(owned(1), [DEATH.degree_id]);
    for (const id of [0, -1, 999, NaN]) assert.deepEqual(grant(id), []);
});

test("updates outside the catalog do not check or award unrelated ready equipment", () => {
    allEquipment(); mock.method(db, "transaction", () => { throw new Error("unexpected reward transaction"); });
    assert.deepEqual(grant(1, [123]), []); assert.deepEqual(grant(1, []), []);
});

test("enhancing the final abyss weapon grants immediately inside the native purchase transaction", () => {
    allEquipment(); own(8000115, 119); useFixtureActivation();
    enhance(8000115); assert.deepEqual(owned(), [ABYSS.degree_id]);
    assert.equal((db.prepare("SELECT enhancement_level FROM players_equipment WHERE player_id=1 AND id=8000115")
        .get() as { enhancement_level: number }).enhancement_level, 120);
});

test("enhancing deathbringer to 120 awards only its degree and replay cannot double charge", () => {
    own(5900101, 119); useFixtureActivation();
    enhance(5900101); assert.deepEqual(owned(), [DEATH.degree_id]);
    const after = state(); assert.throws(() => enhance(5900101)); assert.deepEqual(state(), after);
});

test("a degree insertion failure rolls back the actual enhancement, costs and purchase count", () => {
    own(5900101, 119); useFixtureActivation();
    db.exec(`CREATE TRIGGER reject_equipment_degree BEFORE INSERT ON players_degrees
        WHEN NEW.degree_id = ${DEATH.degree_id} BEGIN SELECT RAISE(ABORT, 'degree failure'); END;`);
    const before = state(); assert.throws(() => enhance(5900101)); assert.deepEqual(state(), before);
});

test("the equipment pair backfill is atomic when the second degree fails", () => {
    allEquipment();
    db.exec(`CREATE TRIGGER reject_equipment_degree BEFORE INSERT ON players_degrees
        WHEN NEW.degree_id = ${DEATH.degree_id} BEGIN SELECT RAISE(ABORT, 'degree failure'); END;`);
    assert.throws(() => grant()); assert.deepEqual(owned(), []);
});

test("one native successful practice backfills all three exclusive degrees independently of party", () => {
    allEquipment(); ownTickets(); useFixtureActivation();
    recordBattleMissionDimensions(practice());
    assert.deepEqual(owned(), [9911001, 9911002, 9911003]);
    recordBattleMissionDimensions(practice()); assert.deepEqual(backfill(), []);
    assert.deepEqual(owned(), [9911001, 9911002, 9911003]);
});

test("failed, wrong-category, multi, nonexistent and malformed practice events never backfill", () => {
    allEquipment(); ownTickets();
    const invalid = [{ accomplished: false }, { mode: "multi" as const }, { questCategory: QuestCategory.MAIN },
        { questId: 999999999 }, { questId: 0 }, { questId: 1.5 }, { questId: NaN }, { playerId: 0 }];
    for (const value of invalid) assert.deepEqual(backfill(practice(value)), []);
    assert.deepEqual(owned(), []);
});

test("practice with both gates disabled performs no new reward database transaction", () => {
    allEquipment(); ownTickets(); activate(activation(false)); writeFileSync(shopConfigPath, "{}");
    mock.method(db, "transaction", () => { throw new Error("unexpected reward transaction"); });
    assert.deepEqual(backfill(), []);
});

test("a practice reward failure rolls back all three exclusive awards in the native observer", () => {
    allEquipment(); ownTickets(); useFixtureActivation();
    db.exec(`CREATE TRIGGER reject_equipment_degree BEFORE INSERT ON players_degrees
        WHEN NEW.degree_id = ${DEATH.degree_id} BEGIN SELECT RAISE(ABORT, 'degree failure'); END;`);
    assert.throws(() => recordBattleMissionDimensions(practice())); assert.deepEqual(owned(), []);
});
