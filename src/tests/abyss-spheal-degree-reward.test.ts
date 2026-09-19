import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, mock, test } from "node:test";
import Fastify from "fastify";

const temp = mkdtempSync(path.join(tmpdir(), "wf-abyss-spheal-"));
process.env.WF_DATABASE_DIR = temp;
const { getDb } = require("../data/db") as typeof import("../data/db");
const degrees = require("../data/domains/degree") as typeof import("../data/domains/degree");
const reward = require("../lib/abyss-spheal-degree-reward") as typeof import("../lib/abyss-spheal-degree-reward");
const { rushLeaderboardStore: store } = require("../data/domains/rushLeaderboard") as typeof import("../data/domains/rushLeaderboard");
const service = require("../lib/rush-leaderboard-service") as typeof import("../lib/rush-leaderboard-service");
const profiles = require("../routes/api/profile").default as typeof import("../routes/api/profile").default;
const configPath = path.join(temp, "activation.json");
const db = getDb();
const originalGrant = reward.grantAbyssSphealDegreeSync;
const grant = (id = 1) => originalGrant(id, { configPath });
const ids = [9911301];
const minute = 60_000;
const config = { schema_version: 1, enabled: true, event_id: 700099, folder_id: 1,
    degree_id: 9911301, character_id: 129990, party_scope: "final_clear_main_or_unison" };
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
    db.exec(`DROP TRIGGER IF EXISTS reject_spheal;
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

test("any main or unison slot qualifies and reward is permanent and idempotent", () => {
    for (const slot of ["characterIds", "unisonCharacterIds"]) {
        for (let i = 0; i < 3; i++) {
            db.exec("DELETE FROM players_rush_event_runs; DELETE FROM players_degrees");
            const party: (number | null)[] = [null, null, null]; party[i] = 129990;
            run(minute, { [slot]: party });
            assert.deepEqual(grant(), ids); assert.deepEqual(grant(), []);
            db.exec("DELETE FROM players_rush_event_runs");
            assert.deepEqual(degrees.getPlayerDegreeIdsSync(1), ids);
        }
    }
});

test("missing character and another player's final-clear party do not qualify", () => {
    run(minute, { characterIds: [129989, null, null] });
    run(minute, { unisonCharacterIds: [129990] }, 2);
    assert.deepEqual(grant(1), []); assert.deepEqual(grant(2), ids);
    for (const id of [0, -1, NaN, 999]) assert.deepEqual(grant(id), []);
});

test("failed, active, partial, adopted runs, endless and other events are excluded", () => {
    const party = { characterIds: [129990] };
    for (const patch of [{ status: "active" }, { status: "abandoned" }, { roundsCleared: 29 },
        { battleMs: 0 }]) run(minute, { ...party, ...patch });
    const emptyTower = run(minute, party);
    db.prepare("UPDATE players_rush_event_runs SET total_rounds = 0 WHERE id = ?").run(emptyTower.id);
    const adopted = run(minute, party);
    db.prepare("UPDATE players_rush_event_runs SET tracked_from_round = 2 WHERE id = ?").run(adopted.id);
    run(minute, party, 1, 700098); run(minute, party, 1, 700099, 2);
    assert.deepEqual(grant(), []);
});

test("eligibility considers older completed runs beyond the first 500", () => {
    run(2 * minute, { characterIds: [129990] });
    for (let i = 0; i < 501; i++) run(minute);
    assert.deepEqual(grant(), ids);
});

test("missing or mismatched activation fails closed", () => {
    run(minute, { characterIds: [129990] });
    assert.equal(reward.sphealDegreeEnabled(path.join(temp, "missing")), false);
    for (const value of [{}, { ...config, enabled: false }, { ...config, event_id: 700098 },
        { ...config, folder_id: 2 }, { ...config, character_id: 1 }, { ...config, degree_id: 1 },
        { ...config, party_scope: "owned" }]) {
        activate(value); assert.deepEqual(grant(), []);
    }
    writeFileSync(configPath, "{"); assert.deepEqual(grant(), []);
});

test("failed insert does not break settlement and is retried from persistent evidence", () => {
    run(minute, { characterIds: [129990] });
    db.exec(`CREATE TRIGGER reject_spheal BEFORE INSERT ON players_degrees
        WHEN NEW.degree_id = 9911301 BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;`);
    mock.method(console, "error", () => {});
    assert.deepEqual(grant(), []); assert.deepEqual(degrees.getPlayerDegreeIdsSync(1), []);
    db.exec("DROP TRIGGER reject_spheal"); assert.deepEqual(grant(), ids);
});

test("final round hook awards only after successful completion using that battle's party", () => {
    run(minute, { status: "active", roundsCleared: 29, durationMs: null, finishedAtMs: null });
    mock.method(reward, "grantAbyssSphealDegreeSync", (player: number) => grant(player));
    mock.method(service, "getRushFolderTotalRoundsSync", () => 30);
    const input = { playerId: 1, eventId: 700099, folderId: 1, round: 30, accomplished: false,
        elapsedMs: minute, characterIds: [], unisonCharacterIds: [129990] };
    service.noteRushRoundFinish(input); assert.deepEqual(degrees.getPlayerDegreeIdsSync(1), []);
    service.noteRushRoundFinish({ ...input, accomplished: true });
    assert.deepEqual(degrees.getPlayerDegreeIdsSync(1), ids);
    service.noteRushRoundFinish({ ...input, accomplished: true });
    assert.deepEqual(degrees.getPlayerDegreeIdsSync(1), ids);
});

test("removing Spheal before the final clear does not qualify", () => {
    run(minute, { status: "active", roundsCleared: 29, durationMs: null, finishedAtMs: null,
        characterIds: [129990] });
    mock.method(reward, "grantAbyssSphealDegreeSync", (player: number) => grant(player));
    mock.method(service, "getRushFolderTotalRoundsSync", () => 30);
    service.noteRushRoundFinish({ playerId: 1, eventId: 700099, folderId: 1, round: 30,
        accomplished: true, elapsedMs: minute, characterIds: [1], unisonCharacterIds: [] });
    assert.deepEqual(degrees.getPlayerDegreeIdsSync(1), []);
});

test("authenticated degree list reconciles earned titles without granting to other saves", async () => {
    run(minute, { characterIds: [129990] });
    db.prepare("INSERT INTO sessions (token, account_id, expires, type) VALUES ('919194', 1, '2099-01-01', 2)").run();
    mock.method(reward, "grantAbyssSphealDegreeSync", (player: number) => grant(player));
    const app = Fastify();
    app.addHook("preHandler", async (_request, reply) => { reply.serializer(payload => JSON.stringify(payload)); });
    await app.register(profiles, { prefix: "/profile" });
    try {
        const response = await app.inject({ method: "POST", url: "/profile/get_degree_list", payload: { viewer_id: 919194 } });
        assert.equal(response.statusCode, 200); assert.deepEqual(response.json().data.degree_ids, [1, ...ids]);
        assert.deepEqual(degrees.getPlayerDegreeIdsSync(2), []);
    } finally { await app.close(); }
});
