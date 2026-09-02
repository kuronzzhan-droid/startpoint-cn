import assert from "node:assert/strict"
import { after, test } from "node:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type * as net from "node:net"


const databaseDir = mkdtempSync(path.join(tmpdir(), "wf-five-boss-protocol-"))
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


function fakeSocket(remoteAddress: string | null = "127.0.0.1") {
    const writes: string[] = []
    let ended = false
    const socket = {
        writable: true,
        destroyed: false,
        remoteAddress: remoteAddress ?? undefined,
        write(chunk: string) {
            writes.push(String(chunk))
            return true
        },
        end() { ended = true },
    } as unknown as net.Socket
    return { socket, writes, get ended() { return ended } }
}


function proofRow(runId: string, playerId: number) {
    return getDb().prepare(`
        SELECT level_next_at AS levelNextAt, finalized_at AS finalizedAt
        FROM five_boss_gauntlet_members
        WHERE run_id = ? AND player_id = ?
    `).get(runId, playerId) as {
        levelNextAt: string | null
        finalizedAt: string | null
    }
}


after(() => {
    getDb().close()
    delete process.env.WF_DATABASE_DIR
    const resolved = path.resolve(databaseDir)
    const safeBase = path.resolve(tmpdir())
    assert.ok(resolved.startsWith(`${safeBase}${path.sep}`))
    assert.ok(path.basename(resolved).startsWith("wf-five-boss-protocol-"))
    rmSync(resolved, { recursive: true, force: true })
})


test("BothBoss TCP level-next and finalize form an ordered per-member settlement proof", async () => {
    const account = accountDomain.insertAccountSync({
        appId: "five-boss-protocol",
        idpAlias: "test",
        idpCode: "test",
        idpId: "five-boss-protocol",
        status: "active",
    })
    const playerId = playerDomain.insertDefaultPlayerSync(account.id).id
    const viewerId = 880_000_001
    const connectionId = "five-boss-protocol-connection"
    const runId = "five-boss-protocol-run"
    itemDomain.setPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET.ticketItemId, 1)

    const room = createRoom(
        viewerId,
        playerId,
        1,
        FIVE_BOSS_GAUNTLET.category,
        FIVE_BOSS_GAUNTLET.visibleQuestId,
        0,
        1,
    )
    room.raising_state = 4
    room.mates = [{ viewer_id: viewerId, com_id: 0, player_id: playerId }]
    room.five_boss_runtime = {
        runId,
        expectedRealPlayerIds: [playerId],
        autoplayModeByPlayerId: { [String(playerId)]: false },
        battleIdentityByConnectionId: {
            [connectionId]: { viewerId, playerId, remoteAddress: "127.0.0.1" },
        },
    }
    runDomain.startMemberSync({
        runId,
        hostPlayerId: playerId,
        routeId: FIVE_BOSS_GAUNTLET.routeId,
        roomNumber: room.room_number,
        ticketItemId: FIVE_BOSS_GAUNTLET.ticketItemId,
        rosterPlayerIds: [playerId],
        playerId,
        clientPlayId: "five-boss-protocol-play",
        isAutoMode: false,
    }, () => undefined)

    const lobby = fakeSocket()
    const lobbyClient = sessionManager.createClient(
        lobby.socket,
        viewerId,
        room.room_number,
        connectionId,
        playerId,
    )
    sessionManager.addClientToRoom(lobbyClient)

    const battle = fakeSocket()
    await handleHandshake(battle.socket, {
        socklet: "cooperation_battle",
        room_number: room.room_number,
        connection_id: connectionId,
    })
    battle.writes.length = 0
    sessionManager.setBattleExpectedCount(room.room_number, 1, true)

    handleBattleMessage(battle.socket, [0, [0]])
    assert.ok(battle.writes.some(write => write.includes("[1,[1]]")))

    battle.writes.length = 0
    handleBattleMessage(battle.socket, [0, [1]])
    assert.equal(battle.writes.some(write => write.includes("[1,[2]]")), false)
    assert.ok(proofRow(runId, playerId).levelNextAt)
    assert.equal(proofRow(runId, playerId).finalizedAt, null)

    handleBattleMessage(battle.socket, [0, [0]])
    assert.ok(battle.writes.some(write => write.includes("[1,[1]]")))

    battle.writes.length = 0
    handleBattleMessage(battle.socket, [0, [2]])
    assert.ok(battle.writes.some(write => write.includes("[1,[2]]")))
    assert.ok(proofRow(runId, playerId).finalizedAt)

    const settlement = runDomain.settleMemberSync(
        { playerId, clientPlayId: "five-boss-protocol-play" },
        () => ({ allowed: true }),
    )
    assert.equal(settlement.status, "settled")

    sessionManager.removeBattleClient(connectionId)
    sessionManager.removeClient(lobbyClient)
    disbandRoom(room.room_number)
})

