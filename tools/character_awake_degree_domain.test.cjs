require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wave2a-8-awake-degree-domain-"))
const previousDatabaseDirectory = process.env.WF_DATABASE_DIR
const worktreeDatabase = path.resolve(__dirname, "..", ".database")
let database

function insertPlayer(playerId, degreeId = 1) {
    database.prepare(`
        INSERT INTO accounts (
            id, app_id, first_login_time, idp_alias, idp_code, idp_id,
            reg_time, last_login_time, status
        ) VALUES (?, 'wf_cn', '2025-01-01', '', 'test', ?, '2025-01-01', '2025-01-01', 'normal')
    `).run(playerId, `wave2a-8-awake-${playerId}`)
    database.prepare(`
        INSERT INTO players (
            id, stamina, stamina_heal_time, boost_point, boss_boost_point,
            transition_state, role, name, last_login_time, comment,
            vmoney, free_vmoney, rank_point, star_crumb, bond_token,
            exp_pool, exp_pooled_time, leader_character_id, party_slot,
            degree_id, birth, free_mana, paid_mana, enable_auto_3x, account_id
        ) VALUES (
            ?, 0, 0, 0, 0, 0, 0, 'tester', '2025-01-01', '',
            0, 0, 0, 0, 0, 0, 0, 0, 1, ?, 0, 0, 0, 0, ?
        )
    `).run(playerId, degreeId, playerId)
}

function insertCharacter(playerId, characterId) {
    database.prepare(`
        INSERT INTO players_characters (
            id, entry_count, evolution_level, over_limit_step, protection,
            join_time, update_time, exp, stack, mana_board_index, player_id
        ) VALUES (?, 1, 0, 0, 0, '2025-01-01', '2025-01-01', 0, 0, 1, ?)
    `).run(characterId, playerId)
}

function assertContractError(callback) {
    assert.throws(callback, error => error instanceof TypeError || error instanceof RangeError)
}

