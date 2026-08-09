require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")

process.env.REMATCH_RECONNECT_GRACE_MS = "30"
process.env.NPC_JOIN_DELAY_MS = "5"
process.env.NPC_READY_DELAY_MS = "5"
process.env.GAME_VERBOSE_LOGS = "false"

const { createRoom, disbandRoom } = require("../src/multi/room/manager")
const { sessionManager } = require("../src/multi/state/SessionManager")
const { scheduleRematchDisconnectCleanup } = require("../src/multi/tcp/lobby")

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function run() {
    const room = createRoom(101, 201, 1, 1, 1001, 0, 101001, true)
    room.lobby_generation = 1
    room.raising_state = 1
    room.expected_real_viewer_ids = [101, 102]
    room.mates = [
        { viewer_id: 101, com_id: 0 },
        { viewer_id: 102, com_id: 0 },
    ]

    const socket = { writable: false, end() {}, destroy() {} }
    const host = sessionManager.createClient(socket, 101, room.room_number, "host", null)
    host.roomGeneration = 1
    host.enterData = {}
    host.yourself = {
        viewerId: 101,
        comId: 0,
        connectionId: "host",
        rank: 250,
        degreeId: 1,
        party: {},
        state: [1],
    }
    host.mates = [host.yourself, {
        viewerId: 102,
        comId: 0,
        connectionId: "missing-guest",
        state: [1],
    }]
    sessionManager.addClientToRoom(host)

    scheduleRematchDisconnectCleanup(room.room_number)
    await delay(220)

    assert.deepEqual(room.expected_real_viewer_ids, [101])
    assert.equal(host.mates.filter(mate => !mate.comId).length, 1)
    assert.equal(host.mates.filter(mate => !!mate.comId).length, 2)
    assert.equal(host.mates.length, 3)

    disbandRoom(room.room_number)
    console.log("multi rematch AI reconciliation test passed")
}

run().then(() => process.exit(0)).catch(error => {
    console.error(error)
    process.exit(1)
})
