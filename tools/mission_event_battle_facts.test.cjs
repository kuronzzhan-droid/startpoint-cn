require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const collectorRequest = "../src/lib/mission/event-battle-facts"
const collectorPath = path.resolve(__dirname, "../src/lib/mission/event-battle-facts.ts")
const masterDataPath = path.resolve(__dirname, "../src/lib/mission/master-data.ts")
const domainPath = path.resolve(__dirname, "../src/data/domains/mission.ts")
const categoryDomainPath = path.resolve(__dirname, "../src/data/domains/category_mission.ts")
const dbPath = path.resolve(__dirname, "../src/data/db.ts")
const eventAssetPath = require.resolve("../assets/mission_event.json")
const rulesAssetPath = require.resolve("../assets/mission_event_battle_rules.json")
const bossAssetPath = require.resolve("../assets/boss_battle_quest.json")
const adventAssetPath = require.resolve("../assets/advent_event_quest.json")
const worldAssetPath = require.resolve("../assets/world_story_event_boss_battle_quest.json")
const fixtureGraphRoots = [collectorPath, masterDataPath, eventAssetPath, rulesAssetPath,
    bossAssetPath, adventAssetPath, worldAssetPath]
const missionDirectory = path.resolve(__dirname, "../src/lib/mission") + path.sep
const assetsDirectory = path.resolve(__dirname, "../assets") + path.sep
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wave2a-13-event-"))
const previousDatabaseDirectory = process.env.WF_DATABASE_DIR
const worktreeRoot = path.resolve(__dirname, "..")
let database
let closedArtifacts = []
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

function clone(value) { return structuredClone(value) }

function expectCtor(callback, ErrorConstructor) {
    assert.throws(callback, error => error?.constructor === ErrorConstructor)
}

function expectAssetFailure(entries, ErrorConstructor = TypeError) {
    let getDbCalls = 0
    let writerCalls = 0
    const fakeDomain = { incrementPlayerCategoryMissionSync() { writerCalls++ } }
    const fakeDb = { getDb() { getDbCalls++; return { transaction() { throw new Error("unexpected") } } } }
    expectCtor(() => freshCollector(new Map([...entries, [domainPath, fakeDomain],
        [categoryDomainPath, fakeDomain], [dbPath, fakeDb]])), ErrorConstructor)
    assert.equal(getDbCalls, 0)
    assert.equal(writerCalls, 0)
    assert.deepEqual(rawRows(3), [])
}

function rawRows(playerId) {
    return database.prepare(`SELECT category, id, progress, player_id FROM players_category_missions
        WHERE player_id = ? ORDER BY category, id`).all(playerId)
}

function insertPlayer(playerId) {
    database.prepare(`INSERT INTO accounts (
        id, app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status
    ) VALUES (?, 'wf_cn', '2025-01-01', '', 'wave2a-13', ?, '2025-01-01', '2025-01-01', 'normal')`).run(playerId, `event-${playerId}`)
    database.prepare(`INSERT INTO players (
        id, stamina, stamina_heal_time, boost_point, boss_boost_point, transition_state, role, name,
        last_login_time, comment, vmoney, free_vmoney, rank_point, star_crumb, bond_token, exp_pool,
        exp_pooled_time, leader_character_id, party_slot, degree_id, birth, free_mana, paid_mana,
        enable_auto_3x, account_id
    ) VALUES (?, 0, 0, 0, 0, 0, 0, 'event-red', '2025-01-01', '', 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, ?)`)
        .run(playerId, playerId)
}

function context(playerId, questId, isMultiHost) {
    return { playerId, questCategory: 7, questId, questAccomplished: true, isMulti: true, isMultiHost }
}

function categoryRows(playerId) {
    return database.prepare(`SELECT id, progress FROM players_category_missions
        WHERE player_id = ? AND category = 3 ORDER BY id`).all(playerId)
}

