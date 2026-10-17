const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const Sqlite = require("better-sqlite3")
const Fastify = require("fastify")
const { pack, unpack } = require("msgpackr")

const temporaryDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "starpoint-abyss-time-test-"))
process.env.DATA_DIR = temporaryDataDir
const version = require("../out/lib/version")
const readPublishedManifest = version.getPatchManifest
const patch = (version, revision, enabled = true) => ({
    id: `tower-${version}`, type: "patch", version, enabled,
    quest_time_revisions: { "rush:700099": revision },
})
const firstRevision = "a".repeat(64)
const secondRevision = "b".repeat(64)
let manifest = { patches: [patch("1.4.96", firstRevision)] }
version.getPatchManifest = () => manifest

const { resolveAbyssTimeRevision } = require("../out/lib/abyss-time-revision")
const { initializeQuestTimeRevision } = require("../out/data/initializers/quest-time-revision")
const { getDb } = require("../out/data/db")
const { insertAccountSync } = require("../out/data/domains/account")
const { insertDefaultPlayerSync } = require("../out/data/domains/player")
const { getPlayerActiveQuestSync, deletePlayerActiveQuestSync } = require("../out/data/domains/quest_active")
const {
    getPlayerQuestProgressSync, getPlayerQuestProgressSubsetSync,
    getPlayerSingleQuestProgressSync, insertPlayerQuestProgressSync,
} = require("../out/data/domains/quest")
const { getClientSerializedData } = require("../out/data/utils")
const { default: finishRoutes, insertActiveQuest, activeQuests } = require("../out/routes/api/singleBattleQuest")
const rushRoutes = require("../out/routes/api/rushEvent").default
const db = getDb()
test.after(() => {
    version.getPatchManifest = readPublishedManifest
    db.close()
    fs.rmSync(temporaryDataDir, { recursive: true, force: true })
})

function player() {
    const account = insertAccountSync({ appId: "wf_cn", idpAlias: "", idpCode: "test", idpId: "", status: "normal" })
    const result = insertDefaultPlayerSync(account.id)
    const viewerId = 810000000 + result.id
    db.prepare("INSERT INTO sessions (token, account_id, expires, type) VALUES (?, ?, ?, 2)")
        .run(String(viewerId), account.id, "2099-01-01T00:00:00.000Z")
    return { id: result.id, viewerId }
}

function stored(playerId, section, questId) {
    return db.prepare("SELECT * FROM players_quest_progress WHERE player_id=? AND section=? AND quest_id=?")
        .get(playerId, section, questId)
}

function seed(playerId, section, questId, revision = null) {
    db.prepare(`INSERT OR REPLACE INTO players_quest_progress
        (player_id, section, quest_id, finished, host_finished, unlocked, high_score,
         clear_rank, best_elapsed_time_ms, leader_character_id, multi_clear_count,
         s_plus_reward_received, best_time_revision)
        VALUES (?, ?, ?, 1, 1, 1, 12345, 5, 1000, 1, 7, 1, ?)`)
        .run(playerId, section, questId, revision)
}

test("old databases migrate idempotently without changing clear or reward state", () => {
    const memory = new Sqlite(":memory:")
    try {
        memory.exec(`CREATE TABLE players_quest_progress (best_elapsed_time_ms INTEGER, finished INTEGER);
            INSERT INTO players_quest_progress VALUES (1234, 1);
            CREATE TABLE players_active_quests (play_id TEXT);
            INSERT INTO players_active_quests VALUES ('old-battle');`)
        initializeQuestTimeRevision(memory)
        initializeQuestTimeRevision(memory)
        assert.deepEqual(memory.prepare("SELECT * FROM players_quest_progress").get(), {
            best_elapsed_time_ms: 1234, finished: 1, best_time_revision: null,
        })
        assert.deepEqual(memory.prepare("SELECT * FROM players_active_quests").get(), {
            play_id: "old-battle", quest_time_revision: null,
        })
    } finally { memory.close() }
})

