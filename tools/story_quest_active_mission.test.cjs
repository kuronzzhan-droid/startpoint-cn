"use strict"

require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const { randomUUID } = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const Fastify = require("fastify")
const { pack, unpack } = require("msgpackr")

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "story-active-mission-"))
const previousDatabaseDirectory = process.env.WF_DATABASE_DIR
process.env.WF_DATABASE_DIR = temporaryRoot
let database

function cleanup() {
    if (database?.open) database.close()
    if (previousDatabaseDirectory === undefined) delete process.env.WF_DATABASE_DIR
    else process.env.WF_DATABASE_DIR = previousDatabaseDirectory
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
}

process.once("exit", cleanup)

function decode(response) {
    return unpack(Buffer.from(response.body, "base64"))
}

async function createPlayer(sequence) {
    const { insertAccountSync } = require("../src/data/domains/account")
    const { insertDefaultPlayerSync } = require("../src/data/domains/player")
    const { insertSessionWithToken } = require("../src/data/domains/session")
    const { SessionType } = require("../src/data/types")
    const account = insertAccountSync({
        appId: "wf_cn",
        idpAlias: "",
        idpCode: "test",
        idpId: `story-active-${sequence}-${randomUUID()}`,
        status: "normal",
    })
    const playerId = insertDefaultPlayerSync(account.id).id
    const viewerId = 860000000 + sequence
    await insertSessionWithToken({
        token: String(viewerId),
        accountId: account.id,
        expires: new Date("2099-12-31T23:59:59.000Z"),
        type: SessionType.VIEWER,
    })
    return { playerId, viewerId }
}

async function finish(app, viewerId) {
    return app.inject({
        method: "POST",
        url: "/story/finish",
        payload: {
            category: 3,
            quest_id: 101,
            party_id: 1,
            viewer_id: viewerId,
            api_count: 1,
        },
    })
}

async function main() {
    const { getDb } = require("../src/data/db")
    const { getPlayerActiveMissionsSync } = require("../src/data/domains/mission")
    const { getPlayerSingleQuestProgressSync } = require("../src/data/domains/quest")
    const storyRoutes = require("../src/routes/api/storyQuest").default
    database = getDb()

    const app = Fastify({ logger: false })
    app.addHook("onSend", (_request, reply, payload, done) => {
        if (String(reply.getHeader("content-type")).includes("application/x-msgpack")) {
            done(null, pack(payload).toString("base64"))
            return
        }
        done(null, payload)
    })
    await app.register(storyRoutes, { prefix: "/story" })
    await app.ready()

    try {
        const success = await createPlayer(1)
        const response = await finish(app, success.viewerId)
        assert.equal(response.statusCode, 200, response.body)
        const data = decode(response).data
        assert.deepEqual(
            data.active_mission_list.find(entry => entry.mission_id === 11010),
            {
                mission_id: 11010,
                progress_value: 1,
                stages: [{ stage: 1, received: false }],
            },
        )
        assert.equal(getPlayerActiveMissionsSync(success.playerId)[11010].progress, 1)

        const rollback = await createPlayer(2)
        database.exec(`
            CREATE TRIGGER reject_story_active_mission
            BEFORE INSERT ON players_active_missions
            WHEN NEW.player_id = ${rollback.playerId} AND NEW.id = 11010
            BEGIN SELECT RAISE(ABORT, 'forced story active mission failure'); END
        `)
        const failed = await finish(app, rollback.viewerId)
        assert.equal(failed.statusCode, 500)
        assert.equal(getPlayerSingleQuestProgressSync(rollback.playerId, 3, 101), null)
        assert.equal(getPlayerActiveMissionsSync(rollback.playerId)[11010], undefined)
        database.exec("DROP TRIGGER reject_story_active_mission")
    } finally {
        await app.close()
        cleanup()
        process.removeListener("exit", cleanup)
    }
}

main().then(
    () => console.log("story quest active mission tests passed"),
    error => {
        console.error(error)
        process.exitCode = 1
    },
)