test("five-boss battle handshake rejects a live duplicate without replacing the original socket", async () => {
    const viewerId = 880_000_002
    const playerId = 980_000_002
    const connectionId = "five-boss-duplicate-connection"
    const room = createRoom(
        viewerId,
        playerId,
        1,
        FIVE_BOSS_GAUNTLET.category,
        FIVE_BOSS_GAUNTLET.visibleQuestId,
        0,
        1,
    )
    room.raising_state = 4
    room.five_boss_runtime = {
        runId: "five-boss-duplicate-run",
        expectedRealPlayerIds: [playerId],
        autoplayModeByPlayerId: { [String(playerId)]: false },
        battleIdentityByConnectionId: {
            [connectionId]: { viewerId, playerId, remoteAddress: "10.0.0.2" },
        },
    }

    const first = fakeSocket("10.0.0.2")
    await handleHandshake(first.socket, {
        socklet: "cooperation_battle",
        room_number: room.room_number,
        connection_id: connectionId,
    })
    assert.equal(sessionManager.getBattleClient(connectionId)?.socket, first.socket)

    const duplicate = fakeSocket("10.0.0.2")
    await handleHandshake(duplicate.socket, {
        socklet: "cooperation_battle",
        room_number: room.room_number,
        connection_id: connectionId,
    })
    assert.equal(duplicate.ended, true)
    assert.ok(duplicate.writes.some(write => write.includes("HANDSHAKE_DENIED")))
    assert.equal(sessionManager.getBattleClient(connectionId)?.socket, first.socket)

    sessionManager.removeBattleClient(connectionId)
    disbandRoom(room.room_number)
})

test("five-boss frozen identity survives lobby loss and rejects unknown or cross-address claims", async () => {
    const viewerId = 880_000_003
    const playerId = 980_000_003
    const connectionId = "five-boss-frozen-identity"
    const room = createRoom(
        viewerId,
        playerId,
        1,
        FIVE_BOSS_GAUNTLET.category,
        FIVE_BOSS_GAUNTLET.visibleQuestId,
        0,
        1,
    )
    room.raising_state = 4
    room.five_boss_runtime = {
        runId: "five-boss-frozen-identity-run",
        expectedRealPlayerIds: [playerId],
        autoplayModeByPlayerId: { [String(playerId)]: false },
        battleIdentityByConnectionId: {
            [connectionId]: { viewerId, playerId, remoteAddress: "10.0.0.3" },
        },
    }

    const wrongAddress = fakeSocket("10.0.0.99")
    await handleHandshake(wrongAddress.socket, {
        socklet: "cooperation_battle",
        room_number: room.room_number,
        connection_id: connectionId,
    })
    assert.equal(wrongAddress.ended, true)

    const missingAddress = fakeSocket(null)
    await handleHandshake(missingAddress.socket, {
        socklet: "cooperation_battle",
        room_number: room.room_number,
        connection_id: connectionId,
    })
    assert.equal(missingAddress.ended, true)

    const unknown = fakeSocket("10.0.0.3")
    await handleHandshake(unknown.socket, {
        socklet: "cooperation_battle",
        room_number: room.room_number,
        connection_id: "not-frozen",
    })
    assert.equal(unknown.ended, true)

    const recovered = fakeSocket("10.0.0.3")
    await handleHandshake(recovered.socket, {
        socklet: "cooperation_battle",
        room_number: room.room_number,
        connection_id: connectionId,
    })
    assert.equal(recovered.ended, false)
    assert.equal(sessionManager.getBattleClient(connectionId)?.viewerId, viewerId)
    assert.equal(sessionManager.getBattleClient(connectionId)?.playerId, playerId)

    sessionManager.removeBattleClient(connectionId)
    disbandRoom(room.room_number)
})

