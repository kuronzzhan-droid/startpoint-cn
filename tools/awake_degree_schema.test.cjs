require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const SqliteDatabase = require("better-sqlite3")

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wf-awake-degree-"))
const previousDatabaseDirectory = process.env.WF_DATABASE_DIR
process.env.WF_DATABASE_DIR = temporaryRoot
const databases = new Set()

function openDatabase(name) {
    const databasePath = path.join(temporaryRoot, `${name}.db`)
    assert.equal(path.dirname(databasePath), temporaryRoot)
    const database = new SqliteDatabase(databasePath)
    database.pragma("foreign_keys = ON")
    databases.add(database)
    return database
}

function insertPlayer(database, playerId, degreeId = 1) {
    database.prepare(`
        INSERT INTO accounts (
            id, app_id, first_login_time, idp_alias, idp_code, idp_id,
            reg_time, last_login_time, status
        ) VALUES (?, 'wf_cn', '2025-01-01', '', 'test', ?, '2025-01-01', '2025-01-01', 'normal')
    `).run(playerId, `awake-degree-${playerId}`)
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

function insertCharacter(database, playerId, characterId) {
    database.prepare(`
        INSERT INTO players_characters (
            id, entry_count, evolution_level, over_limit_step, protection,
            join_time, update_time, exp, stack, mana_board_index, player_id
        ) VALUES (?, 1, 0, 0, 0, '2025-01-01', '2025-01-01', 0, 0, 1, ?)
    `).run(characterId, playerId)
}

function insertActiveReceipt(database, playerId, missionId, progress, stageId = 1, status = 1) {
    database.prepare(`
        INSERT INTO players_active_missions (id, progress, player_id) VALUES (?, ?, ?)
    `).run(missionId, progress, playerId)
    database.prepare(`
        INSERT INTO players_active_missions_stages (id, status, player_id, mission_id)
        VALUES (?, ?, ?, ?)
    `).run(stageId, status, playerId, missionId)
}

function tableExists(database, tableName) {
    return database.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
    `).get(tableName) !== undefined
}

function indexColumns(database, indexName) {
    return database.prepare(`PRAGMA index_info("${indexName}")`).all().map(row => row.name)
}

function columnMap(database, tableName) {
    return Object.fromEntries(database.prepare(`PRAGMA table_info("${tableName}")`).all().map(column => [
        column.name,
        { type: column.type.toUpperCase(), notnull: column.notnull, pk: column.pk },
    ]))
}

function foreignKeyShapes(database, tableName) {
    const groups = new Map()
    for (const row of database.prepare(`PRAGMA foreign_key_list("${tableName}")`).all()) {
        const group = groups.get(row.id) ?? {
            table: row.table,
            onDelete: row.on_delete,
            from: [],
            to: [],
        }
        group.from[row.seq] = row.from
        group.to[row.seq] = row.to
        groups.set(row.id, group)
    }
    return [...groups.values()].map(group =>
        `${group.table}|${group.onDelete}|${group.from.join(",")}|${group.to.join(",")}`
    ).sort()
}

function assertNoForeignKeyViolations(database) {
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), [])
}

let initWdfpData
let categoryMissionMigration
let passCardMigration
let missionFactsMigration
let awakeDegreeMigration

try {
    ;({ default: initWdfpData } = require("../src/data/initializers/wdfpData"))
    ;({ awakeDegreeMigration } = require("../src/data/migrations/wdfp/awake-degree"))
    ;({ categoryMissionMigration } = require("../src/data/migrations/wdfp/category-mission"))
    ;({ passCardMigration } = require("../src/data/migrations/wdfp/pass-card"))
    ;({ missionFactsMigration } = require("../src/data/migrations/wdfp/mission-facts"))

    function prepareBase(database, players) {
        initWdfpData(database, false)
        for (const [playerId, degreeId] of players) insertPlayer(database, playerId, degreeId)
        categoryMissionMigration.apply(database)
        passCardMigration.apply(database)
        missionFactsMigration.apply(database)
    }

    {
        const awakeMissions = require("../assets/mission_char_awake.json")
        const awakeRewards = require("../assets/mission_char_awake_reward.json")
        const missionKeys = Object.keys(awakeMissions)
        const rewardKeys = Object.keys(awakeRewards)
        let unlockRows = 0
        let nonUnlockRows = 0
        for (const stages of Object.values(awakeRewards)) {
            for (const wrappedRows of Object.values(stages)) {
                assert.equal(wrappedRows.length, 1)
                if (wrappedRows[0][1] === "0") unlockRows += 1
                else if (wrappedRows[0][1] === "(None)") nonUnlockRows += 1
            }
        }
        assert.equal(missionKeys.length, 144)
        assert.equal(rewardKeys.length, 144)
        assert.deepEqual(rewardKeys, missionKeys)
        assert.equal(unlockRows, 36)
        assert.equal(nonUnlockRows, 108)
    }

    {
        const database = openDatabase("happy")
        prepareBase(database, [[1, 2000], [2, 0], [3, 3000]])
        insertCharacter(database, 1, 341005)
        insertCharacter(database, 3, 111001)
        insertActiveReceipt(database, 1, 3410054, 1.5)
        insertActiveReceipt(database, 3, 1110014, Number.MAX_SAFE_INTEGER + 2)
        insertActiveReceipt(database, 1, 999999, 7)

        awakeDegreeMigration.apply(database)
        assert.equal(awakeDegreeMigration.id, "wdfp/awake-degree/v1")
        assert.deepEqual(database.prepare(`
            SELECT category, id, progress, player_id
            FROM players_category_missions WHERE category = 9 ORDER BY player_id, id
        `).all(), [
            { category: 9, id: 3410054, progress: 1.5, player_id: 1 },
            { category: 9, id: 1110014, progress: Number.MAX_SAFE_INTEGER + 2, player_id: 3 },
        ])
        assert.deepEqual(database.prepare(`
            SELECT category, id, status, player_id, mission_id
            FROM players_category_mission_stages WHERE category = 9 ORDER BY player_id, mission_id
        `).all(), [
            { category: 9, id: 1, status: 1, player_id: 1, mission_id: 3410054 },
            { category: 9, id: 1, status: 1, player_id: 3, mission_id: 1110014 },
        ])
        assert.equal(database.prepare(`
            SELECT COUNT(*) AS count FROM players_active_missions
            WHERE id IN (3410054, 1110014)
        `).get().count, 0)
        assert.deepEqual(database.prepare(`
            SELECT id, progress, player_id FROM players_active_missions WHERE id = 999999
        `).get(), { id: 999999, progress: 7, player_id: 1 })
        assert.deepEqual(database.prepare(`
            SELECT player_id, character_id, board_index, awake_level
            FROM players_character_awake_unlocks ORDER BY player_id
        `).all(), [
            { player_id: 1, character_id: 341005, board_index: 1, awake_level: 1 },
            { player_id: 3, character_id: 111001, board_index: 1, awake_level: 1 },
        ])
        const unlockColumns = columnMap(database, "players_character_awake_unlocks")
        assert.deepEqual(Object.keys(unlockColumns), [
            "player_id", "character_id", "board_index", "awake_level",
        ])
        assert.deepEqual([
            unlockColumns.player_id.pk,
            unlockColumns.character_id.pk,
            unlockColumns.board_index.pk,
        ], [1, 2, 3])
        assert.deepEqual(foreignKeyShapes(database, "players_character_awake_unlocks"), [
            "players_characters|CASCADE|character_id,player_id|id,player_id",
            "players|CASCADE|player_id|id",
        ])
        const degreeColumns = columnMap(database, "players_degrees")
        assert.deepEqual(Object.keys(degreeColumns), ["player_id", "degree_id", "acquired_at"])
        assert.deepEqual([degreeColumns.player_id.pk, degreeColumns.degree_id.pk], [1, 2])
        assert.deepEqual(foreignKeyShapes(database, "players_degrees"), [
            "players|CASCADE|player_id|id",
        ])
        assert.deepEqual(database.prepare(`
            SELECT degree_id, acquired_at FROM players_degrees
            WHERE player_id = 1 ORDER BY degree_id
        `).all(), [
            { degree_id: 1, acquired_at: 0 },
            { degree_id: 2000, acquired_at: 0 },
        ])
        assert.deepEqual(database.prepare(`
            SELECT degree_id, acquired_at FROM players_degrees
            WHERE player_id = 2 ORDER BY degree_id
        `).all(), [{ degree_id: 1, acquired_at: 0 }])
        assert.deepEqual(indexColumns(database, "idx_players_degrees_player"), [
            "player_id", "acquired_at", "degree_id",
        ])
        assert.equal(database.prepare(`
            SELECT "unique" FROM pragma_index_list('players_degrees')
            WHERE name = 'idx_players_degrees_player'
        `).get().unique, 0)
        assert.equal(database.prepare(`
            SELECT COUNT(*) AS count FROM sqlite_master
            WHERE type = 'trigger' AND name = 'trg_players_default_degrees'
        `).get().count, 1)

        insertPlayer(database, 4, 4000)
        assert.deepEqual(database.prepare(`
            SELECT degree_id, acquired_at FROM players_degrees
            WHERE player_id = 4 ORDER BY degree_id
        `).all(), [
            { degree_id: 1, acquired_at: 0 },
            { degree_id: 4000, acquired_at: 0 },
        ])

        database.prepare(`
            UPDATE players_character_awake_unlocks SET awake_level = 2
            WHERE player_id = 1 AND character_id = 341005 AND board_index = 1
        `).run()
        database.prepare(`
            UPDATE players_degrees SET acquired_at = 123
            WHERE player_id = 1 AND degree_id = 2000
        `).run()
        awakeDegreeMigration.apply(database)
        assert.equal(database.prepare(`
            SELECT awake_level FROM players_character_awake_unlocks
            WHERE player_id = 1 AND character_id = 341005 AND board_index = 1
        `).get().awake_level, 2)
        assert.equal(database.prepare(`
            SELECT acquired_at FROM players_degrees WHERE player_id = 1 AND degree_id = 2000
        `).get().acquired_at, 123)
        assertNoForeignKeyViolations(database)

        database.prepare("DELETE FROM players_characters WHERE id = 341005 AND player_id = 1").run()
        assert.equal(database.prepare(`
            SELECT COUNT(*) AS count FROM players_character_awake_unlocks WHERE player_id = 1
        `).get().count, 0)
        database.prepare("DELETE FROM players WHERE id = 4").run()
        assert.equal(database.prepare(`
            SELECT COUNT(*) AS count FROM players_degrees WHERE player_id = 4
        `).get().count, 0)
        assertNoForeignKeyViolations(database)
    }

    {
        const database = openDatabase("no-character")
        prepareBase(database, [[1, 1]])
        insertActiveReceipt(database, 1, 3410054, 4)
        awakeDegreeMigration.apply(database)
        assert.equal(database.prepare(`
            SELECT progress FROM players_category_missions
            WHERE category = 9 AND id = 3410054 AND player_id = 1
        `).get().progress, 4)
        assert.equal(database.prepare(`
            SELECT COUNT(*) AS count FROM players_character_awake_unlocks
        `).get().count, 0)
        assertNoForeignKeyViolations(database)
    }

    {
        const database = openDatabase("exact-replay")
        prepareBase(database, [[1, 1]])
        insertCharacter(database, 1, 341005)
        insertActiveReceipt(database, 1, 3410054, 2)
        database.prepare(`
            INSERT INTO players_category_missions (category, id, progress, player_id)
            VALUES (9, 3410054, 2, 1)
        `).run()
        database.prepare(`
            INSERT INTO players_category_mission_stages
                (category, id, status, player_id, mission_id)
            VALUES (9, 1, 1, 1, 3410054)
        `).run()
        awakeDegreeMigration.apply(database)
        assert.equal(database.prepare(`
            SELECT COUNT(*) AS count FROM players_active_missions WHERE id = 3410054
        `).get().count, 0)
        assert.equal(database.prepare(`
            SELECT COUNT(*) AS count FROM players_category_missions
            WHERE category = 9 AND id = 3410054 AND player_id = 1
        `).get().count, 1)
    }

    for (const [name, destinationProgress, destinationStatus] of [
        ["progress-conflict", 3, 1],
        ["status-conflict", 2, 0],
    ]) {
        const database = openDatabase(name)
        prepareBase(database, [[1, 1]])
        insertCharacter(database, 1, 341005)
        insertActiveReceipt(database, 1, 3410054, 2)
        database.prepare(`
            INSERT INTO players_category_missions (category, id, progress, player_id)
            VALUES (9, 3410054, ?, 1)
        `).run(destinationProgress)
        database.prepare(`
            INSERT INTO players_category_mission_stages
                (category, id, status, player_id, mission_id)
            VALUES (9, 1, ?, 1, 3410054)
        `).run(destinationStatus)
        assert.throws(() => awakeDegreeMigration.apply(database), /conflict/)
        assert.equal(database.prepare(`
            SELECT COUNT(*) AS count FROM players_active_missions WHERE id = 3410054
        `).get().count, 1)
        assert.equal(tableExists(database, "players_character_awake_unlocks"), false)
        assert.equal(tableExists(database, "players_degrees"), false)
    }

    for (const [name, stageId, status] of [
        ["invalid-stage-id", 1.5, 1],
        ["invalid-stage-status", 1, 2],
    ]) {
        const database = openDatabase(name)
        prepareBase(database, [[1, 1]])
        insertCharacter(database, 1, 341005)
        insertActiveReceipt(database, 1, 3410054, 2, stageId, status)
        assert.throws(() => awakeDegreeMigration.apply(database), /stage/)
        assert.equal(database.prepare(`
            SELECT COUNT(*) AS count FROM players_active_missions WHERE id = 3410054
        `).get().count, 1)
    }

    {
        const database = openDatabase("orphan-stage")
        prepareBase(database, [[1, 1]])
        database.pragma("foreign_keys = OFF")
        database.prepare(`
            INSERT INTO players_active_missions_stages (id, status, player_id, mission_id)
            VALUES (1, 1, 1, 3410054)
        `).run()
        database.pragma("foreign_keys = ON")
        assert.throws(() => awakeDegreeMigration.apply(database), /orphan stage/)
        assert.equal(tableExists(database, "players_character_awake_unlocks"), false)
    }

    for (const [name, progress] of [
        ["negative-progress", -1],
        ["nan-progress", "NaN"],
        ["infinite-progress", Number.POSITIVE_INFINITY],
    ]) {
        const database = openDatabase(name)
        prepareBase(database, [[1, 1]])
        insertActiveReceipt(database, 1, 3410054, progress)
        assert.throws(() => awakeDegreeMigration.apply(database), /progress/)
        assert.equal(tableExists(database, "players_character_awake_unlocks"), false)
    }

    {
        const database = openDatabase("non-canonical-master-decimal")
        prepareBase(database, [[1, 1]])
        const rewardRow = require("../assets/mission_char_awake_reward.json")["3410054"]["1"][0]
        const originalBoardIndex = rewardRow[3]
        try {
            rewardRow[3] = "01"
            assert.throws(() => awakeDegreeMigration.apply(database), /canonical decimal/)
        } finally {
            rewardRow[3] = originalBoardIndex
        }
    }

    {
        const database = openDatabase("invalid-degree")
        prepareBase(database, [[1, -1]])
        assert.throws(() => awakeDegreeMigration.apply(database), /degree/)
        assert.equal(tableExists(database, "players_degrees"), false)
    }

    {
        const database = openDatabase("late-rollback")
        prepareBase(database, [[1, 2000]])
        insertCharacter(database, 1, 341005)
        insertActiveReceipt(database, 1, 3410054, 2)
        database.exec(`
            CREATE TRIGGER reject_category_nine
            BEFORE INSERT ON players_category_missions
            WHEN NEW.category = 9
            BEGIN
                SELECT RAISE(ABORT, 'synthetic category insert failure');
            END
        `)
        assert.throws(() => awakeDegreeMigration.apply(database), /synthetic category insert failure/)
        assert.equal(database.prepare(`
            SELECT COUNT(*) AS count FROM players_active_missions WHERE id = 3410054
        `).get().count, 1)
        assert.equal(database.prepare(`
            SELECT COUNT(*) AS count FROM players_category_missions WHERE category = 9
        `).get().count, 0)
        assert.equal(tableExists(database, "players_character_awake_unlocks"), false)
        assert.equal(tableExists(database, "players_degrees"), false)
    }

    for (const objectKind of ["index", "trigger"]) {
        const database = openDatabase(`wrong-${objectKind}`)
        prepareBase(database, [[1, 2000]])
        insertActiveReceipt(database, 1, 3410054, 2)
        database.exec(`
            CREATE TABLE players_degrees (
                player_id INTEGER NOT NULL,
                degree_id INTEGER NOT NULL,
                acquired_at INTEGER NOT NULL,
                PRIMARY KEY (player_id, degree_id),
                FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
            )
        `)
        if (objectKind === "index") {
            database.exec(`CREATE INDEX idx_players_degrees_player ON players_degrees (degree_id)`)
        } else {
            database.exec(`
                CREATE INDEX idx_players_degrees_player
                ON players_degrees (player_id, acquired_at, degree_id);
                CREATE TRIGGER trg_players_default_degrees AFTER INSERT ON players
                BEGIN SELECT 1; END;
            `)
        }
        assert.throws(() => awakeDegreeMigration.apply(database), new RegExp(objectKind))
        assert.equal(database.prepare(`
            SELECT COUNT(*) AS count FROM players_active_missions WHERE id = 3410054
        `).get().count, 1)
        assert.equal(tableExists(database, "players_character_awake_unlocks"), false)
    }

    console.log("awake degree schema migration tests passed")
} finally {
    for (const database of databases) {
        if (database.open) database.close()
    }
    if (previousDatabaseDirectory === undefined) delete process.env.WF_DATABASE_DIR
    else process.env.WF_DATABASE_DIR = previousDatabaseDirectory
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
}
