require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const masterIndexRequest = "../src/lib/mission/degree/master-index"
const contextRequest = "../src/lib/mission/degree/context"
const coverageRequest = "../src/lib/mission/degree/coverage"
const computerRequest = "../src/lib/mission/degree/computer"
const QUEST_TABLE = "players_quest_progress"
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wave2a-14-progress-"))
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
        .run(playerId, `degree-${playerId}`)
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

    const { buildDegreeMasterIndex, createProductionDegreeMasterSource, getDegreeMasterIndex,
        masterIntegerList, optionalMasterInteger } = require(masterIndexRequest)
    const index = getDegreeMasterIndex()
    assert.equal(getDegreeMasterIndex(), index, "the production index must be built lazily exactly once")
    assert.equal(Object.isFrozen(index), true, "the index object itself must be frozen")
    assert.equal(index.definitionCount, 1288)
    assert.equal(index.listDefinitions().length, 1288)
    assert.equal(Object.isFrozen(index.listDefinitions()), true)
    const rank = index.getDefinition(1000)
    assert.equal(rank.conditionType, 1)
    assert.equal(rank.pattern, "degree_player_rank_growth_1")
    assert.equal(rank.row.length, 36)
    assert.equal(Object.isFrozen(rank.row), true)
    const { getMissionMasterDefinitions } = require("../src/lib/mission/master-data")
    const shared = getMissionMasterDefinitions(5).find(definition => definition.missionId === 1000)
    assert.equal(rank.row === shared.row, false, "the row must be a defensive copy of the shared master row")
    assert.equal(index.getDefinition(999999), undefined)
    expectError(() => index.getDefinition(0), RangeError, "mission id 0", /^degree mission id /)
    assert.equal(index.getTargetDegree(1000), 50)
    assert.equal(index.getTargetDegree(1070), 250)
    assert.equal(index.getTargetDegree(2000), undefined)
    // positiveSafe is shared by five accessors; each one needs its own case, because a fixture that
    // only exercises getDefinition leaves the other four validations unobserved.
    expectError(() => index.getTargetDegree(0), RangeError, "target degree 0", /^degree mission id /)
    expectError(() => index.getMainQuestIds(0), RangeError, "main chapter 0", /^degree chapter /)
    expectError(() => index.getExQuestIds(1.5), RangeError, "ex chapter fractional", /^degree chapter /)
    expectError(() => index.getBossQuestIds(-1), RangeError, "boss id -1", /^degree boss id /)
    expectError(() => index.hasTreasureShopItem(0), RangeError, "shop item 0", /^treasure shop item id /)
    assert.deepEqual(index.listChapters(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    assert.equal(index.getMainQuestIds(1).length, 21)
    assert.equal(index.getExQuestIds(1).length, 11)
    assert.deepEqual(index.getBossQuestIds(3), [1003001, 1003002, 1003003, 1003004])
    assert.equal(Object.isFrozen(index.getBossQuestIds(3)), true)
    assert.deepEqual(index.getBossQuestIds(999), [])
    // Condition 28 statistic titles, with the kind cell each one selects, plus the two equipment
    // conditions: the compute matrix in mission_degree_battle_stats.test.cjs keys off these.
    for (const [missionId, statisticKind] of [[16000, 5], [17000, 15], [28000, 8], [29000, 7],
        [33000, 4], [36000, 0], [37000, 2], [38000, 16], [40000, 11]]) {
        const definition = index.getDefinition(missionId)
        assert.equal(definition.conditionType, 28, `mission ${missionId} condition`)
        assert.equal(optionalMasterInteger(definition.row[4], "kind"), statisticKind,
            `mission ${missionId} statistic kind`)
    }
    assert.equal(index.getDefinition(42000).conditionType, 34)
    assert.equal(index.getDefinition(43000).conditionType, 36)
    assert.equal(index.listTreasureShopItemIds().length, 108)
    assert.equal(index.hasTreasureShopItem(200001), true)
    assert.equal(index.hasTreasureShopItem(199999), false)

    // Coverage. SOURCE's own test froze 1271/13; the tracked asset says 1274/10 and the three
    // condition-92 titles (70004..70006) must stay inside the server-computed partition. Counts
    // alone cannot see 92 being moved between buckets, so the exact membership of all three
    // partitions is pinned as well, and total is tied to the raw asset instead of to the index's
    // own count: a master that silently loses rows must not stay self-consistent.
    const coverage = require(coverageRequest)
    const production = coverage.getDegreeMissionCoverageReport(index)
    assert.deepEqual([production.total, production.serverComputed, production.clientReported,
        production.persistedOnly], [1288, 1274, 4, 10])
    assert.equal(production.serverComputed + production.clientReported + production.persistedOnly,
        production.total, "the three production partitions must sum to total")
    assert.deepEqual(production.clientReportedConditionTypes, [40, 41, 42, 43])
    assert.deepEqual(production.persistedOnlyConditionTypes, [27, 29, 35])
    assert.deepEqual(production.serverComputedConditionTypes, [0, 1, 3, 4, 5, 7, 8, 9, 14, 15,
        16, 17, 19, 20, 21, 22, 23, 25, 26, 28, 30, 31, 34, 36, 37, 39, 44, 45, 48, 92])
    assert.deepEqual(production.persistedOnlyByConditionType, { 27: 3, 29: 4, 35: 3 })
    assert.equal(Object.keys(require("../assets/mission_degree.json")).length, production.total,
        "total must equal the raw degree master key count")
    assert.deepEqual(production.conditionTypeCounts[44], 484)
    assert.deepEqual(production.conditionTypeCounts[48], 475)
    assert.deepEqual(production.conditionTypeCounts[28], 42)
    assert.equal(coverage.SERVER_COMPUTED_CONDITION_TYPES.includes(92), true,
        "condition 92 must not be demoted to persisted-only")
    assert.deepEqual(coverage.CLIENT_REPORTED_CONDITION_TYPES, [40, 41, 42, 43])
    assert.deepEqual(coverage.SERVER_COMPUTED_STATISTIC_KINDS,
        [0, 2, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
    expectError(() => coverage.getDegreeMissionCoverageReport({}), TypeError,
        "coverage without a built master index", /needs a built master index/)
    for (const missionId of [70004, 70005, 70006]) {
        assert.equal(index.getDefinition(missionId).conditionType, 92, `mission ${missionId}`)
    }
    // Reverse index. An illegal id has to abort instead of being filtered out silently, which is
    // how SOURCE turned a typo into an empty and perfectly plausible looking result.
    const idsFor = (conditionTypes, characterIds, itemIds) =>
        coverage.getDegreeMissionIdsForConditionTypes(conditionTypes, characterIds, itemIds, index)
    assert.deepEqual(idsFor([4]), [2000, 2010, 2020])
    assert.deepEqual(idsFor([4, 4]), [2000, 2010, 2020], "a repeated condition type stays one entry")
    assert.deepEqual(idsFor([]), [])
    assert.deepEqual(idsFor([40, 41, 42, 43]), [47000, 48000, 49000, 50000])
    assert.equal(Object.isFrozen(idsFor([4])), true)
    assert.equal(idsFor([44]).length, 484)
    // A title with no target character stays in; one with a target only survives if it was asked
    // for. Conditions 44 and 48 read column 15, condition 37 reads column 13.
    assert.deepEqual(idsFor([48], [111001]), [55000, 55010, 55020, 1111001])
    assert.deepEqual(idsFor([48], [111002]), [55000, 55010, 55020, 1111002])
    assert.deepEqual(idsFor([44], [111001]), [111001])
    assert.deepEqual(idsFor([37], undefined, [100000]), [41000, 41010, 41020])
    assert.deepEqual(idsFor([37], undefined, [70014]), [70000])
    for (const [label, call, ErrorConstructor, pattern] of [
        ["condition type -1", () => idsFor([-1]), RangeError, /^degree condition type /],
        ["condition type string", () => idsFor(["4"]), TypeError, /^degree condition type /],
        ["condition types not an array", () => idsFor(4), TypeError, /condition types must be an array/],
        ["character id 0", () => idsFor([48], [0]), RangeError, /^degree character id /],
        ["item id fractional", () => idsFor([37], undefined, [1.5]), RangeError, /^degree item id /],
    ]) expectError(call, ErrorConstructor, label, pattern)
    assert.equal(coverage.getDegreeSpecificCharacterId(1111001, 48, index), 111001)
    assert.equal(coverage.getDegreeSpecificCharacterId(55000, 48, index), undefined)
    assert.equal(coverage.getDegreeSpecificCharacterId(111001, 44, index), 111001)
    assert.equal(coverage.getDegreeSpecificCharacterId(111001, 48, index), undefined,
        "a condition 44 title is not a condition 48 title")
    assert.equal(coverage.getDegreeSpecificCharacterId(999999, 44, index), undefined)
    expectError(() => coverage.getDegreeSpecificCharacterId(1111001, 26, index), RangeError,
        "character mission type 26", /degree character mission type 26 /)
    // Every family prefix must select exactly the missions of one condition, and no prefix may be
    // a prefix of another: degree_manaboard_growth_ and degree_manaboard_all_growth_ nearly are.
    const families = Object.values(coverage.SUPPORTED_FAMILIES)
    assert.equal(families.length, 11)
    assert.equal(families.some((prefix, position) =>
        families.some((other, index_) => index_ !== position && other.startsWith(prefix))), false)
    for (const [family, conditionType, count] of [["playerRank", 1, 8], ["companionCount", 4, 3],
        ["manaBoardCount", 7, 3], ["secondManaBoardCompleteCount", 48, 3], ["episodeClearCount", 21, 3]]) {
        const prefix = coverage.SUPPORTED_FAMILIES[family]
        const matched = index.listDefinitions().filter(definition => definition.pattern.startsWith(prefix))
        assert.equal(matched.length, count, `${family} count`)
        assert.deepEqual([...new Set(matched.map(definition => definition.conditionType))],
            [conditionType], `${family} condition`)
    }

    for (const [value, expected] of [["", undefined], ["(None)", undefined], ["0", 0], ["1288", 1288]]) {
        assert.equal(optionalMasterInteger(value, "cell"), expected, `optionalMasterInteger ${JSON.stringify(value)}`)
    }
    expectError(() => optionalMasterInteger(5, "cell"), TypeError, "numeric cell", /^cell /)
    for (const bad of ["01", " 1", "1 ", "1.0", "-1", "+1", "1e3", "0x10", "1,2",
        String(Number.MAX_SAFE_INTEGER + 1)]) {
        expectError(() => optionalMasterInteger(bad, "cell"), RangeError,
            `optionalMasterInteger ${JSON.stringify(bad)}`, /^cell /)
    }
    assert.deepEqual(masterIntegerList("5,15,25,35,45,55", "cell"), [5, 15, 25, 35, 45, 55])
    assert.deepEqual(masterIntegerList("", "cell"), [])
    assert.deepEqual(masterIntegerList("(None)", "cell"), [])
    assert.equal(Object.isFrozen(masterIntegerList("1", "cell")), true)
    for (const bad of ["01", "1,,2", "2,1", "1,1", " 1", "1e2"]) {
        expectError(() => masterIntegerList(bad, "cell"), RangeError,
            `masterIntegerList ${JSON.stringify(bad)}`, /^cell /)
    }

    function cloneSource() {
        const source = createProductionDegreeMasterSource()
        return {
            definitions: source.definitions.map(definition => ({ ...definition, row: [...definition.row] })),
            treasureShopItems: { ...source.treasureShopItems },
            mainQuests: { ...source.mainQuests },
            exQuests: { ...source.exQuests },
            bossQuests: { ...source.bossQuests },
        }
    }
    const definitionOf = (source, missionId) =>
        source.definitions.find(definition => definition.missionId === missionId)
    const rebuilt = buildDegreeMasterIndex(cloneSource())
    assert.equal(rebuilt.definitionCount, 1288)
    assert.equal(rebuilt === index, false, "a test source must not be answered from the production cache")
    // Condition 28 with a canonical but unlisted statistic kind is a legal master; it simply leaves
    // the server-computed partition. Real assets contain no such row, so this needs a synthetic one.
    const unlistedSource = cloneSource()
    definitionOf(unlistedSource, 16000).row[4] = "6"
    const unlisted = coverage.getDegreeMissionCoverageReport(buildDegreeMasterIndex(unlistedSource))
    assert.deepEqual([unlisted.total, unlisted.serverComputed, unlisted.clientReported,
        unlisted.persistedOnly], [1288, 1273, 4, 11])
    assert.equal(unlisted.serverComputed + unlisted.clientReported + unlisted.persistedOnly,
        unlisted.total, "the three synthetic partitions must sum to total")
    assert.deepEqual(unlisted.persistedOnlyConditionTypes, [27, 28, 29, 35])
    assert.deepEqual(unlisted.conditionTypeCounts[28], 42, "the row stays a condition 28 row")
    // "0" is a canonical integer cell, so it passes the cell reader and only the reverse index's own
    // positive-id check can catch it. Real assets have no such row, hence a synthetic one.
    const zeroTargetSource = cloneSource()
    definitionOf(zeroTargetSource, 111001).row[15] = "0"
    expectError(() => coverage.getDegreeMissionIdsForConditionTypes([44], [111001], undefined,
        buildDegreeMasterIndex(zeroTargetSource)), RangeError, "target character id 0",
    /degree mission 111001 character id must be a positive id/)

    const buildFails = (label, mutate, ErrorConstructor, pattern) => {
        const source = cloneSource()
        mutate(source)
        expectError(() => buildDegreeMasterIndex(source), ErrorConstructor, label, pattern)
    }
    const renameKey = (table, from, to) => { table[to] = table[from]; delete table[from] }
    for (const [label, mutate, ErrorConstructor, pattern] of [
        ["missing definition", source => { source.definitions.splice(0, 1) },
            RangeError, /definition count mismatch/],
        ["duplicate mission", source => { source.definitions.push({ ...definitionOf(source, 1000) }) },
            RangeError, /degree mission 1000 is duplicated/],
        ["duplicate pattern", source => { definitionOf(source, 2000).pattern = "degree_player_rank_growth_1" },
            RangeError, /pattern degree_player_rank_growth_1 is duplicated/],
        ["mission id 0", source => { definitionOf(source, 1000).missionId = 0 }, RangeError, /^degree mission id /],
        ["mission id unsafe", source => { definitionOf(source, 1000).missionId = Number.MAX_SAFE_INTEGER + 1 },
            RangeError, /^degree mission id /],
        ["mission id string", source => { definitionOf(source, 1000).missionId = "1000" },
            TypeError, /^degree mission id /],
        ["pattern sentinel", source => { definitionOf(source, 1000).pattern = "(None)" },
            TypeError, /degree mission 1000 pattern/],
        ["row 35 cells", source => { definitionOf(source, 1000).row.length = 35 }, TypeError, /row must be dense/],
        // Nothing else in the matrix hands the row a non-array root, so the array-ness and symbol
        // checks at the top of denseArray would otherwise never be exercised.
        ["row array-like", source => {
            const definition = definitionOf(source, 1000)
            const fake = { length: definition.row.length }
            definition.row.forEach((cell, column) => { fake[column] = cell })
            definition.row = fake
        }, TypeError, /row must be a dense array/],
        ["row symbol", source => { definitionOf(source, 1000).row[Symbol("extra")] = "x" },
            TypeError, /row must be a dense array/],
        // The hole is padded with a non-index own property so the arity guard passes and the
        // per-cell descriptor guard is the only thing left that can reject it.
        ["row hole", source => {
            const row = definitionOf(source, 1000).row
            delete row[5]
            row.padding = "x"
        }, TypeError, /row must be a dense data array/],
        ["row cell getter", source => {
            const row = definitionOf(source, 1000).row
            Object.defineProperty(row, "3", { enumerable: true, get() { return "1" } })
        }, TypeError, /row must be a dense data array/],
        ["numeric cell", source => { definitionOf(source, 1000).row[3] = 1 },
            TypeError, /degree mission 1000 cell 3 /],
        ["condition empty", source => { definitionOf(source, 1000).row[3] = "" },
            RangeError, /condition type must not be an empty sentinel/],
        ["condition none", source => { definitionOf(source, 1000).row[3] = "(None)" },
            RangeError, /condition type must not be an empty sentinel/],
        ["condition leading zero", source => { definitionOf(source, 1000).row[3] = "01" },
            RangeError, /condition type must be a canonical/],
        ["condition spaced", source => { definitionOf(source, 1000).row[3] = " 1" },
            RangeError, /condition type must be a canonical/],
        ["condition fractional", source => { definitionOf(source, 1000).row[3] = "1.5" },
            RangeError, /condition type must be a canonical/],
        ["condition negative", source => { definitionOf(source, 1000).row[3] = "-1" },
            RangeError, /condition type must be a canonical/],
        ["statistic kind empty", source => { definitionOf(source, 16000).row[4] = "" },
            RangeError, /statistic kind must not be an empty sentinel/],
        ["statistic kind none", source => { definitionOf(source, 16000).row[4] = "(None)" },
            RangeError, /statistic kind must not be an empty sentinel/],
        ["statistic kind leading zero", source => { definitionOf(source, 16000).row[4] = "05" },
            RangeError, /statistic kind must be a canonical/],
        ["degree target leading zero", source => { definitionOf(source, 1000).row[2] = "玩家达到 050 级" },
            RangeError, /degree target must be a canonical/],
        ["degree target count", source => { definitionOf(source, 1000).row[2] = "no target here" },
            RangeError, /degree target count mismatch/],
        ["definitions not an array", source => { source.definitions = { ...source.definitions } },
            TypeError, /definitions must be an array/],
        ["main quest key leading zero", source => { renameKey(source.mainQuests, "1001001", "01001001") },
            RangeError, /main quest key must be a canonical/],
        ["main quest count", source => { delete source.mainQuests["1001001"] },
            RangeError, /main quest count mismatch/],
        ["ex quest count", source => { delete source.exQuests["1001001"] }, RangeError, /ex quest count mismatch/],
        ["chapter set mismatch", source => {
            for (const key of Object.keys(source.mainQuests)) {
                if (Number(key) >= 12_000_000) renameKey(source.mainQuests, key, String(Number(key) + 1_000_000))
            }
        }, RangeError, /chapter set mismatch/],
        ["boss quest below base", source => { renameKey(source.bossQuests, "1001001", "999999") },
            RangeError, /boss quest 999999 has no valid bucket/],
        ["boss quest count", source => { delete source.bossQuests["1001001"] },
            RangeError, /boss quest count mismatch/],
        ["treasure shop count", source => { delete source.treasureShopItems["200001"] },
            RangeError, /treasure shop count mismatch/],
        ["treasure shop array root", source => { source.treasureShopItems = Object.values(source.treasureShopItems) },
            TypeError, /treasure shop table must be a plain record/],
        // Array.isArray is blind to a class instance, so this is the only case that can reach the
        // prototype comparison inside plainRecord.
        ["treasure shop class instance", source => {
            class Bag { }
            source.treasureShopItems = Object.assign(new Bag(), source.treasureShopItems)
        }, TypeError, /treasure shop table must be a plain record/],
        ["treasure shop getter", source => {
            Object.defineProperty(source.treasureShopItems, "200001", { enumerable: true, get() { return {} } })
        }, TypeError, /treasure shop table has a non-data property/],
        ["treasure shop symbol key", source => { source.treasureShopItems[Symbol("extra")] = {} },
            TypeError, /treasure shop table must be a plain record/],
    ]) buildFails(label, mutate, ErrorConstructor, pattern)
    assert.equal(getDegreeMasterIndex(), index, "rejected test sources must not poison the production cache")
    assert.equal(getDegreeMasterIndex().definitionCount, 1288)

    const { buildDegreeContext } = require(contextRequest)
    const evaluatedAt = new Date("2025-06-01T00:00:00Z")
    const ctx = buildDegreeContext(1, 5, evaluatedAt, undefined, index)
    assert.equal(ctx.flatQuestProgress.length, 3)
    assert.equal(buildDegreeContext(1, 5, evaluatedAt, [1000], index).flatQuestProgress.length, 0,
        "condition 1 needs no quest progress, so that table must not be read at all")

    // The dormant computer. It is reachable only by this path: nothing exports it from the mission
    // barrel and the live registry still points category 5 at the untouched facade.
    const { DegreeComputerV2, computeRecoverableProgress } = require(computerRequest)
    assert.equal(DegreeComputerV2.name, "DegreeV2", "the dormant computer must not answer to the live name")
    const built = DegreeComputerV2.buildContext(1, 5, evaluatedAt)
    assert.equal(built.category, 5)
    assert.equal(built.playerId, 1)
    assert.equal(require(contextRequest).isDegreeContext(built), true, "buildContext returns a branded context")
    // coverage.ts and computer.ts each answer "which conditions can the server recompute", and
    // neither is derived from the other, so a one-sided edit to either one is invisible without
    // this. The left side is not a third hand-written copy: it is read back out of the switch by
    // running it over all 1288 tracked titles, so adding a case or deleting one moves it. Both
    // sides come from production, which is what the literal expectations above cannot do - those
    // can be rewritten to match a changed module, this cannot.
    const computable = [...new Set(index.listDefinitions()
        .filter(definition => computeRecoverableProgress(definition, ctx) !== undefined)
        .map(definition => definition.conditionType))].sort((left, right) => left - right)
    assert.deepEqual(computable, [...coverage.SERVER_COMPUTED_CONDITION_TYPES],
        "coverage and compute must agree on which conditions the server can recompute")
    // Progress is monotonic: a recoverable value may raise the stored one but never lower it, and
    // a title the engine cannot recompute keeps whatever the database holds.
    for (const [missionId, dbProgress, expected, label] of [
        [14000, 0, 1000, "condition 25 recovers the best high score"],
        [14000, 5000, 5000, "a larger stored value survives"],
        [15000, 0, 1, "condition 15 reads the best clear time"],
        [2000, 9, 9, "an empty derived statistic never lowers the stored value"],
        [47000, 3, 3, "a client-reported title keeps its stored progress"],
        [32000, 4, 4, "a persisted-only title keeps its stored progress"],
        [999999, 5, 5, "an unknown but canonical mission keeps its stored progress"],
    ]) assert.equal(DegreeComputerV2.compute(missionId, ctx, dbProgress), expected, label)
    // Object.create keeps the brand reachable through the prototype chain, so a derived object is
    // the one way a context can carry the brand and still be wrong about itself.
    const derived = (overrides) => Object.create(ctx, overrides)
    for (const [label, call, ErrorConstructor, pattern] of [
        ["missionId 0", () => DegreeComputerV2.compute(0, ctx, 0), RangeError, /^degree missionId /],
        ["dbProgress -1", () => DegreeComputerV2.compute(1000, ctx, -1), RangeError, /^degree dbProgress /],
        ["dbProgress fractional", () => DegreeComputerV2.compute(1000, ctx, 1.5),
            RangeError, /^degree dbProgress /],
        ["dbProgress string", () => DegreeComputerV2.compute(1000, ctx, "0"), TypeError, /^degree dbProgress /],
        ["unbranded context", () => DegreeComputerV2.compute(1000, { category: 5 }, 0),
            TypeError, /needs a branded degree context/],
        ["derived context claiming category 4",
            () => DegreeComputerV2.compute(1000, derived({ category: { value: 4 } }), 0),
            RangeError, /degree context category must be 5/],
        ["derived context without a master index",
            () => DegreeComputerV2.compute(1000, derived({ masterIndex: { value: {} } }), 0),
            TypeError, /must carry a built master index/],
    ]) expectError(call, ErrorConstructor, label, pattern)
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

console.log("degree progress tests passed")