test("a late battle reconnect receives the already-open second-scene start exactly once", () => {
    const roomNumber = "five-boss-reconnect-room"
    const first = fakeSocket()
    const second = fakeSocket()
    const firstClient = sessionManager.createClient(first.socket, 1, roomNumber, "reconnect-a", 1)
    const secondClient = sessionManager.createClient(second.socket, 2, roomNumber, "reconnect-b", 2)
    firstClient.isBattle = true
    secondClient.isBattle = true
    assert.equal(sessionManager.addBattleClient(firstClient.connectionId, firstClient), true)
    assert.equal(sessionManager.addBattleClient(secondClient.connectionId, secondClient), true)
    sessionManager.setBattleExpectedCount(roomNumber, 2, true)

    handleBattleMessage(first.socket, [0, [0]])
    handleBattleMessage(second.socket, [0, [0]])
    handleBattleMessage(first.socket, [0, [1]])
    handleBattleMessage(second.socket, [0, [1]])
    first.writes.length = 0
    second.writes.length = 0

    handleBattleMessage(first.socket, [0, [0]])
    sessionManager.removeClient(secondClient)
    assert.ok(first.writes.some(write => write.includes("[1,[1]]")))

    const reconnected = fakeSocket()
    const reconnectedClient = sessionManager.createClient(
        reconnected.socket,
        2,
        roomNumber,
        "reconnect-b",
        2,
    )
    reconnectedClient.isBattle = true
    assert.equal(sessionManager.addBattleClient(reconnectedClient.connectionId, reconnectedClient), true)
    handleBattleMessage(reconnected.socket, [0, [0]])
    handleBattleMessage(reconnected.socket, [0, [0]])
    assert.equal(
        reconnected.writes.filter(write => write.includes("[1,[1]]")).length,
        1,
    )

    sessionManager.removeBattleClient(firstClient.connectionId)
    sessionManager.removeBattleClient(reconnectedClient.connectionId)
    sessionManager.clearBattleExpectedCount(roomNumber)
})

test("a stale socket close cannot remove its replacement or the matching lobby client", () => {
    const roomNumber = "five-boss-cas-room"
    const connectionId = "five-boss-cas-connection"
    const lobby = fakeSocket()
    const lobbyClient = sessionManager.createClient(lobby.socket, 77, roomNumber, connectionId, 88)
    sessionManager.addClientToRoom(lobbyClient)

    const stale = fakeSocket()
    const staleClient = sessionManager.createClient(stale.socket, 77, roomNumber, connectionId, 88)
    staleClient.isBattle = true
    assert.equal(sessionManager.addBattleClient(connectionId, staleClient), true)
    Object.assign(stale.socket, { writable: false, destroyed: true })

    const replacement = fakeSocket()
    const replacementClient = sessionManager.createClient(
        replacement.socket,
        77,
        roomNumber,
        connectionId,
        88,
    )
    replacementClient.isBattle = true
    assert.equal(sessionManager.addBattleClient(connectionId, replacementClient), true)
    sessionManager.removeClient(staleClient)

    assert.equal(sessionManager.getBattleClient(connectionId), replacementClient)
    assert.equal(sessionManager.getClient(77, roomNumber), lobbyClient)

    sessionManager.removeBattleClient(connectionId)
    sessionManager.removeClient(lobbyClient)
})

test("ordinary rooms keep replacement semantics while strict room state is cleared on removal", () => {
    const ordinaryRoom = "ordinary-replacement-room"
    const connectionId = "ordinary-replacement-connection"
    const first = fakeSocket()
    const firstClient = sessionManager.createClient(first.socket, 1, ordinaryRoom, connectionId, 1)
    firstClient.isBattle = true
    assert.equal(sessionManager.addBattleClient(connectionId, firstClient), true)

    const replacement = fakeSocket()
    const replacementClient = sessionManager.createClient(
        replacement.socket,
        1,
        ordinaryRoom,
        connectionId,
        1,
    )
    replacementClient.isBattle = true
    assert.equal(sessionManager.addBattleClient(connectionId, replacementClient), true)
    assert.equal(sessionManager.getBattleClient(connectionId), replacementClient)
    sessionManager.removeBattleClient(connectionId)

    const reusedRoom = "strict-room-cleanup"
    const strict = fakeSocket()
    const strictClient = sessionManager.createClient(strict.socket, 2, reusedRoom, "strict-cid", 2)
    strictClient.isBattle = true
    assert.equal(sessionManager.addBattleClient(strictClient.connectionId, strictClient, true), true)
    sessionManager.setBattleExpectedCount(reusedRoom, 1, true)
    assert.equal(sessionManager.markSceneReady(strictClient.connectionId, reusedRoom), true)
    sessionManager.removeRoomState(reusedRoom)
    assert.equal(sessionManager.claimBattleStartReplay(strictClient.connectionId, reusedRoom), false)
    sessionManager.removeBattleClient(strictClient.connectionId)
})

