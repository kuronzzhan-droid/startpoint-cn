const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { setTimeout: delay } = require('node:timers/promises')

// A duplicate writeHead is an uncaught exception: use real sockets in a child
// process, so a failing route cannot terminate the test runner itself.
async function runScenario(scenario) {
    const Fastify = require('fastify')
    const msgpack = require('msgpackr')
    const { installCnResponseEncoding } = require('../out/lib/cn-response-hook')
    const { CnResponseWorkerPool } = require('../out/lib/cn-response-worker-pool')
    const { getCnLoadHttpCompressionConfig } = require('../out/lib/cn-load-http-compression')
    const { getDb } = require('../out/data/db')
    const { getPlayerSync, updatePlayerSync } = require('../out/data/domains/player')
    const { getPlayerCharacterSync } = require('../out/data/domains/character')
    const { getPlayerTriggeredTutorialsSync } = require('../out/data/domains/tutorial')
    const { getSession, insertSessionWithToken } = require('../out/data/domains/session')
    const { resolvePlayerIdSync } = require('../out/data/activeAccount')
    const db = getDb()
    const logs = []
    const app = Fastify({ logger: { level: 'warn', stream: { write: line => logs.push(line) } } })
    const pool = new CnResponseWorkerPool({
        size: scenario === 'workers-disabled' ? 0 : 1,
        minimumLength: scenario === 'worker' ? 0 : 512 * 1024,
        maxPending: 128,
    })
    installCnResponseEncoding(app, { pool, compression: getCnLoadHttpCompressionConfig({ CN_LOAD_HTTP_COMPRESSION: 'off' }) })
    const workerPayload = JSON.stringify({ fixture: 'worker', text: 'encode'.repeat(10000) })
    app.post('/fixture/worker', async (_request, reply) => reply.type('application/x-msgpack').send(workerPayload))
    if (scenario === 'delayed') app.addHook('onSend', async (_request, _reply, payload) => {
        await delay(10)
        return payload
    })
    for (const [moduleName, prefix] of [
        ['cn/leitingAuth', '/api/index.php'], ['cn/tool', '/api/index.php/tool'],
        ['api/tutorial', '/api/index.php/tutorial'], ['api/index', '/legacy'],
        ['api/tool', '/legacy/tool'], ['api/asset', '/legacy/asset'],
        ['api/news', '/news'], ['api/passCard', '/pass'], ['api/playerHistory', '/history'],
        ['api/character/mana', '/character'], ['api/character/bond', '/character'],
        ['cn/asset', '/asset'], ['cn/versionCheck', ''],
        ['web/index', '/web'], ['web_api/seeds', '/seeds'], ['web_api/server', '/server'],
        ['web_api/leaderboards', '/leaderboards'], ['web_api/news', '/admin-news'],
    ]) app.register(require('../out/routes/' + moduleName).default, { prefix })

    let expected = 0, writes = 0, completed = 0
    app.addHook('onRequest', (_request, reply, done) => {
        const original = reply.raw.writeHead
        reply.raw.writeHead = function (...args) { writes++; return original.apply(this, args) }
        done()
    })
    app.addHook('onResponse', (_request, _reply, done) => { completed++; done() })
    await app.listen({ host: '127.0.0.1', port: 0 })
    const port = app.server.address().port
    async function request(route, body = {}, status = 200, method = 'POST', headers = {}) {
        expected++
        const payload = method === 'GET' ? undefined : JSON.stringify(body)
        const response = await new Promise((resolve, reject) => {
            const req = http.request({ hostname: '127.0.0.1', port, path: route, method,
                headers: { ...(payload === undefined ? {} : {
                    'content-type': 'application/json', 'content-length': Buffer.byteLength(payload),
                }), ...headers } }, res => {
                const chunks = []
                res.on('data', chunk => chunks.push(chunk))
                res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
                res.on('error', reject)
            })
            req.setTimeout(5000, () => req.destroy(Error('HTTP timeout: ' + route)))
            req.on('error', reject)
            req.end(payload)
        })
        assert.equal(response.status, status, `${method} ${route}: ${response.body}`)
        const type = response.headers['content-type'] || ''
        if (type.includes('application/x-msgpack')) {
            const decoded = msgpack.unpack(Buffer.from(response.body.toString(), 'base64'))
            return typeof decoded === 'string' ? JSON.parse(decoded) : decoded
        }
        return type.includes('application/json') ? JSON.parse(response.body) : response.body.toString()
    }
    const leiting = '/api/index.php/channels/channel_leiting/'
    try {
        const login = await request(leiting + 'leiting_login', { userId: 'lifecycle-fixture' })
        assert.deepEqual(login.data, { status: 'success', userId: 'lifecycle-fixture',
            data: { idCard: '123456', age: 18, isGuest: 0, auth: 1 }, online_server_check: true, heart_beat_interval: 240 })
        const anti = await request(leiting + 'leiting_antiaddiction_login')
        assert.equal(anti.data.status, 0)
        assert.equal(anti.data.data.limitTime, 999999)
        for (const endpoint of ['leiting_antiaddiction_logout', 'leiting_update']) {
            assert.deepEqual((await request(leiting + endpoint)).data, {})
        }
        assert.deepEqual((await request('/api/index.php/tool/auth')).data, {})
        const signup = await request('/api/index.php/tool/signup', { device_id: 728193 }, 200, 'POST', { udid: 'fixture-device' })
        assert.equal(signup.data.newAccount, 1)
        const viewerId = signup.data_headers.viewer_id
        const session = await getSession(String(viewerId))
        const playerId = resolvePlayerIdSync(session.accountId)
        assert.ok(getPlayerSync(playerId))
        const reused = await request('/api/index.php/tool/signup', { device_id: 728193 }, 200, 'POST', { udid: 'fixture-device' })
        assert.equal(reused.data.newAccount, 0)
        assert.equal(reused.data_headers.viewer_id, viewerId)
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 1)

        await request('/api/index.php/tutorial/finish_trigger', { viewer_id: viewerId, tutorial_ids: [101, 102] })
        assert.deepEqual(getPlayerTriggeredTutorialsSync(playerId).filter(id => id === 101 || id === 102).sort(), [101, 102])
        updatePlayerSync({ id: playerId, tutorialStep: 0, tutorialSkipFlag: false })
        const nativeHeaders = { login_token: reused.data.login_token }
        const step = await request('/api/index.php/tutorial/update_step', { viewer_id: viewerId, step: 0, api_count: 1 }, 200, 'POST', nativeHeaders)
        assert.equal(step.data.step, 1)
        assert.equal(getPlayerSync(playerId).tutorialStep, 1)
        const manaBefore = getPlayerSync(playerId).freeVmoney
        updatePlayerSync({ id: playerId, tutorialStep: 15 })
        const gift = await request('/api/index.php/tutorial/update_step', { viewer_id: viewerId, step: 15, api_count: 2 }, 200, 'POST', nativeHeaders)
        assert.equal(gift.data.step, 16)
        assert.equal(getPlayerSync(playerId).freeVmoney, manaBefore)
        assert.equal(require('../out/data/domains/item').getPlayerItemSync(playerId, 999012), 1)
        assert.ok(getPlayerCharacterSync(playerId, 243001))
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM players_mails WHERE player_id = ? AND number = 500').get(playerId).n, 0)

        await insertSessionWithToken({ token: 'fixture-zat', accountId: session.accountId, type: 0, expires: new Date(Date.now() + 60000) })
        const legacy = await request('/legacy/tool/signup', { access_token: 'fixture-zat' }, 200, 'POST', { udid: 'fixture-device' })
        assert.equal(legacy.data_headers.viewer_id, viewerId)
        const load = await request('/legacy/load', { access_token: 'fixture-zat', viewer_id: viewerId })
        assert.ok(load.data.user_info)
        await request('/legacy/asset/version_info', {}, 200, 'POST', { device: 'android' })

        // Helpers send errors before returning null; the owning async handler
        // must still wait for the response when another onSend hook is delayed.
        for (const route of ['/news/index', '/news/get_info', '/news/latest_forced',
            '/history/index', '/history/edit', '/pass/get_pass_card', '/pass/receive_all']) {
            assert.equal((await request(route, {}, 400)).error, 'Bad Request')
            assert.equal((await request(route, { viewer_id: 999991, pass_card_id: 1 }, 400)).message, 'Invalid viewer id.')
        }
        for (const route of ['/character/learn_mana_node', '/character/awake_mana_node', '/character/receive_bond_token']) {
            const body = { character_id: 999999, mana_board_index: 1, mana_node_multiplied_id_list: [1], awake_level: 1 }
            assert.equal((await request(route, { ...body, viewer_id: 999991 }, 400)).message, 'Invalid viewer id.')
            assert.equal((await request(route, { ...body, viewer_id: viewerId }, 400)).message, 'Character not owned.')
        }
        for (const [method, route] of [['GET', '/leaderboards/missing'], ['PATCH', '/leaderboards/missing/config'],
            ['PATCH', '/leaderboards/missing/availability'], ['POST', '/leaderboards/missing/settle'], ['POST', '/leaderboards/missing/rollover']]) {
            assert.equal((await request(route, {}, 404, method)).error, 'Leaderboard competition not found.')
        }
        for (const [method, route] of [['POST', '/admin-news/items'], ['PATCH', '/admin-news/items/1'],
            ['DELETE', '/admin-news/items/1'], ['PUT', '/admin-news/popup']]) {
            assert.match((await request(route, {}, 409, method)).error, /公告配置当前无效/)
        }
        for (const route of ['/asset/version_info', '/asset/get_path']) await request(route, {}, 200, 'POST', { device: 'android' })
        for (const platform of ['android', 'ios']) {
            assert.match(await request(`/shijtswy/version/client_release_${platform}.dis`, {}, 200, 'GET'), /apiPath/)
        }
        for (const route of ['/web/', '/web/seeds', '/web/mail', '/web/player/', '/web/player/' + playerId]) {
            assert.match(await request(route, {}, 200, 'GET'), /html/i)
        }
        for (const route of ['/seeds/stats', '/seeds/list', '/server/currentTime']) await request(route, {}, 200, 'GET')
        await request('/seeds/mode', { mode: 'natural' })
        await request('/seeds/test-seed', { seed: 123, rarity: 3 })
        await request('/seeds/test-seed?rarity=3', {}, 200, 'DELETE')

        const burst = Array.from({ length: 80 }, async (_, index) => {
            const id = 'parallel-' + index
            const response = await request(leiting + 'leiting_login', { userId: id })
            assert.equal(response.data.userId, id)
            assert.equal(response.data.status, 'success')
        })
        if (scenario === 'worker') {
            // Game object responses stay on the local encoding path. Mix them
            // with string responses that actually use the worker queue.
            for (let index = 0; index < 20; index++) burst.push(request('/fixture/worker').then(value => {
                assert.deepEqual(value, JSON.parse(workerPayload))
            }))
        }
        await Promise.all(burst)
        await delay(30)
        assert.equal(writes, expected)
        assert.equal(completed, expected)
        assert.doesNotMatch(logs.join('\n'), /already sent|ERR_HTTP_HEADERS_SENT/)
        if (scenario === 'worker') assert.ok(pool.snapshot().completed > 0, 'Must exercise worker encoding')
        console.log(JSON.stringify({ scenario, requests: expected, writes, completed, workerCompleted: pool.snapshot().completed }))
    } finally {
        await app.close()
        await require('../out/lib/seed-validator').default.close()
        db.close()
    }
}

