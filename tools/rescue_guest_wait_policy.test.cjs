require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")

const previousIdle = process.env.RESCUE_GUEST_WAIT_MS
const previousReady = process.env.RESCUE_GUEST_READY_WAIT_MS
process.env.RESCUE_GUEST_WAIT_MS = "2000"
process.env.RESCUE_GUEST_READY_WAIT_MS = "10000"

const { SessionManager } = require("../src/multi/state/SessionManager")
const manager = new SessionManager()
const client = {
    viewerId: 123,
    roomNumber: "456789",
    isReady: false,
    isBattle: false,
    enterData: {},
    socket: { writable: false },
}

manager.markRescueGuest(client.roomNumber, client.viewerId)
manager.beginRescueGuestWait(client)
const key = `${client.viewerId}@${client.roomNumber}`
const idleWait = manager.rescueGuestWaits.get(key)
assert.equal(idleWait.ready, false)
assert.equal(idleWait.deadline - Date.now() <= 2100, true)

client.isReady = true
manager.beginRescueGuestWait(client)
const readyWait = manager.rescueGuestWaits.get(key)
assert.equal(readyWait.ready, true)
assert.equal(readyWait.deadline - Date.now() >= 9500, true)
assert.notEqual(readyWait.ejectTimer, idleWait.ejectTimer)

manager.clearRescueGuestLobbyWait(client.roomNumber, client.viewerId)
assert.equal(
    manager.isRescueGuest(client.roomNumber, client.viewerId),
    true,
    "starting a battle must clear the lobby timeout without losing rescue membership",
)

manager.clearRescueGuestStateForRoom(client.roomNumber)
if (previousIdle === undefined) delete process.env.RESCUE_GUEST_WAIT_MS
else process.env.RESCUE_GUEST_WAIT_MS = previousIdle
if (previousReady === undefined) delete process.env.RESCUE_GUEST_READY_WAIT_MS
else process.env.RESCUE_GUEST_READY_WAIT_MS = previousReady

console.log("rescue guest wait policy test passed")
