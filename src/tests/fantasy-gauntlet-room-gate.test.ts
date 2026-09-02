import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import type { PlayerRushEventPlayedParty } from "../data/types"
import type { MultiRoom } from "../lib/types/multi"


const databaseDir = mkdtempSync(path.join(tmpdir(), "wf-fantasy-room-gate-"))
process.env.WF_DATABASE_DIR = databaseDir

const accountDomain = require("../data/domains/account") as typeof import("../data/domains/account")
const playerDomain = require("../data/domains/player") as typeof import("../data/domains/player")
const rushDomain = require("../data/domains/rushEvent") as typeof import("../data/domains/rushEvent")
const { RushEventBattleType } = require("../data/types") as typeof import("../data/types")
const { QuestCategory } = require("../lib/types") as typeof import("../lib/types")
const { FANTASY_GAUNTLET } = require("../lib/fantasy-gauntlet") as
    typeof import("../lib/fantasy-gauntlet")
const roomGate = require("../multi/fantasy-room-gate") as
    typeof import("../multi/fantasy-room-gate")

const { getFantasyHostRoomGate, isFantasyRoomClosed } = roomGate

let identity = 0


function createPlayer(): number {
    identity += 1
    const account = accountDomain.insertAccountSync({
        appId: `fantasy-room-gate-test-${identity}`,
        idpAlias: "test",
        idpCode: "test",
        idpId: `fantasy-room-gate-test-${identity}`,
        status: "active",
    })
    return playerDomain.insertDefaultPlayerSync(account.id).id
}


function markStagesCleared(playerId: number, upToStage: number): void {
    for (let stage = 1; stage <= upToStage; stage += 1) {
        const party: PlayerRushEventPlayedParty = {
            characterIds: [1001, 1002, 1003],
            unisonCharacterIds: [null, null, null],
            equipmentIds: [null, null, null],
            abilitySoulIds: [null, null, null],
            evolutionImgLevels: [0, 0, 0],
            unisonEvolutionImgLevels: [null, null, null],
            round: FANTASY_GAUNTLET.rushEventId * 1000 + stage,
            battleType: RushEventBattleType.FOLDER,
        }
        rushDomain.insertPlayerRushEventPlayedPartySync(
            playerId,
            FANTASY_GAUNTLET.rushEventId,
            party,
        )
    }
}


function room(
    hostPlayerId: number,
    category: number,
    questId: number,
): Pick<MultiRoom, "host_player_id" | "category" | "quest_id"> {
    return {
        host_player_id: hostPlayerId,
        category: category as MultiRoom["category"],
        quest_id: questId,
    }
}


test("a fantasy room stays open while its host is still on that boss stage", () => {
    const hostId = createPlayer()
    markStagesCleared(hostId, 4)

    const stageFiveRoom = room(hostId, QuestCategory.ADVENT_EVENT_SINGLE, 300098001)
    const gate = getFantasyHostRoomGate(stageFiveRoom)
    assert.equal(gate?.stage, 5)
    assert.equal(gate?.expectedStage, 5)
    assert.equal(gate?.allowed, true)
    assert.equal(isFantasyRoomClosed(stageFiveRoom), false)
})


test("a fantasy room closes the moment its host advances past that stage", () => {
    const hostId = createPlayer()
    markStagesCleared(hostId, 5)

    const stageFiveRoom = room(hostId, QuestCategory.ADVENT_EVENT_SINGLE, 300098001)
    assert.equal(getFantasyHostRoomGate(stageFiveRoom)?.allowed, false)
    assert.equal(isFantasyRoomClosed(stageFiveRoom), true)

    // 房主已经推进到第 6 关,第 10 关的房仍旧不该开(顺序门只放当前那一关)。
    assert.equal(isFantasyRoomClosed(room(hostId, QuestCategory.ADVENT_EVENT_SINGLE, 300098002)), true)
})


test("the CN client's category 7 and the enum's category 8 both reach the gate", () => {
    const hostId = createPlayer()
    markStagesCleared(hostId, 9)

    for (const category of [
        QuestCategory.ADVENT_EVENT_SINGLE,
        QuestCategory.ADVENT_EVENT_MULTI,
    ]) {
        assert.equal(isFantasyRoomClosed(room(hostId, category, 300098002)), false)
        assert.equal(isFantasyRoomClosed(room(hostId, category, 300098003)), true)
    }
})


test("rooms that are not fantasy rooms are never judged by this gate", () => {
    const hostId = createPlayer()
    markStagesCleared(hostId, 5)

    for (const other of [
        room(hostId, QuestCategory.BOSS_BATTLE, 1099001),
        room(hostId, QuestCategory.RUSH_EVENT, 700099001),
        room(hostId, QuestCategory.ADVENT_EVENT_SINGLE, 300099001),
        room(hostId, QuestCategory.MAIN, 300098001),
    ]) {
        assert.equal(getFantasyHostRoomGate(other), null)
        assert.equal(isFantasyRoomClosed(other), false)
    }
})


test("the kill switch closes the runtime without closing anybody's room", () => {
    const hostId = createPlayer()
    markStagesCleared(hostId, 5)
    const stageFiveRoom = room(hostId, QuestCategory.ADVENT_EVENT_SINGLE, 300098001)
    assert.equal(isFantasyRoomClosed(stageFiveRoom), true)

    const previous = process.env.WF_FANTASY_GAUNTLET
    process.env.WF_FANTASY_GAUNTLET = "0"
    try {
        assert.equal(getFantasyHostRoomGate(stageFiveRoom), null)
        assert.equal(isFantasyRoomClosed(stageFiveRoom), false)
    } finally {
        if (previous === undefined) delete process.env.WF_FANTASY_GAUNTLET
        else process.env.WF_FANTASY_GAUNTLET = previous
    }
})
