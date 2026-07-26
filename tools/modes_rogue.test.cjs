"use strict"

const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")

const MODULE_PATH = path.resolve(__dirname, "../modes-src/rogue/rogue.mjs")
const MANIFEST_PATH = path.resolve(__dirname, "../modes-src/rogue/mode-manifest.json")

async function loadRogue() {
    const imported = await import(require("node:url").pathToFileURL(MODULE_PATH).href)
    return imported.register
}

function makeHost({ config, maxLevel = 5 } = {}) {
    const calls = { equipmentUpdates: [], expGrants: [] }
    return {
        host: {
            table(name) {
                if (name !== "rogue_event.json") throw new Error(`unexpected table: ${name}`)
                if (config === undefined) throw new Error("table missing")
                return config
            },
            log() {},
            server: {
                getCharacterElement: id => (id === 1 ? 0 : 1),
                getEquipmentMaxLevel: () => maxLevel,
                updatePlayerEquipment: (playerId, equipmentId, patch) => {
                    calls.equipmentUpdates.push({ playerId, equipmentId, patch })
                },
                givePlayerCharactersExp: (playerId, ids, amount) => {
                    calls.expGrants.push({ playerId, ids, amount })
                },
            },
        },
        calls,
    }
}

function baseParams(overrides = {}) {
    return {
        questCategory: 18,
        questAccomplished: true,
        playerId: 7,
        questData: { rushEventId: 700099, rushEventFolderId: 1, rushEventRound: 2 },
        folderMaxRounds: { 1: 2 },
        party: { characters: [{ id: 1 }], unison_characters: [] },
        giveRewards: () => ({
            equipment_list: [{ equipment_id: 100001, level: 0 }],
            character_list: [{ character_id: 119999 }],
        }),
        transaction: operation => operation(),
        ...overrides,
    }
}

test("rogue module stays inert without an activation table", async () => {
    const register = await loadRogue()
    const { host } = makeHost({ config: undefined })
    const mode = register(host)
    assert.equal(mode.capability, "rogue-settlement@1")
    assert.equal(mode.onRushFinish(baseParams(), host), null)
})

test("rogue module stays inert when the table is disabled or lacks the event", async () => {
    const register = await loadRogue()
    for (const config of [{ enabled: false, events: {} }, { enabled: true, events: {} }]) {
        const { host } = makeHost({ config })
        assert.equal(register(host).onRushFinish(baseParams(), host), null)
    }
})

test("rogue module grants drops, clamps evolution level and reports rewards", async () => {
    const register = await loadRogue()
    const { host, calls } = makeHost({
        maxLevel: 3,
        config: {
            enabled: true,
            events: {
                "700099": {
                    per_round_drops: [{ type: "equipment", id: 100001, count: 1 }],
                    drop_equipment_level: 5,
                    drop_character_exp: 1000,
                },
            },
        },
    })
    const result = register(host).onRushFinish(baseParams(), host)
    assert.deepEqual(result, {
        rush_battle_reward_list: [{ kind: 6, kind_id: 100001, number: 1 }],
    })
    assert.deepEqual(calls.equipmentUpdates, [
        { playerId: 7, equipmentId: 100001, patch: { level: 3 } },
    ])
    assert.deepEqual(calls.expGrants, [{ playerId: 7, ids: [119999], amount: 1000 }])
})

test("rogue module hides rewards on non-final folder rounds", async () => {
    const register = await loadRogue()
    const { host } = makeHost({
        config: {
            enabled: true,
            events: { "700099": { per_round_drops: [{ type: "item", id: 5, count: 2 }] } },
        },
    })
    const params = baseParams({
        questData: { rushEventId: 700099, rushEventFolderId: 1, rushEventRound: 1 },
        folderMaxRounds: { 1: 2 },
    })
    assert.equal(register(host).onRushFinish(params, host), null)
})

test("rogue module releases the character lock when configured", async () => {
    const register = await loadRogue()
    const { host } = makeHost({
        config: { enabled: true, events: { "700099": { unlock_played_parties: true } } },
    })
    const party = {
        character_id_1: 111, character_id_2: 222, character_id_3: 333,
        unison_character_id_1: 444, unison_character_id_2: null, unison_character_id_3: null,
        evolution_img_level_1: 5, evolution_img_level_2: null, evolution_img_level_3: null,
        unison_evolution_img_level_1: 3, unison_evolution_img_level_2: null,
        unison_evolution_img_level_3: null,
        round: 1,
    }
    const context = {
        playerId: 7, eventId: 700099,
        folderParties: { 1: party }, endlessParties: {},
    }
    register(host).onRushPartiesSerialized(context, host)
    for (const field of Object.keys(party)) {
        if (field === "round") continue
        assert.equal(party[field], null, `${field} must be cleared`)
    }
    // 条目本身保留:客户端轮次进度 = 列表长度 + 1
    assert.deepEqual(Object.keys(context.folderParties), ["1"])
    assert.equal(party.round, 1)
})

test("rogue module leaves parties untouched without the unlock flag", async () => {
    const register = await loadRogue()
    for (const config of [
        { enabled: true, events: { "700099": {} } },
        { enabled: false, events: { "700099": { unlock_played_parties: true } } },
    ]) {
        const { host } = makeHost({ config })
        const party = { character_id_1: 111 }
        register(host).onRushPartiesSerialized(
            { playerId: 7, eventId: 700099, folderParties: { 1: party }, endlessParties: {} },
            host,
        )
        assert.equal(party.character_id_1, 111)
    }
})

test("mode manifest hash matches the module file", () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"))
    const digest = crypto.createHash("sha256")
        .update(fs.readFileSync(MODULE_PATH))
        .digest("hex")
    assert.equal(manifest.sha256, digest)
    assert.equal(manifest.capability, "rogue-settlement@1")
})
