require("ts-node/register/transpile-only")

// Pure engine benchmark for the dormant degree computer.
//
// SOURCE timed twenty-five whole settlement rounds and asserted an average under 100 ms. That
// number measured the registry, the reward writes and the database as much as the engine, so it
// could go green while compute itself got slower and red because a disk hiccuped. Nothing here
// imports settlement, the registry, a route, an initializer or the live degree facade: the context
// is built once up front, and the timed region only calls compute over a frozen context.
//
// The budgets below are frozen against pure compute. They are deliberately not the place to absorb
// a regression: the reason a full sweep is this cheap is that the master index answers from a Map,
// and the live facade's Array.prototype.find over 1288 definitions - which the fallback path ran
// twice per compute - is measured alongside as the calibration point.

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const masterIndexRequest = "../src/lib/mission/degree/master-index"
const contextRequest = "../src/lib/mission/degree/context"
const coverageRequest = "../src/lib/mission/degree/coverage"
const computerRequest = "../src/lib/mission/degree/computer"
const migrationRequest = "../src/data/migrations/wdfp/degree-query-index"
const WARMUP_BATCHES = 3
const MEASURED_BATCHES = 11
// One scoped batch does the same number of computes as one full sweep, so the two medians are
// directly comparable: 429 rounds over the three condition 4 titles is 1287 calls against 1288.
const SCOPED_ROUNDS = 429
// Frozen against pure compute measured here at 0.60 ms / 0.13 ms; the headroom is for a loaded
// machine, not for a regression. On this machine these two absolute numbers are the tighter of the
// two gates, not the linear-lookup calibration below — see the note at that assertion.
const FULL_SWEEP_BUDGET_MS = 15
const SCOPED_SWEEP_BUDGET_MS = 5
const FULL_SWEEP_CHECKSUM = 1189
const SCOPED_SWEEP_CHECKSUM = 2574
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wave2a-14-perf-"))
const previousDatabaseDirectory = process.env.WF_DATABASE_DIR
const worktreeRoot = path.resolve(__dirname, "..")
let database
let closedArtifacts = []
let capturedError

function insertPlayer(playerId) {
    database.prepare(`INSERT INTO accounts (
        id, app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status
    ) VALUES (?, 'wf_cn', '2025-01-01', '', 'wave2a-14', ?, '2025-01-01', '2025-01-01', 'normal')`)
        .run(playerId, `degree-perf-${playerId}`)
    database.prepare(`INSERT INTO players (
        id, stamina, stamina_heal_time, boost_point, boss_boost_point, transition_state, role, name,
        last_login_time, comment, vmoney, free_vmoney, rank_point, star_crumb, bond_token, exp_pool,
        exp_pooled_time, leader_character_id, party_slot, degree_id, birth, free_mana, paid_mana,
        enable_auto_3x, account_id
    ) VALUES (?, 0, 0, 0, 0, 0, 0, 'degree', '2025-01-01', '', 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, ?)`)
        .run(playerId, playerId)
}

