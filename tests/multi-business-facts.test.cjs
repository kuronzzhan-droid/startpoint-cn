const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const out = process.env.STARPOINT_TEST_OUT_DIR || path.resolve(__dirname, '../out')
const facts = require(path.join(out, 'multi/coordinator/business-facts'))
function snapshot(playerId = 1, revision = 1, changes = {}) {
    return { parentEpoch: 'parent-a', revision, playerId, viewerId: playerId + 100, expiresAt: Date.now() + 120000,
        category: 15, questId: 1099001999, partyId: 1,
        player: { name: 'fixture', rank: 100, degreeId: 1, leaderCharacterId: 111001, role: 1, tutorialStep: 0, partySlot: 1 },
        party: { characters: [] }, ownedCharacterIds: [111001], restrictedEquipment: false,
        guestEligibility: { allowed: true }, questNpcPartySnapshot: null,
        questPolicy: { isMode15: true, equipmentAllowed: true, hostAllowed: false, exclusiveItemIds: [] }, ...changes }
}
afterEach(() => facts.clearPlayerBusinessFacts())
test('versioned facts reject older parent, revisions and mismatched quest/party, with copied reads', () => {
    const input = snapshot()
    assert.equal(facts.applyPlayerBusinessFacts(input), true)
    input.ownedCharacterIds.push(999)
    const read = facts.getPlayerBusinessFacts(1); read.partyId = 5
    assert.deepEqual(facts.getPlayerBusinessFacts(1).ownedCharacterIds, [111001])
    assert.equal(facts.applyPlayerBusinessFacts(snapshot(1, 1)), false)
    assert.equal(facts.applyPlayerBusinessFacts(snapshot(1, 2, { parentEpoch: 'restarted-parent' })), false)
    assert.equal(facts.getPlayerBusinessFacts(1, { partyId: 2 }), undefined)
    assert.equal(facts.getPlayerBusinessFacts(1, { questId: 123 }), undefined)
    assert.equal(facts.applyPlayerBusinessFacts(snapshot(1, 2)), true)
    assert.equal(facts.getPlayerBusinessFacts(1).revision, 2)
})
test('expired facts are unavailable and capacity rejects new work without evicting active players', () => {
    assert.equal(facts.applyPlayerBusinessFacts(snapshot(1, 1, { expiresAt: Date.now() - 1 })), false)
    for (let playerId = 1; playerId <= 1024; playerId++) assert.equal(facts.applyPlayerBusinessFacts(snapshot(playerId)), true)
    assert.equal(facts.applyPlayerBusinessFacts(snapshot(1025)), false)
    assert.ok(facts.getPlayerBusinessFacts(1))
    assert.equal(facts.applyPlayerBusinessFacts(snapshot(1, 2)), true)
})
test('child host eligibility is keyed by the host player and never falls back to business DB', async () => {
    const previous = process.env.MULTI_REALTIME_OWNER_CHILD
    process.env.MULTI_REALTIME_OWNER_CHILD = '1'
    try {
        const gate = require(path.join(out, 'multi/mode15-room-gate'))
        const handlers = require(path.join(out, 'multi/coordinator/business-handlers'))
        const room = { host_player_id: 1, category: 15, quest_id: 1099001999 }
        assert.equal(gate.isMode15RoomClosed(room), false, 'unknown host facts cannot prove closure or disband')
        assert.equal(gate.getMode15HostRoomGate(room).unknown, true)
        assert.equal(gate.getMode15HostRoomGate(room).allowed, false, 'unknown eligibility cannot prepare/start')
        facts.applyPlayerBusinessFacts(snapshot(1))
        facts.applyPlayerBusinessFacts(snapshot(2, 1, { questPolicy: { isMode15: true, equipmentAllowed: true, hostAllowed: true, exclusiveItemIds: [] } }))
        assert.equal(gate.isMode15RoomClosed(room), true, 'eligible guest facts do not allow host start')
        await assert.rejects(handlers.handleRealtimeBusiness('player.facts', {}), /PARENT_ONLY/)
        await assert.rejects(facts.refreshRealtimePlayerFacts(1, { category: 15, questId: 1099001999 }), /CHANNEL_UNAVAILABLE/)
    } finally {
        if (previous === undefined) delete process.env.MULTI_REALTIME_OWNER_CHILD
        else process.env.MULTI_REALTIME_OWNER_CHILD = previous
    }
})
test('expired eligibility does not close an ordinary room and leaves Mode15 preparation unknown', () => {
    const previous = process.env.MULTI_REALTIME_OWNER_CHILD, originalNow = Date.now
    process.env.MULTI_REALTIME_OWNER_CHILD = '1'
    try {
        const now = originalNow()
        facts.applyPlayerBusinessFacts(snapshot(1, 1, { expiresAt: now + 10, category: 1, questId: 9001001,
            questPolicy: { isMode15: false, equipmentAllowed: false, hostAllowed: true, exclusiveItemIds: [] } }))
        facts.applyPlayerBusinessFacts(snapshot(2, 1, { expiresAt: now + 10 }))
        Date.now = () => now + 11
        const gate = require(path.join(out, 'multi/mode15-room-gate'))
        assert.equal(gate.getMode15HostRoomGate({ host_player_id: 1, category: 1, quest_id: 9001001 }), null)
        const missing = { host_player_id: 2, category: 15, quest_id: 1099001999 }
        assert.equal(gate.getMode15HostRoomGate(missing).unknown, true)
        assert.equal(gate.getMode15HostRoomGate(missing).allowed, false)
        assert.equal(gate.isMode15RoomClosed(missing), false)
    } finally {
        Date.now = originalNow
        if (previous === undefined) delete process.env.MULTI_REALTIME_OWNER_CHILD
        else process.env.MULTI_REALTIME_OWNER_CHILD = previous
    }
})
