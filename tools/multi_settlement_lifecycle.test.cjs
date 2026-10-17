const assert = require("node:assert/strict")

const {
    getMultiSettlementSnapshot,
    registerMultiSettlementSnapshot,
    transitionMultiSettlementSnapshot,
    transitionRoomSettlementSnapshots,
} = require("../out/multi/settlement-snapshot.js")

function register(playerId, playId, roomGeneration) {
    return registerMultiSettlementSnapshot({
        battleInstanceId: `998877:${roomGeneration}:1:2`,
        playerId,
        viewerId: playerId + 1000,
        playId,
        roomNumber: "998877",
        roomGeneration,
        activeQuest: {
            playId,
            category: 1,
            questId: 2,
            roomNumber: "998877",
            matePlayerIds: [],
            mateComIds: [],
        },
        participants: [],
        expectedRealViewerIds: [],
        isHost: true,
        isRescueGuest: false,
        isNewbieRescueGuest: false,
    })
}

const oldBattle = register(81011, "old-play", 7)
const rematch = register(81012, "new-play", 8)

assert.equal(transitionRoomSettlementSnapshots("998877", "LOBBY", 7), 0)
assert.equal(oldBattle.lifecycle, "BATTLE", "host return cannot complete a pending guest result")
transitionMultiSettlementSnapshot(oldBattle.playerId, oldBattle.playId, "RETURN_PENDING")
assert.equal(transitionRoomSettlementSnapshots("998877", "LOBBY", 7), 1)
assert.equal(oldBattle.lifecycle, "LOBBY")
assert.equal(rematch.lifecycle, "BATTLE", "returning from generation 7 must not advance generation 8")

transitionMultiSettlementSnapshot(oldBattle.playerId, oldBattle.playId, "SETTLING")
transitionMultiSettlementSnapshot(oldBattle.playerId, oldBattle.playId, "RETURN_PENDING")
assert.equal(
    getMultiSettlementSnapshot(oldBattle.playerId, oldBattle.playId).lifecycle,
    "LOBBY",
    "a late finish must not roll a returned battle back out of LOBBY",
)

transitionMultiSettlementSnapshot(rematch.playerId, rematch.playId, "SETTLING")
transitionMultiSettlementSnapshot(rematch.playerId, rematch.playId, "RETURN_PENDING")
transitionMultiSettlementSnapshot(rematch.playerId, rematch.playId, "LOBBY")
transitionMultiSettlementSnapshot(rematch.playerId, rematch.playId, "BATTLE")
assert.equal(rematch.lifecycle, "LOBBY", "settlement lifecycle should be monotonic")

console.log("multi_settlement_lifecycle.test: ok")