/** Warm up, then take the median of an odd number of equal batches. Never a single reading. */
function medianBatchMs(batch) {
    for (let warmup = 0; warmup < WARMUP_BATCHES; warmup++) batch()
    const samples = []
    for (let round = 0; round < MEASURED_BATCHES; round++) {
        const started = process.hrtime.bigint()
        batch()
        samples.push(Number(process.hrtime.bigint() - started) / 1e6)
    }
    samples.sort((left, right) => left - right)
    return samples[(MEASURED_BATCHES - 1) / 2]
}

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

    const { getDegreeMasterIndex } = require(masterIndexRequest)
    const { degreeQueryIndexMigration } = require(migrationRequest)
    degreeQueryIndexMigration.apply(database)
    for (const [dimension, qualifier, value] of [
        ["battle.stat", { kind: "fever", mode: "single" }, 7],
        ["battle.max_skill_chain", {}, 4],
        ["battle.clear", { mode: "multi" }, 12],
    ]) {
        const qualifierJson = JSON.stringify(qualifier)
        database.prepare(`INSERT INTO players_mission_counters (player_id, counter_key, dimension,
            scope_type, scope_key, qualifier_json, value, updated_at)
            VALUES (1, ?, ?, 'lifetime', 'all', ?, ?, '2025-01-01')`)
            .run([dimension, "lifetime", "all", qualifierJson].join("|"), dimension, qualifierJson, value)
    }
    database.prepare(`UPDATE players SET rank_point = 1000000, total_login_days = 7 WHERE id = 1`).run()
    // Two owned characters, so the 484 condition 44 titles and the condition 4 family do real work
    // rather than short-circuiting on an empty character record.
    for (const characterId of [111001, 111002]) {
        database.prepare(`INSERT INTO players_characters (id, entry_count, evolution_level,
            over_limit_step, protection, join_time, update_time, exp, stack, mana_board_index,
            player_id) VALUES (?, 1, 0, 0, 0, '2025-01-01', '2025-01-01', 0, 0, 1, 1)`).run(characterId)
    }

    const index = getDegreeMasterIndex()
    const { buildDegreeContext } = require(contextRequest)
    const { getDegreeMissionIdsForConditionTypes } = require(coverageRequest)
    const { DegreeComputerV2 } = require(computerRequest)
    // Everything the timed region reads is built here, once, and frozen.
    const evaluatedAt = new Date("2025-06-01T00:00:00Z")
    const ctx = buildDegreeContext(1, 5, evaluatedAt, undefined, index)
    const missionIds = Object.freeze(index.listDefinitions().map(definition => definition.missionId))
    const scopedIds = getDegreeMissionIdsForConditionTypes([4], undefined, undefined, index)
    const fullSweep = () => {
        let total = 0
        for (const missionId of missionIds) total += DegreeComputerV2.compute(missionId, ctx, 0)
        return total
    }
    const scopedSweep = () => {
        let total = 0
        for (let round = 0; round < SCOPED_ROUNDS; round++) {
            for (const missionId of scopedIds) total += DegreeComputerV2.compute(missionId, ctx, 0)
        }
        return total
    }

    // Correctness first: a benchmark over a sweep that computes the wrong thing measures nothing.
    assert.equal(missionIds.length, 1288)
    assert.equal(Object.isFrozen(ctx), true)
    assert.deepEqual(scopedIds, [2000, 2010, 2020])
    assert.equal(fullSweep(), FULL_SWEEP_CHECKSUM, "the full sweep must compute the same total every run")
    assert.equal(scopedSweep(), SCOPED_SWEEP_CHECKSUM)
    assert.equal(scopedSweep() / SCOPED_ROUNDS, DegreeComputerV2.compute(2000, ctx, 0)
        + DegreeComputerV2.compute(2010, ctx, 0) + DegreeComputerV2.compute(2020, ctx, 0))

    // The timed region may not touch the database. Rather than assert that afterwards, the handle
    // is taken away for its duration, and the guard is proved to bite before it is relied on.
    const originalPrepare = database.prepare
    database.prepare = () => { throw new Error("the timed region must not touch the database") }
    let fullMedianMs
    let scopedMedianMs
    let linearLookupMs
    try {
        assert.throws(() => buildDegreeContext(1, 5, evaluatedAt, undefined, index),
            /the timed region must not touch the database/, "the no-database guard has to bite")
        fullMedianMs = medianBatchMs(fullSweep)
        scopedMedianMs = medianBatchMs(scopedSweep)
        // Calibration: the live facade resolves a definition with a linear find over 1288 entries
        // and the fallback path ran it twice per compute. One such pass per mission, nothing else.
        const { getMissionMasterDefinition } = require("../src/lib/mission/master-data")
        linearLookupMs = medianBatchMs(() => {
            for (const missionId of missionIds) getMissionMasterDefinition(5, missionId)
        })
    } finally {
        database.prepare = originalPrepare
    }
    const report = `full=${fullMedianMs.toFixed(2)}ms scoped=${scopedMedianMs.toFixed(2)}ms `
        + `linearLookup=${linearLookupMs.toFixed(2)}ms over ${MEASURED_BATCHES} batches`
    assert.equal(fullMedianMs < FULL_SWEEP_BUDGET_MS, true, report)
    assert.equal(scopedMedianMs < SCOPED_SWEEP_BUDGET_MS, true, report)
    // A whole sweep of 1288 computes has to stay cheaper than 1288 bare linear master lookups,
    // which is only possible while nothing on the compute path scans the definition list. What this
    // one buys is machine independence: both medians scale together on a slow or loaded box, where
    // the fixed budgets above do not. It is not the stronger gate and it is not the one to lean on.
    // Measured by mutation: restoring one linear lookup per compute puts full at 28.1-28.9 ms
    // against a linearLookup of 27.7-27.9 - one to four percent of margin, and one run in six came
    // out green - while the absolute budgets failed it every time. With both budgets relaxed a
    // hundredfold this line stays green on the baseline, so on its own it guards nothing here.
    // Neither gate catches an ordinary constant-factor slowdown: the floor is about an order of
    // magnitude (2000 added floating point operations per compute is caught, 200 is not), and it is
    // the absolute budgets, not this line, that do the catching.
    assert.equal(fullMedianMs < linearLookupMs, true, report)
    assert.equal(database.inTransaction, false, "compute must not leave a transaction open")
} catch (error) {
    capturedError = error
} finally {
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

console.log("degree immediate performance tests passed")
