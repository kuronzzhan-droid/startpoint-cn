'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const http = require('node:http'), { fork } = require('node:child_process')
const msgpack = require('msgpackr')

// Real compiled handlers, native response encoding and login guard; only the
// transport is deliberately interrupted after the business transaction commits.
function decode(body) {
    const value = msgpack.unpack(Buffer.from(body, 'base64'))
    return typeof value === 'string' ? JSON.parse(value) : value
}

async function server() {
    const load = name => require('../out/' + name)
    load('data').initializeDatabase()
    const db = load('data/db').getDb(), players = load('data/domains/player')
    assert.equal(path.dirname(fs.realpathSync(db.name)), fs.realpathSync(process.env.DATA_DIR))
    load('lib/player-login').initializePlayerLogin()
    const app = require('fastify')({ logger: false })
    load('routes/cn/playerLogin').installPlayerLoginGuard(app)
    load('lib/cn-response-hook').installCnResponseEncoding(app, {
        pool: new (load('lib/cn-response-worker-pool').CnResponseWorkerPool)({ size: 0 }),
        compression: load('lib/cn-load-http-compression').getCnLoadHttpCompressionConfig({ CN_LOAD_HTTP_COMPRESSION: 'off' }),
    })
    let playerId
    const snapshot = () => ({ player: players.getPlayerSync(playerId),
        characters: db.prepare('SELECT * FROM players_characters WHERE player_id=? ORDER BY id').all(playerId),
        items: db.prepare('SELECT * FROM players_items WHERE player_id=? ORDER BY id').all(playerId),
        history: db.prepare('SELECT * FROM players_receive_history WHERE player_id=? ORDER BY id').all(playerId),
        receipts: db.prepare('SELECT * FROM player_operation_receipts WHERE player_id=? ORDER BY operation,request_key').all(playerId) })
    app.addHook('onSend', async (request, reply, payload) => {
        if (request.headers['x-fixture-drop'] === 'after-commit') {
            assert.equal(reply.statusCode, 200)
            assert.equal(db.inTransaction, false)
            process.send({ kind: 'dropped', url: request.url, expected: decode(String(payload)), state: snapshot() })
            reply.raw.destroy()
        }
        return payload
    })
    await app.register(load('routes/cn/playerLogin').default)
    for (const [name, prefix] of [['cn/tool', 'tool'], ['api/tutorial', 'tutorial'], ['api/item', 'item']]) {
        await app.register(load('routes/' + name).default, { prefix: '/api/index.php/' + prefix })
    }
    process.on('message', async message => {
        try {
            if (message.kind === 'stop') {
                await app.close()
                await load('lib/seed-validator').default.close()
                db.close()
                process.disconnect()
                return
            }
            if (message.viewer) {
                const session = await load('data/domains/session').getSession(String(message.viewer))
                playerId = load('data/activeAccount').resolvePlayerIdSync(session.accountId)
            }
            if (message.kind === 'prepare') {
                players.updatePlayerSync({ id: playerId, tutorialStep: 15, tutorialSkipFlag: false,
                    freeVmoney: 1234, stamina: 0, staminaHealTime: new Date() })
                load('data/domains/item').setPlayerItemSync(playerId, 101, 1)
            }
            process.send({ kind: 'reply', id: message.id, state: snapshot() })
        } catch (error) { process.send({ kind: 'failure', error: error.stack }) }
    })
    await app.listen({ host: '127.0.0.1', port: 0 })
    process.send({ kind: 'ready', port: app.server.address().port })
}

function start(directory) {
    const child = fork(__filename, ['--server'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: {
        ...process.env, DATA_DIR: directory, TEMP: directory, TMP: directory, SQLITE_TMPDIR: directory,
        GACHA_SEED_DIR: path.join(directory, 'seeds'), CN_WRITER_THREAD: '0', MULTI_REALTIME_PROCESS: '0',
        MULTI_REALTIME_OWNER_CHILD: '0', MULTI_BATTLE_RELAY_PROCESS: '0', GAME_VERBOSE_LOGS: 'false', GAME_ROUTINE_LOGS: 'off',
    } })
    let output = '', sequence = 0
    child.stdout.on('data', value => { output += value })
    child.stderr.on('data', value => { output += value })
    const messages = [], waiters = []
    child.on('message', message => {
        const index = waiters.findIndex(waiter => waiter.predicate(message) || message.kind === 'failure')
        if (index === -1) messages.push(message)
        else waiters.splice(index, 1)[0].finish(message)
    })
    const wait = predicate => new Promise((resolve, reject) => {
        const index = messages.findIndex(predicate)
        if (index >= 0) return resolve(messages.splice(index, 1)[0])
        const waiter = { predicate, finish(message) {
            clearTimeout(timer)
            if (message.kind === 'failure') reject(Error(message.error))
            else resolve(message)
        } }
        const timer = setTimeout(() => {
            waiters.splice(waiters.indexOf(waiter), 1)
            reject(Error('Child response timed out: ' + output))
        }, 30000)
        waiters.push(waiter)
    })
    return { child, wait, async rpc(kind, viewer) {
        const id = ++sequence, result = wait(message => message.kind === 'reply' && message.id === id)
        child.send({ kind, viewer, id })
        return (await result).state
    }, async stop() {
        if (child.exitCode !== null) return
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => { child.kill(); reject(Error('Child shutdown timed out: ' + output)) }, 10000)
            child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error(output)) })
            child.send({ kind: 'stop' })
        })
    } }
}

