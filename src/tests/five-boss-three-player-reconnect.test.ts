import assert from "node:assert/strict"
import { after, test } from "node:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type * as net from "node:net"


const databaseDir = mkdtempSync(path.join(tmpdir(), "wf-five-boss-three-player-"))
process.env.WF_DATABASE_DIR = databaseDir

const accountDomain = require("../data/domains/account") as typeof import("../data/domains/account")
const playerDomain = require("../data/domains/player") as typeof import("../data/domains/player")
const itemDomain = require("../data/domains/item") as typeof import("../data/domains/item")
const runDomain = require("../data/domains/fiveBossGauntletRun") as typeof import("../data/domains/fiveBossGauntletRun")
const { getDb } = require("../data/db") as typeof import("../data/db")
const { FIVE_BOSS_GAUNTLET } = require("../multi/five-boss/contract") as typeof import("../multi/five-boss/contract")
const { createRoom, disbandRoom } = require("../multi/room/manager") as typeof import("../multi/room/manager")
const { sessionManager } = require("../multi/state/SessionManager") as typeof import("../multi/state/SessionManager")
const { handleHandshake } = require("../multi/tcp/handshake") as typeof import("../multi/tcp/handshake")
const { handleBattleMessage } = require("../multi/tcp/battle") as typeof import("../multi/tcp/battle")


function fakeSocket(remoteAddress: string) {
    const writes: string[] = []
    const socket = {
        writable: true,
        destroyed: false,
        remoteAddress,
        write(chunk: string) {
            writes.push(String(chunk))
            return true
        },
        end() {
            Object.assign(socket, { writable: false, destroyed: true })
        },
    } as unknown as net.Socket
    return { socket, writes }
}


function insertPlayer(index: number): number {
    const identity = `five-boss-three-player-${index}`
    const account = accountDomain.insertAccountSync({
        appId: identity,
        idpAlias: "test",
        idpCode: "test",
        idpId: identity,
        status: "active",
    })
    return playerDomain.insertDefaultPlayerSync(account.id).id
}


function proofCount(runId: string): number {
    return (getDb().prepare(`
        SELECT COUNT(*) AS count
        FROM five_boss_gauntlet_members
        WHERE run_id = ? AND level_next_at IS NOT NULL AND finalized_at IS NOT NULL
    `).get(runId) as { count: number }).count
}


after(() => {
    getDb().close()
    delete process.env.WF_DATABASE_DIR
    const resolved = path.resolve(databaseDir)
    const safeBase = path.resolve(tmpdir())
    assert.ok(resolved.startsWith(`${safeBase}${path.sep}`))
    assert.ok(path.basename(resolved).startsWith("wf-five-boss-three-player-"))
    rmSync(resolved, { recursive: true, force: true })
})


test("three real players can cross both scenes, reconnect late, and settle one shared run", async () => {
    const playerIds = [insertPlayer(1), insertPlayer(2), insertPlayer(3)]
    const viewerIds = [881_000_001, 881_000_002, 881_000_003]
    const connectionIds = ["five-boss-three-a", "five-boss-three-b", "five-boss-three-c"]
    const remoteAddresses = ["10.1.0.1", "10.1.0.2", "10.1.0.3"]
    const clientPlayIds = ["five-boss-play-a", "five-boss-play-b", "five-boss-play-c"]
    const runId = "five-boss-three-player-run"
    itemDomain.setPlayerItemSync(playerIds[0], FIVE_BOSS_GAUNTLET.ticketItemId, 1)

    const room = createRoom(
        viewerIds[0],
        playerIds[0],
        1,
        FIVE_BOSS_GAUNTLET.category,
        FIVE_BOSS_GAUNTLET.visibleQuestId,
        0,
        1,
    )
    room.raising_state = 4
    room.mates = playerIds.map((playerId, index) => ({
        viewer_id: viewerIds[index],
        com_id: 0,
        player_id: playerId,
    }))
    room.five_boss_runtime = {
        runId,
        expectedRealPlayerIds: playerIds,
        autoplayModeByPlayerId: Object.fromEntries(
            playerIds.map(playerId => [String(playerId), false]),
        ),
        battleIdentityByConnectionId: Object.fromEntries(
            connectionIds.map((connectionId, index) => [connectionId, {
                viewerId: viewerIds[index],
                playerId: playerIds[index],
                remoteAddress: remoteAddresses[index],
            }]),
        ),
    }

    for (let index = 0; index < playerIds.length; index++) {
        runDomain.startMemberSync({
            runId,
            hostPlayerId: playerIds[0],
            routeId: FIVE_BOSS_GAUNTLET.routeId,
            roomNumber: room.room_number,
            ticketItemId: FIVE_BOSS_GAUNTLET.ticketItemId,
            rosterPlayerIds: playerIds,
            playerId: playerIds[index],
            clientPlayId: clientPlayIds[index],
            isAutoMode: false,
        }, () => undefined)
    }

    const battleSockets = remoteAddresses.map(fakeSocket)
    for (let index = 0; index < battleSockets.length; index++) {
        await handleHandshake(battleSockets[index].socket, {
            socklet: "cooperation_battle",
            room_number: room.room_number,
            connection_id: connectionIds[index],
        })
    }
    sessionManager.setBattleExpectedCount(room.room_number, 3, true)

    for (const battle of battleSockets) handleBattleMessage(battle.socket, [0, [0]])
    assert.ok(battleSockets.every(battle => battle.writes.some(write => write.includes("[1,[1]]"))))

    for (const battle of battleSockets) handleBattleMessage(battle.socket, [0, [1]])
    assert.equal(proofCount(runId), 0)
    for (const battle of battleSockets) battle.writes.length = 0

    handleBattleMessage(battleSockets[0].socket, [0, [0]])
    handleBattleMessage(battleSockets[1].socket, [0, [0]])
    const disconnected = sessionManager.getBattleClient(connectionIds[2])
    assert.ok(disconnected)
    sessionManager.removeBattleClient(connectionIds[2], disconnected)
    assert.ok(battleSockets[0].writes.some(write => write.includes("[1,[1]]")))
    assert.ok(battleSockets[1].writes.some(write => write.includes("[1,[1]]")))

    const reconnected = fakeSocket(remoteAddresses[2])
    await handleHandshake(reconnected.socket, {
        socklet: "cooperation_battle",
        room_number: room.room_number,
        connection_id: connectionIds[2],
    })
    handleBattleMessage(reconnected.socket, [0, [0]])
    handleBattleMessage(reconnected.socket, [0, [0]])
    assert.equal(
        reconnected.writes.filter(write => write.includes("[1,[1]]")).length,
        1,
    )

    handleBattleMessage(battleSockets[0].socket, [0, [2]])
    handleBattleMessage(battleSockets[1].socket, [0, [2]])
    handleBattleMessage(reconnected.socket, [0, [2]])
    assert.equal(proofCount(runId), 3)

    const settlements = playerIds.map((playerId, index) => runDomain.settleMemberSync(
        { playerId, clientPlayId: clientPlayIds[index] },
        context => ({ multiplier: context.rewardMultiplier }),
    ))
    assert.deepEqual(settlements.map(result => result.rewardMultiplier), [2, 2, 2])
    assert.deepEqual(settlements.map(result => result.run.status), ["active", "active", "settled"])

    for (const connectionId of connectionIds) sessionManager.removeBattleClient(connectionId)
    disbandRoom(room.room_number)
})

