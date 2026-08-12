require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wave2a-12-"))
const previousDatabaseDirectory = process.env.WF_DATABASE_DIR
const worktreeDatabase = path.resolve(__dirname, "..", ".database")
let database
let productionContentSnapshotProvider
let savedSnapshot
let snapshotDescriptor

function row({ pattern = 72, characterId = 121033, battleKind = 3, rangeKind = "(None)" } = {}) {
    const result = Array(73).fill("(None)")
    result[29] = String(pattern)
    result[32] = String(battleKind)
    result[34] = rangeKind
    result[43] = String(characterId)
    return result
}

function definition(missionId, options) {
    return { missionId, row: row(options) }
}

function context(overrides = {}) {
    return {
        questAccomplished: true,
        isMulti: true,
        questCategory: 14,
        questId: 1001,
        partyCharacterIds: [121033],
        ...overrides,
    }
}

function characters(overrides = {}) {
    return { "121033": { level: 100, secondBoardAbilitiesComplete: true }, ...overrides }
}

function insertPlayer(playerId) {
    database.prepare(`INSERT INTO accounts (
        id, app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status
    ) VALUES (?, 'wf_cn', '2025-01-01', '', 'test', ?, '2025-01-01', '2025-01-01', 'normal')`)
        .run(playerId, `wave2a-12-${playerId}`)
    database.prepare(`INSERT INTO players (
        id, stamina, stamina_heal_time, boost_point, boss_boost_point, transition_state, role, name,
        last_login_time, comment, vmoney, free_vmoney, rank_point, star_crumb, bond_token, exp_pool,
        exp_pooled_time, leader_character_id, party_slot, degree_id, birth, free_mana, paid_mana,
        enable_auto_3x, account_id
    ) VALUES (?, 0, 0, 0, 0, 0, 0, 'tester', '2025-01-01', '', 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, ?)`)
        .run(playerId, playerId)
}

function insertCharacter(playerId, characterId = 121033, exp = 379988) {
    database.prepare(`INSERT INTO players_characters (
        id, entry_count, evolution_level, over_limit_step, protection, join_time, update_time, exp, stack,
        mana_board_index, player_id
    ) VALUES (?, 1, 0, 0, 0, '2025-01-01', '2025-01-01', ?, 0, 1, ?)`)
        .run(characterId, exp, playerId)
}

function facts(playerId) {
    return database.prepare(`SELECT pattern, character_id, progress
        FROM players_active_mission_battle_condition_facts WHERE player_id = ? ORDER BY pattern, character_id`)
        .all(playerId)
}

function repository(missions, characterTable = { "121033": { rarity: 5 } }) {
    const calls = []
    return {
        calls,
        info: () => ({ source: "bundled", assetVersion: "test", generatorVersion: 1, releaseDigest: null }),
        table: name => {
            calls.push(name)
            if (name === "mission_active.json") return missions
            if (name === "character.json") return characterTable
            throw new Error(`unexpected table ${name}`)
        },
    }
}

