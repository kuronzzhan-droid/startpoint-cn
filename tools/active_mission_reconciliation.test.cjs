require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wave2a-11-reconcile-"))
const previousDatabaseDirectory = process.env.WF_DATABASE_DIR
const worktreeDatabase = path.resolve(__dirname, "..", ".database")
const NOW = Date.parse("2025-01-01T00:00:00Z")
let database
function missionRow({
    eventId = 901,
    phase = 1,
    pattern = 0,
    battleKind = "(None)",
    questKind = "(None)",
    first = "(None)",
    second = "(None)",
    third = "(None)",
    targets = "",
    characterId = "(None)",
    start = "2020-01-01 00:00:00",
    end = "(None)",
} = {}) {
    const row = []
    row[0] = String(eventId)
    row[1] = phase === undefined ? "(None)" : String(phase)
    row[3] = `mission_${eventId}_${pattern}_${phase}`
    row[29] = String(pattern)
    row[32] = String(battleKind)
    row[34] = String(questKind)
    row[35] = String(first)
    row[36] = String(second)
    row[37] = String(third)
    row[43] = String(characterId)
    row[55] = String(targets)
    row[56] = "(None)"
    row[57] = ""
    row[58] = "(None)"
    row[59] = ""
    row[60] = start
    row[61] = end
    row[62] = start
    row[63] = end
    return row
}

function eventRow({ kind = 0, stringId = "normal_event", maxPhase = 1, start = "2020-01-01 00:00:00", end = "(None)" } = {}) {
    const row = []
    row[0] = stringId
    row[2] = String(kind)
    row[3] = String(maxPhase)
    row[14] = start
    row[15] = end
    row[22] = "(None)"
    return row
}

function rewardRow(target) {
    const row = []
    row[3] = String(target)
    row[4] = "(None)"
    row[7] = "0"
    row[8] = "5"
    return row
}

function makeRepository(overrides = {}) {
    const calls = []
    const tables = {
        "mission_active.json": {
            90001: [missionRow({ pattern: 0 })],
            90002: [missionRow({ pattern: 57, questKind: 0, first: 1, second: 8, third: 4 })],
            90003: [missionRow({ phase: 2, pattern: 13, targets: "90001,90002" })],
            90004: [missionRow({ eventId: 902, pattern: 39, start: "2025-01-02 00:00:00" })],
            90005: [missionRow({ eventId: 903, pattern: 0, end: "2024-12-31 23:59:59" })],
            90006: [missionRow({ eventId: 904, pattern: 0 })],
            90007: [missionRow({ eventId: 905, pattern: 0 })],
        },
        "mission_active_event.json": {
            901: [eventRow({ maxPhase: 2 })],
            902: [eventRow({ start: "2025-01-02 00:00:00" })],
            903: [eventRow({ end: "2024-12-31 23:59:59" })],
            904: [eventRow({ kind: 1, stringId: "come_back_mission_test" })],
            905: [eventRow({ kind: 1, stringId: "normal_kind_one" })],
        },
        "mission_active_reward.json": {
            90001: { 1: [rewardRow(1)], 2: [rewardRow(3)] },
            90002: { 1: [rewardRow(1)] },
            90003: { 1: [rewardRow(2)] },
            90004: { 1: [rewardRow(1)] },
            90005: { 1: [rewardRow(1)] },
            90006: { 1: [rewardRow(1)] },
            90007: { 1: [rewardRow(1)] },
        },
        ...overrides,
    }
    return {
        calls,
        repository: {
            info: () => ({ source: "bundled", assetVersion: "test", generatorVersion: 1, releaseDigest: null }),
            table: tableName => {
                calls.push(tableName)
                if (!(tableName in tables)) throw new Error(`missing required table ${tableName}`)
                return tables[tableName]
            },
        },
    }
}

function insertPlayer(playerId, { login = 3, stamina = 10 } = {}) {
    database.prepare(`INSERT INTO accounts (
        id, app_id, first_login_time, idp_alias, idp_code, idp_id,
        reg_time, last_login_time, status
    ) VALUES (?, 'wf_cn', '2025-01-01', '', 'test', ?, '2025-01-01', '2025-01-01', 'normal')`)
        .run(playerId, `wave2a-11-${playerId}`)
    database.prepare(`INSERT INTO players (
        id, stamina, stamina_heal_time, boost_point, boss_boost_point,
        transition_state, role, name, last_login_time, comment,
        vmoney, free_vmoney, rank_point, star_crumb, bond_token,
        exp_pool, exp_pooled_time, leader_character_id, party_slot,
        degree_id, birth, free_mana, paid_mana, enable_auto_3x,
        total_login_days, total_stamina_used, account_id
    ) VALUES (?, 0, 0, 0, 0, 0, 0, 'tester', '2025-01-01', '',
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, ?, ?, ?)`)
        .run(playerId, login, stamina, playerId)
}

