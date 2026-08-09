require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const {
    getSteamRobotMissionClientChecks,
    isSteamRobotChallengeMissionCleared,
} = require("../src/lib/mission/steam-robot-challenge")

const base = {
    questCategory: 26,
    questAccomplished: true,
    clearRank: 5,
}

assert.deepEqual(getSteamRobotMissionClientChecks(26, 1002001), ["hard_multi_steam_robot_water"])
assert.equal(isSteamRobotChallengeMissionCleared({
    ...base,
    questId: 1001001,
    statistics: { zones: [{ members: [{ debuff_r: 0 }] }] },
}), true)
assert.equal(isSteamRobotChallengeMissionCleared({
    ...base,
    questId: 1001001,
    statistics: { zones: [{ members: [{ debuff_r: 1 }] }] },
}), false)
assert.equal(isSteamRobotChallengeMissionCleared({
    ...base,
    questId: 1001001,
    statistics: { quest_statistics: { zones: [{ members: [{ debuff_r: 0 }] }] } },
}), true)
assert.equal(isSteamRobotChallengeMissionCleared({
    ...base,
    questId: 1001001,
    statistics: { quest_statistics: { zones: [{ members: [{ debuff_r: 2 }] }] } },
}), false)
assert.equal(isSteamRobotChallengeMissionCleared({
    ...base,
    questId: 1002001,
    statistics: { quest_statistics: { client_checks: ["hard_multi_steam_robot_water"] } },
}), true)
assert.equal(isSteamRobotChallengeMissionCleared({
    ...base,
    questId: 1003001,
    statistics: { mission_client_checks: [{ value: "hard_multi_steam_robot_thunder" }] },
}), true)
assert.equal(isSteamRobotChallengeMissionCleared({
    ...base,
    questId: 1004001,
    statistics: {
        quest_statistics: {
            client_checks: { hard_multi_steam_robot_wind_coffin_count: true },
        },
    },
}), true)
assert.equal(isSteamRobotChallengeMissionCleared({
    ...base,
    questId: 1005001,
    statistics: {
        mission_client_checks: [{
            check_id: "hard_multi_steam_robot_light",
            cleared: true,
        }],
    },
}), true)
assert.equal(isSteamRobotChallengeMissionCleared({
    ...base,
    questId: 1006001,
    statistics: {
        mission_client_checks: {
            hard_multi_steam_robot_dark: false,
        },
    },
}), false)
assert.equal(isSteamRobotChallengeMissionCleared({
    ...base,
    questId: 1006001,
    statistics: {
        mission_client_checks: [{
            check_id: "hard_multi_steam_robot_dark",
            result: false,
        }],
    },
}), false)
assert.equal(isSteamRobotChallengeMissionCleared({
    ...base,
    questId: 1003001,
    clearRank: 4,
    statistics: { client_checks: ["hard_multi_steam_robot_thunder"] },
}), false)

for (const [questId, clientCheck] of [
    [1002001, "hard_multi_steam_robot_water"],
    [1003001, "hard_multi_steam_robot_thunder"],
    [1004001, "hard_multi_steam_robot_wind_coffin_count"],
    [1005001, "hard_multi_steam_robot_light"],
    [1006001, "hard_multi_steam_robot_dark"],
]) {
    assert.deepEqual(getSteamRobotMissionClientChecks(26, questId), [clientCheck])
    assert.equal(isSteamRobotChallengeMissionCleared({
        ...base,
        questId,
        statistics: { quest_statistics: { mission_client_checks: [{ value: clientCheck }] } },
    }), true)
}

console.log("steam robot challenge tests passed")
