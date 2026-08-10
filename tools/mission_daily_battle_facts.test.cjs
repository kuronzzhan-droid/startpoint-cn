require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const collectorRequest = "../src/lib/mission/daily-battle-facts"
const collectorPath = path.resolve(__dirname, "../src/lib/mission/daily-battle-facts.ts")
const masterDataPath = path.resolve(__dirname, "../src/lib/mission/master-data.ts")
const domainPath = path.resolve(__dirname, "../src/data/domains/mission.ts")
const categoryDomainPath = path.resolve(__dirname, "../src/data/domains/category_mission.ts")
const dbPath = path.resolve(__dirname, "../src/data/db.ts")
const dailyAssetPath = require.resolve("../assets/mission_daily.json")
const adventAssetPath = require.resolve("../assets/advent_event_quest.json")
const scoreAssetPath = require.resolve("../assets/score_attack_event_quest.json")
const touchedCachePaths = [collectorPath, masterDataPath, domainPath, categoryDomainPath, dbPath,
    dailyAssetPath, adventAssetPath, scoreAssetPath]
const fixtureGraphRoots = [collectorPath, masterDataPath, dailyAssetPath, adventAssetPath, scoreAssetPath]
const missionDirectory = path.resolve(__dirname, "../src/lib/mission") + path.sep
const assetsDirectory = path.resolve(__dirname, "../assets") + path.sep
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wave2a-13-daily-"))
const previousDatabaseDirectory = process.env.WF_DATABASE_DIR
const worktreeDatabase = path.resolve(__dirname, "..", ".database")
let database
let capturedError
let cacheSnapshot

function cacheExport(modulePath, exportsValue) {
    require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true,
        exports: exportsValue, children: [], paths: [] }
}

function snapshotCache() { return new Map(Object.entries(require.cache)) }

function restoreCache(snapshot) {
    for (const modulePath of Object.keys(require.cache).reverse()) {
        if (!snapshot.has(modulePath)) delete require.cache[modulePath]
    }
    for (const [modulePath, entry] of [...snapshot].reverse()) require.cache[modulePath] = entry
}

function purgeFixtureGraph(modulePath, seen = new Set()) {
    if (seen.has(modulePath)) return
    seen.add(modulePath)
    const entry = require.cache[modulePath]
    if (entry) for (const child of entry.children) {
        if (child.filename.startsWith(missionDirectory) || child.filename.startsWith(assetsDirectory)) {
            purgeFixtureGraph(child.filename, seen)
        }
    }
    delete require.cache[modulePath]
}

function freshCollector(overrides = new Map()) {
    const fixtureSnapshot = snapshotCache()
    try {
        for (const modulePath of fixtureGraphRoots) purgeFixtureGraph(modulePath)
        for (const modulePath of overrides.keys()) delete require.cache[modulePath]
        for (const [modulePath, exportsValue] of overrides) cacheExport(modulePath, exportsValue)
        return require(collectorRequest)
    } finally {
        restoreCache(fixtureSnapshot)
    }
}

function clone(value) {
    return structuredClone(value)
}

function rawRows(playerId) {
    return database.prepare(`SELECT category, id, progress, player_id FROM players_category_missions
        WHERE player_id = ? ORDER BY category, id`).all(playerId)
}

function expectCtor(callback, ErrorConstructor) {
    assert.throws(callback, error => error?.constructor === ErrorConstructor)
}

function insertPlayer(playerId) {
    database.prepare(`INSERT INTO accounts (
        id, app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status
    ) VALUES (?, 'wf_cn', '2025-01-01', '', 'wave2a-13', ?, '2025-01-01', '2025-01-01', 'normal')`).run(playerId, `daily-${playerId}`)
    database.prepare(`INSERT INTO players (
        id, stamina, stamina_heal_time, boost_point, boss_boost_point, transition_state, role, name,
        last_login_time, comment, vmoney, free_vmoney, rank_point, star_crumb, bond_token, exp_pool,
        exp_pooled_time, leader_character_id, party_slot, degree_id, birth, free_mana, paid_mana,
        enable_auto_3x, account_id
    ) VALUES (?, 0, 0, 0, 0, 0, 0, 'daily-red', '2025-01-01', '', 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, ?)`)
        .run(playerId, playerId)
}

function categoryRows(playerId) {
    return database.prepare(`SELECT id, progress FROM players_category_missions
        WHERE player_id = ? AND category = 2 ORDER BY id`).all(playerId)
}

