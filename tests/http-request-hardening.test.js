const test = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const Fastify = require("fastify")

const { resolvePlainFileInside, sendFileStream } = require("../out/lib/file-download")
const { trustProxySetting } = require("../out/lib/client-address")

test("patch archive names resolve only to plain files inside the directory", () => {
    const root = path.join(os.tmpdir(), "patch-root")
    const name = "pinball-1.4.194-1.4.195-1-moon-wolf-art-local.zip"
    assert.strictEqual(resolvePlainFileInside(root, name), path.join(path.resolve(root), name))
    for (const bad of ["", ".", "..", "../a.zip", "..\\a.zip", "a/b.zip", "a\\b.zip", "x..zip", ".env", "C:a.zip", "/a.zip"]) {
        assert.strictEqual(resolvePlainFileInside(root, bad), null, JSON.stringify(bad))
    }
})

test("file downloads stream with a content length and 404 when missing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stream-check-"))
    const file = path.join(dir, "a.zip")
    fs.writeFileSync(file, Buffer.alloc(70000, 7))
    const app = Fastify()
    app.get("/f/:file", async (request, reply) => {
        const target = resolvePlainFileInside(dir, request.params.file)
        if (target && sendFileStream(reply, target, "application/zip")) return reply
        return reply.status(404).send("Not Found")
    })
    try {
        const ok = await app.inject({ method: "GET", url: "/f/a.zip" })
        assert.strictEqual(ok.statusCode, 200)
        assert.strictEqual(ok.headers["content-length"], "70000")
        assert.strictEqual(ok.rawPayload.length, 70000)
        assert.strictEqual((await app.inject({ method: "GET", url: "/f/b.zip" })).statusCode, 404)
        assert.strictEqual((await app.inject({ method: "GET", url: "/f/..%5Ca.zip" })).statusCode, 404)
    } finally {
        await app.close()
        fs.rmSync(dir, { recursive: true, force: true })
    }
})

test("management guard covers every URL form the router resolves", async () => {
    process.env.ADMIN_PANEL_PASSWORD = "Correct-Horse-1"
    const { installManagementAuth } = require("../out/lib/management-auth")
    const app = Fastify()
    installManagementAuth(app)
    app.get("/api/server/currentTime", async () => ({ ok: true }))
    app.get("/api/public", async () => ({ ok: true }))
    try {
        for (const url of [
            "/api/server/currentTime",
            "/api/%73erver/currentTime",
            "/api/server/%63urrentTime",
            "/%61pi/server/currentTime",
        ]) {
            const response = await app.inject({ method: "GET", url })
            assert.strictEqual(response.statusCode, 401, url)
        }
        assert.strictEqual((await app.inject({ method: "GET", url: "/api/public" })).statusCode, 200)
        const malformed = await app.inject({ method: "GET", url: "/api/public", headers: { cookie: "other=%E0%A4%A" } })
        assert.strictEqual(malformed.statusCode, 200)
    } finally {
        await app.close()
    }
})

test("admin login throttling ignores client-supplied forwarding headers", async () => {
    process.env.ADMIN_PANEL_PASSWORD = "Correct-Horse-1"
    const { installManagementAuth } = require("../out/lib/management-auth")
    const app = Fastify({ trustProxy: trustProxySetting("") })
    installManagementAuth(app)
    try {
        for (let i = 0; i < 6; i++) {
            await app.inject({
                method: "POST", url: "/admin-login",
                headers: { "x-forwarded-for": `198.51.100.${i}` },
                remoteAddress: "203.0.113.9",
                payload: { password: "wrong" },
            })
        }
        const blocked = await app.inject({
            method: "POST", url: "/admin-login",
            headers: { "x-forwarded-for": "198.51.100.77" },
            remoteAddress: "203.0.113.9",
            payload: { password: "Correct-Horse-1" },
        })
        assert.strictEqual(blocked.statusCode, 401)
        const other = await app.inject({
            method: "POST", url: "/admin-login",
            remoteAddress: "203.0.113.10",
            payload: { password: "Correct-Horse-1" },
        })
        assert.strictEqual(other.statusCode, 200)
    } finally {
        await app.close()
    }
})

test("trust proxy setting defaults to no trust and accepts explicit HTTP proxies", () => {
    assert.strictEqual(trustProxySetting(""), false)
    assert.strictEqual(trustProxySetting("loopback"), "loopback")
    assert.strictEqual(trustProxySetting("false"), false)
    assert.strictEqual(trustProxySetting("1"), 1)
    assert.strictEqual(trustProxySetting("10.0.0.0/8"), "10.0.0.0/8")
})
