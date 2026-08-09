require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const { randomUUID } = require("node:crypto")
const Fastify = require("fastify")
const fs = require("node:fs")
const { pack, unpack } = require("msgpackr")
const os = require("node:os")
const path = require("node:path")

const databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "player-history-route-db-"))
const previousDataDirectory = process.env.DATA_DIR
const previousDatabaseDirectory = process.env.WDFP_DATABASE_DIR
process.env.DATA_DIR = databaseDirectory
delete process.env.WDFP_DATABASE_DIR
let db

function cleanup() {
    if (db?.open) db.close()
    fs.rmSync(databaseDirectory, { recursive: true, force: true })
    if (previousDataDirectory === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = previousDataDirectory
    if (previousDatabaseDirectory === undefined) delete process.env.WDFP_DATABASE_DIR
    else process.env.WDFP_DATABASE_DIR = previousDatabaseDirectory
}

process.once("exit", cleanup)

const { initializeDatabase } = require("../src/data")
const { getDb } = require("../src/data/db")
const { insertAccountSync } = require("../src/data/domains/account")
const { insertDefaultPlayerSync } = require("../src/data/domains/player")
const playerHistoryRoutes = require("../src/routes/api/playerHistory").default

initializeDatabase()
db = getDb()
const account = insertAccountSync({
    appId: "wf_cn",
    idpAlias: "",
    idpCode: "test",
    idpId: `player-history-route-test-${randomUUID()}`,
    status: "normal",
})
const player = insertDefaultPlayerSync(account.id)
const viewerId = 800000123
db.prepare("INSERT INTO sessions (token, account_id, expires, type) VALUES (?, ?, ?, ?)")
    .run(String(viewerId), account.id, new Date("2099-12-31T23:59:59.000Z").toISOString(), 2)

function decodeResponse(response) {
    return unpack(Buffer.from(response.body, "base64"))
}

async function main() {
    const fastify = Fastify()
    fastify.addContentTypeParser(
        "application/x-www-form-urlencoded",
        { parseAs: "string" },
        (_request, body, done) => {
            done(null, unpack(Buffer.from(body, "base64")))
        },
    )
    fastify.addHook("onSend", (_request, reply, payload, done) => {
        if (String(reply.getHeader("content-type")).includes("application/x-msgpack")) {
            done(null, pack(payload).toString("base64"))
            return
        }
        done(null, payload)
    })
    await fastify.register(playerHistoryRoutes, {
        prefix: "/api/index.php/player_history",
    })
    await fastify.ready()

    try {
        const response = await fastify.inject({
            method: "POST",
            url: "/api/index.php/player_history/index",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            payload: pack({
                viewer_id: viewerId,
                api_count: 1,
            }).toString("base64"),
        })
        assert.equal(response.statusCode, 200, response.body)

        const data = decodeResponse(response).data
        assert.equal(data.player_history_id, 1)
        assert.equal(data.background_card_id, 1)
        assert.equal(data.degree_id, player.degreeId)
        assert.equal(data.favorite_character.character_ids.length, 3)
        assert.equal(data.favorite_character.unison_character_ids.length, 3)
        assert.deepEqual(data.player_history_topic_list, {})
    } finally {
        await fastify.close()
        cleanup()
        process.removeListener("exit", cleanup)
    }
}

main().then(
    () => console.log("player history route tests passed"),
    error => {
        console.error(error)
        process.exitCode = 1
    },
)
