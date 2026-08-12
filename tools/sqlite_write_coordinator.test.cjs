require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const { spawnSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const coordinatorPath = path.resolve(__dirname, "../src/lib/sqlite-write-coordinator.ts")

assert.equal(
    fs.existsSync(coordinatorPath),
    true,
    "SQLite 写协调器模块必须存在",
)

function createFakeDatabase(onExec) {
    const commands = []
    const database = {
        inTransaction: false,
        exec(command) {
            commands.push(command)
            if (onExec) onExec(command, database, commands)
            if (command === "BEGIN IMMEDIATE") this.inTransaction = true
            if (command === "COMMIT" || command === "ROLLBACK") this.inTransaction = false
        },
    }
    return { commands, database }
}

function sqliteError(code) {
    return Object.assign(new Error(code), { code })
}

function deferred() {
    let resolve
    let reject
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return { promise, reject, resolve }
}

const dataDbPath = path.resolve(__dirname, "../src/data/db.ts")
const resolvedDataDbPath = require.resolve(dataDbPath)
const resolvedCoordinatorPath = require.resolve(coordinatorPath)

async function withIsolatedCoordinator(callback) {
    const previousDataDbModule = require.cache[resolvedDataDbPath]
    const previousCoordinatorModule = require.cache[resolvedCoordinatorPath]
    let currentDatabase = createFakeDatabase().database
    require.cache[resolvedDataDbPath] = {
        exports: { getDb: () => currentDatabase },
        filename: resolvedDataDbPath,
        id: resolvedDataDbPath,
        loaded: true,
    }
    delete require.cache[resolvedCoordinatorPath]
    try {
        const coordinator = require(coordinatorPath)
        await callback(coordinator, database => { currentDatabase = database })
    } finally {
        if (previousCoordinatorModule) require.cache[resolvedCoordinatorPath] = previousCoordinatorModule
        else delete require.cache[resolvedCoordinatorPath]
        if (previousDataDbModule) require.cache[resolvedDataDbPath] = previousDataDbModule
        else delete require.cache[resolvedDataDbPath]
    }
}

function assertSynchronousCallbackTypeContract() {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wf-sqlite-types-"))
    const fixturePath = path.join(temporaryRoot, "contract.ts")
    const modulePath = coordinatorPath.replace(/\\/g, "/").replace(/\.ts$/, "")
    fs.writeFileSync(fixturePath, [
        `import { runImmediateTransactionWithRetry } from ${JSON.stringify(modulePath)}`,
        "runImmediateTransactionWithRetry(() => 1)",
        "// @ts-expect-error transaction callbacks must be synchronous",
        "runImmediateTransactionWithRetry(async () => 1)",
        "",
    ].join("\n"))
    try {
        const tscPath = require.resolve("typescript/bin/tsc")
        const result = spawnSync(process.execPath, [
            tscPath,
            "--noEmit",
            "--strict",
            "--skipLibCheck",
            "--target", "ES2021",
            "--module", "commonjs",
            "--moduleResolution", "node",
            "--esModuleInterop",
            "--resolveJsonModule",
            fixturePath,
        ], { encoding: "utf8" })
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true })
    }
}

function assertRejectedCallbackIsConsumed() {
    const script = `
require("ts-node/register/transpile-only")
const dataDbPath = require.resolve(${JSON.stringify(dataDbPath)})
const coordinatorPath = require.resolve(${JSON.stringify(coordinatorPath)})
const commands = []
const database = {
    inTransaction: false,
    exec(command) {
        commands.push(command)
        if (command === "BEGIN IMMEDIATE") this.inTransaction = true
        if (command === "COMMIT" || command === "ROLLBACK") this.inTransaction = false
    },
}
require.cache[dataDbPath] = {
    exports: { getDb: () => database },
    filename: dataDbPath,
    id: dataDbPath,
    loaded: true,
}
const { runImmediateTransactionWithRetry } = require(coordinatorPath)
;(async () => {
    let caught
    try {
        await runImmediateTransactionWithRetry(() => Promise.reject(new Error("rejected callback sentinel")))
    } catch (error) {
        caught = error
    }
    if (!(caught instanceof TypeError)) throw new Error("expected synchronous callback TypeError")
    if (commands.join(",") !== "BEGIN IMMEDIATE,ROLLBACK") throw new Error("unexpected transaction commands")
    await new Promise(resolve => setImmediate(resolve))
})()
`
    const result = spawnSync(process.execPath, [
        "--unhandled-rejections=strict",
        "-e",
        script,
    ], {
        cwd: path.resolve(__dirname, ".."),
        encoding: "utf8",
    })
    assert.equal(
        result.status,
        0,
        `rejected callback leaked as an unhandled rejection\n${result.stdout}\n${result.stderr}`,
    )
}

