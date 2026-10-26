'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const http = require('node:http'), { fork } = require('node:child_process')
const msgpack = require('msgpackr')
const compiled = process.env.STARPOINT_TEST_COMPILED === '1'

function decode(body) {
    const value = msgpack.unpack(Buffer.from(body, 'base64'))
    return typeof value === 'string' ? JSON.parse(value) : value
}

async function server() {
    if (!compiled) require('ts-node/register/transpile-only')
    const load = name => require(`../${compiled ? 'out' : 'src'}/${name}`)
    load('data').initializeDatabase()
    const db = load('data/db').getDb(), players = load('data/domains/player'), mails = load('data/domains/mail')
    assert.equal(path.dirname(fs.realpathSync(db.name)), fs.realpathSync(process.env.DATA_DIR))
    load('lib/player-login').initializePlayerLogin()
    const app = require('fastify')({ logger: false })
    load('routes/cn/playerLogin').installPlayerLoginGuard(app)
    load('lib/cn-response-hook').installCnResponseEncoding(app, {
        pool: new (load('lib/cn-response-worker-pool').CnResponseWorkerPool)({ size: 0 }),
        compression: load('lib/cn-load-http-compression').getCnLoadHttpCompressionConfig({ CN_LOAD_HTTP_COMPRESSION: 'off' }),
    })
    let playerId
    const snapshot = () => {
        const state = { player: players.getPlayerSync(playerId) }
        for (const table of ['players_characters', 'players_items', 'players_equipment', 'players_mails',
            'players_receive_history', 'player_operation_receipts']) {
            state[table] = db.prepare(`SELECT * FROM ${table} WHERE player_id=? ORDER BY rowid`).all(playerId)
        }
        return state
    }
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
    await app.register(load('routes/cn/tool').default, { prefix: '/api/index.php/tool' })
    await app.register(load('routes/api/mail').default, { prefix: '/api/index.php/mail' })
    process.on('message', async message => {
        try {
            if (message.kind === 'stop') {
                await app.close(); await load('lib/seed-validator').default.close(); db.close(); process.disconnect(); return
            }
            if (message.viewer) {
                const session = await load('data/domains/session').getSession(String(message.viewer))
                playerId = load('data/activeAccount').resolvePlayerIdSync(session.accountId)
            }
            if (message.kind === 'prepare') {
                for (const [type, typeId, number] of [[1, 101, 2], [5, 111015, 3], [4, null, 77], [6, 5010005, 2]]) {
                    mails.insertMailSync(playerId, { reason_id: 1, subject: 'mail transport fixture', description: '',
                        type, type_id: typeId, number, receive_time: '0000-00-00 00:00:00',
                        create_time: '2026-10-25 00:00:00', reward_period_limited: 0, reward_limit_time: null })
                }
            }
            process.send({ kind: 'reply', id: message.id, state: snapshot() })
        } catch (error) { process.send({ kind: 'failure', error: error.stack }) }
    })
    await app.listen({ host: '127.0.0.1', port: 0 })
    process.send({ kind: 'ready', port: app.server.address().port })
}

function start(directory) {
    const child = fork(__filename, ['--server'], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true, env: {
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
        const index = messages.findIndex(message => predicate(message) || message.kind === 'failure')
        if (index >= 0) {
            const message = messages.splice(index, 1)[0]
            return message.kind === 'failure' ? reject(Error(message.error)) : resolve(message)
        }
        const waiter = { predicate, finish(message) {
            clearTimeout(timer)
            if (message.kind === 'failure') reject(Error(message.error))
            else resolve(message)
        } }
        const timer = setTimeout(() => {
            waiters.splice(waiters.indexOf(waiter), 1)
            reject(Error('Child response timed out: ' + output.slice(-8000)))
        }, 30000)
        waiters.push(waiter)
    })
    return { wait, async rpc(kind, viewer) {
        const id = ++sequence, result = wait(message => message.kind === 'reply' && message.id === id)
        child.send({ kind, viewer, id })
        return (await result).state
    }, async stop() {
        if (child.exitCode !== null) return
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => { child.kill(); reject(Error('Child shutdown timed out: ' + output.slice(-8000))) }, 10000)
            child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error(output.slice(-8000))) })
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
            response.on('data', chunk => chunks.push(chunk)); response.on('error', reject)
            response.on('end', () => {
                try {
                    const raw = Buffer.concat(chunks).toString()
                    resolve({ status: response.statusCode, body: String(response.headers['content-type']).includes('application/x-msgpack')
                        ? decode(raw) : JSON.parse(raw) })
                } catch (error) { reject(error) }
            })
        })
        request.setTimeout(10000, () => request.destroy(Error('HTTP timeout')))
        request.on('error', reject); request.end(payload)
    })
}