function post(port, route, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body)
        const request = http.request({ hostname: '127.0.0.1', port, path: route, method: 'POST',
            headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...headers } }, response => {
            const chunks = []
            response.on('data', chunk => chunks.push(chunk))
            response.on('error', reject)
            response.on('end', () => {
                try {
                    const raw = Buffer.concat(chunks).toString()
                    resolve({ status: response.statusCode, body: String(response.headers['content-type']).includes('application/x-msgpack')
                        ? decode(raw) : JSON.parse(raw) })
                } catch (error) { reject(error) }
            })
        })
        request.setTimeout(10000, () => request.destroy(Error('HTTP timeout')))
        request.on('error', reject)
        request.end(payload)
    })
}

if (process.argv.includes('--server')) server().catch(error => { console.error(error); process.exitCode = 1; process.disconnect() })
else require('node:test').test('committed native replies lost on real sockets survive retry and a fresh server process', { timeout: 120000 }, async () => {
    const root = path.resolve(process.env.STARPOINT_TEST_TMP_ROOT || os.tmpdir())
    fs.mkdirSync(root, { recursive: true })
    const directory = fs.mkdtempSync(path.join(root, 'retry-transport-'))
    fs.mkdirSync(path.join(directory, 'seeds'))
    let running
    try {
        running = start(directory)
        let { port } = await running.wait(message => message.kind === 'ready')
        const account = await post(port, '/player-auth/register', { username: 'socket_retry_fixture', password: require('node:crypto').randomUUID(), remember: true })
        assert.equal(account.body.ok, true, JSON.stringify(account.body))
        const login = await post(port, '/api/index.php/tool/signup', {}, { 'x-sp-session': account.body.data.token })
        assert.equal(login.status, 200)
        const viewer = login.body.data_headers.viewer_id, token = login.body.data.login_token
        const headers = { LOGIN_TOKEN: token, 'x-sp-session': token }
        const initial = await running.rpc('prepare', viewer)
        const cases = [
            { route: '/api/index.php/tutorial/update_step', payload: { viewer_id: viewer, api_count: 1, step: 15, skip: false } },
            { route: '/api/index.php/item/use_item', payload: { viewer_id: viewer, api_count: 2, items: [{ id: 101, number: 1, selectIndex: 0 }] } },
        ]
        for (const entry of cases) {
            const dropped = running.wait(message => message.kind === 'dropped' && message.url === entry.route)
            await assert.rejects(post(port, entry.route, entry.payload, { ...headers, 'x-fixture-drop': 'after-commit' }), { code: 'ECONNRESET' })
            const committed = await dropped
            entry.expected = committed.expected.data
            const retry = await post(port, entry.route, { ...entry.payload, retry_count: 1 }, headers)
            assert.equal(retry.status, 200)
            assert.deepEqual(retry.body.data, entry.expected)
            assert.deepEqual(await running.rpc('snapshot'), committed.state)
        }
        const committed = await running.rpc('snapshot')
        assert.equal(committed.items.find(row => row.id === 999012).amount, 1)
        assert.equal(committed.items.find(row => row.id === 101).amount, 0)
        assert.equal(committed.characters.find(row => row.id === 243001).stack, 0)
        assert.equal(committed.player.freeVmoney, initial.player.freeVmoney)
        assert.equal(committed.player.tutorialStep, 16)
        assert.equal(committed.receipts.length, 3)
        await running.stop()
        running = start(directory)
        ;({ port } = await running.wait(message => message.kind === 'ready'))
        assert.deepEqual(await running.rpc('snapshot', viewer), committed)
        for (const entry of cases) {
            const retry = await post(port, entry.route, entry.payload, headers)
            assert.equal(retry.status, 200)
            assert.deepEqual(retry.body.data, entry.expected)
        }
        const next = await post(port, cases[1].route, { ...cases[1].payload, api_count: 3 }, headers)
        assert.equal(next.status, 400, 'a new use cannot spend the exhausted medicine')
        assert.deepEqual(await running.rpc('snapshot'), committed)
    } finally {
        await running?.stop()
        assert.equal(path.dirname(directory), root)
        fs.rmSync(directory, { recursive: true })
    }
})
