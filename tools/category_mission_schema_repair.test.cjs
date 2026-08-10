require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const SqliteDatabase = require("better-sqlite3")

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wf-category-migration-"))
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

function cleanup() {
    for (const database of databases) {
        if (database.open) database.close()
    }
    if (previousDatabaseDirectory === undefined) delete process.env.WF_DATABASE_DIR
    else process.env.WF_DATABASE_DIR = previousDatabaseDirectory
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
}

function createPlayers(database, ids = [1]) {
    database.exec("CREATE TABLE players (id INTEGER PRIMARY KEY)")
    const insert = database.prepare("INSERT INTO players (id) VALUES (?)")
    for (const id of ids) insert.run(id)
}

const canonicalMissionSql = `CREATE TABLE players_category_missions (
    category INTEGER NOT NULL,
    id INTEGER NOT NULL,
    progress INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    PRIMARY KEY (category, id, player_id),
    FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
)`

const canonicalStageSql = `CREATE TABLE players_category_mission_stages (
    category INTEGER NOT NULL,
    id INTEGER NOT NULL,
    status INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    mission_id INTEGER NOT NULL,
    PRIMARY KEY (category, id, mission_id, player_id),
    FOREIGN KEY (category, mission_id, player_id)
        REFERENCES players_category_missions (category, id, player_id) ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
)`

function createCanonicalTables(database) {
    database.exec(`${canonicalMissionSql}; ${canonicalStageSql};`)
}

function columnShape(database, tableName) {
    return database.prepare(`PRAGMA table_info("${tableName}")`).all().map(column => ({
        name: column.name,
        type: String(column.type).toUpperCase(),
        notnull: column.notnull,
        defaultValue: column.dflt_value,
        pk: column.pk,
    }))
}

function foreignKeyShapes(database, tableName) {
    const rows = database.prepare(`PRAGMA foreign_key_list("${tableName}")`).all()
    const grouped = new Map()
    for (const row of rows) {
        const group = grouped.get(row.id) ?? {
            table: row.table,
            onDelete: row.on_delete,
            from: [],
            to: [],
        }
        group.from[row.seq] = row.from
        group.to[row.seq] = row.to
        grouped.set(row.id, group)
    }
    return [...grouped.values()]
        .map(group => `${group.table}|${group.onDelete}|${group.from.join(",")}|${group.to.join(",")}`)
        .sort()
}

function assertCanonicalSchema(database) {
    assert.deepEqual(columnShape(database, "players_category_missions"), [
        { name: "category", type: "INTEGER", notnull: 1, defaultValue: null, pk: 1 },
        { name: "id", type: "INTEGER", notnull: 1, defaultValue: null, pk: 2 },
        { name: "progress", type: "INTEGER", notnull: 1, defaultValue: null, pk: 0 },
        { name: "player_id", type: "INTEGER", notnull: 1, defaultValue: null, pk: 3 },
    ])
    assert.deepEqual(columnShape(database, "players_category_mission_stages"), [
        { name: "category", type: "INTEGER", notnull: 1, defaultValue: null, pk: 1 },
        { name: "id", type: "INTEGER", notnull: 1, defaultValue: null, pk: 2 },
        { name: "status", type: "INTEGER", notnull: 1, defaultValue: null, pk: 0 },
        { name: "player_id", type: "INTEGER", notnull: 1, defaultValue: null, pk: 4 },
        { name: "mission_id", type: "INTEGER", notnull: 1, defaultValue: null, pk: 3 },
    ])
    assert.deepEqual(foreignKeyShapes(database, "players_category_missions"), [
        "players|CASCADE|player_id|id",
    ])
    assert.deepEqual(foreignKeyShapes(database, "players_category_mission_stages"), [
        "players_category_missions|CASCADE|category,mission_id,player_id|category,id,player_id",
        "players|CASCADE|player_id|id",
    ].sort())
}

function tableSnapshot(database, tableNames) {
    return tableNames.map(tableName => ({
        tableName,
        sql: database.prepare(`
            SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?
        `).get(tableName)?.sql,
        columns: columnShape(database, tableName),
        rows: database.prepare(`SELECT * FROM "${tableName}" ORDER BY rowid`).all(),
    }))
}

