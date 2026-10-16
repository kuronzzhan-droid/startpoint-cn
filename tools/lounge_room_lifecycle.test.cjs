const assert = require("node:assert/strict")

require("ts-node/register/transpile-only")

const {
    attachLoungeSocket,
    canAttachLoungeViewer,
    cleanupExpiredLounges,
    createLounge,
    enterLounge,
    getLounge,
    getLoungeOccupancy,
    loungeCanStart,
    prepareLounge,
    resetLoungesForTests,
    touchLoungeActivity,
} = require("../src/lounge/state.ts")

class FakeSocket {
    constructor() {
        this.destroyed = false
        this.writable = true
        this.frames = []
    }

    write(frame) {
        this.frames.push(String(frame))
        return true
    }

    once() {
        return this
    }

    destroy() {
        this.destroyed = true
        this.writable = false
    }
}

function createTestLounge() {
    return createLounge({
        advice: "lifecycle-test",
        useCase: 1,
        campaignId: 3,
        hostViewerId: 1001,
        hostPlayerId: 2001,
        hostProfile: { name: "host", characterId: 1, characterEvolutionLevel: 0 },
    })
}

resetLoungesForTests()
const room = createTestLounge()
prepareLounge(room)
const sockets = []

for (const viewerId of [1001, 1002, 1003]) {
    assert.equal(canAttachLoungeViewer(room, viewerId), true)
    const socket = new FakeSocket()
    sockets.push(socket)
    attachLoungeSocket(room, viewerId, socket)
}

assert.equal(getLoungeOccupancy(room), 3, "handshake reservations must consume all three slots")
assert.equal(canAttachLoungeViewer(room, 1004), false, "a fourth concurrent handshake must be rejected")

for (const [index, viewerId] of [1001, 1002, 1003].entries()) {
    assert.ok(enterLounge(sockets[index], { name: `member-${viewerId}` }))
}
assert.equal(getLoungeOccupancy(room), 3)
assert.equal(loungeCanStart(room), true)

room.lastActivityAt = Date.now() - 31 * 60 * 1000
touchLoungeActivity(room)
cleanupExpiredLounges(Date.now())
assert.ok(getLounge(room.id), "heartbeat activity must keep an active lounge alive")

resetLoungesForTests()
console.log("lounge room lifecycle tests passed")
