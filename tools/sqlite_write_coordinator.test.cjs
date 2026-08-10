require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const coordinatorPath = path.resolve(__dirname, "../src/lib/sqlite-write-coordinator.ts")

assert.equal(
    fs.existsSync(coordinatorPath),
    true,
    "SQLite 写协调器模块必须存在",
)

function createFakeDatabase() {
    const commands = []
    const database = {
        inTransaction: false,
        exec(command) {
            commands.push(command)
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

let currentDatabase = createFakeDatabase().database
const dataDbPath = path.resolve(__dirname, "../src/data/db.ts")
const resolvedDataDbPath = require.resolve(dataDbPath)
const previousDataDbModule = require.cache[resolvedDataDbPath]
const fakeDataDbModule = {
    exports: { getDb: () => currentDatabase },
    filename: resolvedDataDbPath,
    id: resolvedDataDbPath,
    loaded: true,
}

require.cache[resolvedDataDbPath] = fakeDataDbModule
const {
    isSqliteBusyError,
    runImmediateTransactionWithRetry,
    withPlayerWriteQueue,
} = require(coordinatorPath)
if (previousDataDbModule) require.cache[resolvedDataDbPath] = previousDataDbModule
else delete require.cache[resolvedDataDbPath]

async function main() {
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
    currentDatabase = fake.database
    assert.equal(await runImmediateTransactionWithRetry(() => "committed"), "committed")
    assert.deepEqual(fake.commands, ["BEGIN IMMEDIATE", "COMMIT"])

    fake = createFakeDatabase()
    currentDatabase = fake.database
    const operationFailure = new Error("operation failed")
    await assert.rejects(
        runImmediateTransactionWithRetry(() => { throw operationFailure }),
        error => error === operationFailure,
    )
    assert.deepEqual(fake.commands, ["BEGIN IMMEDIATE", "ROLLBACK"])

    fake = createFakeDatabase()
    currentDatabase = fake.database
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
    currentDatabase = fake.database
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
    currentDatabase = fake.database
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

    for (const maxAttempts of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        fake = createFakeDatabase()
        currentDatabase = fake.database
        await assert.rejects(
            runImmediateTransactionWithRetry(() => "unreachable", maxAttempts),
            error => error instanceof RangeError && /maxAttempts/i.test(error.message),
            `非法 maxAttempts ${String(maxAttempts)} 必须 fail closed`,
        )
        assert.deepEqual(fake.commands, [], "非法 maxAttempts 不得开启事务")
    }
}

main().then(
    () => console.log("sqlite write coordinator tests passed"),
    error => {
        console.error(error)
        process.exitCode = 1
    },
)
