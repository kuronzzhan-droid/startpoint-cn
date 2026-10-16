const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

require("ts-node/register/transpile-only")

const tempDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "sp-lounge-recovery-"))
process.env.DATA_DIR = tempDataDirectory

const Fastify = require("fastify")
const loungeRoutes = require("../src/routes/api/lounge.ts").default
const { getDb } = require("../src/data/db")
const { insertAccountSync } = require("../src/data/domains/account")
const { insertDefaultPlayerSync } = require("../src/data/domains/player")
const { insertSessionWithToken } = require("../src/data/domains/session")
const { SessionType } = require("../src/data/types")
const { handleLoungeHandshake } = require("../src/lounge/tcp.ts")
const { LOUNGE_DISBANDED_STATE, LOUNGE_DISMISSED_MESSAGE } = require("../src/lounge/protocol.ts")

class FakeSocket {
    constructor() {
        this.frames = []
        this.writable = true
        this.destroyed = false
    }

    write(frame) {
        this.frames.push(String(frame))
        return true
    }

    once() {
        return this
    }

    end() {
        this.writable = false
    }
}

async function main() {
    const account = insertAccountSync({
        appId: "wf_cn",
        idpAlias: "",
        idpCode: "test",
        idpId: "lounge-recovery-test",
        status: "normal",
    })
    insertDefaultPlayerSync(account.id)
    await insertSessionWithToken({
        token: "123456789",
        accountId: account.id,
        expires: new Date(0),
        type: SessionType.VIEWER,
    })

    const app = Fastify()
    app.addHook("onSend", (_request, reply, payload, done) => {
        if (reply.getHeader("content-type") === "application/x-msgpack" && typeof payload === "object") {
            done(null, JSON.stringify(payload))
            return
        }
        done(null, payload)
    })
    await app.register(loungeRoutes, { prefix: "/lounge" })

    for (const endpoint of ["restore", "select", "prepare"]) {
        const response = await app.inject({
            method: "POST",
            url: `/lounge/${endpoint}`,
            payload: {
                viewer_id: 123456789,
                use_case: 1,
                lounge_id: 987654321,
                advice: "stale-advice",
                establisher_viewer_id: 987654322,
            },
        })
        assert.equal(response.statusCode, 200)
        const body = JSON.parse(response.body)
        assert.equal(body.data_headers.result_code, 1, `${endpoint} must be recoverable`)
        assert.equal(body.data.raising_state, LOUNGE_DISBANDED_STATE)
        assert.equal(body.data.port, 0)
    }

    const socket = new FakeSocket()
    await handleLoungeHandshake(socket, {
        viewerId: 123456789,
        loungeId: 987654321,
        useCase: 1,
        advice: "stale-advice",
        establisherViewerId: 987654322,
    })
    assert.deepEqual(JSON.parse(socket.frames[0].replace(/\0$/, "")), [1, LOUNGE_DISMISSED_MESSAGE])

    await app.close()
    getDb().close()
    fs.rmSync(tempDataDirectory, { recursive: true, force: true })
    console.log("lounge recovery protocol tests passed")
}

main().catch(error => {
    try { getDb().close() } catch {}
    fs.rmSync(tempDataDirectory, { recursive: true, force: true })
    console.error(error)
    process.exitCode = 1
})
