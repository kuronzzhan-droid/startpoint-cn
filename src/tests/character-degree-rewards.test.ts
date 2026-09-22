import assert from "node:assert/strict";
import Fastify from "fastify";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, mock, test } from "node:test";

// Must precede every database-dependent import.
const tempRoot = mkdtempSync(path.join(tmpdir(), "wf-character-degrees-"));
process.env.WF_DATABASE_DIR = tempRoot;
const configPath = path.join(tempRoot, "activation.json");
const { getDb } = require("../data/db") as typeof import("../data/db");
const degrees = require("../data/domains/degree") as typeof import("../data/domains/degree");
const rewards = require("../lib/character-degree-rewards") as typeof import("../lib/character-degree-rewards");
const catalog = require("../lib/character-degree-catalog") as typeof import("../lib/character-degree-catalog");
const characters = require("../data/domains/character") as typeof import("../data/domains/character");
const assets = require("../lib/assets") as typeof import("../lib/assets");
const { givePlayerCharactersExpSync, characterExpCaps } = require("../lib/character") as typeof import("../lib/character");
const { recordBattleMissionDimensions } = require("../lib/mission/battle-dimensions") as typeof import("../lib/mission/battle-dimensions");
const characterRoutes = require("../routes/api/character").default as typeof import("../routes/api/character").default;
const profileRoutes = require("../routes/api/profile").default as typeof import("../routes/api/profile").default;
const { QuestCategory } = require("../lib/types") as typeof import("../lib/types");
const originalGrant = rewards.grantCharacterDegreeRewardsSync;
const originalPracticeGrant = rewards.grantPracticeCharacterDegreeRewardsSync;
const CID = 119989;
const SECOND = 119996;
const VIEWER = 919191;
const db = getDb();

function activation(enabled = true): unknown {
    return { schema_version: 1, enabled, characters: catalog.CHARACTER_DEGREE_CATALOG };
}
function activate(value: unknown = activation()): void {
    writeFileSync(configPath, JSON.stringify(value));
}
function own(id = CID, exp = 379988, overLimitStep = 4, playerId = 1): void {
    characters.insertDefaultPlayerCharacterSync(playerId, id);
    characters.updatePlayerCharacterSync(playerId, id, { exp, overLimitStep, stack: 2 });
}
function owned(playerId = 1): number[] {
    return degrees.getPlayerDegreeIdsSync(playerId);
}
function grant(ids?: number[], playerId = 1): number[] {
    return originalGrant(playerId, ids, { configPath });
}
function practice(overrides: Partial<import("../lib/mission/events").BattleFinishMissionEvent> = {}) {
    return {
        type: "battle_finish" as const, playerId: 1, questCategory: QuestCategory.PRACTICE,
        questId: 1, accomplished: true, mode: "single" as const, clearTimeMs: 180000,
        partyCharacterIds: [], unisonCharacterIds: [],
        statistics: { dashCount: 0, skillCount: 0, powerFlipCount: 0, maxComboCount: 0 },
        ...overrides,
    };
}
function useFixtureActivation(): void {
    // Exercise actual production hook callers while keeping configuration wholly in tmpdir.
    mock.method(rewards, "grantCharacterDegreeRewardsSync", (playerId: number, ids?: number[]) =>
        originalGrant(playerId, ids, { configPath }));
    mock.method(rewards, "grantPracticeCharacterDegreeRewardsSync", (event: ReturnType<typeof practice>) =>
        originalPracticeGrant(event, { configPath }));
}
async function appFor(plugin: typeof characterRoutes | typeof profileRoutes, prefix: string) {
    const app = Fastify();
    app.addHook("preHandler", async (_request, reply) => {
        reply.serializer(payload => JSON.stringify(payload));
    });
    await app.register(plugin, { prefix });
    return app;
}