try {
    process.env.WF_DATABASE_DIR = temporaryRoot
    const conditional = require("../src/lib/mission/active-conditional-battle-facts")
    const { getDb } = require("../src/data/db")
    database = getDb()
    const mainDatabase = database.pragma("database_list").find(entry => entry.name === "main")
    assert.equal(path.dirname(path.resolve(mainDatabase.file)), path.resolve(temporaryRoot))
    assert.equal(database.pragma("foreign_keys", { simple: true }), 1)
    for (let playerId = 1; playerId <= 6; playerId += 1) insertPlayer(playerId)

    const definitions = [definition(1, { pattern: 71 }), definition(2, { pattern: 72 }), definition(3, { pattern: 73 })]
    assert.deepEqual(conditional.collectActiveMissionConditionalBattleFacts(definitions, context(), characters()), [
        { pattern: 71, characterId: 121033 }, { pattern: 72, characterId: 121033 }, { pattern: 73, characterId: 121033 },
    ])
    assert.deepEqual(conditional.collectActiveMissionConditionalBattleFacts(definitions, context({ questAccomplished: false }), characters()), [])
    for (const bad of [undefined, 0, "true"]) {
        assert.throws(() => conditional.collectActiveMissionConditionalBattleFacts(definitions, context({ questAccomplished: bad }), characters()), TypeError)
        assert.throws(() => conditional.collectActiveMissionConditionalBattleFacts(definitions, context({ isMulti: bad }), characters()), TypeError)
    }
    assert.deepEqual(conditional.collectActiveMissionConditionalBattleFacts([
        definition(1, { pattern: 72, battleKind: 1 }), definition(2, { pattern: 73, battleKind: 2 }), definition(3, { pattern: 71, battleKind: 3 }),
    ], context({ isMulti: false }), characters()), [{ pattern: 71, characterId: 121033 }, { pattern: 72, characterId: 121033 }])
    assert.throws(() => conditional.collectActiveMissionConditionalBattleFacts([definition(1, { battleKind: 4 })], context(), characters()), RangeError)

    assert.deepEqual(conditional.collectActiveMissionConditionalBattleFacts([
        definition(1, { pattern: 72 }), definition(2, { pattern: 99, battleKind: "not-read", characterId: "not-read" }),
    ], context({ partyCharacterIds: [121033, 121033] }), characters()), [{ pattern: 72, characterId: 121033 }])
    assert.deepEqual(conditional.collectActiveMissionConditionalBattleFacts(definitions, context({ partyCharacterIds: [] }), characters()), [])
    assert.throws(() => conditional.collectActiveMissionConditionalBattleFacts(definitions, context({ partyCharacterIds: [121033, 0] }), characters()), RangeError)
    for (const field of ["questCategory", "questId"]) {
        assert.throws(() => conditional.collectActiveMissionConditionalBattleFacts(definitions, context({ [field]: "14" }), characters()), TypeError)
        assert.throws(() => conditional.collectActiveMissionConditionalBattleFacts(definitions, context({ [field]: Number.NaN }), characters()), TypeError)
    }
    assert.doesNotThrow(() => conditional.collectActiveMissionConditionalBattleFacts(definitions, context({ questCategory: 0 }), characters()))
    assert.throws(() => conditional.collectActiveMissionConditionalBattleFacts(definitions, context({ questId: 0 }), characters()), RangeError)
    assert.throws(() => conditional.collectActiveMissionConditionalBattleFacts(definitions, context({ partyCharacterIds: ["121033"] }), characters()), TypeError)
    assert.deepEqual(conditional.collectActiveMissionConditionalBattleFacts(definitions, context(), {}), [])
    assert.throws(() => conditional.collectActiveMissionConditionalBattleFacts(definitions, context(), { "121033": { level: -1, secondBoardAbilitiesComplete: true } }), RangeError)
    for (const [level, expected] of [[79, []], [80, [{ pattern: 72, characterId: 121033 }]], [99, [{ pattern: 72, characterId: 121033 }]], [100, [{ pattern: 72, characterId: 121033 }, { pattern: 73, characterId: 121033 }]]]) {
        assert.deepEqual(conditional.collectActiveMissionConditionalBattleFacts(definitions.slice(1), context(), characters({ "121033": { level, secondBoardAbilitiesComplete: true } })), expected)
    }
    assert.deepEqual(conditional.collectActiveMissionConditionalBattleFacts([definition(1, { pattern: 71 })], context(), characters({ "121033": { level: 0, secondBoardAbilitiesComplete: false } })), [])

    const duplicate = Object.freeze(definition(7, { pattern: 72 }))
    const frozenDefinitions = Object.freeze([duplicate, duplicate, Object.freeze(definition(3, { pattern: 71 }))])
    const frozenContext = Object.freeze(context())
    const frozenCharacters = Object.freeze(characters())
    const first = conditional.collectActiveMissionConditionalBattleFacts(frozenDefinitions, frozenContext, frozenCharacters)
    assert.deepEqual(first, [{ pattern: 71, characterId: 121033 }, { pattern: 72, characterId: 121033 }])
    assert.notEqual(first, conditional.collectActiveMissionConditionalBattleFacts(frozenDefinitions, frozenContext, frozenCharacters))
    assert.deepEqual(conditional.collectActiveMissionConditionalBattleFacts([
        definition(3, { pattern: 73, characterId: 121034 }), definition(2, { pattern: 72 }), definition(1, { pattern: 71, characterId: 121034 }),
    ], context({ partyCharacterIds: [121034, 121033] }), characters({ "121034": { level: 100, secondBoardAbilitiesComplete: true } })), [
        { pattern: 71, characterId: 121034 }, { pattern: 72, characterId: 121033 }, { pattern: 73, characterId: 121034 },
    ])
    for (const bad of [false, undefined, null, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
        const malformed = row()
        malformed[29] = bad
        assert.throws(() => conditional.collectActiveMissionConditionalBattleFacts([{ missionId: 1, row: malformed }], context(), characters()), TypeError)
    }
    for (const bad of [-1, Number.MAX_SAFE_INTEGER + 1, "071", "bad"]) {
        const malformed = row()
        malformed[29] = bad
        assert.throws(() => conditional.collectActiveMissionConditionalBattleFacts([{ missionId: 1, row: malformed }], context(), characters()), RangeError)
    }
    for (const bad of ["01", -1, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => conditional.collectActiveMissionConditionalBattleFacts([{ missionId: bad, row: row() }], context(), characters()), RangeError)
    }
    assert.throws(() => conditional.collectActiveMissionConditionalBattleFacts([{ missionId: Number.NaN, row: row() }], context(), characters()), TypeError)
    for (const bad of ["0121033", -1]) {
        assert.throws(() => conditional.collectActiveMissionConditionalBattleFacts([definition(1, { characterId: bad })], context(), characters()), RangeError)
    }
    const nonFiniteCharacter = row()
    nonFiniteCharacter[43] = Number.NaN
    assert.throws(() => conditional.collectActiveMissionConditionalBattleFacts([{ missionId: 1, row: nonFiniteCharacter }], context(), characters()), TypeError)
    assert.throws(() => conditional.collectActiveMissionConditionalBattleFacts([definition(1, { rangeKind: "099" })], context(), characters()), TypeError)
    assert.throws(() => conditional.collectActiveMissionConditionalBattleFacts([{ missionId: 1, row: row().slice(0, 72) }], context(), characters()), TypeError)
    for (const index of [34, 35, 36, 37]) for (const sentinel of [undefined, null, ""]) {
        const malformed = row()
        malformed[index] = sentinel
        assert.throws(() => conditional.collectActiveMissionConditionalBattleFacts([{ missionId: 1, row: malformed }], context(), characters()), TypeError)
    }
    for (const malformed of [
        definition(2, { pattern: 72, battleKind: 1, rangeKind: "099" }),
        definition(2, { pattern: 72, battleKind: 1, characterId: 0 }),
    ]) assert.throws(() => conditional.collectActiveMissionConditionalBattleFacts([definition(1, { pattern: 72 }), malformed], context(), characters()), error => error instanceof TypeError || error instanceof RangeError)

    assert.deepEqual(facts(1), [])

    ;({ productionContentSnapshotProvider } = require("../src/content/runtime/content-snapshot"))
    savedSnapshot = productionContentSnapshotProvider.snapshot
    snapshotDescriptor = Object.getOwnPropertyDescriptor(productionContentSnapshotProvider, "snapshot")
    const missions = {
        1: [row({ pattern: 71 })], 2: [row({ pattern: 72 })], 3: [row({ pattern: 73 })],
    }
    const primaryRepository = repository(missions)
    let snapshotReads = 0
    Object.defineProperty(productionContentSnapshotProvider, "snapshot", {
        configurable: true,
        get: () => { snapshotReads += 1; return { repository: primaryRepository } },
    })
    insertCharacter(1)
    const manaNodes = require("../src/lib/assets").getCharacterManaNodesSync(121033, 2)
    const tracked = Object.entries(manaNodes).filter(([, node]) => ["4", "5", "6"].includes(node.field6)).map(([id]) => Number(id))
    assert.equal(tracked.length, 18)
    for (const nodeId of tracked) database.prepare(`INSERT INTO players_characters_mana_nodes (value, character_id, player_id) VALUES (?, 121033, 1)`).run(nodeId)
    conditional.recordActiveMissionConditionalBattleFactsSync({
        playerId: 1, questAccomplished: true, isMulti: true, questCategory: 14, questId: 1001,
        party: { characters: [{ id: 121033 }], unison_characters: [] },
    })
    assert.deepEqual(facts(1), [
        { pattern: 71, character_id: 121033, progress: 1 }, { pattern: 72, character_id: 121033, progress: 1 }, { pattern: 73, character_id: 121033, progress: 1 },
    ])
    assert.equal(snapshotReads, 1)
    assert.deepEqual(primaryRepository.calls, ["mission_active.json", "character.json"])
    Object.defineProperty(productionContentSnapshotProvider, "snapshot", snapshotDescriptor)
    productionContentSnapshotProvider.snapshot = { repository: repository(missions) }
    conditional.recordActiveMissionConditionalBattleFactsSync({
        playerId: 1, questAccomplished: true, isMulti: true, questCategory: 14, questId: 1001,
        party: { characters: [{ id: 121033 }], unison_characters: [null, { id: null }] },
    })
    assert.deepEqual(facts(1), [
        { pattern: 71, character_id: 121033, progress: 2 }, { pattern: 72, character_id: 121033, progress: 2 }, { pattern: 73, character_id: 121033, progress: 2 },
    ])
    Object.defineProperty(productionContentSnapshotProvider, "snapshot", {
        configurable: true,
        get: () => { throw new Error("snapshot must not be read") },
    })
    conditional.recordActiveMissionConditionalBattleFactsSync({ playerId: 2, questAccomplished: false })
    assert.throws(() => conditional.recordActiveMissionConditionalBattleFactsSync({
        playerId: 2, questAccomplished: true, isMulti: false, questCategory: 14, questId: 1001,
        party: { characters: [{ id: 0 }], unison_characters: [] },
    }), RangeError)
    const sparseFinishParty = new Array(1)
    assert.throws(() => conditional.recordActiveMissionConditionalBattleFactsSync({
        playerId: 2, questAccomplished: true, isMulti: false, questCategory: 14, questId: 1001,
        party: { characters: sparseFinishParty, unison_characters: [] },
    }), TypeError)
    assert.throws(() => conditional.recordActiveMissionConditionalBattleFactsSync({
        playerId: 2, questAccomplished: true, isMulti: false, questCategory: 14, questId: 1001,
        party: { characters: ["bad"], unison_characters: [] },
    }), TypeError)
    assert.deepEqual(facts(2), [])
    Object.defineProperty(productionContentSnapshotProvider, "snapshot", snapshotDescriptor)
    productionContentSnapshotProvider.snapshot = { repository: repository(missions) }

    insertCharacter(5)
    for (const nodeId of tracked) database.prepare(`INSERT INTO players_characters_mana_nodes (value, character_id, player_id) VALUES (?, 121033, 5)`).run(nodeId)
    for (const missingGroup of ["4", "5", "6"]) {
        const missingNodeId = Number(Object.entries(manaNodes).find(([, node]) => node.field6 === missingGroup)[0])
        database.prepare(`DELETE FROM players_characters_mana_nodes WHERE value = ? AND character_id = 121033 AND player_id = 5`).run(missingNodeId)
        try {
            assert.throws(() => database.transaction(() => {
                conditional.recordActiveMissionConditionalBattleFactsSync({
                    playerId: 5, questAccomplished: true, isMulti: true, questCategory: 14, questId: 1001,
                    party: { characters: [{ id: 121033 }], unison_characters: [] },
                })
                assert.deepEqual(facts(5), [
                    { pattern: 72, character_id: 121033, progress: 1 }, { pattern: 73, character_id: 121033, progress: 1 },
                ])
                throw new Error(`missing node ${missingGroup} rollback`)
            })(), new RegExp(`missing node ${missingGroup} rollback`))
        } finally {
            database.prepare(`INSERT INTO players_characters_mana_nodes (value, character_id, player_id) VALUES (?, 121033, 5)`).run(missingNodeId)
        }
        assert.deepEqual(facts(5), [])
    }

    insertCharacter(6)
    for (const nodeId of tracked) database.prepare(`INSERT INTO players_characters_mana_nodes (value, character_id, player_id) VALUES (?, 121033, 6)`).run(nodeId)
    for (const missingGroup of ["4", "5", "6"]) {
        const removed = Object.entries(manaNodes).filter(([, node]) => node.field6 === missingGroup)
        for (const [nodeId] of removed) delete manaNodes[nodeId]
        try {
            assert.throws(() => database.transaction(() => {
                conditional.recordActiveMissionConditionalBattleFactsSync({
                    playerId: 6, questAccomplished: true, isMulti: true, questCategory: 14, questId: 1001,
                    party: { characters: [{ id: 121033 }], unison_characters: [] },
                })
                assert.deepEqual(facts(6), [
                    { pattern: 72, character_id: 121033, progress: 1 }, { pattern: 73, character_id: 121033, progress: 1 },
                ])
                throw new Error(`missing group ${missingGroup} rollback`)
            })(), new RegExp(`missing group ${missingGroup} rollback`))
        } finally {
            for (const [nodeId, node] of removed) manaNodes[nodeId] = node
        }
        assert.deepEqual(facts(6), [])
    }

    database.prepare(`INSERT INTO players_characters_mana_nodes (value, character_id, player_id) VALUES (-1, 121033, 6)`).run()
    assert.throws(() => conditional.recordActiveMissionConditionalBattleFactsSync({
        playerId: 6, questAccomplished: true, isMulti: true, questCategory: 14, questId: 1001,
        party: { characters: [{ id: 121033 }], unison_characters: [] },
    }), RangeError)
    assert.deepEqual(facts(6), [])
    database.prepare(`DELETE FROM players_characters_mana_nodes WHERE value = -1 AND character_id = 121033 AND player_id = 6`).run()

    manaNodes["01"] = { field6: "4" }
    try {
        assert.throws(() => conditional.recordActiveMissionConditionalBattleFactsSync({
            playerId: 6, questAccomplished: true, isMulti: true, questCategory: 14, questId: 1001,
            party: { characters: [{ id: 121033 }], unison_characters: [] },
        }), error => error instanceof TypeError || error instanceof RangeError)
    } finally {
        delete manaNodes["01"]
    }
    assert.deepEqual(facts(6), [])

    productionContentSnapshotProvider.snapshot = { repository: repository(missions, []) }
    assert.throws(() => conditional.recordActiveMissionConditionalBattleFactsSync({
        playerId: 2, questAccomplished: true, isMulti: true, questCategory: 14, questId: 1001,
        party: { characters: [{ id: 121033 }], unison_characters: [] },
    }), TypeError)
    assert.deepEqual(facts(2), [])
    productionContentSnapshotProvider.snapshot = { repository: { table: () => { throw new Error("snapshot callback failure") } } }
    assert.throws(() => conditional.recordActiveMissionConditionalBattleFactsSync({
        playerId: 2, questAccomplished: true, isMulti: true, questCategory: 14, questId: 1001,
        party: { characters: [{ id: 121033 }], unison_characters: [] },
    }), /snapshot callback failure/)
    assert.deepEqual(facts(2), [])
    productionContentSnapshotProvider.snapshot = { repository: repository(missions) }

    database.prepare(`INSERT INTO players_active_mission_battle_condition_facts (player_id, pattern, character_id, progress) VALUES (3, 71, 121033, ?)`)
        .run(Number.MAX_SAFE_INTEGER)
    insertCharacter(3)
    for (const nodeId of tracked) database.prepare(`INSERT INTO players_characters_mana_nodes (value, character_id, player_id) VALUES (?, 121033, 3)`).run(nodeId)
    assert.throws(() => conditional.recordActiveMissionConditionalBattleFactsSync({
        playerId: 3, questAccomplished: true, isMulti: true, questCategory: 14, questId: 1001,
        party: { characters: [{ id: 121033 }], unison_characters: [] },
    }), RangeError)
    assert.deepEqual(facts(3), [{ pattern: 71, character_id: 121033, progress: Number.MAX_SAFE_INTEGER }])

    insertCharacter(4)
    assert.throws(() => database.transaction(() => {
        conditional.recordActiveMissionConditionalBattleFactsSync({
            playerId: 4, questAccomplished: true, isMulti: true, questCategory: 14, questId: 1001,
            party: { characters: [{ id: 121033 }], unison_characters: [] },
        })
        throw new Error("outer rollback")
    })(), /outer rollback/)
    assert.deepEqual(facts(4), [])

    productionContentSnapshotProvider.snapshot = { repository: repository(missions, {}) }
    assert.doesNotThrow(() => conditional.recordActiveMissionConditionalBattleFactsSync({
        playerId: 4, questAccomplished: true, isMulti: true, questCategory: 14, questId: 1001,
        party: { characters: [{ id: 121033 }], unison_characters: [] },
    }))
    assert.deepEqual(facts(4), [])
    productionContentSnapshotProvider.snapshot = { repository: repository({ 2: [row({ pattern: 72, battleKind: 1 })] }) }
    conditional.recordActiveMissionConditionalBattleFactsSync({
        playerId: 4, questAccomplished: true, isMulti: undefined, questCategory: 14, questId: 1001,
        party: { characters: [{ id: 121033 }], unison_characters: [] },
    })
    assert.deepEqual(facts(4), [{ pattern: 72, character_id: 121033, progress: 1 }])
    database.prepare("DELETE FROM players_active_mission_battle_condition_facts WHERE player_id = 4").run()
    productionContentSnapshotProvider.snapshot = { repository: { table: () => { throw new Error("invalid multi must precede snapshot") } } }
    assert.throws(() => conditional.recordActiveMissionConditionalBattleFactsSync({
        playerId: 4, questAccomplished: true, isMulti: 0, questCategory: 14, questId: 1001,
        party: { characters: [], unison_characters: [] },
    }), TypeError)
    assert.throws(() => conditional.recordActiveMissionConditionalBattleFactsSync({
        playerId: 4, questAccomplished: true, isMulti: "false", questCategory: 14, questId: 1001,
        party: { characters: [], unison_characters: [] },
    }), TypeError)
    productionContentSnapshotProvider.snapshot = { repository: repository(missions) }

    for (const nodeId of tracked) database.prepare(`INSERT INTO players_characters_mana_nodes (value, character_id, player_id) VALUES (?, 121033, 4)`).run(nodeId)
    database.prepare(`INSERT INTO players_active_mission_battle_condition_facts (player_id, pattern, character_id, progress) VALUES (4, 72, 121033, ?)`)
        .run(Number.MAX_SAFE_INTEGER)
    assert.throws(() => conditional.recordActiveMissionConditionalBattleFactsSync({
        playerId: 4, questAccomplished: true, isMulti: true, questCategory: 14, questId: 1001,
        party: { characters: [{ id: 121033 }], unison_characters: [] },
    }), RangeError)
    assert.deepEqual(facts(4), [{ pattern: 72, character_id: 121033, progress: Number.MAX_SAFE_INTEGER }])

    const nullPrototypeRoot = Object.create(null)
    nullPrototypeRoot[1] = [row()]
    productionContentSnapshotProvider.snapshot = { repository: repository(nullPrototypeRoot) }
    assert.doesNotThrow(() => conditional.recordActiveMissionConditionalBattleFactsSync({
        playerId: 2, questAccomplished: true, isMulti: false, questCategory: 14, questId: 1001,
        party: { characters: [], unison_characters: [] },
    }))
    for (const badRoot of [new Date(), Object.create({ inherited: true })]) {
        productionContentSnapshotProvider.snapshot = { repository: repository(badRoot) }
        assert.throws(() => conditional.recordActiveMissionConditionalBattleFactsSync({
            playerId: 2, questAccomplished: true, isMulti: false, questCategory: 14, questId: 1001,
            party: { characters: [], unison_characters: [] },
        }), TypeError)
    }
    let getterReads = 0
    const accessorRoot = {}
    Object.defineProperty(accessorRoot, "1", {
        enumerable: true,
        get: () => { getterReads += 1; return [row()] },
    })
    productionContentSnapshotProvider.snapshot = { repository: repository(accessorRoot) }
    assert.throws(() => conditional.recordActiveMissionConditionalBattleFactsSync({
        playerId: 2, questAccomplished: true, isMulti: false, questCategory: 14, questId: 1001,
        party: { characters: [], unison_characters: [] },
    }), TypeError)
    assert.equal(getterReads, 0)

    productionContentSnapshotProvider.snapshot = { repository: repository({ "020007": [row()] }) }
    assert.throws(() => conditional.recordActiveMissionConditionalBattleFactsSync({
        playerId: 2, questAccomplished: true, isMulti: undefined, questCategory: 14, questId: 1001,
        party: { characters: [], unison_characters: [] },
    }), RangeError)
    productionContentSnapshotProvider.snapshot = { repository: repository({ 7: [row(), row()] }) }
    assert.throws(() => conditional.recordActiveMissionConditionalBattleFactsSync({
        playerId: 2, questAccomplished: true, isMulti: false, questCategory: 14, questId: 1001,
        party: { characters: [], unison_characters: [] },
    }), TypeError)
    productionContentSnapshotProvider.snapshot = { repository: repository({ 7: [row().slice(0, 72)] }) }
    assert.throws(() => conditional.recordActiveMissionConditionalBattleFactsSync({
        playerId: 2, questAccomplished: true, isMulti: false, questCategory: 14, questId: 1001,
        party: { characters: [], unison_characters: [] },
    }), TypeError)
    assert.deepEqual(facts(2), [])
} finally {
    if (productionContentSnapshotProvider && snapshotDescriptor) Object.defineProperty(productionContentSnapshotProvider, "snapshot", snapshotDescriptor)
    if (productionContentSnapshotProvider && savedSnapshot) productionContentSnapshotProvider.snapshot = savedSnapshot
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
console.log("active mission conditional battle facts tests passed")
