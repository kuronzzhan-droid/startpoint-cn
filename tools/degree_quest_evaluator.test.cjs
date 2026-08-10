require("ts-node/register/transpile-only")

// Focused test for the dormant degree quest evaluator.
//
// House convention keeps one unit under test per file (mission_facts_schema, awake_degree_schema,
// category_mission_schema_repair, pass_card_schema, degree_query_index_schema). This file owns the
// filter / matcher / clear-count / rank / score / chapter matrix plus the quest storage guards that
// mission_degree_progress.test.cjs used to carry; the move was verbatim, no case was rewritten.

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const masterIndexRequest = "../src/lib/mission/degree/master-index"
const contextRequest = "../src/lib/mission/degree/context"
const questEvaluatorRequest = "../src/lib/mission/degree/quest-evaluator"
const QUEST_TABLE = "players_quest_progress"
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wave2a-14-quest-"))
const previousDatabaseDirectory = process.env.WF_DATABASE_DIR
const worktreeRoot = path.resolve(__dirname, "..")
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
        .run(playerId, `degree-quest-${playerId}`)
    database.prepare(`INSERT INTO players (
        id, stamina, stamina_heal_time, boost_point, boss_boost_point, transition_state, role, name,
        last_login_time, comment, vmoney, free_vmoney, rank_point, star_crumb, bond_token, exp_pool,
        exp_pooled_time, leader_character_id, party_slot, degree_id, birth, free_mana, paid_mana,
        enable_auto_3x, account_id
    ) VALUES (?, 0, 0, 0, 0, 0, 0, 'degree', '2025-01-01', '', 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, ?)`)
        .run(playerId, playerId)
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
    for (const [section, questId, rank, elapsed] of [[1, 1001001, 3, 60000], [4, 1001001, 2, 90000],
        [2, 1003004, 1, 120000]]) {
        database.prepare(`INSERT INTO ${QUEST_TABLE} (section, quest_id, finished, unlocked,
            high_score, clear_rank, best_elapsed_time_ms, leader_character_id, multi_clear_count,
            player_id, host_finished) VALUES (?, ?, 1, 1, 1000, ?, ?, 111001, 0, 1, 0)`)
            .run(section, questId, rank, elapsed)
    }

    const { getDegreeMasterIndex } = require(masterIndexRequest)
    const index = getDegreeMasterIndex()
    assert.equal(index.definitionCount, 1288)
    const { buildDegreeContext, safeMax } = require(contextRequest)
    const evaluator = require(questEvaluatorRequest)
    const insertCounter = (dimension, scopeType, scopeKey, qualifier, value) => {
        const qualifierJson = JSON.stringify(qualifier)
        database.prepare(`INSERT INTO players_mission_counters (player_id, counter_key, dimension,
            scope_type, scope_key, qualifier_json, value, updated_at)
            VALUES (1, ?, ?, ?, ?, ?, ?, '2025-01-01')`)
            .run([dimension, scopeType, scopeKey, qualifierJson].join("|"), dimension, scopeType,
                scopeKey, qualifierJson, value)
    }
    insertCounter("battle.quest_clear", "lifetime", "all",
        { mode: "multi", questCategory: 1, questId: 1001001 }, 5)
    insertCounter("battle.quest_clear", "lifetime", "all",
        { mode: "single", questCategory: 1, questId: 1001001 }, 3)
    insertCounter("battle.rank_clear", "lifetime", "all", { rank: 3 }, 7)

    const evaluatedAt = new Date("2025-06-01T00:00:00Z")
    const ctx = buildDegreeContext(1, 5, evaluatedAt, undefined, index)
    assert.equal(ctx.flatQuestProgress.length, 3)
    // Every tracked row has to resolve. A selector guard that is too strict would fail closed on
    // the real master, which is the failure mode SOURCE hid behind its silent Number() coercions.
    let resolvedFilters = 0
    for (const definition of index.listDefinitions()) {
        if (evaluator.resolveQuestFilter(definition.row, index).categories !== undefined) resolvedFilters++
    }
    assert.equal(resolvedFilters, 1288, "every degree row must resolve to a quest filter")

    const questRow = overrides => {
        const row = new Array(36).fill("")
        for (const [column, value] of Object.entries(overrides)) row[Number(column)] = value
        return row
    }
    const filterOf = overrides => evaluator.resolveQuestFilter(questRow(overrides), index)
    const exactIds = filter => [...filter.exactQuestIds].sort((left, right) => left - right)
    assert.deepEqual(evaluator.questCategoriesForKind(undefined), [])
    assert.deepEqual(evaluator.questCategoriesForKind(5), [7, 8])
    assert.deepEqual(evaluator.questCategoriesForKind(99), [])
    expectError(() => evaluator.questCategoriesForKind(-1), RangeError, "kind -1", /^degree quest kind /)
    assert.deepEqual(filterOf({ 8: "0" }).categories, [1])
    assert.deepEqual(filterOf({ 8: "12" }).categories, [13, 14, 20])
    assert.deepEqual(exactIds(filterOf({ 8: "2", 10: "3", 12: "4" })), [1003004])
    // Difficulty 9 does not exist for boss 3, so the sorted bucket's last entry is the fallback.
    assert.deepEqual(exactIds(filterOf({ 8: "2", 10: "3", 12: "9" })), [1003004])
    assert.equal(filterOf({ 8: "2", 10: "3" }).bossId, 3)
    assert.equal(filterOf({ 8: "2", 10: "999", 12: "4" }).bossId, 999, "an empty bucket falls back to the boss")
    expectError(() => filterOf({ 8: "2", 10: "0", 12: "4" }), RangeError, "boss cell 0",
        /boss cell must be a positive selector/)
    assert.deepEqual(exactIds(filterOf({ 8: "11", 11: "1,2,3" })), [1, 2, 3])
    assert.equal(filterOf({ 8: "11" }).exactQuestIds, undefined)
    assert.deepEqual(exactIds(filterOf({ 8: "19", 9: "100004" })), [100004])
    assert.deepEqual(exactIds(filterOf({ 8: "1", 9: "1001", 11: "2" })), [1001002])
    assert.equal(filterOf({ 8: "1", 9: "1001" }).eventPrefix, 1001)
    expectError(() => filterOf({ 9: "01" }), RangeError, "event cell 01", /event cell must be a canonical/)
    const bossFilter = filterOf({ 8: "2", 10: "3", 12: "4" })
    assert.equal(Object.isFrozen(bossFilter), true)
    assert.equal(Object.isFrozen(bossFilter.exactQuestIds), true)
    const matches = evaluator.matchesQuest
    assert.equal(matches({ categories: [1] }, 1, 1001001), true)
    assert.equal(matches({ categories: [1] }, 4, 1001001), false)
    assert.equal(matches({ categories: [], exactQuestIds: new Set([9]) }, 3, 8), false)
    assert.equal(matches({ categories: [], bossId: 3 }, 2, 1003004), true)
    assert.equal(matches({ categories: [], bossId: 4 }, 2, 1003004), false)
    assert.equal(matches({ categories: [], eventPrefix: 1001 }, 1, 1001001), true)
    assert.equal(matches({ categories: [], eventPrefix: 1002 }, 1, 1001001), false)
    for (const [cell, mode] of [["1", "single"], ["2", "multi"], ["3", "any"], ["", "any"]]) {
        assert.equal(evaluator.requestedBattleMode(questRow({ 6: cell })), mode, `battle kind ${cell}`)
    }

    // Section 2 holds one finished row whose multiClearCount is 0 and no counter matches it. SOURCE
    // credited Math.max(1, multiClearCount) in multi mode and turned that solo clear into a multi
    // clear; only clears the storage can prove were multiplayer count here.
    assert.equal(evaluator.countQuestClears(ctx, { categories: [2] }, "single"), 1)
    assert.equal(evaluator.countQuestClears(ctx, { categories: [2] }, "multi"), 0,
        "a multiClearCount of 0 is not a multiplayer clear")
    assert.equal(evaluator.countQuestClears(ctx, { categories: [2] }, "any"), 1)
    // Section 1 matches both a stored row and a lifetime counter. They describe the same clears from
    // two sides, so the larger of the two wins; adding them would count the same clear twice.
    assert.equal(evaluator.countQuestClears(ctx, { categories: [1] }, "single"), 3)
    assert.equal(evaluator.countQuestClears(ctx, { categories: [1] }, "multi"), 5)
    assert.equal(evaluator.readCounter(ctx, "battle.rank_clear", { rank: 3 }), 7)
    assert.equal(evaluator.readCounter(ctx, "battle.rank_clear", { rank: 9 }), 0)
    assert.equal(evaluator.readCounter(ctx, "battle.rank_clear"), 0)
    expectError(() => evaluator.readCounter(ctx, ""), TypeError, "empty dimension",
        /counter dimension must be a non-empty string/)
    assert.equal(evaluator.maxClearRankCount(ctx, 3), 7, "the counter wins over the single stored row")
    assert.equal(evaluator.maxClearRankCount(ctx, 2), 1, "with no counter the stored rows win")
    expectError(() => evaluator.maxClearRankCount(ctx, -1), RangeError, "rank -1", /^degree clear rank /)
    assert.equal(evaluator.maxHighScore(ctx), 1000)
    assert.equal(evaluator.bestSingleClearTimeMs(ctx), 60000)
    assert.equal(evaluator.completedChapter(ctx, 1), false, "one cleared quest is not a whole chapter")
    assert.equal(evaluator.completedChapter(ctx, 13), false, "a chapter with no master quests never completes")

    // Every optional quest column is read through its own guard, so each one needs its own case.
    for (const [column, broken, pattern] of [["quest_id", 0, /quest id in section 2 must be a positive/],
        ["high_score", -1, /high score must be a non-negative/],
        ["clear_rank", -2, /clear rank must be a non-negative/],
        ["best_elapsed_time_ms", -3, /elapsed time must be a non-negative/],
        ["multi_clear_count", -4, /multi clear count must be a non-negative/]]) {
        const restore = database.prepare(`SELECT ${column} AS value FROM ${QUEST_TABLE}
            WHERE section = 2`).get().value
        database.prepare(`UPDATE ${QUEST_TABLE} SET ${column} = ? WHERE section = 2`).run(broken)
        expectError(() => buildDegreeContext(1, 5, evaluatedAt, undefined, index), RangeError,
            `quest storage: ${column}`, pattern)
        database.prepare(`UPDATE ${QUEST_TABLE} SET ${column} = ? WHERE section = 2`).run(restore)
    }
    // The section is the third entry into the shared record-key guard (characters and items are the
    // other two) and the only one the column guards above cannot reach: the domain reader turns the
    // raw column into the record key with toString(), and the column carries no CHECK constraint.
    database.prepare(`UPDATE ${QUEST_TABLE} SET section = -1 WHERE section = 2`).run()
    expectError(() => buildDegreeContext(1, 5, evaluatedAt, undefined, index), RangeError,
        "quest storage: section", /degree quest section -1 must be a canonical decimal key/)
    database.prepare(`UPDATE ${QUEST_TABLE} SET section = 2 WHERE section = -1`).run()
    assert.equal(buildDegreeContext(1, 5, evaluatedAt, undefined, index).flatQuestProgress.length, 3)

    // One argument per row: Math.max(...values) / Math.min(...times) blow the call stack here, so
    // the reducers have to be loops.
    const bulk = { flatQuestProgress: [], counterValues: Object.create(null), questClearCounters: [] }
    for (let index_ = 0; index_ < 200_000; index_++) {
        bulk.flatQuestProgress.push({ section: 1, questId: index_ + 1, finished: true,
            highScore: index_, bestElapsedTimeMs: 200_000 - index_, multiClearCount: 0 })
    }
    assert.equal(evaluator.maxHighScore(bulk), 199_999)
    assert.equal(evaluator.bestSingleClearTimeMs(bulk), 1)
    assert.equal(safeMax(bulk.flatQuestProgress.map(entry => entry.highScore), 0), 199_999)
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

console.log("degree quest evaluator tests passed")
