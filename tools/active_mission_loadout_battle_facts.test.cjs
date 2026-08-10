require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wave2a-12-loadout-"))
const previousDatabaseDirectory = process.env.WF_DATABASE_DIR
const worktreeDatabase = path.resolve(__dirname, "..", ".database")
let database
let provider
let savedDescriptor

function row({ pattern = 89, battleKind = 3, characterElement = 1, equipmentElement = "(None)" } = {}) {
    const result = Array(73).fill("(None)")
    result[29] = String(pattern)
    result[32] = String(battleKind)
    result[69] = String(characterElement)
    result[70] = String(equipmentElement)
    return result
}

function definition(missionId, options) {
    return { missionId, row: row(options) }
}

function definitions() {
    return [
        definition(20014, { characterElement: 3, equipmentElement: 3 }),
        definition(20011, { characterElement: 1 }),
        definition(20013, { characterElement: 3 }),
        definition(20012, { characterElement: 1, equipmentElement: 1 }),
    ]
}

function context(overrides = {}) {
    return {
        questAccomplished: true,
        isMulti: true,
        questCategory: 14,
        questId: 1001,
        partyCharacterIds: [1, 131001],
        equipmentElements: [0, 2],
        ...overrides,
    }
}

function characters(overrides = {}) {
    return { "1": { element: 0 }, "131001": { element: 2 }, ...overrides }
}

function insertPlayer(playerId) {
    database.prepare(`INSERT INTO accounts (
        id, app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status
    ) VALUES (?, 'wf_cn', '2025-01-01', '', 'test', ?, '2025-01-01', '2025-01-01', 'normal')`)
        .run(playerId, `wave2a-12-loadout-${playerId}`)
    database.prepare(`INSERT INTO players (
        id, stamina, stamina_heal_time, boost_point, boss_boost_point, transition_state, role, name,
        last_login_time, comment, vmoney, free_vmoney, rank_point, star_crumb, bond_token, exp_pool,
        exp_pooled_time, leader_character_id, party_slot, degree_id, birth, free_mana, paid_mana,
        enable_auto_3x, account_id
    ) VALUES (?, 0, 0, 0, 0, 0, 0, 'tester', '2025-01-01', '', 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, ?)`)
        .run(playerId, playerId)
}

function facts(playerId) {
    return database.prepare(`SELECT mission_id, progress FROM players_active_mission_battle_facts
        WHERE player_id = ? ORDER BY mission_id`).all(playerId)
}

function repository(missionTable, characterTable = { "1": { element: 0 }, "131001": { element: 2 } }) {
    const calls = []
    const value = {
        calls,
        info: () => ({ source: "bundled", assetVersion: "test", generatorVersion: 1, releaseDigest: null }),
        table: name => {
            calls.push(name)
            if (name === "mission_active.json") return missionTable
            if (name === "character.json") return characterTable
            throw new Error(`unexpected table ${name}`)
        },
    }
    return value
}

function missionTable(source = definitions()) {
    return Object.fromEntries(source.map(item => [item.missionId, [item.row]]))
}

function finishContext(playerId, overrides = {}) {
    return {
        playerId,
        questAccomplished: true,
        isMulti: true,
        questCategory: 14,
        questId: 1001,
        equipmentElements: [0, 2],
        party: { characters: [{ id: 1 }, { id: 131001 }], unison_characters: [] },
        ...overrides,
    }
}

