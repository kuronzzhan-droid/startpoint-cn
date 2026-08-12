require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wave2b-battle-facts-"))
const previousDatabaseDirectory = process.env.WF_DATABASE_DIR
const databaseModulePath = require.resolve("../src/data/db")
const battleFactsModulePath = path.resolve(__dirname, "../src/lib/mission/battle-facts.ts")
const previousDatabaseModule = require.cache[databaseModulePath]
let database

function insertPlayer(playerId) {
    database.prepare(`INSERT INTO accounts (
        id, app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status
    ) VALUES (?, 'wf_cn', '2025-01-01', '', 'wave2b', ?, '2025-01-01', '2025-01-01', 'normal')`)
        .run(playerId, `wave2b-battle-${playerId}`)
    database.prepare(`INSERT INTO players (
        id, stamina, stamina_heal_time, boost_point, boss_boost_point, transition_state, role, name,
        last_login_time, comment, vmoney, free_vmoney, rank_point, star_crumb, bond_token, exp_pool,
        exp_pooled_time, leader_character_id, party_slot, degree_id, birth, free_mana, paid_mana,
        enable_auto_3x, account_id
    ) VALUES (?, 0, 0, 0, 0, 0, 0, 'wave2b', '2025-01-01', '', 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 0, 0, 0, 0, ?)`)
        .run(playerId, playerId)
}

function insertQuestProgress(playerId, questId) {
    database.prepare(`INSERT INTO players_quest_progress
        (section, quest_id, finished, unlocked, player_id)
        VALUES (7, ?, 1, 1, ?)`).run(questId, playerId)
}

function context(playerId, overrides = {}) {
    return {
        playerId,
        questCategory: 7,
        questId: 200010001,
        questAccomplished: true,
        clearTime: 1000,
        clearRank: 5,
        party: { characters: [], unison_characters: [] },
        statistics: { clear_phase: 0, party: { characters: [], unison_characters: [] } },
        player: {},
        questPreviouslyCompleted: false,
        questProgress: null,
        isMulti: true,
        isMultiHost: true,
        ...overrides,
    }
}

function categoryRows(playerId) {
    return database.prepare(`SELECT category, id, progress FROM players_category_missions
        WHERE player_id = ? ORDER BY category, id`).all(playerId)
}

function battleResult(playerId) {
    return database.prepare(`SELECT single_clear_count, multi_clear_count, multi_host_clear_count,
        rank_ss_count AS clear_rank_5_count FROM players_mission_battle_counters WHERE player_id = ?`).get(playerId)
}

try {
    process.env.WF_DATABASE_DIR = temporaryRoot
    const { getDb } = require("../src/data/db")
    database = getDb()
    insertPlayer(1)
    insertPlayer(2)
    insertPlayer(3)
    insertPlayer(4)
    insertPlayer(5)
    insertQuestProgress(2, 200010001)
    insertQuestProgress(3, 200010001)
    insertQuestProgress(4, 200015001)
    insertQuestProgress(5, 3002)

    const { recordMissionBattleFacts } = require("../src/lib/mission/battle-facts")
    const evaluationTime = new Date("2024-06-20T04:00:00Z")

    const failed = recordMissionBattleFacts(context(1, {
        questAccomplished: false,
        isMulti: false,
        isMultiHost: undefined,
    }), evaluationTime)
    assert.deepEqual(failed, { dailyMissionIds: [], eventMissionIds: [], passMissionIds: [] })
    assert.deepEqual(categoryRows(1), [])
    assert.deepEqual(battleResult(1), {
        single_clear_count: 0,
        multi_clear_count: 0,
        multi_host_clear_count: 0,
        clear_rank_5_count: 0,
    })

    const success = recordMissionBattleFacts(context(2), evaluationTime)
    assert.deepEqual(success.dailyMissionIds, [])
    assert.deepEqual(success.passMissionIds, [4, 5])
    assert.deepEqual(success.eventMissionIds, [])
    assert.deepEqual(battleResult(2), {
        single_clear_count: 0,
        multi_clear_count: 1,
        multi_host_clear_count: 1,
        clear_rank_5_count: 1,
    })
    assert.deepEqual(categoryRows(2), [
        { category: 8, id: 4, progress: 1 },
        { category: 8, id: 5, progress: 1 },
    ])

    const daily = recordMissionBattleFacts(context(4, { questId: 200015001 }),
        new Date("2024-08-14T03:00:00Z"))
    assert.deepEqual(daily.dailyMissionIds, [800115, 800116, 800117])
    assert.deepEqual(categoryRows(4).filter(row => row.category === 2), [
        { category: 2, id: 800115, progress: 1 },
        { category: 2, id: 800116, progress: 1 },
        { category: 2, id: 800117, progress: 1 },
    ])

    const event = recordMissionBattleFacts(context(5, { questId: 3002 }),
        new Date("2020-04-01T03:00:00Z"))
    assert.deepEqual(event.eventMissionIds, [1412, 1413])
    assert.deepEqual(categoryRows(5).filter(row => row.category === 3), [
        { category: 3, id: 1412, progress: 1 },
        { category: 3, id: 1413, progress: 1 },
    ])

    database.prepare(`INSERT INTO players_category_missions
        (player_id, category, id, progress) VALUES (3, 8, 5, ?)`).run(Number.MAX_VALUE)
    assert.throws(() => recordMissionBattleFacts(context(3), evaluationTime), RangeError)
    assert.deepEqual(categoryRows(3), [{ category: 8, id: 5, progress: Number.MAX_VALUE }])
    assert.equal(battleResult(3), undefined, "failed aggregate must roll back the battle result row")

    console.log("mission battle facts tests passed")
} finally {
    if (database?.open) database.close()
    delete require.cache[battleFactsModulePath]
    if (previousDatabaseModule === undefined) delete require.cache[databaseModulePath]
    else require.cache[databaseModulePath] = previousDatabaseModule
    if (previousDatabaseDirectory === undefined) delete process.env.WF_DATABASE_DIR
    else process.env.WF_DATABASE_DIR = previousDatabaseDirectory
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
}
