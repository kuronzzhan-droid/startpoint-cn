"use strict"

require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const awakeMaster = require("../assets/mission_char_awake.json")

const deniedModulePaths = [
    require.resolve("../src/data/db"),
    require.resolve("../src/lib/mission/index"),
    require.resolve("../src/lib/mission/registry"),
    require.resolve("../src/lib/mission/computer-awake"),
    require.resolve("../src/lib/quest/finish/party-co-clear-tracker"),
    require.resolve("../src/lib/quest/finish/race-utils"),
    require.resolve("../src/routes/api/singleBattleQuest"),
    require.resolve("../src/multi/http/battle"),
]
const cacheBeforeRules = new Map(deniedModulePaths.map(modulePath => [modulePath, require.cache[modulePath]]))

const {
    AWAKE_DIRECT_BATTLE_MISSION_IDS,
    normalizeCharacterPair,
    getCharacterPairKey,
    mergePartyCoClearRows,
    getMatchedAwakeQuestPartyMissionIds,
    getMatchedAwakeRaceMissionIds,
    getMatchedAwakeDirectBattleMissionIds,
    isBondTokenMissionComplete,
} = require("../src/lib/mission/awake-battle-rules")

for (const [modulePath, previous] of cacheBeforeRules) {
    assert.equal(require.cache[modulePath], previous, `pure rules loaded forbidden module ${modulePath}`)
}

const OMIT = Symbol("omit")

function deepFreeze(value) {
    if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value
    for (const child of Object.values(value)) deepFreeze(child)
    return Object.freeze(value)
}

function makeContext({
    questCategory = 21,
    questId = 1006,
    questAccomplished = true,
    isMulti = false,
    clearTime = OMIT,
    main = [231001],
    unison = [],
    leader = OMIT,
    leaderCharacterId = OMIT,
    leaderId = OMIT,
    statistics = OMIT,
} = {}) {
    const party = {
        characters: main.map(id => id === null ? null : { id }),
        unison_characters: unison.map(id => id === null ? null : { id }),
    }
    if (leader !== OMIT) party.leader = leader === null ? null : { id: leader }
    if (leaderCharacterId !== OMIT) party.leader_character_id = leaderCharacterId
    if (leaderId !== OMIT) party.leader_id = leaderId
    const context = { questCategory, questId, questAccomplished, isMulti, party }
    if (clearTime !== OMIT) context.clearTime = clearTime
    if (statistics !== OMIT) context.statistics = statistics
    return deepFreeze(context)
}

function questIds(options) {
    return getMatchedAwakeQuestPartyMissionIds(makeContext(options))
}

function directIds(options, raceKey = "") {
    return getMatchedAwakeDirectBattleMissionIds(makeContext(options), raceKey)
}

function sortedEntries(map) {
    return [...map].sort(([a], [b]) => a.localeCompare(b))
}

const directMissionIds = [
    1510062, 1610022, 2310012, 2310013, 2610072,
    3210132, 3210133, 3310032, 3310033, 3410012, 3410013,
]
assert.deepEqual(AWAKE_DIRECT_BATTLE_MISSION_IDS, directMissionIds)
assert.equal(Object.isFrozen(AWAKE_DIRECT_BATTLE_MISSION_IDS), true)
assert.throws(() => AWAKE_DIRECT_BATTLE_MISSION_IDS.push(9999999), TypeError)
assert.deepEqual(AWAKE_DIRECT_BATTLE_MISSION_IDS, directMissionIds)

const pairA = normalizeCharacterPair(231001, 211001)
const pairB = normalizeCharacterPair(231001, 211001)
assert.deepEqual(pairA, [211001, 231001])
assert.deepEqual(pairB, [211001, 231001])
assert.notEqual(pairA, pairB)
pairA[0] = 1
assert.deepEqual(normalizeCharacterPair(231001, 211001), [211001, 231001])
assert.equal(getCharacterPairKey(231001, 211001), "211001_231001")