try {
    process.env.WF_DATABASE_DIR = temporaryRoot
    const { getDb } = require("../src/data/db")
    database = getDb()
    const mainDatabase = database.pragma("database_list").find(entry => entry.name === "main")
    assert.equal(path.dirname(path.resolve(mainDatabase.file)), path.resolve(temporaryRoot))
    assert.equal(database.pragma("foreign_keys", { simple: true }), 1)

    for (let playerId = 1; playerId <= 12; playerId += 1) {
        insertPlayer(playerId, playerId === 1 ? 2 : 1)
    }
    insertCharacter(1, 100)
    insertCharacter(12, 1200)

    const awake = require("../src/data/domains/character_awake")
    const degree = require("../src/data/domains/degree")

    assert.deepEqual([...awake.getPlayerCharacterAwakeUnlocksSync(1)], [])
    assert.equal(awake.upsertPlayerCharacterAwakeUnlockSync(1, 100, 1, 1), true)
    assert.equal(awake.upsertPlayerCharacterAwakeUnlockSync(1, 100, 1, 3), true)
    assert.equal(awake.upsertPlayerCharacterAwakeUnlockSync(1, 100, 1, 3), false)
    assert.equal(awake.upsertPlayerCharacterAwakeUnlockSync(1, 100, 1, 2), false)
    assert.equal(awake.upsertPlayerCharacterAwakeUnlockSync(1, 100, 2, 1), true)
    assert.deepEqual([...awake.getPlayerCharacterAwakeUnlocksSync(1)], [
        ["100", { 1: 3, 2: 1 }],
    ])
    assert.throws(() => awake.upsertPlayerCharacterAwakeUnlockSync(1, 999, 1, 1), /FOREIGN KEY/)

    for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        assertContractError(() => awake.getPlayerCharacterAwakeUnlocksSync(invalid))
        assertContractError(() => awake.upsertPlayerCharacterAwakeUnlockSync(1, invalid, 1, 1))
        assertContractError(() => awake.upsertPlayerCharacterAwakeUnlockSync(1, 100, invalid, 1))
        assertContractError(() => awake.upsertPlayerCharacterAwakeUnlockSync(1, 100, 1, invalid))
    }

    assert.equal(degree.hasPlayerDegreeSync(1, 1), true)
    assert.equal(degree.hasPlayerDegreeSync(1, 2), true)
    assert.equal(degree.hasPlayerDegreeSync(1, 999), false)
    assert.equal(degree.grantPlayerDegreeSync(1, 10, 200), true)
    assert.equal(degree.grantPlayerDegreeSync(1, 10, 200), false)
    assert.equal(degree.givePlayerDegreeSync(1, 11), true)
    database.prepare("UPDATE players_degrees SET acquired_at = 100 WHERE player_id = 1 AND degree_id = 11").run()
    assert.deepEqual(degree.getPlayerDegreeIdsSync(1), [1, 2, 11, 10])

    for (const [questId, masteryDegreeId, victoryDegreeId, playerId] of [
        [1001, 54500, 54510, 2],
        [1002, 54520, 54530, 3],
        [1003, 54540, 54550, 4],
        [1004, 54560, 54570, 5],
        [1005, 54580, 54590, 6],
        [1006, 54600, 54610, 7],
    ]) {
        assert.deepEqual(
            degree.grantPlayerSoloTimeAttackDegreesSync(playerId, questId, 180_000),
            [victoryDegreeId, masteryDegreeId],
        )
        assert.equal(degree.hasPlayerDegreeSync(playerId, victoryDegreeId), true)
        assert.equal(degree.hasPlayerDegreeSync(playerId, masteryDegreeId), true)
    }
    assert.deepEqual(degree.grantPlayerSoloTimeAttackDegreesSync(8, 1001, 300_000), [54510])
    assert.deepEqual(degree.grantPlayerSoloTimeAttackDegreesSync(8, 1002, 300_001), [])
    assert.deepEqual(degree.grantPlayerSoloTimeAttackDegreesSync(8, 9999, 1), [])

    database.prepare(`
        INSERT INTO players_quest_progress (
            section, quest_id, finished, unlocked, best_elapsed_time_ms, player_id
        ) VALUES (25, 1006, 1, 1, 180000, 10)
    `).run()
    assert.deepEqual(degree.ensurePlayerSoloTimeAttackDegreesSync(10), [54610, 54600])

    database.prepare("DELETE FROM players_degrees WHERE player_id = 11").run()
    database.exec(`
        CREATE TRIGGER fail_legacy_degree
        BEFORE INSERT ON players_degrees
        WHEN NEW.degree_id = 9
        BEGIN SELECT RAISE(ABORT, 'fail legacy degree'); END
    `)
    assert.throws(() => degree.ensurePlayerLegacyDegreesSync(11, 9), /fail legacy degree/)
    assert.deepEqual(degree.getPlayerDegreeIdsSync(11), [])
    database.exec("DROP TRIGGER fail_legacy_degree")

    database.exec(`
        CREATE TRIGGER fail_mastery_degree
        BEFORE INSERT ON players_degrees
        WHEN NEW.player_id = 9 AND NEW.degree_id = 54500
        BEGIN SELECT RAISE(ABORT, 'fail mastery degree'); END
    `)
    assert.throws(
        () => degree.grantPlayerSoloTimeAttackDegreesSync(9, 1001, 180_000),
        /fail mastery degree/,
    )
    assert.equal(degree.hasPlayerDegreeSync(9, 54510), false)
    assert.equal(degree.hasPlayerDegreeSync(9, 54500), false)
    database.exec("DROP TRIGGER fail_mastery_degree")

    for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        assertContractError(() => degree.grantPlayerDegreeSync(1, invalid))
        assertContractError(() => degree.hasPlayerDegreeSync(1, invalid))
    }
    for (const invalid of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        assertContractError(() => degree.grantPlayerDegreeSync(1, 20, invalid))
        assertContractError(() => degree.grantPlayerSoloTimeAttackDegreesSync(1, 1001, invalid))
    }
    assert.equal(degree.grantPlayerDegreeSync(1, 20, 0), true)
    assert.deepEqual(degree.grantPlayerSoloTimeAttackDegreesSync(1, 1001, 0), [54510, 54500])

    database.prepare(`
        INSERT INTO players_character_awake_unlocks (player_id, character_id, board_index, awake_level)
        VALUES (12, 1200, 1, -1)
    `).run()
    assert.throws(() => awake.getPlayerCharacterAwakeUnlocksSync(12), RangeError)
    database.prepare("UPDATE players_degrees SET acquired_at = -1 WHERE player_id = 12 AND degree_id = 1").run()
    assert.throws(() => degree.getPlayerDegreeIdsSync(12), RangeError)

    database.prepare("DELETE FROM players_character_awake_unlocks WHERE player_id = 12").run()
    awake.upsertPlayerCharacterAwakeUnlockSync(12, 1200, 1, 1)
    degree.grantPlayerDegreeSync(12, 50)
    database.prepare("DELETE FROM players WHERE id = 12").run()
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM players_character_awake_unlocks WHERE player_id = 12").get().count, 0)
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM players_degrees WHERE player_id = 12").get().count, 0)
} finally {
    if (database?.open) database.close()
    if (previousDatabaseDirectory === undefined) delete process.env.WF_DATABASE_DIR
    else process.env.WF_DATABASE_DIR = previousDatabaseDirectory
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
}

assert.equal(fs.existsSync(temporaryRoot), false)
assert.equal(fs.existsSync(worktreeDatabase), false)
console.log("character awake and degree domain tests passed")