test("only the latest enabled tower fingerprint selects the record version", () => {
    assert.equal(resolveAbyssTimeRevision([
        patch("1.4.99", secondRevision, false), patch("1.4.96", firstRevision),
        { id: "icons", type: "patch", version: "1.4.101", enabled: true },
    ]), firstRevision)
    assert.equal(resolveAbyssTimeRevision([patch("1.4.102", secondRevision), patch("1.4.96", firstRevision)]), secondRevision)
    assert.throws(() => resolveAbyssTimeRevision([patch("1.4.102", secondRevision), patch("1.4.102", firstRevision)]), /Conflicting/)
    assert.throws(() => resolveAbyssTimeRevision([patch("1.4.102", "bad")]), /Invalid/)
})

test("legacy times become null in the real client payload; other data and bosses remain intact", () => {
    manifest = { patches: [patch("1.4.96", firstRevision)] }
    const p = player()
    for (let round = 1; round <= 30; round++) seed(p.id, 24, 700099000 + round)
    const otherQuests = [[2, 1010001], [24, 700098001], [24, 700007001], [24, 700099099], [2, 700099001]]
    for (const [section, quest] of otherQuests) seed(p.id, section, quest)
    const before = stored(p.id, 24, 700099001)
    const otherBefore = otherQuests.map(([section, quest]) => stored(p.id, section, quest))
    const payload = getClientSerializedData(p.id, { viewerId: p.viewerId })
    const tower = payload.quest_progress[24].filter(q => q.quest_id >= 700099001 && q.quest_id <= 700099030)
    assert.equal(tower.length, 30)
    assert.ok(tower.every(q => q.best_elapsed_time_ms === null))
    assert.deepEqual(stored(p.id, 24, 700099001), { ...before, best_elapsed_time_ms: null, best_time_revision: firstRevision })
    assert.deepEqual(otherQuests.map(([section, quest]) => stored(p.id, section, quest)), otherBefore)
})

test("new tower clears every floor once, repeated reads preserve new records, rollback also resets", () => {
    manifest = { patches: [patch("1.4.96", firstRevision)] }
    const p = player()
    seed(p.id, 24, 700099001, firstRevision)
    seed(p.id, 24, 700099030, firstRevision)
    assert.equal(getPlayerSingleQuestProgressSync(p.id, 24, 700099001).bestElapsedTimeMs, 1000)
    manifest.patches.push(patch("1.4.102", secondRevision))
    assert.equal(getPlayerQuestProgressSubsetSync(p.id, { questIds: [700099001] })[24][0].bestElapsedTimeMs, null)
    assert.equal(stored(p.id, 24, 700099030).best_elapsed_time_ms, null)
    seed(p.id, 24, 700099001, secondRevision)
    getPlayerQuestProgressSync(p.id)
    manifest.patches.push({ id: "icons", type: "patch", version: "1.4.103", enabled: true })
    assert.equal(getPlayerSingleQuestProgressSync(p.id, 24, 700099001).bestElapsedTimeMs, 1000)
    manifest.patches[1].enabled = false
    assert.equal(getPlayerSingleQuestProgressSync(p.id, 24, 700099001).bestElapsedTimeMs, null)
    insertPlayerQuestProgressSync(p.id, 24, { questId: 700099002, finished: true, bestElapsedTimeMs: 4321 })
    assert.equal(getPlayerSingleQuestProgressSync(p.id, 24, 700099002).bestElapsedTimeMs, 4321)
})