beforeEach(() => {
    mock.restoreAll();
    degrees.ensurePlayerDegreesTableSync();
    db.exec(`DROP TRIGGER IF EXISTS reject_second_degree;
        DELETE FROM players_degrees; DELETE FROM players_characters;
        DELETE FROM players_characters_bond_tokens; DELETE FROM sessions;
        DELETE FROM players; DELETE FROM accounts;`);
    const account = db.prepare(`INSERT INTO accounts (id, app_id, first_login_time, idp_alias, idp_code,
        idp_id, reg_time, last_login_time, status)
        VALUES (?, 'app', '2026-01-01', 'test', 'test', 'test', '2026-01-01', '2026-01-01', 'active')`);
    account.run(1);
    account.run(2);
    const player = db.prepare(`INSERT INTO players (id, stamina, stamina_heal_time, boost_point,
        boss_boost_point, transition_state, role, name, last_login_time, comment, vmoney,
        free_vmoney, rank_point, star_crumb, bond_token, exp_pool, exp_pooled_time,
        leader_character_id, party_slot, degree_id, birth, free_mana, paid_mana, enable_auto_3x,
        account_id) VALUES (?, 100, 0, 0, 0, 0, 0, 'degree-test', '2026-01-01', '',
        0, 0, 0, 0, 0, 1000000, 0, 0, 1, 1, 0, 0, 0, 0, ?)`);
    player.run(1, 1);
    player.run(2, 2);
    db.prepare(`INSERT INTO sessions (token, account_id, expires, type)
        VALUES (?, 1, '2099-01-01', 2)`).run(String(VIEWER));
    activate();
});
after(() => { mock.restoreAll(); db.close(); rmSync(tempRoot, { recursive: true, force: true }); });

test("36-character catalog preserves earlier IDs and agrees with five-star level caps", () => {
    assert.equal(catalog.CHARACTER_DEGREE_CATALOG.length, 36);
    assert.deepEqual(catalog.CHARACTER_DEGREE_CATALOG.flatMap(row => [...row.degree_ids]),
        Array.from({ length: 72 }, (_, index) => 9910001 + index));
    assert.equal(characterExpCaps[5][4], catalog.CHARACTER_DEGREE_LEVEL_100_EXP);
    for (const row of catalog.CHARACTER_DEGREE_CATALOG) {
        assert.equal(assets.getCharacterDataSync(row.character_id)?.rarity, 5);
    }
    assert.equal(catalog.CHARACTER_DEGREE_CHARACTER_IDS.includes(159999), false);
    assert.equal(catalog.CHARACTER_DEGREE_CHARACTER_IDS.includes(179981), false);
});

test("new twelve characters each grant two native degrees once after full training", () => {
    const ids = [119992, 119991, 119990, 139992, 139991, 139990,
        149987, 149986, 159995, 159994, 169991, 169988];
    for (const id of ids) own(id, 379987, 4);
    assert.deepEqual(grant(ids), []);
    for (const id of ids) characters.updatePlayerCharacterSync(1, id, { exp: 379988 });
    assert.deepEqual(grant(ids), Array.from({ length: 24 }, (_, index) => 9910049 + index));
    assert.deepEqual(grant(ids), []);
});

test("previous deployment activation cannot enable newly added unpublished degrees", () => {
    own(119990);
    activate({ schema_version: 1, enabled: true, characters: catalog.CHARACTER_DEGREE_CATALOG.slice(0, 24) });
    assert.deepEqual(grant([119990]), []);
});

test("missing/disabled/malformed activation fails closed; changed catalog cannot enable other rewards", () => {
    own();
    assert.equal(rewards.characterDegreeRewardsEnabled(path.join(tempRoot, "missing.json")), false);
    for (const value of [activation(false), {}, { ...activation() as object, enabled: "true" }]) {
        activate(value); assert.deepEqual(grant(), []);
    }
    const bad = JSON.parse(JSON.stringify(activation()));
    bad.characters[0].degree_ids[1] = 9900006;
    activate(bad); assert.deepEqual(grant(), []);
    bad.characters[0].degree_ids[1] = 9910002;
    bad.characters[0].character_id = 179981;
    activate(bad); assert.deepEqual(grant(), []);
    writeFileSync(configPath, "{"); assert.deepEqual(grant(), []);
    assert.deepEqual(owned(), []);
});