if (process.argv[2] === '--child') {
    // Imported gameplay modules own periodic timers; all requests and response
    // workers have finished before explicitly terminating this isolated child.
    runScenario(process.argv[3]).then(() => process.exit(0), error => { console.error(error); process.exit(1) })
} else {
    const test = require('node:test')
    for (const scenario of ['default', 'workers-disabled', 'worker', 'delayed']) {
        test(`real async routes complete exactly once (${scenario})`, { timeout: 45000 }, async t => {
            const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'starpoint-route-response-'))
            fs.mkdirSync(path.join(directory, 'seeds'))
            const newsConfig = path.join(directory, 'invalid-news.json')
            fs.writeFileSync(newsConfig, '{invalid')
            t.after(() => {
                assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(os.tmpdir()))
                fs.rmSync(directory, { recursive: true })
            })
            const { stdout } = await promisify(execFile)(process.execPath, [__filename, '--child', scenario], {
                windowsHide: true, timeout: 40000, maxBuffer: 500000,
                env: { ...process.env, DATA_DIR: directory, GACHA_SEED_DIR: path.join(directory, 'seeds'), NEWS_CONFIG_PATH: newsConfig },
            })
            const result = JSON.parse(stdout.trim().split(/\r?\n/).at(-1))
            assert.ok(result.requests > 120)
            assert.equal(result.writes, result.requests)
            assert.equal(result.completed, result.requests)
            t.diagnostic(JSON.stringify(result))
        })
    }
}
