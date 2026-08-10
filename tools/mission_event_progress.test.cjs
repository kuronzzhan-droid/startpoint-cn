require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const Module = require("node:module")
const path = require("node:path")

const targetPath = path.resolve(__dirname, "../src/lib/mission/computer-event-safe.ts")
const dependencyPaths = [
    require.resolve("../src/lib/mission/master-data"),
    require.resolve("../src/data/domains/player"),
    require.resolve("../src/data/domains/item"),
]

function loadedModule(filename, exports) {
    const module = new Module(filename)
    module.filename = filename
    module.paths = Module._nodeModulePaths(path.dirname(filename))
    module.loaded = true
    module.exports = exports
    return module
}

function withEventComputer({ definitions, player = {}, totals = [{}] }, run) {
    const previous = new Map(dependencyPaths.map(modulePath => [modulePath, require.cache[modulePath]]))
    const calls = { definitions: 0, player: 0, totals: 0 }
    let totalIndex = 0
    try {
        if (definitions !== null) {
            require.cache[dependencyPaths[0]] = loadedModule(dependencyPaths[0], {
                getMissionMasterDefinitions(category) {
                    assert.equal(category, 3)
                    calls.definitions += 1
                    return definitions
                },
                getMissionMasterDefinition() {
                    throw new Error("event-safe computer must not linearly look up master definitions")
                },
            })
        }
        require.cache[dependencyPaths[1]] = loadedModule(dependencyPaths[1], {
            getPlayerSync(playerId) {
                calls.player += 1
                return playerId === 1 ? player : null
            },
        })
        require.cache[dependencyPaths[2]] = loadedModule(dependencyPaths[2], {
            getPlayerCollectedItemTotalsSync(playerId) {
                assert.equal(playerId, 1)
                const value = totals[Math.min(totalIndex, totals.length - 1)]
                totalIndex += 1
                calls.totals += 1
                return value
            },
        })
        delete require.cache[targetPath]
        return run(require(targetPath), calls)
    } finally {
        delete require.cache[targetPath]
        for (const [modulePath, entry] of previous) {
            if (entry === undefined) delete require.cache[modulePath]
            else require.cache[modulePath] = entry
        }
    }
}

function definition(missionId, patternType, itemId = "(None)") {
    const row = Array.from({ length: 35 }, () => "(None)")
    row[2] = patternType
    row[12] = itemId
    return { category: 3, missionId, row }
}

function context(totals) {
    return {
        category: 3,
        playerId: 1,
        player: {},
        questProgress: {},
        totalQuestClears: 0,
        totalStories: 0,
        rankCounts: {},
        ...(totals === undefined ? {} : { collectedItemTotals: totals }),
    }
}

function assertTypeError(fn) {
    assert.throws(fn, TypeError)
}

function assertRangeError(fn) {
    assert.throws(fn, RangeError)
}

const definitions = [
    ...Array.from({ length: 40 }, (_, index) => definition(2355 - index, "37", "80111")),
    definition(1400, "36"),
]

withEventComputer({ definitions: null }, ({
    getEventItemMissionItemId,
    getEventItemMissionIdsForItems,
}) => {
    const { getMissionMasterDefinitions, isMissionDefinitionEnabledAt } = require("../src/lib/mission/master-data")
    const definition2316 = getMissionMasterDefinitions(3).find(definition => definition.missionId === 2316)
    assert.notEqual(definition2316, undefined)
    assert.equal(getEventItemMissionItemId(2316), 80111)
    assert.deepEqual(getEventItemMissionIdsForItems([80111]), Array.from({ length: 40 }, (_, index) => 2316 + index))
    assert.equal(isMissionDefinitionEnabledAt(definition2316, new Date("2023-11-29T03:59:59.000Z")), false)
    assert.equal(isMissionDefinitionEnabledAt(definition2316, new Date("2023-11-29T04:00:00.000Z")), true)
    assert.equal(isMissionDefinitionEnabledAt(definition2316, new Date("2023-12-14T03:59:59.000Z")), true)
    assert.equal(isMissionDefinitionEnabledAt(definition2316, new Date("2023-12-14T04:00:00.000Z")), false)
})