try {
    process.env.WF_DATABASE_DIR = temporaryRoot
    const loadout = require("../src/lib/mission/active-loadout-battle-facts")
    const { getDb } = require("../src/data/db")
    database = getDb()
    const main = database.pragma("database_list").find(entry => entry.name === "main")
    assert.equal(path.dirname(path.resolve(main.file)), path.resolve(temporaryRoot))
    assert.equal(database.pragma("foreign_keys", { simple: true }), 1)
    for (let playerId = 1; playerId <= 5; playerId += 1) insertPlayer(playerId)

    assert.deepEqual(loadout.collectActiveMissionLoadoutBattleFacts(definitions(), context(), characters()), [
        { missionId: 20011 }, { missionId: 20012 }, { missionId: 20013 }, { missionId: 20014 },
    ])
    assert.deepEqual(loadout.collectActiveMissionLoadoutBattleFacts(definitions(), context({ equipmentElements: undefined }), characters()), [
        { missionId: 20011 }, { missionId: 20013 },
    ])
    assert.deepEqual(loadout.collectActiveMissionLoadoutBattleFacts(definitions(), context({ equipmentElements: [] }), characters()), [
        { missionId: 20011 }, { missionId: 20013 },
    ])
    assert.deepEqual(loadout.collectActiveMissionLoadoutBattleFacts(definitions(), context({ equipmentElements: [2, 0, 2] }), characters()), [
        { missionId: 20011 }, { missionId: 20012 }, { missionId: 20013 }, { missionId: 20014 },
    ])
    assert.deepEqual(loadout.collectActiveMissionLoadoutBattleFacts(definitions(), context({ partyCharacterIds: [131001, 1, 1] }), characters()), [
        { missionId: 20011 }, { missionId: 20012 }, { missionId: 20013 }, { missionId: 20014 },
    ])
    assert.deepEqual(loadout.collectActiveMissionLoadoutBattleFacts(definitions(), context({ partyCharacterIds: [999001, 1] }), characters()), [
        { missionId: 20011 }, { missionId: 20012 },
    ])
    assert.deepEqual(loadout.collectActiveMissionLoadoutBattleFacts(definitions(), context({ partyCharacterIds: [999001] }), {}), [])
    assert.throws(() => loadout.collectActiveMissionLoadoutBattleFacts(definitions(), context({ partyCharacterIds: [999001] }), { "999001": { element: "0" } }), TypeError)
    assert.deepEqual(loadout.collectActiveMissionLoadoutBattleFacts(definitions(), context({ questAccomplished: false }), characters()), [])
    for (const bad of [0, 1, "false", null, undefined]) {
        assert.throws(() => loadout.collectActiveMissionLoadoutBattleFacts(definitions(), context({ questAccomplished: bad }), characters()), TypeError)
    }
    assert.throws(() => loadout.collectActiveMissionLoadoutBattleFacts(definitions(), context({ isMulti: undefined }), characters()), TypeError)
    for (const [field, bad, expected] of [
        ["questCategory", "14", TypeError], ["questCategory", -1, RangeError],
        ["questId", "1001", TypeError], ["questId", 0, RangeError],
        ["partyCharacterIds", ["1"], TypeError], ["partyCharacterIds", [0], RangeError],
    ]) assert.throws(() => loadout.collectActiveMissionLoadoutBattleFacts(definitions(), context({ [field]: bad }), characters()), expected)
    const sparseParty = new Array(1)
    const deletedParty = [1, 131001]
    delete deletedParty[0]
    for (const bad of [sparseParty, deletedParty, [null]]) {
        assert.throws(() => loadout.collectActiveMissionLoadoutBattleFacts(definitions(), context({ partyCharacterIds: bad }), characters()), error => error instanceof TypeError || error instanceof RangeError)
    }
    assert.deepEqual(loadout.collectActiveMissionLoadoutBattleFacts([
        definition(1, { battleKind: 1 }), definition(2, { battleKind: 2 }), definition(3, { battleKind: 3 }),
    ], context({ isMulti: false }), characters()), [{ missionId: 1 }, { missionId: 3 }])

    for (const bad of [-1, 6, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "0", null]) {
        assert.throws(() => loadout.collectActiveMissionLoadoutBattleFacts(definitions(), context(), { "1": { element: bad } }), error => error instanceof TypeError || error instanceof RangeError)
    }
    for (const bad of [null, "0", Number.NaN, Number.POSITIVE_INFINITY, -1, 6, 1.5]) {
        assert.throws(() => loadout.collectActiveMissionLoadoutBattleFacts(definitions(), context({ equipmentElements: [bad] }), characters()), error => error instanceof TypeError || error instanceof RangeError)
    }
    for (const bad of [null, "bad", new Array(1), (() => { const value = [0, 2]; delete value[0]; return value })()]) {
        assert.throws(() => loadout.collectActiveMissionLoadoutBattleFacts(definitions(), context({ equipmentElements: bad }), characters()), TypeError)
    }
    assert.throws(() => loadout.collectActiveMissionLoadoutBattleFacts(definitions(), context(), { "1": { element: "0" }, "131001": { element: 2 } }), TypeError)

    const nonTarget = definition(9, { pattern: 99, battleKind: "bad", characterElement: "bad", equipmentElement: "bad" })
    assert.deepEqual(loadout.collectActiveMissionLoadoutBattleFacts([nonTarget], context(), characters()), [])
    for (const bad of [false, undefined, null, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
        const malformed = row()
        malformed[29] = bad
        assert.throws(() => loadout.collectActiveMissionLoadoutBattleFacts([{ missionId: 1, row: malformed }], context(), characters()), TypeError)
    }
    for (const bad of [-1, Number.MAX_SAFE_INTEGER + 1, "089", "bad"]) {
        const malformed = row()
        malformed[29] = bad
        assert.throws(() => loadout.collectActiveMissionLoadoutBattleFacts([{ missionId: 1, row: malformed }], context(), characters()), RangeError)
    }
    for (const [index, values] of [[69, [0, 7, "01", undefined, null, ""]], [70, [0, 7, "01", undefined, null, ""]]]) {
        for (const bad of values) {
            const malformed = row()
            malformed[index] = bad
            assert.throws(() => loadout.collectActiveMissionLoadoutBattleFacts([{ missionId: 1, row: malformed }], context(), characters()), error => error instanceof TypeError || error instanceof RangeError)
        }
    }
    for (const index of [34, 35, 36, 37]) for (const bad of [undefined, null, ""]) {
        const malformed = row()
        malformed[index] = bad
        assert.throws(() => loadout.collectActiveMissionLoadoutBattleFacts([{ missionId: 1, row: malformed }], context(), characters()), TypeError)
    }
    const malformedDuplicate = definition(2, { characterElement: "01" })
    for (const ordered of [[definition(2), malformedDuplicate], [malformedDuplicate, definition(2)]]) {
        assert.throws(() => loadout.collectActiveMissionLoadoutBattleFacts(ordered, context(), characters()), RangeError)
    }
    assert.throws(() => loadout.collectActiveMissionLoadoutBattleFacts([{ missionId: 1, row: row().slice(0, 72) }], context(), characters()), TypeError)

    const frozenDefinitions = Object.freeze([Object.freeze(definition(10)), Object.freeze(definition(2)), Object.freeze(definition(2))])
    const frozenContext = Object.freeze(context())
    const frozenCharacters = Object.freeze(characters())
    const first = loadout.collectActiveMissionLoadoutBattleFacts(frozenDefinitions, frozenContext, frozenCharacters)
    assert.deepEqual(first, [{ missionId: 2 }, { missionId: 10 }])
    assert.notEqual(first, loadout.collectActiveMissionLoadoutBattleFacts(frozenDefinitions, frozenContext, frozenCharacters))

    assert.throws(() => facts(1), /no such table/)
    const { missionFactsMigration } = require("../src/data/migrations/wdfp/mission-facts")
    missionFactsMigration.apply(database)
    assert.deepEqual(facts(1), [])

    ;({ productionContentSnapshotProvider: provider } = require("../src/content/runtime/content-snapshot"))
    savedDescriptor = Object.getOwnPropertyDescriptor(provider, "snapshot")
    let snapshotReads = 0
    const bundledMissions = require("../assets/mission_active.json")
    const bundledCharacters = require("../assets/character.json")
    const trackedMissions = Object.fromEntries([20011, 20012, 20013, 20014].map(id => [id, bundledMissions[id]]))
    const primary = repository(trackedMissions, bundledCharacters)
    Object.defineProperty(provider, "snapshot", {
        configurable: true,
        get: () => { snapshotReads += 1; return { repository: primary } },
    })
    loadout.recordActiveMissionLoadoutBattleFactsSync(finishContext(1))
    assert.equal(snapshotReads, 1)
    assert.deepEqual(primary.calls, ["mission_active.json", "character.json"])
    assert.deepEqual(facts(1), [
        { mission_id: 20011, progress: 1 }, { mission_id: 20012, progress: 1 },
        { mission_id: 20013, progress: 1 }, { mission_id: 20014, progress: 1 },
    ])

    const poisonDescriptor = { configurable: true, get: () => { throw new Error("snapshot must not be read") } }
    Object.defineProperty(provider, "snapshot", poisonDescriptor)
    assert.doesNotThrow(() => loadout.recordActiveMissionLoadoutBattleFactsSync({ questAccomplished: false }))
    for (const bad of [0, "false", null, undefined]) {
        assert.throws(() => loadout.recordActiveMissionLoadoutBattleFactsSync({ questAccomplished: bad }), TypeError)
    }
    for (const overrides of [
        { playerId: "5" }, { playerId: 0 }, { questCategory: "14" }, { questCategory: -1 },
        { questId: "1001" }, { questId: 0 }, { isMulti: 0 }, { isMulti: "false" },
    ]) assert.throws(() => loadout.recordActiveMissionLoadoutBattleFactsSync(finishContext(5, overrides)), error => error instanceof TypeError || error instanceof RangeError)

    const singleRepository = repository({ 20011: [row({ battleKind: 1, characterElement: 1 })] }, bundledCharacters)
    Object.defineProperty(provider, "snapshot", { configurable: true, value: { repository: singleRepository }, writable: true })
    loadout.recordActiveMissionLoadoutBattleFactsSync(finishContext(5, {
        isMulti: undefined,
        equipmentElements: undefined,
        party: { characters: [{ id: 1 }], unison_characters: [] },
    }))
    assert.deepEqual(facts(5), [{ mission_id: 20011, progress: 1 }])
    const secondary = repository({ 20013: [row({ characterElement: 3 })] }, bundledCharacters)
    Object.defineProperty(provider, "snapshot", { configurable: true, value: { repository: secondary }, writable: true })
    loadout.recordActiveMissionLoadoutBattleFactsSync(finishContext(5, {
        isMulti: false,
        equipmentElements: undefined,
        party: { characters: [{ id: 131001 }], unison_characters: [] },
    }))
    assert.deepEqual(secondary.calls, ["mission_active.json", "character.json"])
    assert.deepEqual(facts(5), [{ mission_id: 20011, progress: 1 }, { mission_id: 20013, progress: 1 }])

    Object.defineProperty(provider, "snapshot", { configurable: true, value: { repository: repository(missionTable()) }, writable: true })
    database.prepare(`INSERT INTO players_active_mission_battle_facts (player_id, mission_id, progress) VALUES (2, 20013, ?)`)
        .run(Number.MAX_SAFE_INTEGER)
    assert.throws(() => loadout.recordActiveMissionLoadoutBattleFactsSync(finishContext(2)), RangeError)
    assert.deepEqual(facts(2), [{ mission_id: 20013, progress: Number.MAX_SAFE_INTEGER }])

    assert.throws(() => database.transaction(() => {
        loadout.recordActiveMissionLoadoutBattleFactsSync(finishContext(3))
        throw new Error("outer rollback")
    })(), /outer rollback/)
    assert.deepEqual(facts(3), [])

    for (const badMissionTable of [null, [], { "020011": [row()] }, { 1: [] }, { 1: [row(), row()] }, { 1: [row().slice(0, 72)] }, { 1: [[...row(), "extra"]] }]) {
        Object.defineProperty(provider, "snapshot", { configurable: true, value: { repository: repository(badMissionTable) }, writable: true })
        assert.throws(() => loadout.recordActiveMissionLoadoutBattleFactsSync(finishContext(4)), error => error instanceof TypeError || error instanceof RangeError)
        assert.deepEqual(facts(4), [])
    }
    Object.defineProperty(provider, "snapshot", { configurable: true, value: { repository: repository(missionTable(), bundledCharacters) }, writable: true })
    assert.doesNotThrow(() => loadout.recordActiveMissionLoadoutBattleFactsSync(finishContext(4, {
        party: { characters: [{ id: 999001 }], unison_characters: [] },
    })))
    assert.deepEqual(facts(4), [])
    Object.defineProperty(provider, "snapshot", { configurable: true, value: { repository: repository(missionTable(), { "999001": { element: "0" } }) }, writable: true })
    assert.throws(() => loadout.recordActiveMissionLoadoutBattleFactsSync(finishContext(4, {
        party: { characters: [{ id: 999001 }], unison_characters: [] },
    })), TypeError)
    assert.deepEqual(facts(4), [])
    Object.defineProperty(provider, "snapshot", { configurable: true, value: { repository: repository(missionTable(), []) }, writable: true })
    assert.throws(() => loadout.recordActiveMissionLoadoutBattleFactsSync(finishContext(4)), TypeError)
    assert.deepEqual(facts(4), [])
} finally {
    if (provider && savedDescriptor) Object.defineProperty(provider, "snapshot", savedDescriptor)
    if (database?.open) database.close()
    if (previousDatabaseDirectory === undefined) delete process.env.WF_DATABASE_DIR
    else process.env.WF_DATABASE_DIR = previousDatabaseDirectory
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
}

assert.equal(fs.existsSync(temporaryRoot), false)
assert.equal(fs.existsSync(`${worktreeDatabase}-wal`), false)
assert.equal(fs.existsSync(`${worktreeDatabase}-shm`), false)
assert.equal(fs.existsSync(`${worktreeDatabase}.version`), false)
assert.equal(fs.existsSync(worktreeDatabase), false)
console.log("active mission loadout battle facts tests passed")
