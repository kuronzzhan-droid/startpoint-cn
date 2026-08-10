require("ts-node/register/transpile-only")

// Focused schema test for the dormant degree covering index.
//
// House convention keeps every migration matrix in its own file (mission_facts_schema,
// awake_degree_schema, category_mission_schema_repair, pass_card_schema). This file owns the
// fresh / idempotent / wrong-object / parent-shape / rollback / FK / row-preservation / query-plan
// matrix that mission_degree_progress.test.cjs used to carry.

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const SqliteDatabase = require("better-sqlite3")

const migrationRequest = "../src/data/migrations/wdfp/degree-query-index"
const QUEST_TABLE = "players_quest_progress"
const INDEX_NAME = "idx_players_quest_progress_player_section_finished"
// Measured on the tracked BASE schema: player_id is the tenth column, so the key cids are 9/0/2.
const EXPECTED_XINFO = [
    { seqno: 0, cid: 9, name: "player_id", desc: 0, coll: "BINARY", key: 1 },
    { seqno: 1, cid: 0, name: "section", desc: 0, coll: "BINARY", key: 1 },
    { seqno: 2, cid: 2, name: "finished", desc: 0, coll: "BINARY", key: 1 },
    { seqno: 3, cid: -1, name: null, desc: 0, coll: "BINARY", key: 0 },
]
const NON_CANONICAL = /degree query index is non-canonical/
const PARENT_NON_CANONICAL = /players_quest_progress is non-canonical/
const QUEST_COLUMNS = [
    "section INTEGER NOT NULL",
    "quest_id INTEGER NOT NULL",
    "finished INTEGER NOT NULL",
    "unlocked INTEGER NOT NULL DEFAULT 0",
    "high_score INTEGER",
    "clear_rank INTEGER",
    "best_elapsed_time_ms INTEGER",
    "leader_character_id INTEGER",
    "multi_clear_count INTEGER NOT NULL DEFAULT 0",
    "player_id INTEGER NOT NULL",
]
// The column missionFactsMigration appends; the migration treats its presence as the "prerequisite
// already ran" signal, so its name has to be pinned by a fixture and not merely counted.
const HOST_FINISHED = "host_finished INTEGER NOT NULL DEFAULT 0"
const PLAYER_OWNERSHIP = `,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE`
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wave2a-14-index-"))
const previousDatabaseDirectory = process.env.WF_DATABASE_DIR
const worktreeRoot = path.resolve(__dirname, "..")
const extraDatabases = new Set()
let database
let closedArtifacts = []
let capturedError

// Locks the exact constructor plus an anchored message fragment, so a case cannot pass by being
// stopped at an earlier guard than the one it targets.
function expectError(callback, ErrorConstructor, label, pattern) {
    assert.throws(callback, error => error?.constructor === ErrorConstructor
        && (pattern === undefined || pattern.test(String(error?.message))), label)
}

function insertPlayer(playerId) {
    database.prepare(`INSERT INTO accounts (
        id, app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status
    ) VALUES (?, 'wf_cn', '2025-01-01', '', 'wave2a-14', ?, '2025-01-01', '2025-01-01', 'normal')`)
        .run(playerId, `degree-index-${playerId}`)
    database.prepare(`INSERT INTO players (
        id, stamina, stamina_heal_time, boost_point, boss_boost_point, transition_state, role, name,
        last_login_time, comment, vmoney, free_vmoney, rank_point, star_crumb, bond_token, exp_pool,
        exp_pooled_time, leader_character_id, party_slot, degree_id, birth, free_mana, paid_mana,
        enable_auto_3x, account_id
    ) VALUES (?, 0, 0, 0, 0, 0, 0, 'degree', '2025-01-01', '', 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, ?)`)
        .run(playerId, playerId)
}

function questDigest() {
    return database.prepare(`SELECT section, quest_id, finished, unlocked, high_score, clear_rank,
        best_elapsed_time_ms, leader_character_id, multi_clear_count, player_id, host_finished
        FROM ${QUEST_TABLE} ORDER BY section, quest_id, player_id`).all()
}