function createKnownLegacyTables(database) {
    database.pragma("foreign_keys = OFF")
    database.exec(`
        CREATE TABLE players_category_missions (
            category INTEGER NOT NULL,
            id INTEGER NOT NULL,
            progress INTEGER NOT NULL,
            player_id INTEGER NOT NULL,
            counter_key TEXT NOT NULL,
            dimension TEXT NOT NULL,
            scope_type TEXT NOT NULL,
            scope_key TEXT NOT NULL,
            qualifier_json TEXT NOT NULL,
            value INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (player_id, counter_key)
        );
        CREATE TABLE players_category_mission_stages (
            category INTEGER NOT NULL,
            id INTEGER NOT NULL,
            status INTEGER NOT NULL,
            player_id INTEGER NOT NULL,
            mission_id INTEGER NOT NULL,
            PRIMARY KEY (category, id, mission_id, player_id),
            FOREIGN KEY (category, mission_id, player_id)
                REFERENCES players_category_missions (category, id, player_id) ON DELETE CASCADE
        );
    `)
    database.pragma("foreign_keys = ON")
}

function insertLegacyMission(database, values) {
    database.prepare(`
        INSERT INTO players_category_missions (
            category, id, progress, player_id, counter_key, dimension,
            scope_type, scope_key, qualifier_json, value, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'legacy', 'global', '', '{}', 0, '2026-08-10 00:00:00')
    `).run(values.category, values.id, values.progress, values.playerId, values.counterKey)
}