test("real finish establishes and improves the new best; failure and old-tower finishes cannot write it", async () => {
    manifest = { patches: [patch("1.4.96", firstRevision)] }
    const p = player()
    seed(p.id, 24, 700099001, firstRevision)
    const app = Fastify()
    app.addHook("onSend", (_request, reply, payload, done) => {
        done(null, reply.getHeader("content-type") === "application/x-msgpack"
            ? pack(payload).toString("base64") : payload)
    })
    await app.register(finishRoutes, { prefix: "/single_battle_quest" })
    await app.register(rushRoutes, { prefix: "/event/rush" })
    let count = 0
    const start = () => insertActiveQuest(p.id, {
        category: 24, questId: 700099001, useBossBoostPoint: false, useBoostPoint: false,
        isAutoStartMode: false, isMulti: false, playId: `abyss-time-${++count}`, continueCount: 0,
    })
    const finish = async (time, accomplished = true, resourceVersion, status = 200) => {
        const response = await app.inject({ method: "POST", url: "/single_battle_quest/finish",
            headers: resourceVersion ? { res_ver: resourceVersion } : {}, payload: {
            viewer_id: p.viewerId, category: 24, quest_id: 700099001, play_id: `abyss-time-${count}`,
            continue_count: 0, elapsed_time_ms: time, score: 12345, add_mana: 0,
            is_accomplished: accomplished, is_restored: false, api_count: count,
            statistics: { clear_phase: 1, party: {
                characters: [{ id: 1 }, null, null], unison_characters: [null, null, null],
                equipments: [null, null, null], ability_soul_ids: [null, null, null],
            }, zones: [] },
        } })
        assert.equal(response.statusCode, status, response.body)
        if (status !== 200) return response.json()
        return unpack(Buffer.from(response.body, "base64"))
    }
    try {
        start()
        assert.equal(getPlayerActiveQuestSync(p.id).questTimeRevision, firstRevision)
        delete activeQuests[p.id] // Exercise recovery from the persisted start revision.
        manifest.patches.push(patch("1.4.102", secondRevision))
        const oldClientStart = await app.inject({ method: "POST", url: "/event/rush/battle/start",
            headers: { res_ver: "1.4.96" }, payload: {
                viewer_id: p.viewerId, quest_id: 700099001, party_id: 1,
                is_auto_start_mode: false, play_id: "old-client-start",
            },
        })
        assert.equal(oldClientStart.statusCode, 200, oldClientStart.body)
        const oldClientData = unpack(Buffer.from(oldClientStart.body, "base64"))
        assert.equal(oldClientData.data_headers.asset_update, true)
        assert.equal(oldClientData.data_headers.result_code, 4050)
        const stale = await finish(500)
        assert.equal(stale.data_headers.asset_update, true)
        assert.equal(stale.data_headers.result_code, 4050)
        assert.equal(getPlayerSingleQuestProgressSync(p.id, 24, 700099001).bestElapsedTimeMs, null)
        count++
        const oldRebuilt = await finish(400, true, "1.4.96")
        assert.equal(oldRebuilt.data_headers.result_code, 4050)
        assert.equal(getPlayerSingleQuestProgressSync(p.id, 24, 700099001).bestElapsedTimeMs, null)
        start()
        await finish(500, false)
        assert.equal(getPlayerSingleQuestProgressSync(p.id, 24, 700099001).bestElapsedTimeMs, null)
        for (const [time, expected] of [[60000, 60000], [70000, 60000], [45000, 45000]]) {
            start()
            await finish(time)
            assert.equal(getPlayerSingleQuestProgressSync(p.id, 24, 700099001).bestElapsedTimeMs, expected)
            const payload = getClientSerializedData(p.id, { viewerId: p.viewerId })
            assert.equal(payload.quest_progress[24].find(q => q.quest_id === 700099001).best_elapsed_time_ms, expected)
        }
        const reset = await app.inject({ method: "POST", url: "/event/rush/reset", payload: {
            viewer_id: p.viewerId, event_id: 700099, quest_type: 1,
        } })
        assert.equal(reset.statusCode, 200, reset.body)
        assert.equal(getPlayerSingleQuestProgressSync(p.id, 24, 700099001).bestElapsedTimeMs, 45000)
        delete activeQuests[p.id]
        deletePlayerActiveQuestSync(p.id)
        count++
        // A current resource version cannot replace a missing battle registration.
        const unregistered = await finish(40000, true, "1.4.102", 400)
        assert.equal(unregistered.message, "No active quest to finish.")
        assert.equal(getPlayerSingleQuestProgressSync(p.id, 24, 700099001).bestElapsedTimeMs, 45000)
        start()
        delete activeQuests[p.id]
        const recovered = await finish(40000, true, "1.4.102")
        assert.equal(recovered.data_headers.result_code, 1)
        assert.equal(getPlayerSingleQuestProgressSync(p.id, 24, 700099001).bestElapsedTimeMs, 40000)
    } finally { await app.close() }
})
