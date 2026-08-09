const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "multi", "tcp", "lobby.ts"),
    "utf8",
)

const welcomeIndex = source.indexOf(
    "sessionManager.sendJson(client.socket, [1, [0, yourself, [yourself]]])",
)
const hostReplayIndex = source.indexOf(
    "sessionManager.sendJson(client.socket, [1, [1, client.mates]])",
    welcomeIndex,
)
const autoReadyIndex = source.indexOf(
    "checkHostAutoReady(client.roomNumber)",
    hostReplayIndex,
)

assert.notEqual(welcomeIndex, -1, "host must receive Welcome")
assert.notEqual(hostReplayIndex, -1, "host reconnect must receive the full roster")
assert.ok(
    hostReplayIndex > welcomeIndex,
    "the full roster must be replayed after Welcome",
)
assert.ok(
    autoReadyIndex > hostReplayIndex,
    "host auto-ready must be recalculated after roster replay",
)

console.log("multi host reconnect roster test passed")