withEventComputer({ definitions, totals: [{ "80111": 12 }, { "80111": 18 }] }, ({
    EventSafeComputer,
    getEventItemMissionItemId,
    getEventItemMissionIdsForItems,
}, calls) => {
    assert.equal(calls.definitions, 1)
    assert.equal(getEventItemMissionItemId(2316), 80111)
    assert.equal(getEventItemMissionItemId(1400), undefined)
    assert.equal(getEventItemMissionItemId(999999), undefined)
    assert.deepEqual(getEventItemMissionIdsForItems([80111]), Array.from({ length: 40 }, (_, index) => 2316 + index))
    assert.deepEqual(getEventItemMissionIdsForItems([99999, 80111, 80111]), Array.from({ length: 40 }, (_, index) => 2316 + index))
    assert.deepEqual(getEventItemMissionIdsForItems([]), [])
    const returned = getEventItemMissionIdsForItems([80111])
    returned.pop()
    assert.deepEqual(getEventItemMissionIdsForItems([80111]), Array.from({ length: 40 }, (_, index) => 2316 + index))

    for (const value of ["2316", NaN, Infinity, -Infinity]) assertTypeError(() => getEventItemMissionItemId(value))
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assertRangeError(() => getEventItemMissionItemId(value))
    for (const value of ["80111", NaN, Infinity, -Infinity]) assertTypeError(() => getEventItemMissionIdsForItems([value]))
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assertRangeError(() => getEventItemMissionIdsForItems([value]))

    const first = EventSafeComputer.buildContext(1, 3)
    assert.equal(calls.player, 1)
    assert.equal(calls.totals, 1)
    assert.equal(EventSafeComputer.compute(2316, first, 3), 12)
    assert.equal(EventSafeComputer.compute(2316, first, 20), 20)
    assert.equal(EventSafeComputer.compute(1400, first, 7), 7)
    assert.equal(calls.totals, 1)

    const second = EventSafeComputer.buildContext(1, 3)
    assert.equal(calls.player, 2)
    assert.equal(calls.totals, 2)
    assert.equal(EventSafeComputer.compute(2316, second, 0), 18)
    assertRangeError(() => EventSafeComputer.buildContext(1, 4))
    assertRangeError(() => EventSafeComputer.buildContext(0, 3))
    assert.throws(() => EventSafeComputer.buildContext(2, 3))
})

withEventComputer({ definitions }, ({ EventSafeComputer }) => {
    assert.equal(EventSafeComputer.compute(2316, context(), 7), 7)
    assert.equal(EventSafeComputer.compute(2316, context({}), 7), 7)
    assert.equal(EventSafeComputer.compute(2316, context({ "80111": 0 }), 7), 7)
    assert.equal(EventSafeComputer.compute(2316, context({ "80111": 3 }), 7), 7)
    assert.equal(EventSafeComputer.compute(2316, context({ "80111": 12 }), 1.5), 12)
    assert.equal(EventSafeComputer.compute(2316, context({ "80111": 12 }), Number.MAX_VALUE), Number.MAX_VALUE)

    for (const value of [NaN, Infinity, -Infinity, "0"]) assertTypeError(() => EventSafeComputer.compute(2316, context({}), value))
    assertRangeError(() => EventSafeComputer.compute(2316, context({}), -1))
    for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "12"]) {
        const expected = typeof value === "number" && Number.isFinite(value) ? RangeError : TypeError
        assert.throws(() => EventSafeComputer.compute(2316, context({ "80111": value }), 0), expected)
    }
})

for (const malformed of [
    [{ category: 3, missionId: 2316, row: Array(34).fill("(None)") }],
    [definition(2316, "037", "80111")],
    [definition(2316, "37", "080111")],
    [definition(2316, "37", " 80111")],
    [definition(2316, "37", "8e4")],
    [definition(2316, "37", "80111"), definition(2316, "37", "80111")],
]) {
    assert.throws(() => withEventComputer({ definitions: malformed }, () => {}))
}

console.log("mission event progress tests passed")