async function runBehaviorTests(coordinator, setCurrentDatabase) {
    const {
        isSqliteBusyError,
        runImmediateTransactionWithRetry,
        withPlayerWriteQueue,
    } = coordinator
    for (const code of ["SQLITE_BUSY", "SQLITE_BUSY_SNAPSHOT", "SQLITE_BUSY_RECOVERY"]) {
        assert.equal(isSqliteBusyError(sqliteError(code)), true, `${code} 必须识别为可重试忙错误`)
    }
    for (const error of [
        sqliteError("SQLITE_LOCKED"),
        sqliteError("BUSY"),
        Object.assign(new Error("SQLITE_BUSY"), { code: undefined }),
        { code: "SQLITE_BUSY" },
        new Error("SQLITE_BUSY"),
        null,
    ]) {
        assert.equal(isSqliteBusyError(error), false, "只允许精确 SQLITE_BUSY* 错误代码")
    }

    const firstGate = deferred()
    const events = []
    const firstFailure = new Error("first write failed")
    const first = withPlayerWriteQueue(101, async () => {
        events.push("first:start")
        await firstGate.promise
        events.push("first:reject")
        throw firstFailure
    })
    const second = withPlayerWriteQueue(101, async () => {
        events.push("second:start")
        return "second result"
    })
    await Promise.resolve()
    assert.deepEqual(events, ["first:start"], "同一玩家后写入必须等前一写入结束")
    firstGate.resolve()
    await assert.rejects(first, error => error === firstFailure)
    assert.equal(await second, "second result")
    assert.deepEqual(events, ["first:start", "first:reject", "second:start"], "失败写入不得阻塞同玩家队列尾部")

    const parallelA = deferred()
    const parallelB = deferred()
    const parallelStarts = []
    const playerA = withPlayerWriteQueue(201, async () => {
        parallelStarts.push("A")
        await parallelA.promise
        return "A"
    })
    const playerB = withPlayerWriteQueue(202, async () => {
        parallelStarts.push("B")
        await parallelB.promise
        return "B"
    })
    await Promise.resolve()
    assert.deepEqual(parallelStarts.sort(), ["A", "B"], "不同玩家写入不得相互串行化")
    parallelA.resolve()
    parallelB.resolve()
    assert.deepEqual(await Promise.all([playerA, playerB]), ["A", "B"])

    for (const playerId of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
        await assert.rejects(
            withPlayerWriteQueue(playerId, async () => "unreachable"),
            error => error instanceof RangeError && /playerId/i.test(error.message),
            `不安全 playerId ${String(playerId)} 必须在入队前拒绝`,
        )
    }

    let fake = createFakeDatabase()
    setCurrentDatabase(fake.database)
    assert.equal(await runImmediateTransactionWithRetry(() => "committed"), "committed")
    assert.deepEqual(fake.commands, ["BEGIN IMMEDIATE", "COMMIT"])

    fake = createFakeDatabase()
    setCurrentDatabase(fake.database)
    const operationFailure = new Error("operation failed")
    await assert.rejects(
        runImmediateTransactionWithRetry(() => { throw operationFailure }),
        error => error === operationFailure,
    )
    assert.deepEqual(fake.commands, ["BEGIN IMMEDIATE", "ROLLBACK"])

    fake = createFakeDatabase()
    setCurrentDatabase(fake.database)
    let retryAttempts = 0
    assert.equal(
        await runImmediateTransactionWithRetry(() => {
            retryAttempts += 1
            if (retryAttempts < 3) throw sqliteError("SQLITE_BUSY_SNAPSHOT")
            return "retried"
        }, 3),
        "retried",
    )
    assert.equal(retryAttempts, 3)
    assert.deepEqual(fake.commands, [
        "BEGIN IMMEDIATE", "ROLLBACK",
        "BEGIN IMMEDIATE", "ROLLBACK",
        "BEGIN IMMEDIATE", "COMMIT",
    ])

    fake = createFakeDatabase()
    setCurrentDatabase(fake.database)
    const finalBusy = sqliteError("SQLITE_BUSY")
    let exhaustedAttempts = 0
    await assert.rejects(
        runImmediateTransactionWithRetry(() => {
            exhaustedAttempts += 1
            throw finalBusy
        }, 2),
        error => error === finalBusy,
    )
    assert.equal(exhaustedAttempts, 2)
    assert.deepEqual(fake.commands, ["BEGIN IMMEDIATE", "ROLLBACK", "BEGIN IMMEDIATE", "ROLLBACK"])

    fake = createFakeDatabase()
    setCurrentDatabase(fake.database)
    const nonBusy = sqliteError("SQLITE_LOCKED")
    let nonBusyAttempts = 0
    await assert.rejects(
        runImmediateTransactionWithRetry(() => {
            nonBusyAttempts += 1
            throw nonBusy
        }, 3),
        error => error === nonBusy,
    )
    assert.equal(nonBusyAttempts, 1, "非 SQLITE_BUSY* 错误不得重试")
    assert.deepEqual(fake.commands, ["BEGIN IMMEDIATE", "ROLLBACK"])

    const beginFailure = sqliteError("SQLITE_IOERR")
    let beginOperationCalls = 0
    fake = createFakeDatabase(command => {
        if (command === "BEGIN IMMEDIATE") throw beginFailure
    })
    setCurrentDatabase(fake.database)
    await assert.rejects(
        runImmediateTransactionWithRetry(() => { beginOperationCalls += 1 }),
        error => error === beginFailure,
    )
    assert.equal(beginOperationCalls, 0)
    assert.deepEqual(fake.commands, ["BEGIN IMMEDIATE"], "BEGIN 失败时事务尚未建立，不得 ROLLBACK")

    const commitFailure = sqliteError("SQLITE_IOERR")
    fake = createFakeDatabase(command => {
        if (command === "COMMIT") throw commitFailure
    })
    setCurrentDatabase(fake.database)
    await assert.rejects(
        runImmediateTransactionWithRetry(() => "not committed"),
        error => error === commitFailure,
    )
    assert.deepEqual(fake.commands, ["BEGIN IMMEDIATE", "COMMIT", "ROLLBACK"])
    assert.equal(fake.database.inTransaction, false)

    const originalBusy = sqliteError("SQLITE_BUSY")
    const rollbackFailure = sqliteError("SQLITE_IOERR_ROLLBACK")
    fake = createFakeDatabase(command => {
        if (command === "ROLLBACK") throw rollbackFailure
    })
    setCurrentDatabase(fake.database)
    let rollbackFailureAttempts = 0
    await assert.rejects(
        runImmediateTransactionWithRetry(() => {
            rollbackFailureAttempts += 1
            throw originalBusy
        }, 3),
        error => {
            assert.equal(error.name, "SqliteRollbackError")
            assert.match(error.message, /transaction failed and rollback failed/i)
            assert.strictEqual(error.cause, originalBusy)
            assert.strictEqual(error.rollbackCause, rollbackFailure)
            return true
        },
    )
    assert.equal(rollbackFailureAttempts, 1, "ROLLBACK 失败后连接状态不可信，不得继续重试")
    assert.equal(fake.database.inTransaction, true, "协调器不得伪装 ROLLBACK 已清理事务")
    assert.deepEqual(fake.commands, ["BEGIN IMMEDIATE", "ROLLBACK"])

    for (const asyncResult of [Promise.resolve("late"), { then() {} }]) {
        fake = createFakeDatabase()
        setCurrentDatabase(fake.database)
        await assert.rejects(
            runImmediateTransactionWithRetry(() => asyncResult),
            error => error instanceof TypeError && /synchronous|Promise|thenable/i.test(error.message),
        )
        assert.deepEqual(fake.commands, ["BEGIN IMMEDIATE", "ROLLBACK"], "异步结果必须在 COMMIT 前拒绝并回滚")
    }

    for (const maxAttempts of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        fake = createFakeDatabase()
        setCurrentDatabase(fake.database)
        await assert.rejects(
            runImmediateTransactionWithRetry(() => "unreachable", maxAttempts),
            error => error instanceof RangeError && /maxAttempts/i.test(error.message),
            `非法 maxAttempts ${String(maxAttempts)} 必须 fail closed`,
        )
        assert.deepEqual(fake.commands, [], "非法 maxAttempts 不得开启事务")
    }
}

async function main() {
    const source = fs.readFileSync(coordinatorPath, "utf8")
    assert.match(source, /same player[^\n]*not reentrant/i)
    assert.match(source, /must not await[^\n]*withPlayerWriteQueue/i)
    assertSynchronousCallbackTypeContract()
    assertRejectedCallbackIsConsumed()
    await withIsolatedCoordinator(runBehaviorTests)
}

main().then(
    () => console.log("sqlite write coordinator tests passed"),
    error => {
        console.error(error)
        process.exitCode = 1
    },
)
