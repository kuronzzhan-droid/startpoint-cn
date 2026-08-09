const assert = require("node:assert/strict")
const Fastify = require("fastify")

require("ts-node/register/transpile-only")

const previousPassword = process.env.ADMIN_PANEL_PASSWORD
const previousTtl = process.env.ADMIN_SESSION_TTL_HOURS
process.env.ADMIN_PANEL_PASSWORD = "test-only-admin-password"
process.env.ADMIN_SESSION_TTL_HOURS = "1"

const { installManagementAuth } = require("../src/lib/management-auth")

async function main() {
    const app = Fastify()
    installManagementAuth(app)
    app.get("/", async () => ({ legacy: true }))
    app.get("/admin", async () => ({ ok: true }))
    app.get("/api/server/status", async () => ({ ok: true }))
    await app.ready()

    const anonymousPage = await app.inject({ method: "GET", url: "/admin" })
    assert.equal(anonymousPage.statusCode, 302)
    assert.equal(anonymousPage.headers.location, "/admin-login")

    const anonymousApi = await app.inject({ method: "GET", url: "/api/server/status" })
    assert.equal(anonymousApi.statusCode, 401)

    const wrongLogin = await app.inject({
        method: "POST",
        url: "/admin-login",
        payload: { password: "wrong-password" },
    })
    assert.equal(wrongLogin.statusCode, 401)

    const login = await app.inject({
        method: "POST",
        url: "/admin-login",
        payload: { password: "test-only-admin-password" },
    })
    assert.equal(login.statusCode, 200)
    const cookie = login.headers["set-cookie"]
    assert.equal(typeof cookie, "string")
    assert.match(cookie, /^sp_admin_session=/)
    assert.doesNotMatch(cookie, /test-only-admin-password/)

    const authenticatedLoginPage = await app.inject({
        method: "GET",
        url: "/admin-login",
        headers: { cookie },
    })
    assert.equal(authenticatedLoginPage.statusCode, 302)
    assert.equal(authenticatedLoginPage.headers.location, "/admin/")

    const authenticatedRoot = await app.inject({
        method: "GET",
        url: "/",
        headers: { cookie },
    })
    assert.equal(authenticatedRoot.statusCode, 302)
    assert.equal(authenticatedRoot.headers.location, "/admin/")

    const authenticatedApi = await app.inject({
        method: "GET",
        url: "/api/server/status",
        headers: { cookie },
    })
    assert.equal(authenticatedApi.statusCode, 200)

    const logout = await app.inject({
        method: "POST",
        url: "/admin-logout",
        headers: { cookie },
    })
    assert.equal(logout.statusCode, 200)
    assert.match(logout.headers["set-cookie"], /Max-Age=0/)

    await app.close()
}

main().then(
    () => console.log("management auth tests passed"),
    error => {
        console.error(error)
        process.exitCode = 1
    },
).finally(() => {
    if (previousPassword === undefined) delete process.env.ADMIN_PANEL_PASSWORD
    else process.env.ADMIN_PANEL_PASSWORD = previousPassword
    if (previousTtl === undefined) delete process.env.ADMIN_SESSION_TTL_HOURS
    else process.env.ADMIN_SESSION_TTL_HOURS = previousTtl
})
