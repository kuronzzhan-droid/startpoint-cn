require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const collectorRequest = "../src/lib/mission/pass-battle-facts"
const collectorPath = path.resolve(__dirname, "../src/lib/mission/pass-battle-facts.ts")
const masterDataPath = path.resolve(__dirname, "../src/lib/mission/master-data.ts")
const domainPath = path.resolve(__dirname, "../src/data/domains/mission.ts")
const categoryDomainPath = path.resolve(__dirname, "../src/data/domains/category_mission.ts")
const dbPath = path.resolve(__dirname, "../src/data/db.ts")
const passAssetPath = require.resolve("../assets/mission_pass_event.json")
const touchedCachePaths = [collectorPath, masterDataPath, domainPath, categoryDomainPath, dbPath, passAssetPath]
const fixtureGraphRoots = [collectorPath, masterDataPath, passAssetPath]
const missionDirectory = path.resolve(__dirname, "../src/lib/mission") + path.sep
const assetsDirectory = path.resolve(__dirname, "../assets") + path.sep
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wave2a-13-pass-"))
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

function clone(value) { return structuredClone(value) }

// Locks the exact constructor, and (where several guards throw the same class) a short message
// fragment, so a case cannot silently pass by being stopped at an earlier guard than intended.
function expectCtor(callback, ErrorConstructor, label, pattern) {
    assert.throws(callback, error => error?.constructor === ErrorConstructor
        && (pattern === undefined || pattern.test(String(error?.message))), label)
}

// Anchored so isMulti's case cannot be satisfied by isMultiHost's guard (and vice versa).
function fieldPattern(field) { return new RegExp(`^${field} `) }
// The intrinsic Date check rethrows V8's own "this is not a Date object." untouched; only the NaN
// path reaches our own wording. Both are accepted, nothing else is.
const TIME_PATTERN = /not a Date object|evaluation time/

function rawRows(playerId) {
    return database.prepare(`SELECT category, id, progress, player_id FROM players_category_missions
        WHERE player_id = ? ORDER BY category, id`).all(playerId)
}

function insertPlayer(playerId) {
    database.prepare(`INSERT INTO accounts (
        id, app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status
    ) VALUES (?, 'wf_cn', '2025-01-01', '', 'wave2a-13', ?, '2025-01-01', '2025-01-01', 'normal')`).run(playerId, `pass-${playerId}`)
    database.prepare(`INSERT INTO players (
        id, stamina, stamina_heal_time, boost_point, boss_boost_point, transition_state, role, name,
        last_login_time, comment, vmoney, free_vmoney, rank_point, star_crumb, bond_token, exp_pool,
        exp_pooled_time, leader_character_id, party_slot, degree_id, birth, free_mana, paid_mana,
        enable_auto_3x, account_id
    ) VALUES (?, 0, 0, 0, 0, 0, 0, 'pass-red', '2025-01-01', '', 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, ?)`)
        .run(playerId, playerId)
}

function context(playerId, questCategory, questId, isMulti) {
    return { playerId, questCategory, questId, questAccomplished: true, isMulti }
}

