const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const compiled = process.env.STARPOINT_TEST_COMPILED !== "0"
if (!compiled) require("ts-node/register/transpile-only")
const load = name => require(`../${compiled ? "out" : "src"}/${name}`)

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "starpoint-sponsor-degree-"))
process.env.DATA_DIR = dataDir
const Fastify = require("fastify")
const { pack, unpack } = require("msgpackr")
const { getDb } = load("data/db")
const { insertAccountSync } = load("data/domains/account")
const { insertDefaultPlayerSync, getPlayerSync } = load("data/domains/player")
const { insertSessionWithToken } = load("data/domains/session")
const { saveAccountDefaultPlayer } = load("data/activeAccount")
const { getPlayerMailsSync } = load("data/domains/mail")
const { getPlayerDegreeIdsSync, hasPlayerDegreeSync } = load("data/domains/degree")
const { degreeDefinitions } = load("lib/content-master")
const identities = load("lib/gameplay-request-identity")
identities.initializeGameplayRequestIdentitySchemaSync(getDb())
const definition = require("../assets/degree_sponsor.json")["9900012"]
const ID = 9900012

test.after(() => {
    if (getDb().open) getDb().close()
    const resolved = path.resolve(dataDir)
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()))
    assert.ok(path.basename(resolved).startsWith("starpoint-sponsor-degree-"))
    fs.rmSync(resolved, { recursive: true, force: true })
})

test("赞助称号进入实际合并主数据，ID唯一且与客户端资料一致", () => {
    assert.equal(require("../assets/degree.json")[ID], undefined)
    assert.equal(require("../assets/degree_rank_p5b.json")[ID], undefined)
    assert.deepEqual(degreeDefinitions[ID], definition)
    assert.equal(definition.name, "特别鸣谢")
    assert.equal(definition.condition, "感谢您对 StarPoint CN 的支持与赞助。")
    assert.equal(definition.category_id, 8)
    const audit = require("../assets/asset-patch/audit/sponsor-special-thanks-1.4.105/report.json")
    assert.equal(audit.degree_id, ID)
    assert.deepEqual(audit.definition, degreeDefinitions[ID])
    assert.equal(audit.client_fields[0], definition.string_id)
    assert.equal(audit.client_fields[2], definition.name)
    assert.equal(audit.client_fields[4], definition.condition)
    assert.equal(Number(audit.client_fields[5]), definition.category_id)
})

