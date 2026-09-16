import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, mock, test } from "node:test";
import Fastify from "fastify";

const temp = mkdtempSync(path.join(tmpdir(), "wf-abyss-endurance-"));
process.env.WF_DATABASE_DIR = temp;
const { getDb } = require("../data/db") as typeof import("../data/db");
const degrees = require("../data/domains/degree") as typeof import("../data/domains/degree");
const reward = require("../lib/abyss-endurance-degree-reward") as typeof import("../lib/abyss-endurance-degree-reward");
const { rushLeaderboardStore: store } = require("../data/domains/rushLeaderboard") as typeof import("../data/domains/rushLeaderboard");
const service = require("../lib/rush-leaderboard-service") as typeof import("../lib/rush-leaderboard-service");
const profiles = require("../routes/api/profile").default as typeof import("../routes/api/profile").default;
const configPath = path.join(temp, "activation.json");
const db = getDb();
const originalGrant = reward.grantAbyssEnduranceDegreesSync;
const grant = (id = 1) => originalGrant(id, { configPath });
const ids = [9911101, 9911102, 9911103];
const minute = 60_000;
const config = { schema_version: 1, enabled: true, event_id: 700099, folder_id: 1,
    clock: "battle_ms", comparison: ">", cumulative: true,
    rewards: reward.ABYSS_ENDURANCE_REWARDS.map(r => ({ degree_id: r.degreeId, minutes: r.minutes })) };
function activate(value: unknown = config) { writeFileSync(configPath, JSON.stringify(value)); }
function run(battleMs: number, patch: Record<string, unknown> = {}, player = 1, event = 700099, folder = 1) {
    const r = store.insertRun({ playerId: player, playerName: "fixture", eventId: event, folderId: folder,
        season: 1, startedAtMs: 1000, totalRounds: 30, trackedFromRound: 1 });
    store.updateRun(r.id, { status: "completed", battleMs, durationMs: battleMs + 1000,
        finishedAtMs: battleMs + 2000, roundsCleared: 30, ...patch });
    return r;
}
beforeEach(() => {
    mock.restoreAll(); degrees.ensurePlayerDegreesTableSync();
    db.exec(`DROP TRIGGER IF EXISTS reject_endurance;
        DELETE FROM players_degrees; DELETE FROM players_rush_event_runs;
        DELETE FROM sessions; DELETE FROM players; DELETE FROM accounts;`);
    for (const id of [1, 2]) {
        db.prepare(`INSERT INTO accounts (id, app_id, first_login_time, idp_alias, idp_code, idp_id,
            reg_time, last_login_time, status) VALUES (?, 'app', '2026-01-01', 'test', 'test', 'test',
            '2026-01-01', '2026-01-01', 'active')`).run(id);
        db.prepare(`INSERT INTO players (id, stamina, stamina_heal_time, boost_point, boss_boost_point,
            transition_state, role, name, last_login_time, comment, vmoney, free_vmoney, rank_point,
            star_crumb, bond_token, exp_pool, exp_pooled_time, leader_character_id, party_slot, degree_id,
            birth, free_mana, paid_mana, enable_auto_3x, account_id)
            VALUES (?, 100, 0, 0, 0, 0, 0, 'fixture', '2026-01-01', '', 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, ?)`).run(id, id);
    }
    activate();
});
after(() => { mock.restoreAll(); db.close(); rmSync(temp, { recursive: true, force: true }); });