function categoryRows(playerId) {
    return database.prepare(`SELECT id, progress FROM players_category_missions
        WHERE player_id = ? AND category = 8 ORDER BY id`).all(playerId)
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

    const { recordPassMissionBattleFacts } = freshCollector()
    const advent = context(1, 7, 200015001, true)
    assert.throws(
        () => recordPassMissionBattleFacts(advent, new Date("2024-08-14T03:00:00Z")),
        /no such table: players_category_missions/,
    )

    const { categoryMissionMigration } = require("../src/data/migrations/wdfp/category-mission")
    categoryMissionMigration.apply(database)
    assert.deepEqual(recordPassMissionBattleFacts(advent, new Date("2024-08-14T03:00:00Z")), [15])
    assert.deepEqual(recordPassMissionBattleFacts(context(1, 2, 1025001, true), new Date("2024-08-14T03:00:00Z")), [16])
    // Mission 16 is row[9]="1" / row[10]="25,26,27,28,29,30" / row[11]="(None)". Each segment below is
    // the sole varying term; the others stay hit (or wildcard), so a miss can only come from that segment.
    assert.deepEqual(recordPassMissionBattleFacts(context(1, 2, 1030001, true), new Date("2024-08-14T03:00:00Z")),
        [16], "boss middle segment 30 is the inclusive upper edge of row[10]")
    assert.deepEqual(recordPassMissionBattleFacts(context(1, 2, 1099001, true), new Date("2024-08-14T03:00:00Z")),
        [], "boss middle segment 99 is outside row[10] and must not match")
    assert.deepEqual(recordPassMissionBattleFacts(context(1, 2, 1031001, true), new Date("2024-08-14T03:00:00Z")),
        [], "boss middle segment 31 is just past the upper edge of row[10]")
    assert.deepEqual(recordPassMissionBattleFacts(context(1, 2, 2025001, true), new Date("2024-08-14T03:00:00Z")),
        [], "boss first segment 2 is outside row[9]=1 while the middle segment still hits")
    assert.deepEqual(recordPassMissionBattleFacts(context(1, 23, 4001, false), new Date("2024-06-03T03:00:00Z")), [2])
    assert.deepEqual(recordPassMissionBattleFacts(context(1, 23, 4005, false), new Date("2024-06-03T03:00:00Z")),
        [], "non-boss last segment 5 is outside row[11]=1,2,3,4 while the first segment still hits")
    assert.deepEqual(recordPassMissionBattleFacts(context(1, 23, 4001, true), new Date("2024-06-03T03:00:00Z")), [])
    assert.deepEqual(recordPassMissionBattleFacts(context(1, 24, 700004001, false), new Date("2024-07-10T03:00:00Z")), [9])
    assert.deepEqual(recordPassMissionBattleFacts(context(1, 24, 700005001, false), new Date("2024-07-10T03:00:00Z")), [])
    assert.deepEqual(recordPassMissionBattleFacts(context(1, 7, 200010001, true), new Date("2024-06-20T04:00:00Z")), [4, 5])
    for (const [label, candidate] of [["failed", { ...advent, questAccomplished: false }],
        ["single", { ...advent, isMulti: false }], ["wrong category", { ...advent, questCategory: 8 }],
        ["unmatched quest", { ...advent, questId: 200016001 }]]) {
        assert.deepEqual(recordPassMissionBattleFacts(candidate, new Date("2024-08-14T03:00:00Z")), [], label)
    }
    const passStart = "2024-06-13T04:00:00.000Z"
    const passEnd = "2024-06-27T15:59:59.000Z"
    const passFour = context(1, 7, 200010001, true)
    assert.deepEqual(recordPassMissionBattleFacts(passFour, new Date(Date.parse(passStart) - 1)), [], "start-1ms")
    assert.deepEqual(recordPassMissionBattleFacts(passFour, new Date(passStart)), [4], "start inclusive")
    assert.deepEqual(recordPassMissionBattleFacts(passFour, new Date(passEnd)), [4, 5], "end inclusive")
    assert.deepEqual(recordPassMissionBattleFacts(passFour, new Date(Date.parse(passEnd) + 1)), [], "end+1ms")
    const freshOutput = recordPassMissionBattleFacts(advent, new Date("2024-08-14T03:00:00Z"))
    freshOutput.push(999999)
    assert.deepEqual(recordPassMissionBattleFacts(advent, new Date("2024-08-14T03:00:00Z")), [15])
    assert.deepEqual(categoryRows(1).filter(row => row.id === 4 || row.id === 5), [
        { id: 4, progress: 3 }, { id: 5, progress: 2 },
    ])

    for (const [field, invalid, ErrorConstructor] of [
        ["playerId", "1", TypeError], ["playerId", 0, RangeError],
        ["questId", NaN, TypeError], ["questId", Number.MAX_SAFE_INTEGER + 1, RangeError],
        ["questCategory", "7", TypeError], ["questCategory", -1, RangeError],
        ["questAccomplished", 1, TypeError], ["isMulti", null, TypeError],
        ["isMultiHost", 0, TypeError], ["isMultiHost", "host", TypeError],
        ["isMultiHost", null, TypeError], ["isMultiHost", 1, TypeError],
    ]) expectCtor(() => recordPassMissionBattleFacts({ ...advent, [field]: invalid }, new Date("2024-08-14T03:00:00Z")),
        ErrorConstructor, `context ${field}=${String(invalid)}`, fieldPattern(field))
    for (const host of [true, false]) {
        assert.deepEqual(recordPassMissionBattleFacts({ ...advent, isMultiHost: host },
            new Date("2024-08-14T03:00:00Z")), [15], `isMultiHost=${host} must not change matching`)
    }
    for (const [label, time] of [["number", 0], ["string", "2024-08-14"],
        ["fake Date", Object.create(Date.prototype)], ["Invalid Date", new Date(NaN)]]) {
        expectCtor(() => recordPassMissionBattleFacts(advent, time), TypeError,
            `evaluationTime ${label}`, TIME_PATTERN)
    }
    let dateGetterReads = 0
    const guardedDate = new Date("2024-08-14T03:00:00Z")
    Object.defineProperty(guardedDate, "getTime", { get() { dateGetterReads++; return Date.prototype.getTime } })
    assert.deepEqual(recordPassMissionBattleFacts(advent, guardedDate), [15])
    assert.equal(dateGetterReads, 0)
    assert.deepEqual(recordPassMissionBattleFacts(context(1, 7, 200010001, true), new Date("2024-06-20T04:00:00Z")), [4, 5])
    assert.deepEqual(categoryRows(1).filter(row => row.id === 4 || row.id === 5), [
        { id: 4, progress: 4 }, { id: 5, progress: 3 },
    ])

    database.prepare(`INSERT INTO players_category_missions (category, id, progress, player_id)
        VALUES (8, 5, ?, 2)`).run(Number.MAX_VALUE)
    assert.throws(() => recordPassMissionBattleFacts(context(2, 7, 200010001, true), new Date("2024-06-20T04:00:00Z")), RangeError)
    assert.deepEqual(categoryRows(2), [{ id: 5, progress: Number.MAX_VALUE }])

    assert.throws(() => recordPassMissionBattleFacts({ ...advent, isMulti: "yes" }, new Date("2024-08-14T03:00:00Z")), TypeError)
    assert.throws(() => recordPassMissionBattleFacts(advent, new Date("invalid")), TypeError)
    assert.throws(() => recordPassMissionBattleFacts({ ...advent, playerId: 99 }, new Date("2024-08-14T03:00:00Z")), /FOREIGN KEY/)
    assert.throws(database.transaction(() => {
        recordPassMissionBattleFacts(context(3, 7, 200010001, true), new Date("2024-06-20T04:00:00Z"))
        throw new Error("pass caller rollback")
    }), /pass caller rollback/)
    assert.deepEqual(categoryRows(3), [])

    const realPass = require(passAssetPath)
    assert.equal(Object.keys(realPass).length, 115)
    const targetIds = [2,3,4,5,6,8,9,10,11,12,14,15,16,17,18,20,21,22,23,24,26,27,28,29,
        30,32,33,34,35,36,38,39,40,41,42,44,45,46,47,48,49,51,52,53,54,55,57,58,59,60,
        61,63,64,65,66,67,69,70,71,72,73,75,76,77,78,79,81,82,83,84,85,87,88,89,90,91]
    assert.equal(targetIds.length, 76)
    assert.deepEqual(targetIds.filter(id => realPass[String(id)] === undefined), [])
    assert.equal(realPass["15"][0][6], "")
    const importFails = (asset, ErrorConstructor, label, pattern) =>
        expectCtor(() => freshCollector(new Map([[passAssetPath, asset]])), ErrorConstructor, label, pattern)
    // "02" and "01" are injected by REPLACING a key, so the table still holds 115 keys and the
    // canonical-key guard is the only thing that can reject them (the count guard cannot fire).
    for (const [label, mutate, Ctor, pattern] of [
        ["missing target 2", table => { delete table["2"] }, RangeError, /count mismatch/],
        ["leading-zero key replaces 2", table => { table["02"] = table["2"]; delete table["2"] },
            RangeError, /key must be canonical/],
        ["numeric collision 01 beside 1", table => { table["01"] = clone(table["1"]); delete table["7"] },
            RangeError, /key must be canonical/],
        ["extra target key 999999", table => { table["999999"] = clone(table["2"]) }, RangeError, /count mismatch/],
        ["target two rows", table => { table["2"] = [table["2"][0], clone(table["2"][0])] },
            TypeError, /^pass mission 2 must be dense/],
        ["target 35 columns", table => { table["2"] = [table["2"][0].slice(0, 35)] },
            TypeError, /^pass mission row 2 must be dense/],
        ["numeric patternType", table => { table["2"][0][3] = 23 }, TypeError, /patternType must be a string/],
        ["row[12] not sentinel", table => { table["2"][0][12] = "None" }, TypeError, /reserved cell/],
        ["2024-02-30 start", table => { table["2"][0][26] = "2024-02-30 12:00:00" },
            RangeError, /not a real calendar time/],
        ["2023-02-29 start", table => { table["2"][0][26] = "2023-02-29 12:00:00" },
            RangeError, /not a real calendar time/],
        ["start after end", table => { table["2"][0][26] = "2024-06-07 00:00:00" },
            RangeError, /invalid time range/],
        ["pattern16 kind (None)", table => { table["15"][0][6] = "(None)" }, TypeError, /empty sentinel/],
        ["unapproved range 99", table => { table["2"][0][8] = "99" }, RangeError, /range kind is not approved/],
    ]) { const bad = clone(realPass); mutate(bad); importFails(bad, Ctor, label, pattern) }

    const extraTarget = clone(realPass)
    extraTarget["1"] = clone(realPass["2"])
    assert.equal(Object.keys(extraTarget).length, 115)
    importFails(extraTarget, RangeError, "77th target at 115 keys", /pattern 23 target set mismatch/)
    const crossBucket = clone(realPass)
    crossBucket["2"][0][3] = "16"
    assert.equal(Object.keys(crossBucket).length, 115)
    importFails(crossBucket, RangeError, "76 targets but 71/5 split", /pattern 16 target set mismatch/)
    const extraNonTarget = clone(realPass)
    extraNonTarget["999999"] = clone(realPass["1"])
    assert.equal(Object.keys(extraNonTarget).length, 116)
    importFails(extraNonTarget, RangeError, "116 keys, targets intact", /count mismatch/)
    const missingNonTarget = clone(realPass)
    delete missingNonTarget["1"]
    assert.equal(Object.keys(missingNonTarget).length, 114)
    importFails(missingNonTarget, RangeError, "114 keys, targets intact", /count mismatch/)

    for (const [label, mutate, pattern] of [
        ["zero rows", table => { table["1"] = [] }, /^pass mission 1 must be dense/],
        ["two rows", table => { table["1"] = [table["1"][0], clone(table["1"][0])] }, /^pass mission 1 must be dense/],
        ["35 columns", table => { table["1"] = [table["1"][0].slice(0, 35)] }, /^pass mission row 1 must be dense/],
        ["37 columns", table => { table["1"] = [[...table["1"][0], "extra"]] }, /^pass mission row 1 must be dense/],
        ["sparse wrapper", table => { table["1"] = new Array(1) }, /^pass mission 1 must be dense/],
        ["row hole at 5", table => { delete table["1"][0][5] }, /^pass mission row 1 must be dense/],
        ["non-index own property", table => { table["1"].extra = [] }, /^pass mission 1 must be dense/],
    ]) { const bad = clone(realPass); mutate(bad); importFails(bad, TypeError, `non-target ${label}`, pattern) }

    class PassMaster {}
    importFails(Object.values(clone(realPass)), TypeError, "array root", /plain record/)
    importFails(Object.assign(new PassMaster(), clone(realPass)), TypeError, "custom prototype root", /plain record/)

    const withDefinitions = definitions => freshCollector(new Map([[masterDataPath,
        { getMissionMasterDefinitions: () => definitions }]]))
    assert.equal(typeof withDefinitions([{ category: 8, missionId: 2, patternType: 23 }])
        .recordPassMissionBattleFacts, "function", "consistent definition must load")
    expectCtor(() => withDefinitions([{ category: 8, missionId: 2, patternType: 16 }]), RangeError,
        "definition says 16 but raw row[3] is 23", /patternType mismatch/)
    expectCtor(() => withDefinitions([{ category: 8, missionId: 4, patternType: 23 }]), RangeError,
        "definition says 23 but raw row[3] is 16", /patternType mismatch/)
    expectCtor(() => withDefinitions([{ category: 8, missionId: 2, patternType: 23 },
        { category: 8, missionId: 2, patternType: 23 }]), RangeError, "duplicate definition", /is duplicated/)

    for (const [badCsv, pattern] of [["01", /decimal CSV/], [" 1", /decimal CSV/], ["1e2", /decimal CSV/],
        ["0", /decimal CSV/], ["-1", /decimal CSV/], [String(Number.MAX_SAFE_INTEGER + 1), /must stay safe/],
        ["1,,2", /decimal CSV/], ["1,1", /sorted and unique/], ["2,1", /sorted and unique/]]) {
        const bad = clone(realPass)
        bad["2"][0][9] = badCsv
        importFails(bad, RangeError, `selector csv ${JSON.stringify(badCsv)}`, pattern)
    }
    for (const [battleKind, Ctor, pattern] of [[undefined, TypeError, /canonical decimal/],
        [null, TypeError, /canonical decimal/], ["", RangeError, /canonical 1, 2 or 3/],
        ["01", RangeError, /canonical 1, 2 or 3/], ["4", RangeError, /canonical 1, 2 or 3/]]) {
        const bad = clone(realPass); bad["2"][0][6] = battleKind
        importFails(bad, Ctor, `battle kind ${String(battleKind)}`, pattern)
    }

    function collectorWithMissionTwo({ range, first = "(None)", second = "(None)",
        third = "(None)", battleKind = "3" }) {
        const asset = clone(realPass)
        asset["2"][0][6] = battleKind
        asset["2"][0][8] = String(range)
        asset["2"][0][9] = first
        asset["2"][0][10] = second
        asset["2"][0][11] = third
        asset["2"][0][12] = "(None)"
        return freshCollector(new Map([[passAssetPath, asset]])).recordPassMissionBattleFacts
    }
    for (const [range, category] of [[2,2],[5,7],[7,13],[8,11],[10,19],[15,22],[16,23],[17,24]]) {
        const record = collectorWithMissionTwo({ range })
        assert.deepEqual(record(context(1, category, 1001, false), new Date("2024-06-03T03:00:00Z")), [2],
            `range ${range} must map to questCategory ${category}`)
    }
    const malformedSecond = ["01", " 1", "1,,2", "1e2", "-1", "0", "2,1"]
    for (const [index, range] of [5, 7, 8, 10, 15, 16, 17].entries()) {
        const bad = clone(realPass)
        bad["2"][0][6] = "3"
        bad["2"][0][8] = String(range)
        bad["2"][0][9] = "(None)"
        bad["2"][0][10] = malformedSecond[index]
        bad["2"][0][11] = "(None)"
        importFails(bad, RangeError, `range ${range} malformed row[10]=${JSON.stringify(malformedSecond[index])}`,
            /selector 10/)
    }
    for (const [battleKind, singleWant, multiWant] of [["1",[2],[]],["2",[],[2]],["3",[2],[2]],
        [1,[2],[]],[2,[],[2]],[3,[2],[2]]]) {
        const record = collectorWithMissionTwo({ range: 16, battleKind })
        const label = `battle kind ${JSON.stringify(battleKind)} (${typeof battleKind})`
        assert.deepEqual(record(context(1, 23, 4001, false), new Date("2024-06-03T03:00:00Z")), singleWant, `${label} single`)
        assert.deepEqual(record(context(1, 23, 4001, true), new Date("2024-06-03T03:00:00Z")), multiWant, `${label} multi`)
    }
    const bossBoundary = collectorWithMissionTwo({ range: 2, first: "999", second: "999", third: "999" })
    assert.deepEqual(bossBoundary(context(1, 2, 999999999, false), new Date("2024-06-03T03:00:00Z")), [2],
        "boss 999/999/999 carry boundary")
    const bossCarry = collectorWithMissionTwo({ range: 2, first: "1000" })
    assert.deepEqual(bossCarry(context(1, 2, 1000000000, false), new Date("2024-06-03T03:00:00Z")), [2],
        "boss million-segment carry to 1000")
    const nonBossBoundary = collectorWithMissionTwo({ range: 16, first: "999", third: "999" })
    assert.deepEqual(nonBossBoundary(context(1, 23, 999999, false), new Date("2024-06-03T03:00:00Z")), [2],
        "non-boss 999/999 boundary")
    // Mirror of the boss case: row[10] must be validated but NOT consumed outside range 2.
    const nonBossIgnoresSecond = collectorWithMissionTwo({ range: 16, first: "4", second: "999", third: "1" })
    assert.deepEqual(nonBossIgnoresSecond(context(1, 23, 4001, false), new Date("2024-06-03T03:00:00Z")), [2],
        "non-boss range must ignore row[10] even when it cannot match")
    const safeBoundary = collectorWithMissionTwo({ range: 16,
        first: String(Math.floor(Number.MAX_SAFE_INTEGER / 1000)), third: "991" })
    assert.deepEqual(safeBoundary(context(1, 23, Number.MAX_SAFE_INTEGER, false), new Date("2024-06-03T03:00:00Z")), [2],
        "MAX_SAFE_INTEGER questId splits exactly once")

    let getterReads = 0
    const accessorPass = clone(realPass)
    Object.defineProperty(accessorPass["2"][0], "8", { enumerable: true, get() { getterReads++; return "16" } })
    importFails(accessorPass, TypeError, "range cell getter", /dense data array/)
    for (const location of ["root", "wrapper", "pattern", "battleKind", "selector", "time"]) {
        const bad = clone(realPass)
        const target = location === "root" ? bad : location === "wrapper" ? bad["2"] : bad["2"][0]
        const key = { root: "2", wrapper: "0", pattern: "3", battleKind: "6", selector: "9", time: "26" }[location]
        const value = target[key]
        Object.defineProperty(target, key, { enumerable: true, get() { getterReads++; return value } })
        importFails(bad, TypeError, `getter on ${location}`,
            location === "root" ? /non-data property/ : /dense data array/)
    }
    assert.equal(getterReads, 0)
    let setterWrites = 0
    for (const [location, key] of [["root", "2"], ["wrapper", "0"], ["cell", "9"]]) {
        const bad = clone(realPass)
        const target = location === "root" ? bad : location === "wrapper" ? bad["2"] : bad["2"][0]
        Object.defineProperty(target, key, { enumerable: true, configurable: true, set() { setterWrites++ } })
        importFails(bad, TypeError, `setter on ${location}`,
            location === "root" ? /non-data property/ : /dense data array/)
    }
    assert.equal(setterWrites, 0)
    const frozenPass = clone(realPass)
    for (const rows of Object.values(frozenPass)) { Object.freeze(rows[0]); Object.freeze(rows) }
    Object.freeze(frozenPass)
    assert.equal(typeof freshCollector(new Map([[passAssetPath, frozenPass]])).recordPassMissionBattleFacts, "function")
    const nullPrototypePass = Object.assign(Object.create(null), clone(realPass))
    assert.equal(typeof freshCollector(new Map([[passAssetPath, nullPrototypePass]])).recordPassMissionBattleFacts, "function")
    const sameIdentity = clone(realPass)
    assert.equal(typeof freshCollector(new Map([[passAssetPath, sameIdentity]])).recordPassMissionBattleFacts, "function")
    sameIdentity["2"][0][6] = "01"
    importFails(sameIdentity, RangeError, "same identity mutated to malformed", /canonical 1, 2 or 3/)
    assert.equal(typeof freshCollector(new Map([[passAssetPath, clone(realPass)]])).recordPassMissionBattleFacts, "function")

    const reversedPass = {}
    for (const key of Object.keys(realPass).reverse()) reversedPass[key] = clone(realPass[key])
    const reversed = freshCollector(new Map([[passAssetPath, reversedPass]])).recordPassMissionBattleFacts
    assert.deepEqual(reversed(context(1, 7, 200010001, true), new Date("2024-06-20T04:00:00Z")), [4, 5])
    assert.deepEqual(reversed(context(1, 23, 4001, false), new Date("2024-06-03T03:00:00Z")), [2])
    assert.deepEqual(reversed(context(1, 2, 1025001, true), new Date("2024-08-14T03:00:00Z")), [16])
    const mixedOrder = clone(realPass)
    Object.assign(mixedOrder["2"][0], { 6: "3", 8: "5", 9: "200010", 10: "(None)", 11: "(None)",
        26: "2024-06-13 12:00:00", 27: "2024-06-27 23:59:59" })
    const mixed = freshCollector(new Map([[passAssetPath, mixedOrder]])).recordPassMissionBattleFacts
    assert.deepEqual(mixed(context(1, 7, 200010001, true), new Date("2024-06-20T04:00:00Z")), [2, 4, 5],
        "pattern23 target 2 must sort ahead of pattern16 targets 4 and 5")

    let increments = 0
    let getDbCalls = 0
    const fakeDomain = { incrementPlayerCategoryMissionSync() { increments++ } }
    const fakeDb = { getDb() { getDbCalls++; return { transaction() { throw new Error("unexpected") } } } }
    const isolated = freshCollector(new Map([[domainPath, fakeDomain], [categoryDomainPath, fakeDomain], [dbPath, fakeDb]]))
    const adventTime = new Date("2024-08-14T03:00:00Z")
    // Observed on player 1 (the player every candidate below writes as), so the snapshot can actually change.
    const isolatedBaseline = rawRows(1)
    assert.notDeepEqual(isolatedBaseline, [], "baseline must be non-empty or the snapshot proves nothing")
    for (const [name, candidate, time] of [
        ["failed", { ...advent, questAccomplished: false }, adventTime],
        ["single", { ...advent, isMulti: false }, adventTime],
        ["unmatched questId", { ...advent, questId: 200016001 }, adventTime],
        ["unmatched questCategory", { ...advent, questCategory: 1 }, adventTime],
        ["inactive time", { ...advent }, new Date("2020-01-01T00:00:00Z")],
    ]) {
        assert.deepEqual(isolated.recordPassMissionBattleFacts(candidate, time), [], `${name} must be a no-op`)
        for (const [field, invalid, ErrorConstructor] of [["playerId", 0, RangeError],
            ["questAccomplished", 1, TypeError], ["isMultiHost", null, TypeError],
            ["evaluationTime", null, TypeError]]) {
            const patched = field === "evaluationTime" ? candidate : { ...candidate, [field]: invalid }
            const patchedTime = field === "evaluationTime" ? new Date("invalid") : time
            expectCtor(() => isolated.recordPassMissionBattleFacts(patched, patchedTime), ErrorConstructor,
                `${name} + bad ${field} must still throw`,
                field === "evaluationTime" ? TIME_PATTERN : fieldPattern(field))
        }
        assert.equal(increments, 0, `${name}: writer must not be called`)
        assert.equal(getDbCalls, 0, `${name}: getDb must not be called`)
        assert.deepEqual(rawRows(1), isolatedBaseline, `${name}: no player row may change`)
    }
    assert.deepEqual(freshCollector().recordPassMissionBattleFacts(context(1, 2, 1025001, true),
        new Date("2024-08-14T03:00:00Z")), [16])
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

console.log("pass mission battle facts tests passed")
