const assert = require("node:assert/strict")
const { EmbeddedMultiCoordinator } = require("../out/multi/coordinator/embedded.js")

function room(coordinator) {
    return {
        room_number: "123456",
        access_token: "token",
        category: 1,
        quest_id: 2,
        host_viewer_id: 10,
        host_player_id: 20,
        host_party_id: 1,
        host_main_character_id: 1,
        accepted_type: 0,
        created_at: Date.now(),
        raising_state: 2,
        room_sequence: 1,
        host_entry_time: 1,
        mates: [],
        share_room_options: 0,
        is_npc_mode: false,
        npc_count: 0,
        expected_real_viewer_ids: [],
        member_viewer_ids: [],
        member_player_ids: {},
        lobby_generation: 0,
        rematch_wait_started_at: null,
        settlement_return_pending: false,
        lifecycle: coordinator.createLifecycle(),
    }
}

async function main() {
    const coordinator = new EmbeddedMultiCoordinator()
    const value = room(coordinator)

    const staleFinish = coordinator.beginSettlementReturn(value, 0)
    assert.equal(staleFinish.ok, false, "a lobby cannot jump directly to settlement return")

    const start = coordinator.commitBattleStart(value)
    assert.equal(start.ok, true)
    assert.equal(start.previousGeneration, 0)
    assert.equal(value.lifecycle.phase, "BATTLE")
    assert.equal(value.lobby_generation, 1)
    assert.equal(value.raising_state, 4)
    assert.equal(value.lifecycle.battleSessionId, `${value.lifecycle.instanceId}:1:1:2`)

    const duplicateStart = coordinator.commitBattleStart(value)
    assert.deepEqual(duplicateStart, { ok: false, reason: "INVALID_TRANSITION" })
    assert.equal(value.lobby_generation, 1, "duplicate StartBattle must not create a new generation")

    const staleGeneration = coordinator.beginSettlementReturn(value, 0)
    assert.deepEqual(staleGeneration, { ok: false, reason: "STALE_GENERATION" })
    assert.equal(value.lifecycle.phase, "BATTLE")

    const returning = coordinator.beginSettlementReturn(value, 1)
    assert.equal(returning.ok, true)
    assert.equal(value.lifecycle.phase, "RETURNING")
    assert.equal(value.raising_state, 1)
    assert.equal(value.settlement_return_pending, true)

    const returnVersion = value.lifecycle.version
    assert.equal(coordinator.beginSettlementReturn(value, 1).ok, true)
    assert.equal(value.lifecycle.version, returnVersion, "duplicate finish must not advance lifecycle")

    const lobby = coordinator.completeSettlementReturn(value)
    assert.equal(lobby.ok, true)
    assert.equal(value.lifecycle.phase, "LOBBY")
    assert.equal(value.settlement_return_pending, false)
    assert.equal(value.lifecycle.battleSessionId, null)

    const disbanded = coordinator.commitDisband(value, "test")
    assert.equal(disbanded.ok, true)
    assert.equal(value.lifecycle.phase, "DISBANDED")
    assert.deepEqual(coordinator.commitBattleStart(value), { ok: false, reason: "ROOM_DISBANDED" })

    const order = []
    let releaseFirst
    const firstGate = new Promise(resolve => { releaseFirst = resolve })
    const first = coordinator.enqueueRoomCommand("serialized", async () => {
        order.push("first:start")
        await firstGate
        order.push("first:end")
    })
    const second = coordinator.enqueueRoomCommand("serialized", () => {
        order.push("second")
    })
    await Promise.resolve()
    assert.deepEqual(order, ["first:start"])
    releaseFirst()
    await Promise.all([first, second])
    assert.deepEqual(order, ["first:start", "first:end", "second"])

    console.log("multi room lifecycle coordinator test passed")
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