test("persisted exp threshold and exact full-break state are both required", () => {
    own(CID, 379987, 4);
    assert.deepEqual(grant(), []);
    characters.updatePlayerCharacterSync(1, CID, { exp: 379988, overLimitStep: 3 });
    assert.deepEqual(grant(), []);
    characters.updatePlayerCharacterSync(1, CID, { overLimitStep: 5 });
    assert.deepEqual(grant(), []);
    characters.updatePlayerCharacterSync(1, CID, { overLimitStep: 4, evolutionLevel: 0 });
    assert.deepEqual(grant(), [9910001, 9910002]);
    assert.equal(catalog.isCharacterDegreeEligible({ exp: NaN, over_limit_step: 4 }), false);
    assert.equal(catalog.isCharacterDegreeEligible({ exp: Infinity, over_limit_step: 4 }), false);
});

test("unowned, unknown-player, non-roster boss/miniboss cannot earn degrees", () => {
    assert.deepEqual(grant([CID]), []);
    own(179981); own(159999);
    assert.deepEqual(grant(), []);
    own();
    assert.deepEqual(grant(undefined, 999), []);
    assert.deepEqual(grant(undefined, -1), []);
    assert.deepEqual(grant([179981, 159999]), []);
    assert.deepEqual(owned(), []);
});

test("granting is account-scoped, repairs a missing variant, and replay is a no-op", () => {
    own(CID, 400000, 4, 1); own(SECOND, 379988, 4, 2);
    degrees.grantPlayerDegreeSync(1, 9910001);
    assert.deepEqual(grant([CID, CID]), [9910002]);
    assert.deepEqual(grant(), []);
    assert.deepEqual(owned(2), []);
    assert.deepEqual(grant(undefined, 2), [9910003, 9910004]);
    activate(activation(false));
    assert.deepEqual(grant(), []);
    assert.deepEqual(owned(), [9910001, 9910002]);
    assert.equal((db.prepare("SELECT degree_id FROM players WHERE id=1").get() as any).degree_id, 1);
});

test("a failed second insert rolls the whole pair back", () => {
    own();
    db.exec(`CREATE TRIGGER reject_second_degree BEFORE INSERT ON players_degrees
        WHEN NEW.degree_id = 9910002 BEGIN SELECT RAISE(ABORT, 'isolated failure'); END`);
    assert.throws(() => grant(), /isolated failure/);
    assert.deepEqual(owned(), []);
});

test("successful native practice backfills all eligible inventory, including characters outside party", () => {
    own(); own(SECOND); own(119997, 379987);
    assert.deepEqual(originalPracticeGrant(practice({ partyCharacterIds: [1] }), { configPath }),
        [9910001, 9910002, 9910003, 9910004]);
    assert.deepEqual(originalPracticeGrant(practice(), { configPath }), []);
});

test("one practice finish can grant all 72 reviewed variants and replay adds none", () => {
    for (const id of catalog.CHARACTER_DEGREE_CHARACTER_IDS) own(id);
    assert.deepEqual(originalPracticeGrant(practice(), { configPath }),
        Array.from({ length: 72 }, (_, index) => 9910001 + index));
    assert.deepEqual(originalPracticeGrant(practice(), { configPath }), []);
    assert.equal(owned().length, 72);
});

test("failed, unknown, wrong-category, malformed and multi practice events cannot backfill", () => {
    own();
    const cases = [
        { accomplished: false }, { accomplished: 1 as any }, { mode: "multi" as const },
        { questCategory: QuestCategory.MAIN }, { questCategory: QuestCategory.RUSH_EVENT, questId: 700098016 },
        { questId: 999999999 }, { questId: -1 }, { questId: 1.5 }, { type: "history" as any },
    ];
    for (const value of cases) {
        assert.deepEqual(originalPracticeGrant(practice(value), { configPath }), []);
    }
    assert.deepEqual(owned(), []);
});

