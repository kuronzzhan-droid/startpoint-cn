require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wave2a-8-battle-domain-"))
const previousDatabaseDirectory = process.env.WF_DATABASE_DIR
const worktreeDatabase = path.resolve(__dirname, "..", ".database")
let database

const EMPTY = {
    singlePlayCount: 0,
    singleClearCount: 0,
    multiPlayCount: 0,
    multiClearCount: 0,
    multiHostClearCount: 0,
    multiGuestClearCount: 0,
    singleRankSsCount: 0,
    rankSsCount: 0,
    rankSCount: 0,
    rankACount: 0,
    rankBCount: 0,
}

function insertPlayer(playerId) {
    database.prepare(`
        INSERT INTO accounts (
            id, app_id, first_login_time, idp_alias, idp_code, idp_id,
            reg_time, last_login_time, status
        ) VALUES (?, 'wf_cn', '2025-01-01', '', 'test', ?, '2025-01-01', '2025-01-01', 'normal')
    `).run(playerId, `wave2a-8-battle-${playerId}`)
    database.prepare(`
        INSERT INTO players (
            id, stamina, stamina_heal_time, boost_point, boss_boost_point,
            transition_state, role, name, last_login_time, comment,
            vmoney, free_vmoney, rank_point, star_crumb, bond_token,
            exp_pool, exp_pooled_time, leader_character_id, party_slot,
            degree_id, birth, free_mana, paid_mana, enable_auto_3x, account_id
        ) VALUES (
            ?, 0, 0, 0, 0, 0, 0, 'tester', '2025-01-01', '',
            0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, ?
        )
    `).run(playerId, playerId)
}

try {
    process.env.WF_DATABASE_DIR = temporaryRoot
    const { getDb } = require("../src/data/db")
    database = getDb()
    const mainDatabase = database.pragma("database_list").find(entry => entry.name === "main")
    assert.equal(path.dirname(path.resolve(mainDatabase.file)), path.resolve(temporaryRoot))
    assert.equal(database.pragma("foreign_keys", { simple: true }), 1)
    for (let playerId = 1; playerId <= 9; playerId += 1) insertPlayer(playerId)

    assert.throws(
        () => database.prepare("SELECT * FROM players_mission_battle_counters").get(),
        /no such table: players_mission_battle_counters/,
    )

    const battleFacts = require("../src/data/domains/mission_battle_facts")
    assert.throws(() => battleFacts.getMissionBattleCountersSync(1), /no such table/)
    const { missionFactsMigration } = require("../src/data/migrations/wdfp/mission-facts")
    missionFactsMigration.apply(database)
    assert.deepEqual(battleFacts.getMissionBattleCountersSync(1), EMPTY)

    const cases = [
        {
            playerId: 1,
            result: { isMulti: false, accomplished: false },
            expected: { ...EMPTY, singlePlayCount: 1 },
        },
        {
            playerId: 2,
            result: { isMulti: false, accomplished: true, clearRank: 5 },
            expected: {
                ...EMPTY,
                singlePlayCount: 1,
                singleClearCount: 1,
                singleRankSsCount: 1,
                rankSsCount: 1,
            },
        },
        {
            playerId: 3,
            result: { isMulti: true, isHost: true, accomplished: true, clearRank: 5 },
            expected: {
                ...EMPTY,
                multiPlayCount: 1,
                multiClearCount: 1,
                multiHostClearCount: 1,
                rankSsCount: 1,
            },
        },
        {
            playerId: 4,
            result: { isMulti: true, isHost: false, accomplished: true, clearRank: 4 },
            expected: {
                ...EMPTY,
                multiPlayCount: 1,
                multiClearCount: 1,
                multiGuestClearCount: 1,
                rankSCount: 1,
            },
        },
        {
            playerId: 5,
            result: { isMulti: true, accomplished: true, clearRank: 3 },
            expected: {
                ...EMPTY,
                multiPlayCount: 1,
                multiClearCount: 1,
                rankACount: 1,
            },
        },
        {
            playerId: 6,
            result: { isMulti: true, isHost: false, accomplished: true, clearRank: 2 },
            expected: {
                ...EMPTY,
                multiPlayCount: 1,
                multiClearCount: 1,
                multiGuestClearCount: 1,
                rankBCount: 1,
            },
        },
    ]
    for (const { playerId, result, expected } of cases) {
        battleFacts.recordMissionBattleResultSync(playerId, result)
        assert.deepEqual(battleFacts.getMissionBattleCountersSync(playerId), expected)
    }

    const invalidResults = [
        null,
        {},
        { isMulti: 0, accomplished: true },
        { isMulti: false, accomplished: 1 },
        { isMulti: true, isHost: "host", accomplished: true },
        { isMulti: false, accomplished: true, clearRank: -1 },
        { isMulti: false, accomplished: true, clearRank: 1.5 },
        { isMulti: false, accomplished: true, clearRank: Number.POSITIVE_INFINITY },
    ]
    for (const result of invalidResults) {
        assert.throws(
            () => battleFacts.recordMissionBattleResultSync(7, result),
            error => error instanceof TypeError || error instanceof RangeError,
        )
        assert.deepEqual(battleFacts.getMissionBattleCountersSync(7), EMPTY)
    }
    assert.throws(() => battleFacts.getMissionBattleCountersSync(0), RangeError)

    database.prepare(`
        INSERT INTO players_mission_battle_counters (player_id, single_play_count)
        VALUES (8, ?)
    `).run(Number.MAX_SAFE_INTEGER)
    const beforeOverflow = database.prepare("SELECT * FROM players_mission_battle_counters WHERE player_id = 8").get()
    assert.throws(
        () => battleFacts.recordMissionBattleResultSync(8, {
            isMulti: false,
            accomplished: true,
            clearRank: 5,
        }),
        RangeError,
    )
    assert.deepEqual(database.prepare("SELECT * FROM players_mission_battle_counters WHERE player_id = 8").get(), beforeOverflow)

    assert.throws(
        () => battleFacts.recordMissionBattleResultSync(999, { isMulti: false, accomplished: false }),
        /FOREIGN KEY/,
    )

    assert.throws(() => database.transaction(() => {
        battleFacts.recordMissionBattleResultSync(9, { isMulti: true, isHost: true, accomplished: true, clearRank: 5 })
        throw new Error("rollback mission battle")
    })(), /rollback mission battle/)
    assert.deepEqual(battleFacts.getMissionBattleCountersSync(9), EMPTY)

    database.prepare("UPDATE players_mission_battle_counters SET rank_s_count = -1 WHERE player_id = 4").run()
    assert.throws(() => battleFacts.getMissionBattleCountersSync(4), RangeError)
    database.prepare("DELETE FROM players WHERE id = 3").run()
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM players_mission_battle_counters WHERE player_id = 3").get().count, 0)
} finally {
    if (database?.open) database.close()
    if (previousDatabaseDirectory === undefined) delete process.env.WF_DATABASE_DIR
    else process.env.WF_DATABASE_DIR = previousDatabaseDirectory
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
}

assert.equal(fs.existsSync(temporaryRoot), false)
assert.equal(fs.existsSync(worktreeDatabase), false)
console.log("mission battle fact domain tests passed")
