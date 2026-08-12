require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const { mergeMissionSettlementResponse } = require("../src/lib/mission/response")

const data = {
    mission_info: [{ mission_category_id: 9, mission_id: 100, mission_reward_id: 1 }],
    user_info: { free_mana: 10, rank_point: 20 },
    item_list: { 1: 5, 2: 7 },
    character_list: [
        { character_id: 10, level: 2, mana_board_awake: { 1: 1 } },
        { character_id: 11, level: 1 },
    ],
    equipment_list: [
        { equipment_id: 20, level: 1 },
        { equipment_id: 21, level: 1 },
    ],
    degree_list: [{ viewer_id: 99, degree_id: 30 }],
}

mergeMissionSettlementResponse(data, {
    missionInfo: [{ mission_category_id: 1, mission_id: 6, mission_reward_id: 6001 }],
    userInfo: { free_mana: 50, free_vmoney: 60 },
    itemList: { 1: 8, 3: 9 },
    characterList: [
        { character_id: 10, level: 3, mana_board_awake: { 2: 1 } },
        { character_id: 12, level: 1 },
    ],
    equipmentList: [
        { equipment_id: 20, level: 2 },
        { equipment_id: 22, level: 1 },
    ],
    degreeIds: [30, 31],
    passCardPoints: { 3: 50 },
}, 99)

assert.deepEqual(data.mission_info.map(entry => entry.mission_id), [100, 6])
assert.deepEqual(data.user_info, { free_mana: 50, rank_point: 20, free_vmoney: 60 })
assert.deepEqual(data.item_list, { 1: 8, 2: 7, 3: 9 })
assert.deepEqual(data.character_list, [
    { character_id: 10, level: 3, mana_board_awake: { 1: 1, 2: 1 } },
    { character_id: 11, level: 1 },
    { character_id: 12, level: 1 },
])
assert.deepEqual(data.equipment_list, [
    { equipment_id: 20, level: 2 },
    { equipment_id: 21, level: 1 },
    { equipment_id: 22, level: 1 },
])
assert.deepEqual(data.degree_list, [
    { viewer_id: 99, degree_id: 30 },
    { viewer_id: 99, degree_id: 31 },
])

const empty = {}
mergeMissionSettlementResponse(empty, {
    missionInfo: [],
    itemList: {},
    characterList: [],
    equipmentList: [],
    degreeIds: [],
    passCardPoints: {},
}, 99)
assert.deepEqual(empty, {
    mission_info: [],
    item_list: {},
    character_list: [],
    equipment_list: [],
    degree_list: [],
})

console.log("mission response merge tests passed")