for (const value of ["1", NaN, Infinity, -Infinity]) {
    assert.throws(() => normalizeCharacterPair(value, 2), TypeError)
    assert.throws(() => getCharacterPairKey(2, value), TypeError)
}
for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => normalizeCharacterPair(value, 2), RangeError)
    assert.throws(() => getCharacterPairKey(2, value), RangeError)
}
assert.throws(() => normalizeCharacterPair(2, 2), RangeError)
assert.throws(() => getCharacterPairKey(2, 2), RangeError)

const coClearRows = deepFreeze([
    { char_id_a: 3, char_id_b: 1, co_clear_count: 2 },
    { char_id_a: 1, char_id_b: 3, co_clear_count: 4 },
    { char_id_a: 4, char_id_b: 2, co_clear_count: 0 },
])
const merged = mergePartyCoClearRows(coClearRows)
assert.deepEqual(sortedEntries(merged), [["1_3", 6], ["2_4", 0]])
assert.deepEqual(sortedEntries(mergePartyCoClearRows([...coClearRows].reverse())), [["1_3", 6], ["2_4", 0]])
merged.set("1_3", 999)
assert.deepEqual(sortedEntries(mergePartyCoClearRows(coClearRows)), [["1_3", 6], ["2_4", 0]])

const sparseRows = Array(1)
assert.throws(() => mergePartyCoClearRows(sparseRows))
for (const rows of [undefined, null, {}, "rows"]) assert.throws(() => mergePartyCoClearRows(rows), TypeError)
for (const row of [null, 1, "row", []]) assert.throws(() => mergePartyCoClearRows([row]))
for (const count of ["1", NaN, Infinity, -Infinity]) {
    assert.throws(() => mergePartyCoClearRows([{ char_id_a: 1, char_id_b: 2, co_clear_count: count }]), TypeError)
}
for (const count of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => mergePartyCoClearRows([{ char_id_a: 1, char_id_b: 2, co_clear_count: count }]), RangeError)
}
const overflowingRows = deepFreeze([
    { char_id_a: 1, char_id_b: 2, co_clear_count: Number.MAX_SAFE_INTEGER },
    { char_id_a: 2, char_id_b: 1, co_clear_count: 1 },
])
assert.throws(() => mergePartyCoClearRows(overflowingRows), RangeError)
assert.deepEqual(sortedEntries(mergePartyCoClearRows(coClearRows)), [["1_3", 6], ["2_4", 0]])

