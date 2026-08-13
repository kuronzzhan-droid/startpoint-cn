require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const { randomUUID } = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const Fastify = require("fastify")
const { pack, unpack } = require("msgpackr")

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mission-progress-route-"))
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
        updatePlayerActiveMissionStageSync,
        updatePlayerActiveMissionSync,
        updatePlayerCategoryMissionSync,
    } = require("../src/data/domains/mission")
    const { insertDefaultPlayerSync } = require("../src/data/domains/player")
    const missionRoutes = require("../src/routes/api/mission").default
    const { getTimeOffset, setServerTimeOffset } = require("../src/utils")

    const previousTimeOffset = getTimeOffset()
    restoreTime = () => setServerTimeOffset(previousTimeOffset)
    setServerTimeOffset(Date.parse("2099-12-30T04:00:00.000Z") - Date.now())

    const account = insertAccountSync({
        appId: "wf_cn",
        idpAlias: "",
        idpCode: "test",
        idpId: `mission-progress-${randomUUID()}`,
        status: "normal",
    })
    const playerId = insertDefaultPlayerSync(account.id).id
    const viewerId = 800000299
    database.prepare("INSERT INTO sessions (token, account_id, expires, type) VALUES (?, ?, ?, ?)")
        .run(String(viewerId), account.id, new Date("2099-12-31T23:59:59.000Z").toISOString(), 2)

    updatePlayerActiveMissionSync(playerId, 107, 1)
    updatePlayerActiveMissionStageSync(playerId, 1, 107, true)

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

    async function update(params, apiCount) {
        return app.inject({
            method: "POST",
            url: "/api/index.php/mission/update_mission_progress",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            payload: encode({ viewer_id: viewerId, api_count: apiCount, mission_param_list: params }),
        })
    }

    try {
        const first = await update([
            { mission_pattern: "twitter_check", progress_value: 1 },
            { mission_pattern: "character_detail_zoom_illust_for_1min_count", progress_value: 1 },
            { mission_pattern: "unknown_client_pattern", progress_value: 99 },
            { mission_pattern: "home_tap_town_character_count", progress_value: -1 },
        ], 1)
        assert.equal(first.statusCode, 200, first.body)
        const firstData = decode(first).data
        assert.equal(getPlayerCategoryMissionsSync(playerId, 1)["107"].progress, 1)
        assert.equal(getPlayerCategoryMissionsSync(playerId, 1)["107"].stages["1"], true)
        assert.equal(getPlayerCategoryMissionsSync(playerId, 5)["47000"].progress, 1)
        assert.equal(firstData.mission_info.some(entry => entry.mission_id === 107), false)
        assert.equal(firstData.mission_info.some(entry => entry.mission_id === 47000), true)
        assert.equal(firstData.degree_list.some(entry => entry.degree_id === 47000), true)
        assert.equal(typeof firstData.mail_arrived, "boolean")
        assert.deepEqual(Object.keys(getPlayerActiveMissionsSync(playerId)), ["107"])

        const second = await update([
            { mission_pattern: "twitter_check", progress_value: 1 },
            { mission_pattern: "character_detail_zoom_illust_for_1min_count", progress_value: 1 },
        ], 2)
        assert.equal(second.statusCode, 200, second.body)
        assert.deepEqual(decode(second).data.mission_info, [])
        assert.equal(getPlayerCategoryMissionsSync(playerId, 1)["107"].progress, 1)
        assert.equal(getPlayerCategoryMissionsSync(playerId, 5)["47000"].progress, 1)

        updatePlayerCategoryMissionSync(playerId, 5, 49000, 0)
        updatePlayerCategoryMissionSync(playerId, 5, 48000, Number.MAX_SAFE_INTEGER)
        const failed = await update([
            { mission_pattern: "home_tap_town_character_count", progress_value: 1 },
            { mission_pattern: "character_detail_play_dot_sp_motion_count", progress_value: 1 },
        ], 3)
        assert.equal(failed.statusCode, 500)
        assert.equal(getPlayerCategoryMissionsSync(playerId, 5)["49000"].progress, 0)
        assert.equal(
            getPlayerCategoryMissionsSync(playerId, 5)["48000"].progress,
            Number.MAX_SAFE_INTEGER,
        )
    } finally {
        await app.close()
        cleanup()
        process.removeListener("exit", cleanup)
    }
}

main().then(
    () => console.log("mission progress route tests passed"),
    error => {
        console.error(error)
        process.exitCode = 1
    },
)
