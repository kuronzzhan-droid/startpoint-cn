require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const { BUNDLED_CDN_CATALOG_VERSION } = require("../src/content/constants")
const { deepFreeze } = require("../src/content/deep-freeze")
const {
    getContentSnapshot,
    initializeContentSnapshot,
    productionContentSnapshotProvider,
} = require("../src/content/runtime/content-snapshot")

function withReadSpy(callback) {
    const original = fs.readFileSync
    let calls = 0
    fs.readFileSync = function (...args) {
        calls += 1
        return original.apply(this, args)
    }
    try {
        callback(() => calls)
    } finally {
        fs.readFileSync = original
    }
}

async function withInjectedSnapshot(snapshot, callback) {
    const original = productionContentSnapshotProvider.snapshot
    productionContentSnapshotProvider.snapshot = snapshot
    try {
        await callback()
    } finally {
        productionContentSnapshotProvider.snapshot = original
    }
}

function assertBundledRootPinnedAtModuleLoad() {
    const originalCwd = process.cwd()
    const modulePath = require.resolve("../src/content/runtime/content-snapshot")
    const originalModule = require.cache[modulePath]
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wf-content-root-"))
    const rootA = path.join(temporaryRoot, "a")
    const rootB = path.join(temporaryRoot, "b")
    let freshModule
    let originalProviderSnapshot

    for (const root of [rootA, rootB]) fs.mkdirSync(path.join(root, "assets"), { recursive: true })
    for (const [root, marker] of [[rootA, "A"], [rootB, "B"]]) {
        fs.writeFileSync(path.join(root, "assets", "main_quest.json"), JSON.stringify({ marker }))
        fs.writeFileSync(path.join(root, "assets", "ex_quest.json"), JSON.stringify({ marker }))
    }

    try {
        delete require.cache[modulePath]
        process.chdir(rootA)
        freshModule = require(modulePath)
        originalProviderSnapshot = freshModule.productionContentSnapshotProvider.snapshot
        const freshRepository = freshModule.getContentSnapshot().repository
        assert.equal(freshRepository.table("main_quest.json").marker, "A")
        process.chdir(rootB)
        assert.equal(freshRepository.table("ex_quest.json").marker, "A")
    } finally {
        if (freshModule) freshModule.productionContentSnapshotProvider.snapshot = originalProviderSnapshot
        process.chdir(originalCwd)
        delete require.cache[modulePath]
        if (originalModule) require.cache[modulePath] = originalModule
        fs.rmSync(temporaryRoot, { recursive: true, force: true })
    }
}

const repository = getContentSnapshot().repository
assert.equal(repository.info().assetVersion, BUNDLED_CDN_CATALOG_VERSION)
const snapshotSource = fs.readFileSync(
    path.join(__dirname, "../src/content/runtime/content-snapshot.ts"),
    "utf8",
)
assert.doesNotMatch(snapshotSource, /assetVersion\s*:\s*["']1\.4\.\d+["']/)

withReadSpy((getCalls) => {
    const first = repository.table("mission_active.json")
    const second = repository.table("mission_active.json")
    assert.strictEqual(second, first)
    assert.equal(getCalls(), 1)
})

for (const tableName of [
    "not_registered.json",
    "../character.json",
    "cdndata/character.json",
    "character.json.bak",
    "C:\\x.json",
]) {
    withReadSpy((getCalls) => {
        assert.throws(
            () => repository.table(tableName),
            (error) => error instanceof TypeError && /not registered|Invalid bundled content table/.test(error.message),
        )
        assert.equal(getCalls(), 0)
    })
}

const originalWrites = [fs.writeFileSync, fs.mkdirSync, fs.rmSync]
const writeCalls = [0, 0, 0]
fs.writeFileSync = () => { writeCalls[0] += 1 }
fs.mkdirSync = () => { writeCalls[1] += 1 }
fs.rmSync = () => { writeCalls[2] += 1 }
try {
    const actual = repository.table("mission_active_event.json")
    const expected = JSON.parse(fs.readFileSync(path.join(process.cwd(), "assets", "mission_active_event.json"), "utf8"))
    assert.deepEqual(actual, expected)
    assert.deepEqual(writeCalls, [0, 0, 0])
} finally {
    ;[fs.writeFileSync, fs.mkdirSync, fs.rmSync] = originalWrites
}

assertBundledRootPinnedAtModuleLoad()

const originalSnapshot = getContentSnapshot()
const injected = { repository: { info: () => ({ source: "fixture" }) } }
withInjectedSnapshot(injected, async () => {
    assert.strictEqual(getContentSnapshot(), injected)
    assert.strictEqual(await initializeContentSnapshot(), injected)
}).then(() => {
    assert.strictEqual(getContentSnapshot(), originalSnapshot)
    let getterCalls = 0
    const cycle = { nested: { rows: [{}] } }
    cycle.self = cycle
    Object.defineProperty(cycle, "lazy", { get: () => { getterCalls += 1 } })
    deepFreeze(cycle)
    assert.equal(getterCalls, 0)
    assert.ok(Object.isFrozen(cycle))
    assert.ok(Object.isFrozen(cycle.nested))
    assert.ok(Object.isFrozen(cycle.nested.rows))
    assert.ok(Object.isFrozen(cycle.nested.rows[0]))
    console.log("content snapshot boundary tests passed")
})