test("strict millisecond boundaries and cumulative titles", () => {
    for (let i = 0; i < 3; i++) {
        const threshold = (i + 1) * 60 * minute;
        assert.deepEqual(reward.enduranceDegreeIds(threshold - 1), ids.slice(0, i));
        assert.deepEqual(reward.enduranceDegreeIds(threshold), ids.slice(0, i));
        assert.deepEqual(reward.enduranceDegreeIds(threshold + 1), ids.slice(0, i + 1));
    }
    for (const bad of [NaN, Infinity, -1, 0, 10_800_000.5]) assert.deepEqual(reward.enduranceDegreeIds(bad), []);
});
test("one full run grants all qualifying titles once and isolates players", () => {
    run(181 * minute, {}, 2);
    assert.deepEqual(grant(1), []); assert.deepEqual(grant(2), ids); assert.deepEqual(grant(2), []);
    assert.deepEqual(degrees.getPlayerDegreeIdsSync(2), ids);
    for (const bad of [0, -1, NaN, 999]) assert.deepEqual(grant(bad), []);
});
test("idle wall time, failed or partial runs, endless and other events never qualify", () => {
    run(30 * minute, { durationMs: 240 * minute });
    run(240 * minute, { status: "active" });
    run(240 * minute, { status: "abandoned" });
    run(240 * minute, { roundsCleared: 29 });
    const adopted = run(240 * minute);
    db.prepare("UPDATE players_rush_event_runs SET tracked_from_round = 2 WHERE id = ?").run(adopted.id);
    run(240 * minute, {}, 1, 700098); run(240 * minute, {}, 1, 700099, 2);
    assert.deepEqual(grant(), []);
});
test("different runs are not summed and older slow records are not limited to fastest 500", () => {
    run(40 * minute); run(40 * minute); assert.deepEqual(grant(), []);
    run(181 * minute);
    for (let i = 0; i < 501; i++) run(minute);
    assert.deepEqual(grant(), ids);
});
test("activation rejects missing, disabled, malformed and mismatched rules", () => {
    run(181 * minute);
    assert.equal(reward.enduranceDegreesEnabled(path.join(temp, "missing")), false);
    for (const value of [{}, { ...config, enabled: false }, { ...config, event_id: 700098 },
        { ...config, clock: "duration_ms" }, { ...config, comparison: ">=" },
        { ...config, rewards: [{ degree_id: 1, minutes: 60 }] }]) {
        activate(value); assert.deepEqual(grant(), []);
    }
    writeFileSync(configPath, "{"); assert.deepEqual(grant(), []);
});
test("an interrupted grant rolls back every title and safely retries", () => {
    run(181 * minute);
    db.exec(`CREATE TRIGGER reject_endurance BEFORE INSERT ON players_degrees
        WHEN NEW.degree_id = 9911102 BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;`);
    mock.method(console, "error", () => {});
    assert.deepEqual(grant(), []); assert.deepEqual(degrees.getPlayerDegreeIdsSync(1), []);
    db.exec("DROP TRIGGER reject_endurance"); assert.deepEqual(grant(), ids);
});
test("final round hook uses persisted accumulated battle time and repeated finish is idempotent", () => {
    const r = run(179 * minute, { status: "active", roundsCleared: 29, durationMs: null, finishedAtMs: null });
    mock.method(reward, "grantAbyssEnduranceDegreesSync", (player: number) => grant(player));
    mock.method(service, "getRushFolderTotalRoundsSync", () => 30);
    const input = { playerId: 1, eventId: 700099, folderId: 1, round: 30, accomplished: true,
        elapsedMs: 2 * minute, characterIds: [], unisonCharacterIds: [] };
    service.noteRushRoundFinish(input);
    assert.deepEqual(degrees.getPlayerDegreeIdsSync(1), ids);
    assert.equal((db.prepare("SELECT battle_ms FROM players_rush_event_runs WHERE id = ?").get(r.id) as any).battle_ms, 181 * minute);
    service.noteRushRoundFinish(input); assert.deepEqual(degrees.getPlayerDegreeIdsSync(1), ids);
});
test("native degree list reconciles historical eligible records on the authenticated player's profile", async () => {
    run(181 * minute);
    db.prepare("INSERT INTO sessions (token, account_id, expires, type) VALUES ('919193', 1, '2099-01-01', 2)").run();
    mock.method(reward, "grantAbyssEnduranceDegreesSync", (player: number) => grant(player));
    const app = Fastify();
    app.addHook("preHandler", async (_request, reply) => { reply.serializer(payload => JSON.stringify(payload)); });
    await app.register(profiles, { prefix: "/profile" });
    try {
        const response = await app.inject({ method: "POST", url: "/profile/get_degree_list", payload: { viewer_id: 919193 } });
        assert.equal(response.statusCode, 200); assert.deepEqual(response.json().data.degree_ids, [1, ...ids]);
        assert.deepEqual(degrees.getPlayerDegreeIdsSync(2), []);
    } finally { await app.close(); }
});