test("赞助称号经定向邮件领取、佩戴和重启持久化", async t => {
    const app = Fastify({ logger: false })
    app.addHook("onSend", (_request, reply, payload, done) => {
        done(null, reply.getHeader("content-type") === "application/x-msgpack" ? pack(payload) : payload)
    })
    await app.register(load("routes/web_api/mail").default, { prefix: "/admin/mail" })
    await app.register(load("routes/api/mail").default, { prefix: "/mail" })
    await app.register(load("routes/api/profile").default, { prefix: "/profile" })
    await app.ready()
    t.after(() => app.close())
    const identitiesByViewer = new Map()
    async function player(name) {
        const account = insertAccountSync({ appId: "wf_cn", idpAlias: "", idpCode: "sponsor-test", idpId: name, status: "normal" })
        const saved = insertDefaultPlayerSync(account.id)
        saveAccountDefaultPlayer(account.id, saved.id)
        const viewerId = 725000000 + saved.id
        await insertSessionWithToken({ token: String(viewerId), accountId: account.id, type: 2,
            expires: new Date(Date.now() + 86400000) })
        const token = getDb().transaction(() => identities.issueGameplayLoginTokenSync(getDb(), {
            accountId: account.id, viewerId, udid: "sponsor-" + viewerId, expiresAt: Date.now() + 86400000,
        }))()
        const result = { id: saved.id, viewerId, token, count: 0 }
        identitiesByViewer.set(viewerId, result)
        return result
    }
    const sponsor = await player("sponsor")
    const other = await player("other")
    async function request(url, payload, status = 200) {
        const native = url.startsWith("/mail/") ? identitiesByViewer.get(payload.viewer_id) : null
        if (native) payload = { ...payload, api_count: ++native.count }
        const response = await app.inject({ method: "POST", url, payload,
            headers: { accept: "application/json", ...(native ? { login_token: native.token } : {}) } })
        assert.equal(response.statusCode, status, response.payload)
        return response.headers["content-type"].startsWith("application/x-msgpack")
            ? unpack(response.rawPayload) : response.json()
    }
    const send = (number = "0") => request("/admin/mail/send", {
        type: "13", type_id: String(ID), number, playerId: String(sponsor.id),
        subject: "特别鸣谢", description: definition.condition,
    }, number === "0" ? 200 : 400)
    const list = target => request("/profile/get_degree_list", { viewer_id: target.viewerId })
    const equip = (target, status = 200) => request("/profile/update_degree",
        { viewer_id: target.viewerId, degree_id: ID }, status)
    let mail

    await t.test("访问资料不自动授予，未拥有者不能佩戴", async () => {
        assert.ok(!(await list(sponsor)).data.degree_ids.includes(ID))
        assert.ok(!(await list(other)).data.degree_ids.includes(ID))
        await equip(other, 400)
    })
    await t.test("后台识别新ID，数量固定为0，只投递指定存档", async () => {
        await send("1")
        assert.equal(getPlayerMailsSync(sponsor.id).length, 0)
        assert.deepEqual(await send(), { ok: true, sent: 1 })
        mail = getPlayerMailsSync(sponsor.id)[0]
        assert.equal(mail.type, 13)
        assert.equal(mail.type_id, ID)
        assert.equal(mail.number, 0)
        assert.equal(mail.reward_period_limited, 0)
        assert.equal(getPlayerMailsSync(other.id).length, 0)
        assert.equal(hasPlayerDegreeSync(sponsor.id, ID), false)
    })
    await t.test("收件人领取后获得通知和所有权，他人不能代领", async () => {
        await request("/mail/receive", { viewer_id: other.viewerId, mail_id: mail.id }, 400)
        const claimed = await request("/mail/receive", { viewer_id: sponsor.viewerId, mail_id: mail.id })
        assert.deepEqual(claimed.data.degree_list, [{ viewer_id: sponsor.viewerId, degree_id: ID }])
        assert.ok((await list(sponsor)).data.degree_ids.includes(ID))
        assert.equal(hasPlayerDegreeSync(other.id, ID), false)
    })
    await t.test("重复领取或重复邮件均不增加称号所有权", async () => {
        const acknowledged = await request("/mail/receive", { viewer_id: sponsor.viewerId, mail_id: mail.id })
        assert.deepEqual(acknowledged.data.degree_list, [{ viewer_id: sponsor.viewerId, degree_id: ID }])
        await send()
        const duplicate = getPlayerMailsSync(sponsor.id)[0]
        const claimed = await request("/mail/receive", { viewer_id: sponsor.viewerId, mail_id: duplicate.id })
        assert.equal(claimed.data.degree_list, undefined)
        assert.equal(getPlayerDegreeIdsSync(sponsor.id).filter(id => id === ID).length, 1)
    })
    await t.test("佩戴写入资料，其他玩家看到同一称号ID", async () => {
        assert.equal((await equip(sponsor)).data.user_info.degree_id, ID)
        assert.equal(getPlayerSync(sponsor.id).degreeId, ID)
        const profile = await request("/profile/get_profile", {
            viewer_id: other.viewerId, target_viewer_id: sponsor.viewerId,
        })
        assert.equal(profile.data.target_user_info.degree_id, ID)
    })
    await t.test("新进程重新读取仍持有并佩戴，未产生限时状态", () => {
        const script = `${compiled ? "" : "require('ts-node/register/transpile-only');"}const d=require('./${compiled ? "out" : "src"}/data/domains/degree');
            const p=require('./${compiled ? "out" : "src"}/data/domains/player');
            console.log(JSON.stringify({owned:d.getPlayerDegreeIdsSync(${sponsor.id}),
                equipped:p.getPlayerSync(${sponsor.id}).degreeId}));`
        const child = spawnSync(process.execPath, ["-e", script], {
            cwd: path.resolve(__dirname, ".."), env: process.env, encoding: "utf8", timeout: 30000,
        })
        assert.equal(child.status, 0, child.stderr)
        const persisted = JSON.parse(child.stdout.trim().split(/\r?\n/).at(-1))
        assert.ok(persisted.owned.includes(ID))
        assert.equal(persisted.equipped, ID)
    })
})
