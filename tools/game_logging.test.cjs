const assert = require("node:assert/strict")

require("ts-node/register/transpile-only")

const modulePath = require.resolve("../src/lib/game-logging")
const originalConsoleLog = console.log

try {
    let calls = 0
    let formatted = false
    console.log = () => { calls += 1 }

    process.env.GAME_VERBOSE_LOGS = "false"
    delete require.cache[modulePath]
    let logging = require(modulePath)
    logging.gameVerboseLog(() => {
        formatted = true
        return "suppressed"
    })
    assert.equal(calls, 0)
    assert.equal(formatted, false)
    assert.equal(logging.isGameVerboseLoggingEnabled(), false)

    process.env.GAME_VERBOSE_LOGS = "true"
    delete require.cache[modulePath]
    logging = require(modulePath)
    logging.gameVerboseLog(() => "visible")
    assert.equal(calls, 1)
    assert.equal(logging.isGameVerboseLoggingEnabled(), true)
} finally {
    console.log = originalConsoleLog
    delete process.env.GAME_VERBOSE_LOGS
    delete require.cache[modulePath]
}

console.log("game logging tests passed")
