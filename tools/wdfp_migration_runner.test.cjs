require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const SqliteDatabase = require("better-sqlite3")

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wf-wave2b-migrations-"))
const previousDatabaseDirectory = process.env.WF_DATABASE_DIR
const databases = new Set()

function openInitialized(name) {
    const database = new SqliteDatabase(path.join(temporaryRoot, `${name}.db`))
    databases.add(database)
    database.pragma("foreign_keys = OFF")
    require("../src/data/initializers/wdfpData").default(database, false)
    database.pragma("foreign_keys = ON")
    return database
}

function tableNames(database) {
    return database.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
    `).all().map(row => row.name)
}

function closeDatabase(database) {
    if (database && database.open) database.close()
    databases.delete(database)
}

function clearDataModules() {
    for (const request of ["../src/data/db", "../src/data/index"]) {
        try {
            delete require.cache[require.resolve(request)]
        } catch {}
    }
}

function loadProductionDatabase(directory) {
    process.env.WF_DATABASE_DIR = directory
    clearDataModules()
    return require("../src/data/db").getDb()
}

try {
    const {
        WDFP_MIGRATION_IDS,
        applyWdfpMigrations,
    } = require("../src/data/migrations/wdfp")

    assert.deepEqual(WDFP_MIGRATION_IDS, [
        "wdfp/category-mission/v1",
        "wdfp/pass-card/v1",
        "wdfp/mission-facts/v1",
        "wdfp/awake-degree/v1",
        "wdfp/degree-query-index/v1",
    ])
    assert.equal(Object.isFrozen(WDFP_MIGRATION_IDS), true)

    const fresh = openInitialized("fresh")
    applyWdfpMigrations(fresh)
    const requiredTables = [
        "players_active_mission_battle_condition_facts",
        "players_active_mission_battle_facts",
        "players_active_mission_counters",
        "players_category_mission_stages",
        "players_category_missions",
        "players_character_awake_unlocks",
        "players_degrees",
        "players_mission_battle_counters",
        "players_pass_card_rewards",
        "players_pass_cards",
    ]
    for (const name of requiredTables) {
        assert.equal(tableNames(fresh).includes(name), true, `${name} must exist`)
    }
    assert.notEqual(fresh.prepare(`
        SELECT 1 FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_players_quest_progress_player_section_finished'
    `).get(), undefined)
    const firstSchema = fresh.prepare(`
        SELECT type, name, tbl_name, sql FROM sqlite_master
        WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name
    `).all()
    applyWdfpMigrations(fresh)
    assert.deepEqual(fresh.prepare(`
        SELECT type, name, tbl_name, sql FROM sqlite_master
        WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name
    `).all(), firstSchema, "the migration bundle must be idempotent")
    closeDatabase(fresh)

    const rejected = openInitialized("rollback")
    rejected.prepare(`CREATE TABLE players_pass_cards (wrong INTEGER)`).run()
    const beforeRejected = rejected.prepare(`
        SELECT type, name, tbl_name, sql FROM sqlite_master
        WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name
    `).all()
    assert.throws(
        () => applyWdfpMigrations(rejected),
        /wdfp\/pass-card\/v1: unknown parent schema/,
    )
    assert.deepEqual(rejected.prepare(`
        SELECT type, name, tbl_name, sql FROM sqlite_master
        WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name
    `).all(), beforeRejected, "a later migration failure must roll back the whole bundle")
    assert.equal(tableNames(rejected).includes("players_category_missions"), false)
    closeDatabase(rejected)

    const productionRoot = path.join(temporaryRoot, "production-fresh")
    const production = loadProductionDatabase(productionRoot)
    assert.equal(
        fs.readFileSync(path.join(productionRoot, "wdfp_data.db.version"), "utf8"),
        "3",
    )
    assert.equal(tableNames(production).includes("players_pass_cards"), true)
    closeDatabase(production)

    const brokenRoot = path.join(temporaryRoot, "production-broken")
    fs.mkdirSync(brokenRoot)
    const broken = new SqliteDatabase(path.join(brokenRoot, "wdfp_data.db"))
    require("../src/data/initializers/wdfpData").default(broken, false)
    broken.prepare(`CREATE TABLE players_pass_cards (wrong INTEGER)`).run()
    broken.close()
    fs.writeFileSync(path.join(brokenRoot, "wdfp_data.db.version"), "2", "utf8")
    assert.throws(
        () => loadProductionDatabase(brokenRoot),
        /wdfp\/pass-card\/v1: unknown parent schema/,
    )
    assert.equal(
        fs.readFileSync(path.join(brokenRoot, "wdfp_data.db.version"), "utf8"),
        "2",
        "failed production migration must not advance the version marker",
    )
    const brokenReadback = new SqliteDatabase(path.join(brokenRoot, "wdfp_data.db"), {
        readonly: true,
    })
    assert.equal(tableNames(brokenReadback).includes("players_category_missions"), false)
    brokenReadback.close()

    for (const [name, version, pattern] of [
        ["future", "4", /newer than supported version 3/],
        ["fractional", "2.5", /invalid database version/],
        ["garbage", "not-a-version", /invalid database version/],
    ]) {
        const incompatibleRoot = path.join(temporaryRoot, `production-${name}`)
        fs.mkdirSync(incompatibleRoot)
        const incompatible = new SqliteDatabase(path.join(incompatibleRoot, "wdfp_data.db"))
        require("../src/data/initializers/wdfpData").default(incompatible, false)
        incompatible.close()
        const incompatibleVersion = path.join(incompatibleRoot, "wdfp_data.db.version")
        fs.writeFileSync(incompatibleVersion, version, "utf8")
        let unexpectedDatabase
        let incompatibilityError
        try {
            unexpectedDatabase = loadProductionDatabase(incompatibleRoot)
        } catch (error) {
            incompatibilityError = error
        } finally {
            if (unexpectedDatabase?.open) unexpectedDatabase.close()
        }
        assert.match(String(incompatibilityError), pattern)
        assert.equal(fs.readFileSync(incompatibleVersion, "utf8"), version)
        const incompatibleReadback = new SqliteDatabase(
            path.join(incompatibleRoot, "wdfp_data.db"), { readonly: true },
        )
        assert.equal(tableNames(incompatibleReadback).includes("players_category_missions"), false)
        incompatibleReadback.close()
    }

    console.log("wdfp migration runner tests passed")
} finally {
    for (const database of databases) closeDatabase(database)
    clearDataModules()
    if (previousDatabaseDirectory === undefined) delete process.env.WF_DATABASE_DIR
    else process.env.WF_DATABASE_DIR = previousDatabaseDirectory
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
}