function queryPlan() {
    return database.prepare(`EXPLAIN QUERY PLAN SELECT COUNT(*) FROM ${QUEST_TABLE}
        WHERE player_id = ? AND section = ? AND finished = 1`).all(1, 1)
        .map(row => row.detail).join(" | ")
}

function namedObject() {
    return database.prepare(`SELECT type, tbl_name, sql FROM sqlite_master WHERE name = ?`).get(INDEX_NAME)
}

function memoryParent(columns, ownership, primaryKey = "section, quest_id, player_id") {
    const memory = new SqliteDatabase(":memory:")
    extraDatabases.add(memory)
    memory.pragma("foreign_keys = ON")
    memory.exec(`CREATE TABLE players (id INTEGER NOT NULL PRIMARY KEY)`)
    memory.exec(`CREATE TABLE ${QUEST_TABLE} (${columns.join(", ")},
        PRIMARY KEY (${primaryKey})${ownership})`)
    return memory
}

const indexOn = (columns, tail = "", unique = "") =>
    `CREATE ${unique}INDEX ${INDEX_NAME} ON ${QUEST_TABLE} (${columns})${tail}`

try {
    process.env.WF_DATABASE_DIR = temporaryRoot
    const { getDb } = require("../src/data/db")
    database = getDb()
    const main = database.pragma("database_list").find(entry => entry.name === "main")
    assert.equal(path.dirname(path.resolve(main.file)), path.resolve(temporaryRoot))
    assert.equal(database.pragma("foreign_keys", { simple: true }), 1)
    insertPlayer(1)
    const { missionFactsMigration } = require("../src/data/migrations/wdfp/mission-facts")
    missionFactsMigration.apply(database)
    for (const [section, questId, rank, elapsed] of [[1, 1001001, 3, 60000], [4, 1001001, 2, 90000],
        [2, 1003004, 1, 120000]]) {
        database.prepare(`INSERT INTO ${QUEST_TABLE} (section, quest_id, finished, unlocked,
            high_score, clear_rank, best_elapsed_time_ms, leader_character_id, multi_clear_count,
            player_id, host_finished) VALUES (?, ?, 1, 1, 1000, ?, ?, 111001, 0, 1, 0)`)
            .run(section, questId, rank, elapsed)
    }
    const baseline = questDigest()
    assert.equal(baseline.length, 3)
    const barePlan = queryPlan()
    assert.equal(barePlan.includes("USING COVERING INDEX"), false, "BASE must not already cover the query")
    assert.equal(barePlan.includes("sqlite_autoindex_players_quest_progress_1"), true, "BASE falls back to the PK")

    const { degreeQueryIndexMigration } = require(migrationRequest)
    assert.equal(degreeQueryIndexMigration.id, "wdfp/degree-query-index/v1")
    const bare = new SqliteDatabase(":memory:")
    extraDatabases.add(bare)
    bare.pragma("foreign_keys = ON")
    expectError(() => degreeQueryIndexMigration.apply(bare), Error, "no players table",
        /wdfp\/degree-query-index\/v1: players table is required/)
    bare.exec(`CREATE TABLE players (id INTEGER NOT NULL PRIMARY KEY)`)
    expectError(() => degreeQueryIndexMigration.apply(bare), Error, "no quest progress table",
        /players_quest_progress table is missing/)
    expectError(() => degreeQueryIndexMigration.apply(memoryParent(QUEST_COLUMNS, PLAYER_OWNERSHIP)),
        Error, "mission facts migration not applied yet", PARENT_NON_CANONICAL)
    // Same eleven columns, but the ownership foreign key is gone: the index would then point at a
    // table whose rows no player is responsible for, so the parent check has to reject it too.
    expectError(() => degreeQueryIndexMigration.apply(memoryParent([...QUEST_COLUMNS, HOST_FINISHED], "")),
        Error, "quest progress without ownership", PARENT_NON_CANONICAL)

    // Every variant below keeps the column count at eleven and only rewrites one field, so nothing
    // except the field-by-field parent comparison can reject it.
    const canonicalColumns = [...QUEST_COLUMNS, HOST_FINISHED]
    for (const [label, position, ddl] of [
        ["high score type", 4, "high_score TEXT"],
        ["finished nullability", 2, "finished INTEGER"],
        ["unlocked default", 3, "unlocked INTEGER NOT NULL DEFAULT 1"],
        ["host_finished renamed", 10, "spare INTEGER NOT NULL DEFAULT 0"],
    ]) {
        const columns = [...canonicalColumns]
        assert.notEqual(columns[position], ddl, `${label}: the fixture must differ from the canonical column`)
        columns[position] = ddl
        expectError(() => degreeQueryIndexMigration.apply(memoryParent(columns, PLAYER_OWNERSHIP)),
            Error, `parent column: ${label}`, PARENT_NON_CANONICAL)
    }
    // The arity conjunct is the one part of the parent comparison the loop above holds fixed at
    // eleven, so a twelfth column is the only input that can read it. Every canonical column is
    // still in its canonical position here, which is why the per-field loop alone would accept it.
    expectError(() => degreeQueryIndexMigration.apply(
        memoryParent([...canonicalColumns, "spare INTEGER NOT NULL DEFAULT 0"], PLAYER_OWNERSHIP)),
    Error, "parent column count: a twelfth column", PARENT_NON_CANONICAL)
    // Same eleven columns with the same names, types, nullability and defaults; only the primary
    // key differs. pk is the fifth field of the parent comparison and the loop above cannot vary
    // it, so without these two the pk comparison is the one field nothing ever reads. It does not
    // move the cids: on a rowid table PRIMARY KEY order leaves table_info ordinals alone (measured:
    // PRIMARY KEY (c, a) over a, b, c still reports cid 0/1/2), so EXPECTED_XINFO would stay green.
    // What these two cases pin is the field itself, not a knock-on effect on the index.
    for (const [label, primaryKey] of [["reordered", "quest_id, section, player_id"],
        ["two of three columns", "section, quest_id"]]) {
        expectError(() => degreeQueryIndexMigration.apply(
            memoryParent(canonicalColumns, PLAYER_OWNERSHIP, primaryKey)),
        Error, `parent primary key: ${label}`, PARENT_NON_CANONICAL)
    }
    // Control: the untouched eleven-column parent is accepted, so the loop above rejects the
    // mutation rather than the fixture shape.
    const canonicalMemory = memoryParent(canonicalColumns, PLAYER_OWNERSHIP)
    degreeQueryIndexMigration.apply(canonicalMemory)
    assert.deepEqual(canonicalMemory.pragma(`index_xinfo("${INDEX_NAME}")`), EXPECTED_XINFO)

    degreeQueryIndexMigration.apply(database)
    assert.deepEqual(database.pragma(`index_xinfo("${INDEX_NAME}")`), EXPECTED_XINFO)
    assert.deepEqual(database.pragma(`index_list("${QUEST_TABLE}")`).find(entry => entry.name === INDEX_NAME),
        { seq: 0, name: INDEX_NAME, unique: 0, origin: "c", partial: 0 })
    assert.equal(namedObject().type, "index")
    assert.equal(namedObject().tbl_name, QUEST_TABLE)
    assert.equal(database.pragma("foreign_keys", { simple: true }), 1, "the caller pragma must be untouched")
    assert.deepEqual(questDigest(), baseline, "an index migration must not touch any row")
    const coveredPlan = queryPlan()
    assert.equal(coveredPlan.includes(`USING COVERING INDEX ${INDEX_NAME}`), true, coveredPlan)
    const afterFirstApply = namedObject().sql
    degreeQueryIndexMigration.apply(database)
    assert.equal(namedObject().sql, afterFirstApply, "the second apply must be a no-op")
    assert.deepEqual(database.pragma(`index_xinfo("${INDEX_NAME}")`), EXPECTED_XINFO)
    assert.deepEqual(questDigest(), baseline)

    // Every variant below differs from the canonical index in exactly one readback field, so each
    // one can only be rejected by the guard that reads that field.
    database.prepare(`DROP INDEX ${INDEX_NAME}`).run()
    for (const [label, createSql, pattern, dropSql] of [
        ["unique", indexOn("player_id, section, finished", "", "UNIQUE "), NON_CANONICAL],
        ["descending", indexOn("player_id DESC, section, finished"), NON_CANONICAL],
        ["partial", indexOn("player_id, section, finished", " WHERE finished = 1"), NON_CANONICAL],
        ["collation", indexOn("player_id COLLATE NOCASE, section, finished"), NON_CANONICAL],
        ["column order", indexOn("section, player_id, finished"), NON_CANONICAL],
        ["extra key column", indexOn("player_id, section, finished, quest_id"), NON_CANONICAL],
        // Shorter than expected: the trailing rowid entry lands where a key column belongs, so the
        // per-row comparison is what rejects it.
        ["missing key column", indexOn("player_id, section"), NON_CANONICAL],
        // Right object kind, wrong table: only the tbl_name comparison can see this one.
        ["foreign owner", `CREATE INDEX ${INDEX_NAME} ON players (id)`, /owned by a index on players$/],
        // Right table, wrong object kind: only the type comparison can see this one.
        ["shadowing trigger", `CREATE TRIGGER ${INDEX_NAME} AFTER INSERT ON ${QUEST_TABLE} BEGIN SELECT 1; END`,
            new RegExp(`owned by a trigger on ${QUEST_TABLE}$`), `DROP TRIGGER ${INDEX_NAME}`],
        ["not an index", `CREATE TABLE ${INDEX_NAME} (value INTEGER)`,
            new RegExp(`owned by a table on ${INDEX_NAME}$`), `DROP TABLE ${INDEX_NAME}`],
    ]) {
        database.exec(createSql)
        expectError(() => degreeQueryIndexMigration.apply(database), Error, `wrong object: ${label}`, pattern)
        assert.equal(namedObject().sql, createSql, `${label}: the foreign object must survive untouched`)
        assert.deepEqual(questDigest(), baseline, `${label}: rows must be preserved`)
        database.exec(dropSql ?? `DROP INDEX ${INDEX_NAME}`)
    }
    assert.equal(namedObject(), undefined)

    database.pragma("foreign_keys = OFF")
    database.prepare(`INSERT INTO ${QUEST_TABLE} (section, quest_id, finished, unlocked,
        multi_clear_count, player_id, host_finished) VALUES (9, 9009009, 0, 0, 0, 4242, 0)`).run()
    database.pragma("foreign_keys = ON")
    expectError(() => degreeQueryIndexMigration.apply(database), Error, "orphan child row",
        /failed foreign key validation/)
    assert.equal(namedObject(), undefined, "a failed apply must leave no index behind")
    database.prepare(`DELETE FROM ${QUEST_TABLE} WHERE player_id = 4242`).run()
    assert.deepEqual(questDigest(), baseline)

    expectError(database.transaction(() => {
        degreeQueryIndexMigration.apply(database)
        assert.notEqual(namedObject(), undefined)
        throw new RangeError("degree caller rollback")
    }), RangeError, "caller rollback", /^degree caller rollback$/)
    assert.equal(namedObject(), undefined, "the caller rollback must undo the index")
    assert.deepEqual(questDigest(), baseline)
    assert.equal(queryPlan().includes("USING COVERING INDEX"), false)
    degreeQueryIndexMigration.apply(database)
    assert.deepEqual(database.pragma(`index_xinfo("${INDEX_NAME}")`), EXPECTED_XINFO)
    assert.deepEqual(questDigest(), baseline)
} catch (error) {
    capturedError = error
} finally {
    for (const extra of extraDatabases) if (extra.open) extra.close()
    if (database?.open) database.close()
    if (previousDatabaseDirectory === undefined) delete process.env.WF_DATABASE_DIR
    else process.env.WF_DATABASE_DIR = previousDatabaseDirectory
    if (fs.existsSync(temporaryRoot)) closedArtifacts = fs.readdirSync(temporaryRoot)
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
}

// Rethrown before the artifact assertions: a body failure that happens before the database exists
// would otherwise be swallowed by an empty-artifact deepEqual instead of being reported.
if (capturedError !== undefined) throw capturedError
assert.equal(fs.existsSync(temporaryRoot), false)
assert.deepEqual(closedArtifacts.sort(), ["wdfp_data.db", "wdfp_data.db.version"])
assert.deepEqual(fs.readdirSync(worktreeRoot).filter(name => name.startsWith(".database")), [])

console.log("degree query index schema tests passed")