test("existing EXP entry point awards at threshold while fixed-party ignore cannot award", () => {
    useFixtureActivation();
    own(CID, 379987);
    givePlayerCharactersExpSync(1, [CID], 1, true);
    assert.deepEqual(owned(), []);
    assert.equal(characters.getPlayerCharacterSync(1, CID)?.exp, 379987);
    givePlayerCharactersExpSync(1, [CID], 1, false);
    assert.deepEqual(owned(), [9910001, 9910002]);
    assert.equal(characters.getPlayerCharacterSync(1, CID)?.exp, 379988);
    givePlayerCharactersExpSync(1, [CID], 100, false);
    assert.equal(characters.getPlayerCharacterSync(1, CID)?.exp, 379988);
    assert.deepEqual(owned(), [9910001, 9910002]);
});

test("existing mission finish observer accepts only successful practice and scans inventory", () => {
    useFixtureActivation(); own(); own(SECOND);
    recordBattleMissionDimensions(practice({ accomplished: false }));
    recordBattleMissionDimensions(practice({ questCategory: QuestCategory.MAIN }));
    assert.deepEqual(owned(), []);
    recordBattleMissionDimensions(practice());
    assert.deepEqual(owned(), [9910001, 9910002, 9910003, 9910004]);
});

test("single breakthrough after imported level-100 EXP grants both; invalid viewer grants nothing", async () => {
    useFixtureActivation(); own(CID, 379988, 3);
    const app = await appFor(characterRoutes, "/character");
    try {
        const payload = { viewer_id: VIEWER, character_id: CID, use_stack: true, over_limit_count: 1 };
        assert.equal((await app.inject({ method: "POST", url: "/character/over_limit", payload: { ...payload, viewer_id: 0 } })).statusCode, 400);
        assert.deepEqual(owned(), []);
        const result = await app.inject({ method: "POST", url: "/character/over_limit", payload });
        assert.equal(result.statusCode, 200, result.body);
        assert.deepEqual(owned(), [9910001, 9910002]);
        assert.equal(result.json().data.character_list[0].over_limit_step, 4);
    } finally { await app.close(); }
});

test("item breakthrough uses the same reward check without changing item cost", async () => {
    useFixtureActivation(); own(CID, 379988, 3);
    const { givePlayerItemSync, getPlayerItemSync } = require("../data/domains/item") as typeof import("../data/domains/item");
    givePlayerItemSync(1, 10003, 2);
    const app = await appFor(characterRoutes, "/character");
    try {
        const result = await app.inject({ method: "POST", url: "/character/over_limit", payload: {
            viewer_id: VIEWER, character_id: CID, use_stack: false, item_id: 10003, over_limit_count: 1,
        } });
        assert.equal(result.statusCode, 200, result.body);
        assert.equal(getPlayerItemSync(1, 10003), 1);
        assert.deepEqual(owned(), [9910001, 9910002]);
    } finally { await app.close(); }
});

test("bulk breakthrough waits for subsequent EXP if needed and awards other ready characters", async () => {
    useFixtureActivation(); own(CID, 323488, 3); own(SECOND, 379988, 3);
    const app = await appFor(characterRoutes, "/character");
    try {
        const result = await app.inject({ method: "POST", url: "/character/bulk_over_limit", payload: { viewer_id: VIEWER } });
        assert.equal(result.statusCode, 200, result.body);
        assert.deepEqual(owned(), [9910003, 9910004]);
        givePlayerCharactersExpSync(1, [CID], 56500, false);
        assert.deepEqual(owned(), [9910001, 9910002, 9910003, 9910004]);
    } finally { await app.close(); }
});

test("native degree list exposes grants without granting on a read or changing worn title", async () => {
    own();
    const app = await appFor(profileRoutes, "/profile");
    try {
        const request = { method: "POST" as const, url: "/profile/get_degree_list", payload: { viewer_id: VIEWER } };
        assert.deepEqual((await app.inject(request)).json().data.degree_ids, [1]);
        grant();
        assert.deepEqual((await app.inject(request)).json().data.degree_ids, [1, 9910001, 9910002]);
        assert.equal((db.prepare("SELECT degree_id FROM players WHERE id=1").get() as any).degree_id, 1);
    } finally { await app.close(); }
});
