require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const { randomUUID } = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const Fastify = require("fastify")
const { pack, unpack } = require("msgpackr")

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mission-auto-settlement-route-"))
const previousDatabaseDirectory = process.env.WF_DATABASE_DIR
process.env.WF_DATABASE_DIR = temporaryRoot
let database
let restoreTime = () => {}

function cleanup() {
    if (database?.open) database.close()
    restoreTime()
    if (previousDatabaseDirectory === undefined) delete process.env.WF_DATABASE_DIR
    else process.env.WF_DATABASE_DIR = previousDatabaseDirectory
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
}

process.once("exit", cleanup)

function encode(body) {
    return pack(body).toString("base64")
}

function decode(response) {
    return unpack(Buffer.from(response.body, "base64"))
}

async function main() {
    const { getDb } = require("../src/data/db")
    database = getDb()
    const { insertAccountSync } = require("../src/data/domains/account")
    const {
        getPlayerActiveMissionsSync,
        getPlayerCategoryMissionsSync,
        updatePlayerCategoryMissionStageSync,
        updatePlayerCategoryMissionSync,
        updatePlayerActiveMissionStageSync,
        updatePlayerActiveMissionSync,
    } = require("../src/data/domains/mission")
    const { recordMissionBattleResultSync } = require("../src/data/domains/mission_battle_facts")
    const { getPlayerCharacterAwakeUnlocksSync } = require("../src/data/domains/character_awake")
    const { getPlayerSync, insertDefaultPlayerSync, updatePlayerSync } = require("../src/data/domains/player")
    const missionRoutes = require("../src/routes/api/mission").default
    const { getTimeOffset, setServerTimeOffset } = require("../src/utils")

    const previousTimeOffset = getTimeOffset()
    restoreTime = () => setServerTimeOffset(previousTimeOffset)
    setServerTimeOffset(Date.parse("2024-08-14T12:00:00.000Z") - Date.now())

    const account = insertAccountSync({
        appId: "wf_cn",
        idpAlias: "",
        idpCode: "test",
        idpId: `mission-auto-settlement-${randomUUID()}`,
        status: "normal",
    })
    const playerId = insertDefaultPlayerSync(account.id).id
    const viewerId = 800000298
    database.prepare("INSERT INTO sessions (token, account_id, expires, type) VALUES (?, ?, ?, ?)")
        .run(String(viewerId), account.id, new Date("2099-12-31T23:59:59.000Z").toISOString(), 2)

    updatePlayerSync({
        id: playerId,
        totalStaminaUsed: 100,
        totalDashes: 100,
        totalLoginDays: 4,
        totalPowerflips: 100,
    })
    for (let index = 0; index < 20; index += 1) {
        recordMissionBattleResultSync(playerId, {
            isMulti: false,
            accomplished: true,
            clearRank: 5,
        })
    }
    updatePlayerActiveMissionSync(playerId, 11, 1)
    updatePlayerActiveMissionStageSync(playerId, 1, 11, true)
    for (let index = 0; index < 20; index += 1) {
        recordMissionBattleResultSync(playerId, {
            isMulti: true,
            isHost: true,
            accomplished: true,
            clearRank: 5,
        })
    }

    const app = Fastify()
    app.addContentTypeParser(
        "application/x-www-form-urlencoded",
        { parseAs: "string" },
        (_request, body, done) => done(null, unpack(Buffer.from(body, "base64"))),
    )
    app.addHook("onSend", (_request, reply, payload, done) => {
        if (String(reply.getHeader("content-type")).includes("application/x-msgpack")) {
            done(null, pack(payload).toString("base64"))
            return
        }
        done(null, payload)
    })
    await app.register(missionRoutes, { prefix: "/api/index.php/mission" })
    await app.ready()

    try {
        updatePlayerActiveMissionSync(playerId, 107, 1)
        const disabledLegacy = await app.inject({
            method: "POST",
            url: "/api/index.php/mission/get_mission_progress",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            payload: encode({
                viewer_id: viewerId,
                api_count: 0,
                category_list: [{ category: 1 }],
            }),
        })
        assert.equal(disabledLegacy.statusCode, 200, disabledLegacy.body)
        assert.equal(
            getPlayerCategoryMissionsSync(playerId, 1)["107"],
            undefined,
            "disabled legacy missions must not be imported before their active window",
        )
        database.prepare("DELETE FROM players_active_missions WHERE player_id = ? AND id = 107").run(playerId)

        const first = await app.inject({
            method: "POST",
            url: "/api/index.php/mission/get_mission_progress",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            payload: encode({
                viewer_id: viewerId,
                api_count: 1,
                category_list: [{ category: 2 }, { category: 10 }],
            }),
        })
        assert.equal(first.statusCode, 200, first.body)
        const firstData = decode(first).data
        assert.equal(firstData.mission_progress_list.some(entry => entry.mission_category === 2), true)
        assert.equal(firstData.mission_progress_list.some(entry => entry.mission_category === 10), true)
        assert.equal(firstData.mission_info.some(entry => entry.mission_category_id === 2), true)
        assert.equal(firstData.mission_info.some(entry => entry.mission_category_id === 10), true)
        assert.equal(
            firstData.mission_info.some(entry => entry.mission_category_id === 2 && entry.mission_id === 11),
            false,
            "a legacy received stage must not be granted again",
        )

        const daily = getPlayerCategoryMissionsSync(playerId, 2)
        const weekly = getPlayerCategoryMissionsSync(playerId, 10)
        assert.equal((daily["11"]?.progress ?? 0) > 0, true)
        assert.equal((weekly["1"]?.progress ?? 0) > 0, true)
        assert.equal(daily["11"].stages["1"], true, "legacy receipt state must be imported per category")
        assert.deepEqual(Object.keys(getPlayerActiveMissionsSync(playerId)), ["11"])

        const playerAfterFirst = getPlayerSync(playerId)
        const second = await app.inject({
            method: "POST",
            url: "/api/index.php/mission/get_mission_progress",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            payload: encode({
                viewer_id: viewerId,
                api_count: 2,
                category_list: [{ category: 2 }, { category: 10 }],
            }),
        })
        assert.equal(second.statusCode, 200, second.body)
        const secondData = decode(second).data
        assert.deepEqual(secondData.mission_info, [], "settlement must be idempotent")
        assert.equal(getPlayerSync(playerId).freeVmoney, playerAfterFirst.freeVmoney)

        const awake = await app.inject({
            method: "POST",
            url: "/api/index.php/mission/get_mission_progress",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            payload: encode({
                viewer_id: viewerId,
                api_count: 3,
                category_list: [{ category: 9, character_id: 1 }],
            }),
        })
        assert.equal(awake.statusCode, 200, awake.body)
        const awakeData = decode(awake).data
        assert.equal(awakeData.mission_info.some(entry => entry.mission_id === 13), true)
        assert.equal(
            awakeData.mission_info.some(entry => entry.mission_id === 14),
            false,
            "an all-complete awake mission must not unlock after only one child completes",
        )
        assert.equal((getPlayerCategoryMissionsSync(playerId, 9)["13"]?.progress ?? 0) >= 97, true)
        assert.equal(getPlayerCategoryMissionsSync(playerId, 9)["14"]?.progress ?? 0, 1)
        assert.deepEqual(
            Object.keys(getPlayerActiveMissionsSync(playerId)),
            ["11"],
            "awake settlement must not add to the legacy tables",
        )

        updatePlayerCategoryMissionSync(playerId, 9, 11, 3)
        updatePlayerCategoryMissionStageSync(playerId, 9, 1, 11, true)
        updatePlayerCategoryMissionSync(playerId, 9, 12, 100)
        updatePlayerCategoryMissionStageSync(playerId, 9, 1, 12, true)
        assert.deepEqual(getPlayerCategoryMissionsSync(playerId, 9)["14"]?.stages ?? [], [])
        database.exec(`
            CREATE TRIGGER fail_awake_all_complete
            BEFORE INSERT ON players_category_mission_stages
            WHEN NEW.category = 9 AND NEW.mission_id = 14
            BEGIN SELECT RAISE(ABORT, 'awake stage failure'); END
        `)
        const failedAwake = await app.inject({
            method: "POST",
            url: "/api/index.php/mission/get_mission_progress",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            payload: encode({
                viewer_id: viewerId,
                api_count: 4,
                category_list: [{ category: 9, character_id: 1 }],
            }),
        })
        assert.equal(failedAwake.statusCode, 500)
        assert.equal(getPlayerCategoryMissionsSync(playerId, 9)["14"]?.progress ?? 0, 1)
        assert.equal(getPlayerCategoryMissionsSync(playerId, 9)["14"].stages["1"], undefined)
        assert.equal(getPlayerCharacterAwakeUnlocksSync(playerId).has("1"), false)
        database.exec("DROP TRIGGER fail_awake_all_complete")

        const completedResponse = await app.inject({
            method: "POST",
            url: "/api/index.php/mission/get_mission_progress",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            payload: encode({
                viewer_id: viewerId,
                api_count: 5,
                category_list: [{ category: 9, character_id: 1 }],
            }),
        })
        assert.equal(completedResponse.statusCode, 200, completedResponse.body)
        const completedAwake = decode(completedResponse).data
        assert.equal(
            completedAwake.mission_info.some(entry => entry.mission_id === 14),
            true,
            JSON.stringify({ completedAwake, stored: getPlayerCategoryMissionsSync(playerId, 9) }),
        )
        assert.deepEqual(completedAwake.character_list[0].mana_board_awake, { 1: 1 })
    } finally {
        await app.close()
        cleanup()
        process.removeListener("exit", cleanup)
    }
}

main().then(
    () => console.log("mission auto settlement route tests passed"),
    error => {
        console.error(error)
        process.exitCode = 1
    },
)