const COVERAGE = { totalEventMissions: 2512, exactMultiRules: 805, roles: { any: 792, host: 12, guest: 1 } }
function expectCoverage(read) { assert.deepEqual(read(), COVERAGE) }
function one(...rules) { return { schemaVersion: 1, rules } }
function expectMessage(callback, ErrorConstructor, pattern) {
    assert.throws(callback, error => error.constructor === ErrorConstructor && pattern.test(error.message))
}

let accessorReads = 0
function trapPath(root, route) {
    const container = route.slice(0, -1).reduce((node, key) => node[key], root)
    const key = route[route.length - 1]
    const value = container[key]
    Object.defineProperty(container, key, { enumerable: true,
        get() { accessorReads++; return value }, set() { accessorReads++ } })
    return root
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
    insertPlayer(4)

    const {
        recordEventMissionBattleFacts,
        loadExactEventBattleRules,
        getExactEventBattleRuleCoverage,
    } = freshCollector()
    const host = context(1, 3002, true)
    expectCoverage(getExactEventBattleRuleCoverage)
    const pollutedCoverage = getExactEventBattleRuleCoverage()
    pollutedCoverage.roles.any = -1
    expectCoverage(getExactEventBattleRuleCoverage)
    assert.deepEqual(recordEventMissionBattleFacts(context(1, 6002, undefined), new Date("2020-08-14T03:00:00Z")), [1625, 1626])
    assert.deepEqual(recordEventMissionBattleFacts(host, new Date("2020-04-01T03:00:00Z")), [1412, 1413])
    assert.deepEqual(recordEventMissionBattleFacts(context(1, 1, undefined), new Date("2019-12-04T03:00:00Z")), [1224, 1302])
    assert.deepEqual(recordEventMissionBattleFacts(context(1, 14001, false), new Date("2021-07-01T03:00:00Z")), [800000])
    assert.deepEqual(recordEventMissionBattleFacts(context(1, 3002, false), new Date("2020-04-01T03:00:00Z")), [])
    assert.deepEqual(recordEventMissionBattleFacts(context(1, 3002, undefined), new Date("2020-04-01T03:00:00Z")), [])
    assert.deepEqual(recordEventMissionBattleFacts(context(1, 14001, true), new Date("2021-07-01T03:00:00Z")), [])
    assert.deepEqual(recordEventMissionBattleFacts(context(1, 14001, undefined), new Date("2021-07-01T03:00:00Z")), [])
    assert.deepEqual(categoryRows(1).filter(row => row.id === 1412 || row.id === 1413), [
        { id: 1412, progress: 1 }, { id: 1413, progress: 1 },
    ])

    const finite = context(1, 6002, undefined)
    for (const candidate of [{ ...finite, questAccomplished: false }, { ...finite, isMulti: false },
        { ...finite, questCategory: 8 }, { ...finite, questId: 6001 }]) {
        assert.deepEqual(recordEventMissionBattleFacts(candidate, new Date("2020-08-14T03:00:00Z")), [])
    }
    const eventStart = "2020-08-13T04:00:00.000Z"
    const eventEnd = "2020-08-21T03:59:59.000Z"
    assert.deepEqual(recordEventMissionBattleFacts(finite, new Date(Date.parse(eventStart) - 1)), [])
    assert.deepEqual(recordEventMissionBattleFacts(finite, new Date(eventStart)), [1625, 1626])
    assert.deepEqual(recordEventMissionBattleFacts(finite, new Date(eventEnd)), [1625, 1626])
    assert.deepEqual(recordEventMissionBattleFacts(finite, new Date(Date.parse(eventEnd) + 1)), [])
    const outputA = recordEventMissionBattleFacts(finite, new Date("2020-08-14T03:00:00Z"))
    outputA.push(999999)
    assert.deepEqual(recordEventMissionBattleFacts(finite, new Date("2020-08-14T03:00:00Z")), [1625, 1626])

    for (const [field, invalid, ErrorConstructor] of [
        ["playerId", "1", TypeError], ["playerId", 0, RangeError],
        ["questId", Infinity, TypeError], ["questId", 1.5, RangeError],
        ["questCategory", "7", TypeError], ["questCategory", -1, RangeError],
        ["questAccomplished", 0, TypeError], ["isMulti", null, TypeError],
        ["isMultiHost", 1, TypeError], ["isMultiHost", "host", TypeError],
    ]) expectCtor(() => recordEventMissionBattleFacts({ ...finite, [field]: invalid }, new Date("2020-08-14T03:00:00Z")), ErrorConstructor)
    for (const time of [0, "2020-08-14", Object.create(Date.prototype), new Date(NaN)]) {
        expectCtor(() => recordEventMissionBattleFacts(finite, time), TypeError)
    }
    let dateGetterReads = 0
    const guardedDate = new Date("2020-08-14T03:00:00Z")
    Object.defineProperty(guardedDate, "getTime", { get() { dateGetterReads++; return Date.prototype.getTime } })
    assert.deepEqual(recordEventMissionBattleFacts(finite, guardedDate), [1625, 1626])
    assert.equal(dateGetterReads, 0)
    assert.deepEqual(recordEventMissionBattleFacts(host, new Date("2020-04-01T03:00:00Z")), [1412, 1413])
    assert.deepEqual(categoryRows(1).filter(row => row.id === 1412 || row.id === 1413), [
        { id: 1412, progress: 2 }, { id: 1413, progress: 2 },
    ])

    database.prepare(`INSERT INTO players_category_missions (category, id, progress, player_id)
        VALUES (3, 1413, ?, 2)`).run(Number.MAX_VALUE)
    expectCtor(() => recordEventMissionBattleFacts(context(2, 3002, true), new Date("2020-04-01T03:00:00Z")), RangeError)
    assert.deepEqual(categoryRows(2), [{ id: 1413, progress: Number.MAX_VALUE }])

    expectCtor(() => recordEventMissionBattleFacts({ ...host, questAccomplished: 1 }, new Date("2020-04-01T03:00:00Z")), TypeError)
    expectCtor(() => recordEventMissionBattleFacts(host, new Date("invalid")), TypeError)
    assert.throws(() => recordEventMissionBattleFacts({ ...host, playerId: 99 }, new Date("2020-04-01T03:00:00Z")), /FOREIGN KEY/)
    assert.throws(database.transaction(() => {
        recordEventMissionBattleFacts(context(3, 3002, true), new Date("2020-04-01T03:00:00Z"))
        throw new Error("event caller rollback")
    }), /event caller rollback/)
    assert.deepEqual(categoryRows(3), [])

    const ruleAsset = require(rulesAssetPath)
    const firstRule = ruleAsset.rules[0]
    assert.equal(ruleAsset.rules.length, 805)
    assert.deepEqual(Object.keys(ruleAsset), ["schemaVersion", "rules"])
    assert.deepEqual(Object.keys(firstRule), ["missionId", "patternType", "role", "categories",
        "selector", "questIds", "rank", "compatibility"])
    const finiteRule = ruleAsset.rules.find(rule => rule.missionId === 1625)
    const subsetA = loadExactEventBattleRules({ schemaVersion: 1, rules: [finiteRule] })
    assert.deepEqual(subsetA.map(rule => rule.missionId), [finiteRule.missionId])
    try { subsetA.push({ missionId: 999999 }) } catch {}
    try { subsetA[0].missionId = 999999 } catch {}
    subsetA[0].categories.clear(); subsetA[0].categories.add(999)
    subsetA[0].questIds.clear(); subsetA[0].questIds.add(999999)
    assert.deepEqual(loadExactEventBattleRules({ schemaVersion: 1, rules: [finiteRule] })
        .map(rule => rule.missionId), [finiteRule.missionId])
    expectCoverage(getExactEventBattleRuleCoverage)
    assert.deepEqual(recordEventMissionBattleFacts(context(1, 6002, undefined), new Date("2020-08-14T03:00:00Z")), [1625, 1626])
    const authoritativeIds = ruleAsset.rules.map(rule => rule.missionId)
    assert.equal(authoritativeIds.length, 805)
    assert.equal(crypto.createHash("sha256").update(authoritativeIds.join(",")).digest("hex"),
        "48d50f7930c5992699eb5aa687299e2f6c7800725acf3136a39d806c840213b1")
    assert.deepEqual([0,1,2,10,50,100,200,300,400,500,600,700,803,804]
        .map(index => authoritativeIds[index]),
    [1224,1302,1412,1420,1569,1675,1873,2192,2572,11630,12625,30200,900803,900804])
    assert.deepEqual(ruleAsset.rules.find(rule => rule.missionId === 1412), {
        missionId: 1412, patternType: 17, role: "host", categories: [7],
        selector: { range: "AdventEvent", keys: [
            { kind: "Within", values: [3] }, { kind: "Within", values: [2] },
        ] }, questIds: [3002], rank: null, compatibility: null,
    })
    assert.deepEqual(loadExactEventBattleRules(ruleAsset).map(rule => rule.missionId), authoritativeIds)
    assert.deepEqual(loadExactEventBattleRules({ schemaVersion: 1,
        rules: [ruleAsset.rules[1], ruleAsset.rules[0]] }).map(rule => rule.missionId), [1224, 1302])

    for (const [badAsset, ErrorConstructor] of [[null, TypeError], [[], TypeError],
        [{ schemaVersion: 1, rules: [], extra: true }, TypeError], [{ schemaVersion: 2, rules: [firstRule] }, TypeError],
        [{ schemaVersion: 1, rules: [] }, RangeError], [{ schemaVersion: 1, rules: new Array(1) }, TypeError],
        [{ schemaVersion: 1, rules: [firstRule, clone(firstRule)] }, RangeError]]) {
        expectCtor(() => loadExactEventBattleRules(badAsset), ErrorConstructor)
    }
    const bossRule = ruleAsset.rules.find(rule => rule.missionId === 1416)
    const adventRule = ruleAsset.rules.find(rule => rule.missionId === 1625)
    const adventMulti = ruleAsset.rules.find(rule => rule.missionId === 1627)
    assert.equal(adventMulti.questIds.length, 3)
    for (const [badRule, ErrorConstructor, pattern] of [
        [{ ...firstRule, extra: true }, TypeError, /has unexpected fields/],
        [{ ...firstRule, missionId: 0 }, RangeError, /missionId must be positive/],
        [{ ...firstRule, patternType: 17 }, RangeError, /event rule master mismatch/],
        [{ ...firstRule, role: "host" }, RangeError, /event rule role mismatch/],
        [{ ...firstRule, rank: 1 }, TypeError, /compatibility is invalid/],
        [{ ...firstRule, compatibility: "legacy" }, TypeError, /compatibility is invalid/],
        [{ ...firstRule, selector: { range: "All", keys: [{}] } }, TypeError, /selector key is invalid/],
        [{ ...bossRule, categories: [2, 2] }, RangeError, /categories must be sorted/],
        [{ ...bossRule, categories: [3, 2] }, RangeError, /categories must be sorted/],
        [{ ...bossRule, categories: [3] }, RangeError, /event rule categories mismatch/],
        [{ ...bossRule, selector: { ...bossRule.selector,
            keys: [{ kind: "Within", values: [2] }, ...bossRule.selector.keys.slice(1)] } },
        RangeError, /event selector keys mismatch/],
        [{ ...bossRule, selector: { range: "All", keys: [] }, categories: "all", questIds: "all" },
            RangeError, /event All selector mismatch/],
        [{ ...bossRule, questIds: bossRule.questIds.slice(0, -1) }, RangeError, /event rule questIds mismatch/],
        [{ ...bossRule, questIds: [...bossRule.questIds, 1014999] }, RangeError, /event rule questIds mismatch/],
        [{ ...adventMulti, questIds: adventMulti.questIds.slice(0, -1) }, RangeError, /event rule questIds mismatch/],
    ]) expectMessage(() => loadExactEventBattleRules(one(badRule)), ErrorConstructor, pattern)
    expectCtor(() => loadExactEventBattleRules({ schemaVersion: 1,
        rules: [firstRule, { ...bossRule, role: "guest" }] }), RangeError)

    for (const route of [["schemaVersion"], ["rules", "0"], ["rules", "0", "role"],
        ["rules", "0", "selector"], ["rules", "0", "selector", "range"],
        ["rules", "0", "selector", "keys", "0"], ["rules", "0", "selector", "keys", "0", "kind"],
        ["rules", "0", "selector", "keys", "0", "values", "0"],
        ["rules", "0", "categories", "0"], ["rules", "0", "questIds", "0"]]) {
        expectCtor(() => loadExactEventBattleRules(trapPath(one(clone(bossRule)), route)), TypeError)
    }
    assert.equal(accessorReads, 0)

    const realEvent = require(eventAssetPath)
    const missingRules = clone(ruleAsset); missingRules.rules.pop()
    expectMessage(() => freshCollector(new Map([[rulesAssetPath, missingRules]])), RangeError, /authority/)
    const extraRules = clone(ruleAsset)
    extraRules.rules.push({ ...clone(firstRule), missionId: 999999 })
    expectMessage(() => freshCollector(new Map([[rulesAssetPath, extraRules]])), RangeError, /master mismatch/)
    const sameIdentity = clone(ruleAsset)
    assert.equal(freshCollector(new Map([[rulesAssetPath, sameIdentity]])).getExactEventBattleRuleCoverage().exactMultiRules, 805)
    sameIdentity.rules[0].role = "guest"
    expectMessage(() => freshCollector(new Map([[rulesAssetPath, sameIdentity]])), RangeError, /role mismatch/)
    const otherId = Object.keys(realEvent).find(id => !authoritativeIds.includes(Number(id)))
    const masterFixtures = [[[], TypeError], [new (class EventMaster {})(), TypeError],
        [Object.assign(Object.create({}), realEvent), TypeError],
        [Object.assign(clone(realEvent), { [`0${otherId}`]: realEvent[otherId] }), RangeError]]
    for (const [master, ErrorConstructor] of masterFixtures) expectAssetFailure([[eventAssetPath, master]], ErrorConstructor)
    for (const [mutate, ErrorConstructor] of [[master => { master[String(firstRule.missionId)] = [] }, TypeError],
        [master => { master[String(firstRule.missionId)] = [master[String(firstRule.missionId)][0], []] }, TypeError],
        [master => { master[String(firstRule.missionId)][0] = master[String(firstRule.missionId)][0].slice(0, 34) }, TypeError],
        [master => { master[String(firstRule.missionId)][0].push("extra") }, TypeError],
        [master => { const rows = new Array(1); master[String(firstRule.missionId)] = rows }, TypeError],
        [master => { master[String(firstRule.missionId)].extra = [] }, TypeError], [master => { master[otherId][0][2] = null }, TypeError],
        [master => { delete master[otherId][0][5] }, TypeError],
        [master => { delete master[otherId] }, RangeError],
        [master => { const row = master[otherId]; delete master[otherId]; master[`0${otherId}`] = row }, RangeError],
        [master => { master["1625"][0][26] = "2024-02-30 12:00:00" }, RangeError],
        [master => { master["1625"][0][25] = "2020-08-22 00:00:00" }, RangeError]]) {
        const invalidMaster = clone(realEvent); mutate(invalidMaster)
        expectAssetFailure([[eventAssetPath, invalidMaster]], ErrorConstructor)
    }
    // Rule 1625 expects selector key [6] from master row[8]="6". Every value below is normalised by
    // Number() to that same 6, so only the canonical-decimal regex in masterValues() can reject them.
    for (const noncanonical of ["06", " 6", "6.0", "+6", "6e0"]) {
        const bad = clone(realEvent); bad["1625"][0][8] = noncanonical
        expectAssetFailure([[eventAssetPath, bad]], RangeError)
    }
    const targetKey = String(firstRule.missionId)
    for (const route of [[targetKey], [targetKey, "0"], [targetKey, "0", "2"], [targetKey, "0", "25"]]) {
        expectAssetFailure([[eventAssetPath, trapPath(clone(realEvent), route)]])
    }
    assert.equal(accessorReads, 0)

    for (const [assetPath, expectedCount] of [[bossAssetPath, 232], [adventAssetPath, 459], [worldAssetPath, 96]]) {
        const projection = clone(require(assetPath))
        assert.equal(Object.keys(projection).length, expectedCount)
        const key = Object.keys(projection)[0]
        const short = clone(projection); delete short[Object.keys(short).pop()]
        expectAssetFailure([[assetPath, short]], RangeError)
        projection[`0${key}`] = projection[key]
        expectAssetFailure([[assetPath, projection]], RangeError)
        for (const invalidProjection of [[], Object.assign(Object.create({}), require(assetPath))]) {
            expectAssetFailure([[assetPath, invalidProjection]])
        }
        expectAssetFailure([[assetPath, trapPath(clone(require(assetPath)), [key])]])
        assert.equal(accessorReads, 0)
    }

    let increments = 0
    let getDbCalls = 0
    const fakeDomain = { incrementPlayerCategoryMissionSync() { increments++ } }
    const fakeDb = { getDb() { getDbCalls++; return { transaction() { throw new Error("unexpected") } } } }
    const isolated = freshCollector(new Map([[domainPath, fakeDomain], [categoryDomainPath, fakeDomain], [dbPath, fakeDb]]))
    assert.deepEqual(isolated.recordEventMissionBattleFacts({ ...finite, questAccomplished: false }, new Date("2020-08-14T03:00:00Z")), [])
    assert.deepEqual(isolated.recordEventMissionBattleFacts({ ...finite, isMulti: false }, new Date("2020-08-14T03:00:00Z")), [])
    assert.equal(increments, 0)
    assert.equal(getDbCalls, 0)
    assert.deepEqual(rawRows(3), [])
    for (const candidate of [{ ...finite, questAccomplished: false }, { ...finite, isMulti: false },
        { ...finite, questId: 6001 }, { ...finite, questId: 6002 }]) {
        for (const [contextValue, time, ErrorConstructor] of [
            [{ ...candidate, playerId: 0 }, new Date("2020-08-14T03:00:00Z"), RangeError],
            [{ ...candidate, questAccomplished: 1 }, new Date("2020-08-14T03:00:00Z"), TypeError],
            [candidate, new Date("invalid"), TypeError],
            [{ ...candidate, isMultiHost: null }, new Date("2020-08-14T03:00:00Z"), TypeError],
        ]) expectCtor(() => isolated.recordEventMissionBattleFacts(contextValue, time), ErrorConstructor)
    }
    const inactiveTime = new Date("2019-01-01T03:00:00Z")
    for (const [contextValue, ErrorConstructor] of [[{ ...finite, playerId: 0 }, RangeError],
        [{ ...finite, questAccomplished: 1 }, TypeError], [{ ...finite, isMultiHost: null }, TypeError]]) {
        expectCtor(() => isolated.recordEventMissionBattleFacts(contextValue, inactiveTime), ErrorConstructor)
    }
    assert.deepEqual(isolated.recordEventMissionBattleFacts(finite, inactiveTime), [])
    assert.equal(increments, 0)
    assert.equal(getDbCalls, 0)
    assert.deepEqual(rawRows(3), [])
    expectCtor(() => isolated.recordEventMissionBattleFacts({ ...finite, questId: 0 },
        new Date("2020-08-14T03:00:00Z")), RangeError)
    assert.equal(increments, 0)
    assert.equal(getDbCalls, 0)
    assert.deepEqual(rawRows(3), [])
    const restored = freshCollector()
    expectCoverage(restored.getExactEventBattleRuleCoverage)
    const bossRule88 = ruleAsset.rules.find(rule => rule.missionId === 1788)
    const fabricated = { ...clone(bossRule88), missionId: 2491 }
    assert.deepEqual(loadExactEventBattleRules({ schemaVersion: 1, rules: [fabricated] })
        .map(rule => rule.missionId), [2491])
    const swapped = clone(ruleAsset)
    swapped.rules[swapped.rules.findIndex(rule => rule.missionId === 1788)] = clone(fabricated)
    assert.equal(swapped.rules.length, 805)
    assert.deepEqual([0,1,2,10,50,100,200,300,400,500,600,700,803,804].map(index => swapped.rules[index].missionId),
        [1224,1302,1412,1420,1569,1675,1873,2192,2572,11630,12625,30200,900803,900804])
    expectAssetFailure([[rulesAssetPath, swapped]], RangeError)
    const subsetB = loadExactEventBattleRules({ schemaVersion: 1, rules: [bossRule88] })
    assert.deepEqual(subsetB.map(rule => rule.missionId), [1788])
    subsetB[0].categories.clear(); subsetB[0].categories.add(999); subsetB[0].questIds.clear(); subsetB[0].questIds.add(999999)
    for (const key of subsetB[0].selector.keys) if (key.values) key.values.push(1)
    subsetB[0].missionId = 999999; subsetB[0].role = "guest"; subsetB[0].patternType = 18
    assert.deepEqual(loadExactEventBattleRules({ schemaVersion: 1, rules: [bossRule88] })
        .map(rule => rule.missionId), [1788])
    expectCoverage(getExactEventBattleRuleCoverage)
    assert.deepEqual(recordEventMissionBattleFacts(context(1, 6002, undefined), new Date("2020-08-14T03:00:00Z")), [1625, 1626])
    const worldQuest = Number(Object.keys(require(worldAssetPath))[0])
    const worldRule = { missionId: 1612, patternType: 16, role: "any", categories: [7],
        selector: { range: "WorldStoryEventBossBattle", keys: [{ kind: "Within", values: [100300] }, { kind: "All" }] },
        questIds: [worldQuest], rank: null, compatibility: null }
    const disguised = { ...clone(adventRule),
        selector: { range: "WorldStoryEventBossBattle", keys: clone(adventRule.selector.keys) } }
    for (const [rule, pattern] of [[worldRule, /world story .*derivation/],
        [{ ...worldRule, questIds: [999999999] }, /world story .*not tracked/],
        [disguised, /event selector range mismatch/]]) {
        assert.throws(() => loadExactEventBattleRules({ schemaVersion: 1, rules: [rule] }),
            error => error.constructor === RangeError && pattern.test(error.message))
    }
    assert.deepEqual(loadExactEventBattleRules({ schemaVersion: 1, rules: [clone(adventRule)] })
        .map(rule => rule.missionId), [1625])
    const reversedAsset = { schemaVersion: 1, rules: clone(ruleAsset.rules).reverse() }
    assert.deepEqual(reversedAsset.rules.map(rule => rule.missionId).reverse(), authoritativeIds)
    const reversed = freshCollector(new Map([[rulesAssetPath, reversedAsset]]))
    expectCoverage(reversed.getExactEventBattleRuleCoverage)
    assert.deepEqual(reversed.recordEventMissionBattleFacts(context(4, 3002, true),
        new Date("2020-04-01T03:00:00Z")), [1412, 1413])
    assert.deepEqual(rawRows(4), [{ category: 3, id: 1412, progress: 1, player_id: 4 },
        { category: 3, id: 1413, progress: 1, player_id: 4 }])
} catch (error) {
    capturedError = error
} finally {
    if (database?.open) database.close()
    if (cacheSnapshot) restoreCache(cacheSnapshot)
    if (previousDatabaseDirectory === undefined) delete process.env.WF_DATABASE_DIR
    else process.env.WF_DATABASE_DIR = previousDatabaseDirectory
    if (fs.existsSync(temporaryRoot)) closedArtifacts = fs.readdirSync(temporaryRoot)
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
}

assert.equal(fs.existsSync(temporaryRoot), false)
assert.deepEqual(closedArtifacts.sort(), ["wdfp_data.db", "wdfp_data.db.version"])
assert.deepEqual(fs.readdirSync(worktreeRoot).filter(name => name.startsWith(".database")), [])
if (capturedError !== undefined) throw capturedError

console.log("event mission battle facts tests passed")