function context(playerId, questCategory, questId, isMulti = true) {
    return { playerId, questCategory, questId, questAccomplished: true, isMulti }
}

try {
    process.env.WF_DATABASE_DIR = temporaryRoot
    cacheSnapshot = snapshotCache()
    const { getDb } = require("../src/data/db")
    database = getDb()
    const main = database.pragma("database_list").find(entry => entry.name === "main")
    assert.equal(path.dirname(path.resolve(main.file)), path.resolve(temporaryRoot))
    assert.equal(database.pragma("foreign_keys", { simple: true }), 1)
    insertPlayer(1)
    insertPlayer(2)
    insertPlayer(3)

    const { recordDailyMissionBattleFacts } = freshCollector()
    const advent = context(1, 7, 200015001)
    assert.throws(
        () => recordDailyMissionBattleFacts(advent, new Date("2024-08-14T03:00:00Z")),
        /no such table: players_category_missions/,
    )

    const { categoryMissionMigration } = require("../src/data/migrations/wdfp/category-mission")
    categoryMissionMigration.apply(database)

    assert.deepEqual(recordDailyMissionBattleFacts(context(1, 27, 1001, false), new Date("2026-07-25T03:00:00Z")), [10075, 800392])
    assert.deepEqual(recordDailyMissionBattleFacts(context(1, 27, 2001, false), new Date("2026-07-25T03:00:00Z")), [800392])
    assert.deepEqual(recordDailyMissionBattleFacts(advent, new Date("2024-08-14T03:00:00Z")), [800115, 800116, 800117])
    assert.deepEqual(recordDailyMissionBattleFacts(context(1, 2, 1014001), new Date("2024-08-14T03:00:00Z")), [800124, 800125, 800126])
    assert.deepEqual(categoryRows(1), [
        { id: 10075, progress: 1 }, { id: 800115, progress: 1 }, { id: 800116, progress: 1 },
        { id: 800117, progress: 1 }, { id: 800124, progress: 1 }, { id: 800125, progress: 1 },
        { id: 800126, progress: 1 }, { id: 800392, progress: 2 },
    ])
    assert.deepEqual(recordDailyMissionBattleFacts(advent, new Date("2024-08-14T03:00:00Z")), [800115, 800116, 800117])
    assert.deepEqual(categoryRows(1).filter(row => row.id >= 800115 && row.id <= 800117), [
        { id: 800115, progress: 2 }, { id: 800116, progress: 2 }, { id: 800117, progress: 2 },
    ])

    const noOpCases = [
        [{ ...advent, questAccomplished: false }, new Date("2024-08-14T03:00:00Z")],
        [{ ...advent, isMulti: false }, new Date("2024-08-14T03:00:00Z")],
        [{ ...advent, questCategory: 1 }, new Date("2024-08-14T03:00:00Z")],
        [{ ...advent, questCategory: 5 }, new Date("2024-08-14T03:00:00Z")],
        [{ ...advent, questId: 200016001 }, new Date("2024-08-14T03:00:00Z")],
        [{ ...advent, questId: 200015006 }, new Date("2024-08-14T03:00:00Z")],
    ]
    for (const [candidate, time] of noOpCases) assert.deepEqual(recordDailyMissionBattleFacts(candidate, time), [])

    const adventStart = "2024-08-01T04:00:00.000Z"
    const adventEnd = "2024-08-16T15:59:59.000Z"
    assert.deepEqual(recordDailyMissionBattleFacts(advent, new Date(Date.parse(adventStart) - 1)), [])
    assert.deepEqual(recordDailyMissionBattleFacts(advent, new Date(adventStart)), [800115, 800116, 800117])
    assert.deepEqual(recordDailyMissionBattleFacts(advent, new Date(adventEnd)), [800115, 800116, 800117])
    assert.deepEqual(recordDailyMissionBattleFacts(advent, new Date(Date.parse(adventEnd) + 1)), [])

    const valid = { ...advent }
    for (const [field, invalid, ErrorConstructor] of [
        ["playerId", "1", TypeError], ["playerId", 0, RangeError], ["playerId", 1.5, RangeError],
        ["questId", NaN, TypeError], ["questId", Number.MAX_SAFE_INTEGER + 1, RangeError],
        ["questCategory", "5", TypeError], ["questCategory", -1, RangeError],
        ["questAccomplished", 1, TypeError], ["isMulti", null, TypeError],
        ["isMultiHost", 0, TypeError], ["isMultiHost", "host", TypeError],
    ]) expectCtor(() => recordDailyMissionBattleFacts({ ...valid, [field]: invalid }, new Date("2024-08-14T03:00:00Z")), ErrorConstructor)
    for (const [time, ErrorConstructor] of [[0, TypeError], ["2024-08-14", TypeError],
        [Object.create(Date.prototype), TypeError], [new Date(NaN), TypeError]]) {
        expectCtor(() => recordDailyMissionBattleFacts(valid, time), ErrorConstructor)
    }
    let dateGetterReads = 0
    const guardedDate = new Date("2024-08-14T03:00:00Z")
    Object.defineProperty(guardedDate, "getTime", { get() { dateGetterReads++; return Date.prototype.getTime } })
    assert.deepEqual(recordDailyMissionBattleFacts(valid, guardedDate), [800115, 800116, 800117])
    assert.equal(dateGetterReads, 0)

    database.prepare(`INSERT INTO players_category_missions (category, id, progress, player_id)
        VALUES (2, 800116, ?, 2)`).run(Number.MAX_VALUE)
    assert.throws(() => recordDailyMissionBattleFacts(context(2, 7, 200015001), new Date("2024-08-14T03:00:00Z")), RangeError)
    assert.deepEqual(categoryRows(2), [{ id: 800116, progress: Number.MAX_VALUE }])

    assert.throws(() => recordDailyMissionBattleFacts(context(1, 7, 0), new Date("2024-08-14T03:00:00Z")), RangeError)
    assert.throws(() => recordDailyMissionBattleFacts(advent, new Date("invalid")), TypeError)
    assert.throws(() => recordDailyMissionBattleFacts(context(99, 7, 200015001), new Date("2024-08-14T03:00:00Z")), /FOREIGN KEY/)
    assert.throws(database.transaction(() => {
        recordDailyMissionBattleFacts(context(3, 2, 1014001), new Date("2024-08-14T03:00:00Z"))
        throw new Error("daily caller rollback")
    }), /daily caller rollback/)
    assert.deepEqual(categoryRows(3), [])

    const realDaily = require(dailyAssetPath)
    const realAdvent = require(adventAssetPath)
    const realScore = require(scoreAssetPath)
    assert.equal(Object.keys(realAdvent).length, 459)
    assert.equal(Object.keys(realScore).length, 123)
    const importFails = (overrides, ErrorConstructor) => expectCtor(() => freshCollector(overrides), ErrorConstructor)
    for (const [mutate, ErrorConstructor] of [
        [table => { delete table["800115"] }, Error],
        [table => { table["0800115"] = clone(table["800115"]) }, RangeError],
        [table => { table["800115"] = [table["800115"][0], clone(table["800115"][0])] }, TypeError],
        [table => { table["800115"] = [table["800115"][0].slice(0, 34)] }, TypeError],
        [table => { table["800115"][0][2] = 16 }, TypeError],
        [table => { table["800115"][0][25] = "2024-02-30 12:00:00" }, RangeError],
        [table => { table["800115"][0][25] = "2023-02-29 12:00:00" }, RangeError],
        [table => { table["800115"][0][25] = "2024-08-17 00:00:00" }, RangeError],
    ]) {
        const bad = clone(realDaily); mutate(bad)
        importFails(new Map([[dailyAssetPath, bad]]), ErrorConstructor)
    }
    const badAdvent = clone(realAdvent)
    badAdvent["0200015001"] = badAdvent["200015001"]
    importFails(new Map([[adventAssetPath, badAdvent]]), RangeError)
    const badScore = clone(realScore)
    const unrelatedScoreKey = Object.keys(badScore).find(key => key !== "1001")
    badScore[unrelatedScoreKey].eventId = "1"
    importFails(new Map([[scoreAssetPath, badScore]]), TypeError)
    let scoreGetterReads = 0
    const accessorScore = clone(realScore)
    Object.defineProperty(accessorScore["1001"], "harmless", {
        enumerable: true, get() { scoreGetterReads++; return "ignored" },
    })
    importFails(new Map([[scoreAssetPath, accessorScore]]), TypeError)
    assert.equal(scoreGetterReads, 0)
    assert.deepEqual(rawRows(3), [])
    assert.equal(typeof freshCollector(new Map([[scoreAssetPath, Object.freeze(clone(realScore))]]))
        .recordDailyMissionBattleFacts, "function")

    let getterReads = 0
    const accessorDaily = clone(realDaily)
    Object.defineProperty(accessorDaily, "800115", { enumerable: true, get() { getterReads++; return realDaily["800115"] } })
    importFails(new Map([[dailyAssetPath, accessorDaily]]), TypeError)
    for (const location of ["wrapper", "pattern", "range", "selector", "time"]) {
        const bad = clone(realDaily)
        const target = location === "wrapper" ? bad["800115"] : bad["800115"][0]
        const key = { wrapper: "0", pattern: "2", range: "7", selector: "8", time: "25" }[location]
        const value = target[key]
        Object.defineProperty(target, key, { enumerable: true, get() { getterReads++; return value } })
        importFails(new Map([[dailyAssetPath, bad]]), TypeError)
    }
    assert.equal(getterReads, 0)

    const unauthorizedSelectorTarget = clone(realDaily)
    unauthorizedSelectorTarget["10001"] = clone(realDaily["800115"])
    importFails(new Map([[dailyAssetPath, unauthorizedSelectorTarget]]), RangeError)
    assert.deepEqual(rawRows(3), [])
    const unauthorizedGeneralTarget = clone(realDaily)
    unauthorizedGeneralTarget["10001"] = clone(realDaily["800392"])
    importFails(new Map([[dailyAssetPath, unauthorizedGeneralTarget]]), RangeError)
    assert.deepEqual(rawRows(3), [])

    const sameIdentity = clone(realDaily)
    assert.equal(typeof freshCollector(new Map([[dailyAssetPath, sameIdentity]])).recordDailyMissionBattleFacts, "function")
    sameIdentity["800115"][0][2] = 23
    importFails(new Map([[dailyAssetPath, sameIdentity]]), TypeError)
    const differentIdentity = clone(realDaily)
    assert.equal(typeof freshCollector(new Map([[dailyAssetPath, differentIdentity]])).recordDailyMissionBattleFacts, "function")

    let incrementCalls = 0
    let getDbCalls = 0
    const fakeDomain = { incrementPlayerCategoryMissionSync() { incrementCalls++ } }
    const fakeDb = { getDb() { getDbCalls++; return { transaction() { throw new Error("unexpected transaction") } } } }
    const isolated = freshCollector(new Map([[domainPath, fakeDomain], [categoryDomainPath, fakeDomain], [dbPath, fakeDb]]))
    assert.deepEqual(isolated.recordDailyMissionBattleFacts({ ...valid, questAccomplished: false }, new Date("2024-08-14T03:00:00Z")), [])
    assert.deepEqual(isolated.recordDailyMissionBattleFacts({ ...valid, questCategory: 1, questId: 999 }, new Date("2024-08-14T03:00:00Z")), [])
    assert.equal(incrementCalls, 0)
    assert.equal(getDbCalls, 0)
    assert.deepEqual(rawRows(3), [])
    expectCtor(() => isolated.recordDailyMissionBattleFacts({ ...valid, playerId: 0 }, new Date("2024-08-14T03:00:00Z")), RangeError)
    assert.equal(incrementCalls, 0)
    assert.equal(getDbCalls, 0)
    assert.deepEqual(rawRows(3), [])
    assert.deepEqual(freshCollector().recordDailyMissionBattleFacts(context(1, 2, 1014001),
        new Date("2024-08-14T03:00:00Z")), [800124, 800125, 800126])
} catch (error) {
    capturedError = error
} finally {
    if (database?.open) database.close()
    if (cacheSnapshot) restoreCache(cacheSnapshot)
    if (previousDatabaseDirectory === undefined) delete process.env.WF_DATABASE_DIR
    else process.env.WF_DATABASE_DIR = previousDatabaseDirectory
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
}

assert.equal(fs.existsSync(temporaryRoot), false)
assert.equal(fs.existsSync(`${temporaryRoot}-wal`), false)
assert.equal(fs.existsSync(`${temporaryRoot}-shm`), false)
assert.equal(fs.existsSync(`${temporaryRoot}.version`), false)
assert.equal(fs.existsSync(worktreeDatabase), false)
if (capturedError !== undefined) throw capturedError

console.log("daily mission battle facts tests passed")
