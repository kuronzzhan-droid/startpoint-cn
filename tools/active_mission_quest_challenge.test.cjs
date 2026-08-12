require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wave2a-12-entry-"))
const previousDatabaseDirectory = process.env.WF_DATABASE_DIR
const worktreeDatabase = path.resolve(__dirname, "..", ".database")
let database

function insertPlayer(playerId) {
    database.prepare(`INSERT INTO accounts (
        id, app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status
    ) VALUES (?, 'wf_cn', '2025-01-01', '', 'test', ?, '2025-01-01', '2025-01-01', 'normal')`)
        .run(playerId, `wave2a-12-entry-${playerId}`)
    database.prepare(`INSERT INTO players (
        id, stamina, stamina_heal_time, boost_point, boss_boost_point, transition_state, role, name,
        last_login_time, comment, vmoney, free_vmoney, rank_point, star_crumb, bond_token, exp_pool,
        exp_pooled_time, leader_character_id, party_slot, degree_id, birth, free_mana, paid_mana,
        enable_auto_3x, account_id
    ) VALUES (?, 0, 0, 0, 0, 0, 0, 'tester', '2025-01-01', '', 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, ?)`)
        .run(playerId, playerId)
}

function storedRow(playerId) {
    return database.prepare(`SELECT practice_quest_challenge_count AS count
        FROM players_active_mission_counters WHERE player_id = ?`).get(playerId)
}

try {
    process.env.WF_DATABASE_DIR = temporaryRoot
    const { recordActiveMissionQuestChallengeFactSync } = require("../src/lib/mission/active-entry-facts")
    const counters = require("../src/data/domains/active_mission_counters")
    const { getDb } = require("../src/data/db")
    database = getDb()
    const main = database.pragma("database_list").find(entry => entry.name === "main")
    assert.equal(path.dirname(path.resolve(main.file)), path.resolve(temporaryRoot))
    assert.equal(database.pragma("foreign_keys", { simple: true }), 1)
    for (let playerId = 1; playerId <= 6; playerId += 1) insertPlayer(playerId)

    assert.equal(counters.getActiveMissionPracticeQuestChallengeCountSync(1), 0)

    for (const category of [0, 1, 14, 16, 99]) {
        recordActiveMissionQuestChallengeFactSync(1, category)
        assert.equal(counters.getActiveMissionPracticeQuestChallengeCountSync(1), 0)
        assert.equal(storedRow(1), undefined)
    }
    recordActiveMissionQuestChallengeFactSync(1, 15)
    assert.equal(counters.getActiveMissionPracticeQuestChallengeCountSync(1), 1)
    assert.deepEqual(storedRow(1), { count: 1 })
    recordActiveMissionQuestChallengeFactSync(1, 15)
    assert.equal(counters.getActiveMissionPracticeQuestChallengeCountSync(1), 2)

    for (const bad of ["2", null, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
        assert.throws(() => recordActiveMissionQuestChallengeFactSync(bad, 1), TypeError)
        assert.equal(storedRow(2), undefined)
    }
    for (const bad of [0, -1, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => recordActiveMissionQuestChallengeFactSync(bad, 1), RangeError)
        assert.equal(storedRow(2), undefined)
    }
    for (const bad of ["15", null, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
        assert.throws(() => recordActiveMissionQuestChallengeFactSync(2, bad), TypeError)
        assert.equal(storedRow(2), undefined)
    }
    for (const bad of [-1, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => recordActiveMissionQuestChallengeFactSync(2, bad), RangeError)
        assert.equal(storedRow(2), undefined)
    }

    assert.throws(() => recordActiveMissionQuestChallengeFactSync(999, 15), /FOREIGN KEY/)
    assert.equal(storedRow(999), undefined)

    database.prepare(`INSERT INTO players_active_mission_counters
        (player_id, practice_quest_challenge_count) VALUES (3, ?)`).run(Number.MAX_SAFE_INTEGER)
    assert.throws(() => recordActiveMissionQuestChallengeFactSync(3, 15), RangeError)
    assert.deepEqual(storedRow(3), { count: Number.MAX_SAFE_INTEGER })

    database.prepare(`INSERT INTO players_active_mission_counters
        (player_id, practice_quest_challenge_count) VALUES (4, 0)`).run()
    database.prepare(`UPDATE players_active_mission_counters
        SET practice_quest_challenge_count = -1 WHERE player_id = 4`).run()
    assert.throws(() => recordActiveMissionQuestChallengeFactSync(4, 15), RangeError)
    assert.throws(() => counters.getActiveMissionPracticeQuestChallengeCountSync(4), RangeError)
    assert.deepEqual(storedRow(4), { count: -1 })

    assert.throws(() => database.transaction(() => {
        recordActiveMissionQuestChallengeFactSync(5, 15)
        throw new Error("outer rollback")
    })(), /outer rollback/)
    assert.equal(counters.getActiveMissionPracticeQuestChallengeCountSync(5), 0)
    assert.equal(storedRow(5), undefined)
} finally {
    if (database?.open) database.close()
    if (previousDatabaseDirectory === undefined) delete process.env.WF_DATABASE_DIR
    else process.env.WF_DATABASE_DIR = previousDatabaseDirectory
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
}

assert.equal(fs.existsSync(temporaryRoot), false)
assert.equal(fs.existsSync(`${worktreeDatabase}-wal`), false)
assert.equal(fs.existsSync(`${worktreeDatabase}-shm`), false)
assert.equal(fs.existsSync(`${worktreeDatabase}.version`), false)
assert.equal(fs.existsSync(worktreeDatabase), false)
console.log("active mission quest challenge tests passed")