function run() {
    const { categoryMissionMigration } = require("../src/data/migrations/wdfp/category-mission")
    assert.equal(categoryMissionMigration.id, "wdfp/category-mission/v1")
    assert.equal(typeof categoryMissionMigration.apply, "function")

    {
        const database = openDatabase("fresh")
        createPlayers(database, [1])
        categoryMissionMigration.apply(database)
        assertCanonicalSchema(database)
        database.prepare(`
            INSERT INTO players_category_missions (category, id, progress, player_id)
            VALUES (6, 101, 4, 1)
        `).run()
        database.prepare(`
            INSERT INTO players_category_mission_stages
                (category, id, status, player_id, mission_id)
            VALUES (6, 1, 2, 1, 101)
        `).run()
        categoryMissionMigration.apply(database)
        assert.deepEqual(database.prepare(`
            SELECT category, id, progress, player_id FROM players_category_missions
        `).all(), [{ category: 6, id: 101, progress: 4, player_id: 1 }])
        assert.deepEqual(database.prepare(`
            SELECT category, id, status, player_id, mission_id
            FROM players_category_mission_stages
        `).all(), [{ category: 6, id: 1, status: 2, player_id: 1, mission_id: 101 }])
        database.prepare(`DELETE FROM players_category_missions WHERE id = 101`).run()
        assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM players_category_mission_stages`).get().count, 0)
        database.prepare(`
            INSERT INTO players_category_missions (category, id, progress, player_id)
            VALUES (6, 102, 1, 1)
        `).run()
        database.prepare(`
            INSERT INTO players_category_mission_stages
                (category, id, status, player_id, mission_id)
            VALUES (6, 1, 1, 1, 102)
        `).run()
        database.prepare(`DELETE FROM players WHERE id = 1`).run()
        assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM players_category_missions`).get().count, 0)
        assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM players_category_mission_stages`).get().count, 0)
        assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), [])
    }

    {
        const database = openDatabase("base-v2-like")
        require("../src/data/initializers/wdfpData").default(database, false)
        categoryMissionMigration.apply(database)
        assertCanonicalSchema(database)
        categoryMissionMigration.apply(database)
        assertCanonicalSchema(database)
    }

    {
        const database = openDatabase("known-legacy")
        createPlayers(database, [7])
        createKnownLegacyTables(database)
        insertLegacyMission(database, { category: 9, id: 341005, progress: 4, playerId: 7, counterKey: "first" })
        insertLegacyMission(database, { category: 3, id: 900814, progress: 1, playerId: 7, counterKey: "second" })
        database.pragma("foreign_keys = OFF")
        database.prepare(`
            INSERT INTO players_category_mission_stages
                (category, id, status, player_id, mission_id)
            VALUES (9, 1, 2, 7, 341005)
        `).run()
        database.pragma("foreign_keys = ON")
        categoryMissionMigration.apply(database)
        assertCanonicalSchema(database)
        assert.deepEqual(database.prepare(`
            SELECT category, id, progress, player_id
            FROM players_category_missions ORDER BY category, id
        `).all(), [
            { category: 3, id: 900814, progress: 1, player_id: 7 },
            { category: 9, id: 341005, progress: 4, player_id: 7 },
        ])
        assert.deepEqual(database.prepare(`
            SELECT category, id, status, player_id, mission_id
            FROM players_category_mission_stages
        `).all(), [{ category: 9, id: 1, status: 2, player_id: 7, mission_id: 341005 }])
        assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), [])
    }

    {
        const database = openDatabase("duplicate-mission")
        createPlayers(database, [1])
        createKnownLegacyTables(database)
        insertLegacyMission(database, { category: 6, id: 1, progress: 1, playerId: 1, counterKey: "a" })
        insertLegacyMission(database, { category: 6, id: 1, progress: 2, playerId: 1, counterKey: "b" })
        const before = tableSnapshot(database, ["players_category_missions", "players_category_mission_stages"])
        assert.throws(() => categoryMissionMigration.apply(database), /duplicate mission key/i)
        assert.deepEqual(tableSnapshot(database, ["players_category_missions", "players_category_mission_stages"]), before)
    }

    {
        const database = openDatabase("duplicate-stage")
        createPlayers(database, [1])
        database.exec(canonicalMissionSql)
        database.exec(`
            CREATE TABLE players_category_mission_stages (
                category INTEGER NOT NULL, id INTEGER NOT NULL, status INTEGER NOT NULL,
                player_id INTEGER NOT NULL, mission_id INTEGER NOT NULL, legacy_key TEXT NOT NULL,
                PRIMARY KEY (player_id, legacy_key)
            );
            INSERT INTO players_category_missions VALUES (6, 1, 1, 1);
            INSERT INTO players_category_mission_stages VALUES (6, 1, 0, 1, 1, 'a');
            INSERT INTO players_category_mission_stages VALUES (6, 1, 1, 1, 1, 'b');
        `)
        const before = tableSnapshot(database, ["players_category_missions", "players_category_mission_stages"])
        assert.throws(() => categoryMissionMigration.apply(database), /duplicate stage key/i)
        assert.deepEqual(tableSnapshot(database, ["players_category_missions", "players_category_mission_stages"]), before)
    }

    {
        const database = openDatabase("orphan-stage")
        createPlayers(database, [1])
        database.pragma("foreign_keys = OFF")
        createCanonicalTables(database)
        database.prepare(`INSERT INTO players_category_missions VALUES (6, 1, 1, 1)`).run()
        database.prepare(`INSERT INTO players_category_mission_stages VALUES (6, 1, 1, 1, 999)`).run()
        database.pragma("foreign_keys = ON")
        const before = tableSnapshot(database, ["players_category_missions", "players_category_mission_stages"])
        assert.throws(() => categoryMissionMigration.apply(database), /orphan stage/i)
        assert.deepEqual(tableSnapshot(database, ["players_category_missions", "players_category_mission_stages"]), before)
    }

    {
        const database = openDatabase("missing-column")
        createPlayers(database, [1])
        database.exec(`CREATE TABLE players_category_missions (
            category INTEGER, id INTEGER, player_id INTEGER, PRIMARY KEY (category, id, player_id)
        )`)
        const before = tableSnapshot(database, ["players_category_missions"])
        assert.throws(() => categoryMissionMigration.apply(database), /missing required column/i)
        assert.deepEqual(tableSnapshot(database, ["players_category_missions"]), before)
    }

    {
        const database = openDatabase("child-only")
        createPlayers(database, [1])
        database.exec(`CREATE TABLE players_category_mission_stages (
            category INTEGER, id INTEGER, status INTEGER, player_id INTEGER, mission_id INTEGER
        )`)
        const before = tableSnapshot(database, ["players_category_mission_stages"])
        assert.throws(() => categoryMissionMigration.apply(database), /child table exists without parent/i)
        assert.deepEqual(tableSnapshot(database, ["players_category_mission_stages"]), before)
    }

    {
        const database = openDatabase("rollback")
        createPlayers(database, [1])
        createKnownLegacyTables(database)
        insertLegacyMission(database, { category: 6, id: 1, progress: 3, playerId: 1, counterKey: "safe" })
        database.pragma("foreign_keys = OFF")
        database.prepare(`INSERT INTO players_category_mission_stages VALUES (6, 1, 1, 1, 1)`).run()
        database.pragma("foreign_keys = ON")
        const before = tableSnapshot(database, ["players_category_missions", "players_category_mission_stages"])
        const originalPrepare = database.prepare
        let injected = false
        database.prepare = function prepareWithFailure(sql) {
            if (!injected && /INSERT INTO players_category_missions/i.test(sql) && /SELECT category/i.test(sql)) {
                injected = true
                throw new Error("injected category copy failure")
            }
            return originalPrepare.call(this, sql)
        }
        try {
            assert.throws(() => categoryMissionMigration.apply(database), /injected category copy failure/)
        } finally {
            delete database.prepare
        }
        assert.equal(injected, true)
        assert.deepEqual(tableSnapshot(database, ["players_category_missions", "players_category_mission_stages"]), before)
    }

    {
        const database = openDatabase("foreign-key-state")
        createPlayers(database, [1])
        database.pragma("foreign_keys = OFF")
        categoryMissionMigration.apply(database)
        assert.equal(Number(database.pragma("foreign_keys", { simple: true })), 0)
    }
}

try {
    run()
    console.log("category mission migration tests passed")
} finally {
    cleanup()
}