assert.deepEqual(questIds({ clearTime: 90000 }), [2310013])
assert.deepEqual(questIds({ clearTime: 90000, isMulti: true }), [2310013])
assert.deepEqual(questIds({ questCategory: 2, questId: 1010004, clearTime: 90000 }), [2310013])
assert.deepEqual(questIds({ clearTime: 90001 }), [])
for (const clearTime of ["90000", -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(questIds({ clearTime }), [])
}
assert.deepEqual(questIds({}), [])

assert.deepEqual(questIds({
    questCategory: 99,
    questId: 88,
    main: [151006],
    unison: [263002],
}), [1510062])
assert.deepEqual(questIds({
    questCategory: 99,
    questId: 88,
    main: [151006],
    unison: [263002],
    isMulti: true,
}), [1510062])
assert.deepEqual(questIds({
    questCategory: 99,
    questId: 88,
    main: [151006],
    unison: [151006, 263002, 263002],
}), [1510062])
assert.deepEqual(questIds({ questCategory: 15, questId: 5, main: [331003, 1] }), [3310032])
assert.deepEqual(questIds({ questCategory: 15, questId: 5, main: [331003, 1], isMulti: true }), [])
assert.deepEqual(questIds({ questCategory: 2, questId: 1010004, main: [331003], unison: [10] }), [3310033])
assert.deepEqual(questIds({ questCategory: 2, questId: 1010004, main: [331003], unison: [10], isMulti: true }), [])

for (const questId of [2001, 2006]) {
    assert.deepEqual(questIds({ questCategory: 13, questId, main: [321013] }), [3210132, 3210133])
}
for (const questId of [2000, 2007]) {
    assert.deepEqual(questIds({ questCategory: 13, questId, main: [321013] }), [3210132])
}
for (const questCategory of [6, 14, 20]) {
    assert.deepEqual(questIds({ questCategory, questId: 9999, main: [], unison: [321013] }), [3210132])
}
assert.deepEqual(questIds({ questCategory: 5, questId: 2001, main: [321013] }), [])
assert.deepEqual(questIds({ questCategory: 21, questId: 2001, main: [321013] }), [])
assert.deepEqual(questIds({ questCategory: 13, questId: 2001, main: [321013], isMulti: true }), [])

assert.deepEqual(questIds({ questCategory: 13, questId: 1040, main: [341001] }), [3410012, 3410013])
for (const questId of [1039, 1041]) {
    assert.deepEqual(questIds({ questCategory: 13, questId, main: [341001] }), [3410012])
}
for (const questCategory of [6, 14, 20]) {
    assert.deepEqual(questIds({ questCategory, questId: 9999, main: [], unison: [341001] }), [3410012])
}
assert.deepEqual(questIds({ questCategory: 5, questId: 1040, main: [341001] }), [])
assert.deepEqual(questIds({ questCategory: 21, questId: 1040, main: [341001] }), [])

const raceContext = makeContext({ main: [231001] })
assert.deepEqual(getMatchedAwakeRaceMissionIds(raceContext, "Devil+Dragon+Human"), [2310012])
assert.deepEqual(getMatchedAwakeRaceMissionIds(raceContext, "Alien+Devil+Dragon+Human"), [2310012])
for (const raceKey of [
    "", "Devil+Dragon", "devil+Dragon+Human", "Human+Dragon+Devil",
    "Devil+Dragon+Human+Human", "Devil++Dragon+Human", "+Devil+Dragon+Human",
    "Devil+Dragon+Human+", "Devil+ Dragon+Human", "Devil+Dragon+Human ", 1, null,
]) {
    assert.deepEqual(getMatchedAwakeRaceMissionIds(raceContext, raceKey), [])
}

assert.deepEqual(directIds({
    main: [161002],
    statistics: { zones: [{ encoffin_count: 0 }, {}] },
}), [1610022])
assert.deepEqual(directIds({
    main: [261007],
    statistics: { zones: [{ encoffin_count: 0, continue_count: 99 }] },
}), [2610072])
for (const statistics of [
    { zones: [{ encoffin_count: 1 }] },
    { zones: [] },
    { zones: [null] },
    { zones: [{ encoffin_count: -1 }] },
    { zones: [{ encoffin_count: 1.5 }] },
    { zones: [{ encoffin_count: "0" }] },
    { zones: [{ encoffin_count: null }] },
    { zones: [{ encoffin_count: undefined }] },
    { zones: [{ encoffin_count: NaN }] },
    { zones: [{ encoffin_count: Infinity }] },
    { zones: [{ encoffin_count: Number.MAX_SAFE_INTEGER }, { encoffin_count: 1 }] },
]) {
    assert.deepEqual(directIds({ main: [161002], statistics }), [])
}

for (const statistics of [
    { zones: [{ encoffin_count: 0 }] },
    { quest_statistics: { zones: [{ encoffin_count: 0 }] } },
    { battle: { zones: [{ encoffin_count: 0 }] } },
    { zone_statistics: [{ encoffin_count: 0 }] },
]) {
    assert.deepEqual(directIds({ main: [161002], statistics }), [1610022])
}
assert.deepEqual(directIds({
    main: [161002],
    statistics: { zones: "malformed", quest_statistics: { zones: [{ encoffin_count: 0 }] } },
}), [])

const successfulShapes = [
    { main: [null, 231001], leader: 231001 },
    { main: [null, 231001], leader: 231001, leaderCharacterId: 231001, leaderId: 231001 },
]
for (const shape of successfulShapes) {
    assert.deepEqual(questIds({ ...shape, clearTime: 90000 }), [2310013])
}
assert.deepEqual(questIds({ main: [231001], leader: 999, clearTime: 90000 }), [])
assert.deepEqual(questIds({ main: [null], unison: [231001], clearTime: 90000 }), [])
assert.deepEqual(questIds({
    questCategory: 15,
    questId: 5,
    main: [331003, 1],
    leader: 331003,
    leaderId: 1,
}), [])
for (const value of ["231001", 0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(questIds({ main: [231001], leader: value, clearTime: 90000 }), [])
    assert.deepEqual(questIds({ main: [231001], leaderCharacterId: value, clearTime: 90000 }), [])
    assert.deepEqual(questIds({ main: [231001], leaderId: value, clearTime: 90000 }), [])
}

for (const accomplished of [false, null, 0, 1, "true"]) {
    const options = {
        questAccomplished: accomplished,
        clearTime: 90000,
        statistics: { zones: [{ encoffin_count: 0 }] },
    }
    const ctx = makeContext(options)
    assert.deepEqual(getMatchedAwakeQuestPartyMissionIds(ctx), [])
    assert.deepEqual(getMatchedAwakeRaceMissionIds(ctx, "Devil+Dragon+Human"), [])
    assert.deepEqual(getMatchedAwakeDirectBattleMissionIds(ctx, "Devil+Dragon+Human"), [])
}
const missingAccomplished = deepFreeze({
    questCategory: 21,
    questId: 1006,
    party: { characters: [{ id: 231001 }], unison_characters: [] },
})
assert.deepEqual(getMatchedAwakeQuestPartyMissionIds(missingAccomplished), [])
assert.deepEqual(getMatchedAwakeRaceMissionIds(missingAccomplished, "Devil+Dragon+Human"), [])
assert.deepEqual(getMatchedAwakeDirectBattleMissionIds(missingAccomplished, "Devil+Dragon+Human"), [])
assert.deepEqual(questIds({
    questAccomplished: false,
    questCategory: 13,
    questId: 2001,
    main: [321013],
}), [])
assert.deepEqual(directIds({
    questAccomplished: false,
    main: [161002],
    statistics: { zones: [{ encoffin_count: 0 }] },
}), [])

for (const value of ["1", 0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(questIds({ questCategory: value, clearTime: 90000 }), [])
    assert.deepEqual(questIds({ questId: value, clearTime: 90000 }), [])
}
for (const value of [null, 0, 1, "false"]) {
    assert.deepEqual(questIds({ isMulti: value, clearTime: 90000 }), [])
}
for (const value of ["1", 0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(questIds({ main: [value], clearTime: 90000 }), [])
    assert.deepEqual(questIds({ main: [231001], unison: [value], clearTime: 90000 }), [])
}
assert.deepEqual(getMatchedAwakeQuestPartyMissionIds(deepFreeze({
    questCategory: 21,
    questId: 1006,
    questAccomplished: true,
    party: { characters: null, unison_characters: [] },
})), [])
assert.deepEqual(getMatchedAwakeQuestPartyMissionIds(deepFreeze({
    questCategory: 21,
    questId: 1006,
    questAccomplished: true,
    party: { characters: [], unison_characters: null },
})), [])
assert.deepEqual(getMatchedAwakeQuestPartyMissionIds(deepFreeze({
    questCategory: 21,
    questId: 1006,
    questAccomplished: true,
})), [])
assert.deepEqual(getMatchedAwakeQuestPartyMissionIds(deepFreeze({
    questCategory: 21,
    questId: 1006,
    questAccomplished: true,
    party: { characters: [1], unison_characters: [] },
})), [])
assert.deepEqual(questIds({ questCategory: 99, questId: 999, main: [999] }), [])

assert.deepEqual(directIds({ clearTime: 90000 }, "Devil+Dragon+Human"), [2310012, 2310013])
assert.deepEqual(directIds({ questCategory: 13, questId: 2001, main: [321013] }), [3210132, 3210133])
const firstDirect = directIds({ clearTime: 90000 }, "Devil+Dragon+Human")
const secondDirect = directIds({ clearTime: 90000 }, "Devil+Dragon+Human")
assert.notEqual(firstDirect, secondDirect)
firstDirect.splice(0, firstDirect.length, 9999999)
assert.deepEqual(directIds({ clearTime: 90000 }, "Devil+Dragon+Human"), [2310012, 2310013])
const firstQuest = questIds({ clearTime: 90000 })
const firstRace = getMatchedAwakeRaceMissionIds(raceContext, "Devil+Dragon+Human")
firstQuest.push(9999999)
firstRace.push(9999999)
assert.deepEqual(questIds({ clearTime: 90000 }), [2310013])
assert.deepEqual(getMatchedAwakeRaceMissionIds(raceContext, "Devil+Dragon+Human"), [2310012])

assert.equal(isBondTokenMissionComplete(undefined), false)
assert.equal(isBondTokenMissionComplete(null), false)
assert.equal(isBondTokenMissionComplete({}), false)
assert.equal(isBondTokenMissionComplete("tokens"), false)
assert.equal(isBondTokenMissionComplete([]), false)
assert.equal(isBondTokenMissionComplete(Array(1)), false)
assert.equal(isBondTokenMissionComplete(deepFreeze([{ status: 2 }, { status: 3 }])), true)
assert.equal(isBondTokenMissionComplete([{ status: Number.MAX_SAFE_INTEGER }]), true)
assert.equal(isBondTokenMissionComplete(deepFreeze([{ status: 2 }, { status: 1 }])), false)
for (const value of ["2", 0, 1, 2.5, NaN, Infinity, -Infinity, -1, Number.MAX_SAFE_INTEGER + 1, undefined]) {
    assert.equal(isBondTokenMissionComplete([{ status: value }]), false)
}
for (const value of [null, 1, "token", {}, []]) {
    assert.equal(isBondTokenMissionComplete([value]), false)
}

assert.equal(Object.keys(awakeMaster).length, 144)
for (const [missionId, rows] of Object.entries(awakeMaster)) {
    assert.match(missionId, /^[1-9]\d*$/)
    assert.equal(Number.isSafeInteger(Number(missionId)), true)
    assert.equal(Array.isArray(rows), true)
    assert.equal(rows.length, 1)
    assert.equal(Array.isArray(rows[0]), true)
    assert.equal(rows[0].length, 37)
}

const masterFacts = [
    [2310012, "231001", "94", "231001", "", "Human,Dragon,Devil"],
    [2310013, "231001", "15", "231001", "", ""],
    [1510062, "151006", "93", "151006", "263002", ""],
    [3310032, "331003", "93", "(None)", "331003,1", ""],
    [3310033, "331003", "93", "(None)", "331003,10", ""],
    [3210132, "321013", "93", "(None)", "321013", ""],
    [3210133, "321013", "93", "(None)", "321013", ""],
    [3410012, "341001", "93", "(None)", "341001", ""],
    [3410013, "341001", "93", "(None)", "341001", ""],
    [1610022, "161002", "95", "161002", "", ""],
    [2610072, "261007", "95", "261007", "", ""],
]
for (const [missionId, characterId, pattern, leaderId, partyIds, raceNames] of masterFacts) {
    const row = awakeMaster[String(missionId)][0]
    assert.equal(row[1], characterId)
    assert.equal(row[4], pattern)
    assert.equal(row[23], leaderId)
    assert.equal(row[24], partyIds)
    assert.equal(row[25], raceNames)
}
for (const missionId of [1410033, 2210043, 2510043, 2610073]) {
    assert.equal(awakeMaster[String(missionId)][0][4], "48")
}

for (const [modulePath, previous] of cacheBeforeRules) {
    assert.equal(require.cache[modulePath], previous, `pure test loaded forbidden module ${modulePath}`)
}
assert.equal(require.cache[require.resolve("../src/data/db")], undefined)

console.log("character awake pure battle rule tests passed")