function addFinishedQuest(playerId, questId = 1008004) {
    database.prepare(`INSERT INTO players_quest_progress (
        section, quest_id, finished, unlocked, multi_clear_count, player_id
    ) VALUES (1, ?, 1, 1, 0, ?)` ).run(questId, playerId)
}

function activeRows(playerId) {
    return database.prepare(`SELECT id, progress FROM players_active_missions
        WHERE player_id = ? ORDER BY id`).all(playerId)
}

function stageRows(playerId, missionId) {
    return database.prepare(`SELECT id, status FROM players_active_missions_stages
        WHERE player_id = ? AND mission_id = ? ORDER BY id`).all(playerId, missionId)
}

try {
    process.env.WF_DATABASE_DIR = temporaryRoot
    const facade = require("../src/lib/mission/active-reconciliation")
    assert.deepEqual(Object.keys(facade).sort(), [
        "computeActiveMissionFactProgress",
        "estimateActiveMissionCharacterLevel",
        "matchesActiveMissionQuestRange",
        "reconcileActiveMissionFacts",
        "resolveActiveMissionQuestIds",
    ])
    const { reconcileActiveMissionFacts, resolveActiveMissionQuestIds } = facade
    const { getDb } = require("../src/data/db")
    database = getDb()
    const mainDatabase = database.pragma("database_list").find(entry => entry.name === "main")
    assert.equal(path.dirname(path.resolve(mainDatabase.file)), path.resolve(temporaryRoot))
    assert.equal(database.pragma("foreign_keys", { simple: true }), 1)

    assert.deepEqual(resolveActiveMissionQuestIds(missionRow({ questKind: 0, first: 1, second: 8, third: 4 })), [1008004])
    assert.deepEqual(resolveActiveMissionQuestIds(missionRow({ questKind: 1, first: 1, second: 8, third: 1 })), [11008001])
    assert.deepEqual(resolveActiveMissionQuestIds(missionRow({ questKind: 9, first: 500005, third: 1 })), [500005001])

    insertPlayer(1)
    addFinishedQuest(1)
    const primary = makeRepository()
    const callbackEvents = []
    const first = reconcileActiveMissionFacts({
        playerId: 1,
        repository: primary.repository,
        now: NOW,
        isEventEligible: context => {
            callbackEvents.push(context)
            return false
        },
    })
    assert.deepEqual(first.map(delta => delta.mission_id), [90001, 90002, 90003, 90007])
    assert.deepEqual(first.find(delta => delta.mission_id === 90001), {
        mission_id: 90001,
        progress_value: 3,
        stages: [{ stage: 1, received: false }, { stage: 2, received: false }],
    })
    assert.equal(first.find(delta => delta.mission_id === 90003).progress_value, 2)
    assert.deepEqual(callbackEvents, [{ playerId: 1, eventId: 904, eventStringId: "come_back_mission_test", eventKind: 1 }])
    assert.deepEqual(reconcileActiveMissionFacts({ playerId: 1, repository: primary.repository, now: new Date(NOW) }), [])

    insertPlayer(7)
    const eligible = reconcileActiveMissionFacts({
        playerId: 7,
        repository: primary.repository,
        now: NOW,
        patterns: [0],
        isEventEligible: () => true,
    })
    assert.equal(eligible.some(delta => delta.mission_id === 90006), true)
    insertPlayer(8)
    assert.throws(() => reconcileActiveMissionFacts({
        playerId: 8,
        repository: primary.repository,
        now: NOW,
        patterns: [0],
        isEventEligible: () => { throw new Error("eligibility failed") },
    }), /eligibility failed/)
    assert.deepEqual(activeRows(8), [])

    database.prepare("UPDATE players SET total_login_days = 1, total_stamina_used = 1 WHERE id = 1").run()
    assert.deepEqual(reconcileActiveMissionFacts({ playerId: 1, repository: primary.repository, now: NOW }), [])
    assert.equal(activeRows(1).find(row => row.id === 90001).progress, 3)

    database.prepare("UPDATE players_active_missions_stages SET status = 1 WHERE player_id = 1 AND mission_id = 90001 AND id = 1").run()
    database.prepare("UPDATE players SET total_login_days = 4 WHERE id = 1").run()
    const preserved = reconcileActiveMissionFacts({ playerId: 1, repository: primary.repository, now: NOW, patterns: [0, 0] })
    assert.equal(preserved.find(delta => delta.mission_id === 90001).progress_value, 4)
    assert.deepEqual(stageRows(1, 90001), [{ id: 1, status: 1 }, { id: 2, status: 0 }])

    insertPlayer(2, { login: 2 })
    database.prepare("INSERT INTO players_active_missions (id, progress, player_id) VALUES (90001, 2, 2)").run()
    const stageOnly = reconcileActiveMissionFacts({ playerId: 2, repository: primary.repository, now: NOW, patterns: [0] })
    assert.deepEqual(stageOnly[0].stages, [{ stage: 1, received: false }])

    insertPlayer(3)
    assert.throws(() => reconcileActiveMissionFacts({ playerId: 3, repository: primary.repository, now: 0 / 0 }), TypeError)
    assert.throws(
        () => reconcileActiveMissionFacts({ playerId: 3, repository: primary.repository, now: 0, patterns: [0, -1] }),
        error => error instanceof TypeError || error instanceof RangeError,
    )
    assert.throws(() => reconcileActiveMissionFacts({ playerId: 0, repository: primary.repository, now: 0 }), RangeError)
    assert.deepEqual(activeRows(3), [])
    const deletedPatterns = [0, 1]
    delete deletedPatterns[0]
    for (const patterns of [new Array(1), deletedPatterns]) {
        assert.throws(() => reconcileActiveMissionFacts({ playerId: 3, repository: primary.repository, now: NOW, patterns }), TypeError)
    }
    assert.deepEqual(reconcileActiveMissionFacts({ playerId: 3, repository: primary.repository, now: NOW, patterns: [] }), [])

    const filtered = makeRepository({
        "mission_active.json": {
            91001: [missionRow({ pattern: 0 })],
            91002: [missionRow({ pattern: 4 })],
        },
        "mission_active_reward.json": { 91001: { 1: [rewardRow(1)] }, 91002: { 1: [rewardRow(1)] } },
    })
    reconcileActiveMissionFacts({ playerId: 3, repository: filtered.repository, now: NOW, patterns: [0] })
    assert.equal(filtered.calls.includes("character.json"), false)

    insertPlayer(4)
    const missingCharacter = makeRepository({
        "mission_active.json": { 92001: [missionRow({ pattern: 4 })] },
        "mission_active_reward.json": { 92001: { 1: [rewardRow(1)] } },
    })
    assert.throws(() => reconcileActiveMissionFacts({ playerId: 4, repository: missingCharacter.repository, now: NOW }), /character\.json/)
    assert.deepEqual(activeRows(4), [])
    insertPlayer(9)
    const zeroCharacter = makeRepository({
        "mission_active.json": { 92003: [missionRow({ pattern: 4 })] },
        "mission_active_reward.json": { 92003: { 1: [rewardRow(1)] } },
        "character.json": {},
    })
    assert.deepEqual(reconcileActiveMissionFacts({ playerId: 9, repository: zeroCharacter.repository, now: NOW }), [])
    assert.deepEqual(activeRows(9), [])
    insertPlayer(10)
    const malformedMaster = makeRepository({
        "mission_active.json": { "092004": [missionRow({ pattern: 0 })] },
        "mission_active_reward.json": { "092004": { 1: [rewardRow(1)] } },
    })
    assert.throws(() => reconcileActiveMissionFacts({ playerId: 10, repository: malformedMaster.repository, now: NOW }), TypeError)
    assert.deepEqual(activeRows(10), [])

    for (const [playerId, invalidMissionId, validMissionId] of [
        [11, 94001, 94002],
        [12, 94004, 94003],
    ]) {
        insertPlayer(playerId)
        const invalidPatternMaster = makeRepository({
            "mission_active.json": {
                [invalidMissionId]: [missionRow({
                    eventId: 904,
                    pattern: 23,
                    battleKind: 1,
                    questKind: 4,
                    first: "01",
                    third: 1,
                })],
                [validMissionId]: [missionRow({ pattern: 0 })],
            },
            "mission_active_reward.json": {
                [invalidMissionId]: { 1: [rewardRow(1)] },
                [validMissionId]: { 1: [rewardRow(1)] },
            },
        })
        assert.throws(() => reconcileActiveMissionFacts({
            playerId,
            repository: invalidPatternMaster.repository,
            now: NOW,
            isEventEligible: () => false,
        }), TypeError)
        assert.deepEqual(activeRows(playerId), [])
    }
    insertPlayer(13)
    const availabilityReadFailure = makeRepository({
        "mission_active.json": { 94501: [missionRow({ pattern: 0 })], 94502: [missionRow({ phase: 2, pattern: 0 })] },
        "mission_active_reward.json": { 94501: { 1: [rewardRow(1)] }, 94502: { 1: [rewardRow(1)] } },
    })
    let rewardTableReads = 0
    const failingAvailabilityRepository = {
        info: availabilityReadFailure.repository.info,
        table: tableName => {
            if (tableName === "mission_active_reward.json" && ++rewardTableReads === 9) {
                throw new Error("required repository read failed")
            }
            return availabilityReadFailure.repository.table(tableName)
        },
    }
    assert.throws(() => reconcileActiveMissionFacts({
        playerId: 13,
        repository: failingAvailabilityRepository,
        now: NOW,
    }), /required repository read failed/)
    assert.deepEqual(activeRows(13), [])
    const auxiliaryTables = new Set([
        "treasure_shop.json",
        "boss_coin_shop_item_category_map.json",
        "boss_coin_shop.json",
        "main_quest.json",
        "ex_quest.json",
        "mana_node.json",
    ])
    const preciseReads = [
        {
            playerId: 14,
            missionId: 95001,
            row: missionRow({ pattern: 45 }),
            tables: { "treasure_shop.json": {} },
            expected: ["treasure_shop.json"],
        },
        {
            playerId: 15,
            missionId: 95002,
            row: missionRow({ pattern: 66, questKind: 0, first: 1, second: 1, third: 1 }),
            tables: { "main_quest.json": { 1001001: { rankPointReward: 1 } } },
            expected: ["main_quest.json"],
        },
        {
            playerId: 16,
            missionId: 95003,
            row: missionRow({ pattern: 7 }),
            tables: {},
            expected: [],
        },
    ]
    for (const testCase of preciseReads) {
        insertPlayer(testCase.playerId)
        const preciseRepository = makeRepository({
            "mission_active.json": { [testCase.missionId]: [testCase.row] },
            "mission_active_reward.json": { [testCase.missionId]: { 1: [rewardRow(1)] } },
            ...testCase.tables,
        })
        assert.deepEqual(reconcileActiveMissionFacts({
            playerId: testCase.playerId,
            repository: preciseRepository.repository,
            now: NOW,
        }), [])
        assert.deepEqual(preciseRepository.calls.filter(name => auxiliaryTables.has(name)), testCase.expected)
    }
    const requiredManaMaster = makeRepository({
        "mission_active.json": { 95004: [missionRow({ pattern: 62 })] },
        "mission_active_reward.json": { 95004: { 1: [rewardRow(1)] } },
    })
    assert.throws(() => reconcileActiveMissionFacts({
        playerId: 16,
        repository: requiredManaMaster.repository,
        now: NOW,
    }), /mana_node\.json/)

    const malformedCharacter = makeRepository({
        "mission_active.json": { 92002: [missionRow({ pattern: 4 })] },
        "mission_active_reward.json": { 92002: { 1: [rewardRow(1)] } },
        "character.json": [],
    })
    assert.throws(() => reconcileActiveMissionFacts({ playerId: 4, repository: malformedCharacter.repository, now: NOW }), TypeError)
    assert.deepEqual(activeRows(4), [])

    insertPlayer(5)
    const battleRepository = makeRepository({
        "mission_active.json": { 93001: [missionRow({ pattern: 14 })] },
        "mission_active_reward.json": { 93001: { 1: [rewardRow(1)] } },
    })
    assert.throws(() => reconcileActiveMissionFacts({ playerId: 5, repository: battleRepository.repository, now: NOW }), /no such table/)
    assert.deepEqual(activeRows(5), [])
    const { missionFactsMigration } = require("../src/data/migrations/wdfp/mission-facts")
    missionFactsMigration.apply(database)
    database.prepare("INSERT INTO players_mission_battle_counters (player_id, single_clear_count) VALUES (5, 2)").run()
    assert.equal(reconcileActiveMissionFacts({ playerId: 5, repository: battleRepository.repository, now: NOW })[0].progress_value, 2)
    assert.deepEqual(reconcileActiveMissionFacts({ playerId: 5, repository: battleRepository.repository, now: NOW }), [])

    insertPlayer(6, { login: 2 })
    addFinishedQuest(6)
    database.exec(`CREATE TRIGGER fail_wave2a11_stage BEFORE INSERT ON players_active_missions_stages
        WHEN NEW.mission_id = 90002 BEGIN SELECT RAISE(FAIL, 'forced stage rollback'); END`)
    assert.throws(() => reconcileActiveMissionFacts({ playerId: 6, repository: primary.repository, now: NOW }), /forced stage rollback/)
    assert.deepEqual(activeRows(6), [])
    database.exec("DROP TRIGGER fail_wave2a11_stage")

    assert.throws(() => database.transaction(() => {
        reconcileActiveMissionFacts({ playerId: 6, repository: primary.repository, now: NOW, patterns: [0] })
        throw new Error("outer rollback")
    })(), /outer rollback/)
    assert.deepEqual(activeRows(6), [])

    database.exec(`CREATE TRIGGER ignore_wave2a11_progress BEFORE INSERT ON players_active_missions
        WHEN NEW.player_id = 6 BEGIN SELECT RAISE(IGNORE); END`)
    assert.throws(() => reconcileActiveMissionFacts({ playerId: 6, repository: primary.repository, now: NOW, patterns: [0] }), /row count/i)
    assert.deepEqual(activeRows(6), [])
    database.exec("DROP TRIGGER ignore_wave2a11_progress")

    database.prepare("UPDATE players_quest_progress SET multi_clear_count = -1 WHERE player_id = 6").run()
    assert.throws(() => reconcileActiveMissionFacts({ playerId: 6, repository: primary.repository, now: NOW, patterns: [0] }), RangeError)
    assert.deepEqual(activeRows(6), [])
    database.prepare("UPDATE players_quest_progress SET multi_clear_count = 0 WHERE player_id = 6").run()
    database.prepare("INSERT INTO players_active_missions (id, progress, player_id) VALUES (90001, -1, 6)").run()
    assert.throws(() => reconcileActiveMissionFacts({ playerId: 6, repository: primary.repository, now: NOW, patterns: [0] }), RangeError)
    database.prepare("UPDATE players_active_missions SET progress = 1 WHERE player_id = 6").run()
    database.prepare("INSERT INTO players_active_missions_stages (id, status, player_id, mission_id) VALUES (1, 2, 6, 90001)").run()
    assert.throws(() => reconcileActiveMissionFacts({ playerId: 6, repository: primary.repository, now: NOW, patterns: [0] }), RangeError)
    database.prepare("DELETE FROM players_active_missions WHERE player_id = 6").run()
    database.pragma("foreign_keys = OFF")
    database.prepare("INSERT INTO players_active_missions (id, progress, player_id) VALUES (999001, 1, 999001)").run()
    database.pragma("foreign_keys = ON")
    assert.throws(
        () => reconcileActiveMissionFacts({ playerId: 6, repository: primary.repository, now: NOW, patterns: [0] }),
        /foreign key check/i,
    )
    assert.deepEqual(activeRows(6), [])
    database.prepare("DELETE FROM players_active_missions WHERE player_id = 999001").run()
    database.prepare("UPDATE players_mission_battle_counters SET single_clear_count = -1 WHERE player_id = 5").run()
    assert.throws(() => reconcileActiveMissionFacts({ playerId: 5, repository: battleRepository.repository, now: NOW }), RangeError)
} finally {
    if (database?.open) database.close()
    if (previousDatabaseDirectory === undefined) delete process.env.WF_DATABASE_DIR
    else process.env.WF_DATABASE_DIR = previousDatabaseDirectory
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
}

assert.equal(fs.existsSync(temporaryRoot), false)
assert.equal(fs.existsSync(worktreeDatabase), false)
console.log("active mission reconciliation tests passed")