if (process.argv.includes('--server')) server().catch(error => { console.error(error); process.exitCode = 1; process.disconnect() })
else require('node:test').test('native single and batch mail replies lost after COMMIT replay through sockets and a new process', { timeout: 120000 }, async () => {
    const root = path.resolve(process.env.STARPOINT_TEST_TMP_ROOT || os.tmpdir())
    fs.mkdirSync(root, { recursive: true })
    const directory = fs.mkdtempSync(path.join(root, 'mail-transport-'))
    fs.mkdirSync(path.join(directory, 'seeds'))
    let running
    try {
        running = start(directory)
        let { port } = await running.wait(message => message.kind === 'ready')
        const account = await post(port, '/player-auth/register', { username: 'mail_socket_fixture', password: require('node:crypto').randomUUID(), remember: true })
        assert.equal(account.body.ok, true, JSON.stringify(account.body))
        const login = await post(port, '/api/index.php/tool/signup', {}, { 'x-sp-session': account.body.data.token })
        assert.equal(login.status, 200)
        const viewer = login.body.data_headers.viewer_id, token = login.body.data.login_token
        const headers = { LOGIN_TOKEN: token, 'x-sp-session': token }, initial = await running.rpc('prepare', viewer)
        const ids = initial.players_mails.filter(row => row.subject === 'mail transport fixture').map(row => row.id)
        assert.equal(ids.length, 4)
        const cases = [
            { route: '/api/index.php/mail/receive', payload: { viewer_id: viewer, api_count: 1, mail_id: ids[0] } },
            { route: '/api/index.php/mail/receive_all', payload: { viewer_id: viewer, api_count: 2, mail_ids: ids.slice(1) } },
        ]
        for (const entry of cases) {
            const dropped = running.wait(message => message.kind === 'dropped' && message.url === entry.route)
            await assert.rejects(post(port, entry.route, entry.payload, { ...headers, 'x-fixture-drop': 'after-commit' }), { code: 'ECONNRESET' })
            const committed = await dropped
            entry.expected = committed.expected.data
            const retry = await post(port, entry.route, { ...entry.payload, retry_count: 1 }, headers)
            assert.equal(retry.status, 200); assert.deepEqual(retry.body.data, entry.expected)
            assert.deepEqual(await running.rpc('snapshot'), committed.state)
        }
        const committed = await running.rpc('snapshot')
        assert.equal(committed.player.freeVmoney, initial.player.freeVmoney + 77)
        assert.equal(committed.players_items.find(row => row.id === 101).amount, 2)
        assert.equal(committed.players_characters.find(row => row.id === 111015).stack, 2)
        assert.equal(committed.players_receive_history.length - initial.players_receive_history.length, 4)
        assert.equal(committed.player_operation_receipts.filter(row => row.operation === 'gameplay_mutation.v1').length, 2)
        await running.stop(); running = start(directory)
        ;({ port } = await running.wait(message => message.kind === 'ready'))
        assert.deepEqual(await running.rpc('snapshot', viewer), committed)
        for (const entry of cases) {
            const retry = await post(port, entry.route, entry.payload, headers)
            assert.equal(retry.status, 200); assert.deepEqual(retry.body.data, entry.expected)
        }
        assert.deepEqual(await running.rpc('snapshot'), committed)
    } finally {
        await running?.stop()
        assert.equal(path.dirname(directory), root)
        fs.rmSync(directory, { recursive: true })
    }
})
