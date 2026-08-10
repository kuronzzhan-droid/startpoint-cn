require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const Module = require("node:module")
const path = require("node:path")

const targetPath = path.resolve(__dirname, "../src/lib/mission/collect-progress.ts")
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

function withCollectComputer({ definitions, player = {}, totals = [{}] }, run) {
    const previous = new Map(dependencyPaths.map(modulePath => [modulePath, require.cache[modulePath]]))
    const calls = { definitions: 0, player: 0, totals: 0 }
    let totalIndex = 0
    try {
        if (definitions !== null) {
            require.cache[dependencyPaths[0]] = loadedModule(dependencyPaths[0], {
                getMissionMasterDefinitions(category) {
                    assert.equal(category, 4)
                    calls.definitions += 1
                    return definitions
                },
                getMissionMasterDefinition() {
                    throw new Error("collect computer must not linearly look up master definitions")
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

function definition(missionId, itemId) {
    const row = Array.from({ length: 37 }, () => "(None)")
    row[14] = itemId
    return { category: 4, missionId, row }
}

function context(totals) {
    return {
        category: 4,
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

const definitions = [definition(1500, "80001"), definition(1653, "(None)")]

withCollectComputer({ definitions: null }, ({ getCollectMissionItemId }) => {
    assert.equal(getCollectMissionItemId(1500), 80001)
    assert.equal(getCollectMissionItemId(1653), undefined)
    assert.equal(getCollectMissionItemId(1761), 50200)
})

withCollectComputer({ definitions, totals: [{ "80001": 14 }, { "80001": 21 }] }, ({
    CollectComputer,
    getCollectMissionItemId,
}, calls) => {
    assert.equal(calls.definitions, 1)
    assert.equal(getCollectMissionItemId(1500), 80001)
    assert.equal(getCollectMissionItemId(1653), undefined)
    assert.equal(getCollectMissionItemId(999999), undefined)

    for (const value of ["1500", NaN, Infinity, -Infinity]) assertTypeError(() => getCollectMissionItemId(value))
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assertRangeError(() => getCollectMissionItemId(value))

    const first = CollectComputer.buildContext(1, 4)
    assert.equal(calls.player, 1)
    assert.equal(calls.totals, 1)
    assert.equal(CollectComputer.compute(1500, first, 0), 14)
    assert.equal(CollectComputer.compute(1500, first, 20), 20)
    assert.equal(CollectComputer.compute(1653, first, 7), 7)
    assert.equal(CollectComputer.compute(999999, first, 7), 7)
    assert.equal(calls.totals, 1)

    const second = CollectComputer.buildContext(1, 4)
    assert.equal(calls.player, 2)
    assert.equal(calls.totals, 2)
    assert.equal(CollectComputer.compute(1500, second, 0), 21)

    assertRangeError(() => CollectComputer.buildContext(1, 3))
    assertRangeError(() => CollectComputer.buildContext(0, 4))
    assert.throws(() => CollectComputer.buildContext(2, 4))
})

withCollectComputer({ definitions }, ({ CollectComputer }) => {
    assert.equal(CollectComputer.compute(1500, context(), 7), 7)
    assert.equal(CollectComputer.compute(1500, context({}), 7), 7)
    assert.equal(CollectComputer.compute(1500, context({ "80001": 0 }), 7), 7)
    assert.equal(CollectComputer.compute(1500, context({ "80001": 3 }), 7), 7)
    assert.equal(CollectComputer.compute(1500, context({ "80001": 14 }), 1.5), 14)
    assert.equal(CollectComputer.compute(1500, context({ "80001": 14 }), Number.MAX_VALUE), Number.MAX_VALUE)

    for (const value of ["1500", NaN, Infinity, -Infinity]) assertTypeError(() => CollectComputer.compute(value, context({}), 0))
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assertRangeError(() => CollectComputer.compute(value, context({}), 0))
    for (const value of [NaN, Infinity, -Infinity, "0"]) assertTypeError(() => CollectComputer.compute(1500, context({}), value))
    assertRangeError(() => CollectComputer.compute(1500, context({}), -1))

    for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "14"]) {
        const expected = typeof value === "number" && Number.isFinite(value) ? RangeError : TypeError
        assert.throws(() => CollectComputer.compute(1500, context({ "80001": value }), 0), expected)
    }
})

for (const malformed of [
    [{ category: 4, missionId: 1500, row: Array(36).fill("(None)") }],
    [definition(1500, "080001")],
    [definition(1500, " 80001")],
    [definition(1500, "8e4")],
    [definition(1500, "80001.0")],
    [definition(1500, "NaN")],
    [definition(1500, "Infinity")],
    [definition(1500, "80001"), definition(1500, "80002")],
]) {
    assert.throws(() => withCollectComputer({ definitions: malformed }, () => {}))
}

console.log("mission collect progress tests passed")
