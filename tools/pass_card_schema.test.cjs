require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const SqliteDatabase = require("better-sqlite3")

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wf-pass-card-migration-"))
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

const canonicalPassCardSql = `CREATE TABLE players_pass_cards (
    player_id INTEGER NOT NULL,
    event_id INTEGER NOT NULL,
    point INTEGER NOT NULL DEFAULT 0,
    is_buy INTEGER NOT NULL DEFAULT 0,
    login_baseline INTEGER,
    PRIMARY KEY (player_id, event_id),
    FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
)`

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
    assert.deepEqual(columnShape(database, "players_pass_cards"), [
        { name: "player_id", type: "INTEGER", notnull: 1, defaultValue: null, pk: 1 },
        { name: "event_id", type: "INTEGER", notnull: 1, defaultValue: null, pk: 2 },
        { name: "point", type: "INTEGER", notnull: 1, defaultValue: "0", pk: 0 },
        { name: "is_buy", type: "INTEGER", notnull: 1, defaultValue: "0", pk: 0 },
        { name: "login_baseline", type: "INTEGER", notnull: 0, defaultValue: null, pk: 0 },
    ])
    assert.deepEqual(columnShape(database, "players_pass_card_rewards"), [
        { name: "player_id", type: "INTEGER", notnull: 1, defaultValue: null, pk: 1 },
        { name: "event_id", type: "INTEGER", notnull: 1, defaultValue: null, pk: 2 },
        { name: "reward_id", type: "INTEGER", notnull: 1, defaultValue: null, pk: 3 },
        { name: "is_received_1", type: "INTEGER", notnull: 1, defaultValue: "0", pk: 0 },
        { name: "is_received_2", type: "INTEGER", notnull: 1, defaultValue: "0", pk: 0 },
    ])
    assert.deepEqual(foreignKeyShapes(database, "players_pass_cards"), [
        "players|CASCADE|player_id|id",
    ])
    assert.deepEqual(foreignKeyShapes(database, "players_pass_card_rewards"), [
        "players_pass_cards|CASCADE|player_id,event_id|player_id,event_id",
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

function tableExists(database, tableName) {
    return database.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
    `).get(tableName) !== undefined
}

function run() {
    const { passCardMigration } = require("../src/data/migrations/wdfp/pass-card")
    assert.equal(passCardMigration.id, "wdfp/pass-card/v1")
    assert.equal(typeof passCardMigration.apply, "function")

    {
        const database = openDatabase("fresh")
        createPlayers(database, [1])
        passCardMigration.apply(database)
        assertCanonicalSchema(database)
        database.prepare(`INSERT INTO players_pass_cards (player_id, event_id) VALUES (1, 3)`).run()
        assert.deepEqual(database.prepare(`SELECT * FROM players_pass_cards`).get(), {
            player_id: 1,
            event_id: 3,
            point: 0,
            is_buy: 0,
            login_baseline: null,
        })
        database.prepare(`
            INSERT INTO players_pass_card_rewards (player_id, event_id, reward_id)
            VALUES (1, 3, 150)
        `).run()
        assert.deepEqual(database.prepare(`SELECT * FROM players_pass_card_rewards`).get(), {
            player_id: 1,
            event_id: 3,
            reward_id: 150,
            is_received_1: 0,
            is_received_2: 0,
        })
        const before = tableSnapshot(database, ["players_pass_cards", "players_pass_card_rewards"])
        passCardMigration.apply(database)
        assert.deepEqual(tableSnapshot(database, ["players_pass_cards", "players_pass_card_rewards"]), before)
        database.prepare(`DELETE FROM players_pass_cards WHERE player_id = 1 AND event_id = 3`).run()
        assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM players_pass_card_rewards`).get().count, 0)
        database.prepare(`INSERT INTO players_pass_cards (player_id, event_id) VALUES (1, 4)`).run()
        database.prepare(`
            INSERT INTO players_pass_card_rewards (player_id, event_id, reward_id)
            VALUES (1, 4, 151)
        `).run()
        database.prepare(`DELETE FROM players WHERE id = 1`).run()
        assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM players_pass_cards`).get().count, 0)
        assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM players_pass_card_rewards`).get().count, 0)
        assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), [])
    }

    {
        const database = openDatabase("base-v2-like")
        require("../src/data/initializers/wdfpData").default(database, false)
        passCardMigration.apply(database)
        assertCanonicalSchema(database)
    }

    {
        const database = openDatabase("parent-only")
        createPlayers(database, [1])
        database.exec(canonicalPassCardSql)
        passCardMigration.apply(database)
        assertCanonicalSchema(database)
    }

    {
        const database = openDatabase("child-only")
        createPlayers(database, [1])
        database.pragma("foreign_keys = OFF")
        database.exec(`CREATE TABLE players_pass_card_rewards (
            player_id INTEGER, event_id INTEGER, reward_id INTEGER
        )`)
        database.pragma("foreign_keys = ON")
        const before = tableSnapshot(database, ["players_pass_card_rewards"])
        assert.throws(() => passCardMigration.apply(database), /child table exists without parent/i)
        assert.deepEqual(tableSnapshot(database, ["players_pass_card_rewards"]), before)
    }

    {
        const database = openDatabase("malformed-parent")
        createPlayers(database, [1])
        database.exec(`CREATE TABLE players_pass_cards (
            player_id INTEGER NOT NULL,
            event_id INTEGER NOT NULL,
            points TEXT,
            PRIMARY KEY (player_id, event_id)
        )`)
        const before = tableSnapshot(database, ["players_pass_cards"])
        assert.throws(() => passCardMigration.apply(database), /unknown parent schema/i)
        assert.deepEqual(tableSnapshot(database, ["players_pass_cards"]), before)
    }

    {
        const database = openDatabase("malformed-child")
        createPlayers(database, [1])
        database.exec(`${canonicalPassCardSql}; CREATE TABLE players_pass_card_rewards (
            player_id INTEGER, event_id INTEGER, reward_id INTEGER, received INTEGER
        )`)
        const before = tableSnapshot(database, ["players_pass_cards", "players_pass_card_rewards"])
        assert.throws(() => passCardMigration.apply(database), /unknown child schema/i)
        assert.deepEqual(tableSnapshot(database, ["players_pass_cards", "players_pass_card_rewards"]), before)
    }

    {
        const database = openDatabase("rollback")
        createPlayers(database, [1])
        const originalPrepare = database.prepare
        let injected = false
        database.prepare = function prepareWithFailure(sql) {
            if (!injected && /CREATE TABLE players_pass_card_rewards/i.test(sql)) {
                injected = true
                throw new Error("injected pass child creation failure")
            }
            return originalPrepare.call(this, sql)
        }
        try {
            assert.throws(() => passCardMigration.apply(database), /injected pass child creation failure/)
        } finally {
            delete database.prepare
        }
        assert.equal(injected, true)
        assert.equal(tableExists(database, "players_pass_cards"), false)
        assert.equal(tableExists(database, "players_pass_card_rewards"), false)
    }

    {
        const database = openDatabase("missing-players")
        assert.throws(() => passCardMigration.apply(database), /players table is required/i)
        assert.equal(tableExists(database, "players_pass_cards"), false)
    }

    {
        const database = openDatabase("foreign-key-state")
        createPlayers(database, [1])
        database.pragma("foreign_keys = OFF")
        passCardMigration.apply(database)
        assert.equal(Number(database.pragma("foreign_keys", { simple: true })), 0)
    }
}

try {
    run()
    console.log("pass card migration tests passed")
} finally {
    cleanup()
}
