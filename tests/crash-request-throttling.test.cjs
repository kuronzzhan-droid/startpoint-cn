'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const Fastify = require('fastify')
const { trustProxySetting } = require('../out/lib/client-address')

// Execute the production hook without importing cn-server's startup, database,
// or listening sockets. Its limiter state and limits also come from the AST.
function loadCrashLimiter() {
    const text = fs.readFileSync(path.join(__dirname, '../src/cn-server.ts'), 'utf8')
    const source = ts.createSourceFile('cn-server.ts', text, ts.ScriptTarget.Latest, true)
    const names = new Set([
        'rateLimitMap', 'RATE_LIMIT_MAX', 'RATE_LIMIT_WINDOW',
        'RATE_LIMIT_MAP_MAX', 'nextRateLimitSweep',
    ])
    const declarations = []
    const found = new Set()
    const hooks = []
    for (const statement of source.statements) {
        if (!ts.isVariableStatement(statement)) continue
        for (const declaration of statement.declarationList.declarations) {
            if (names.has(declaration.name.getText(source))) {
                declarations.push(statement.getText(source))
                found.add(declaration.name.getText(source))
            }
        }
    }
    function visit(node) {
        if (ts.isCallExpression(node)
            && node.expression.getText(source) === 'fastify.addHook'
            && node.arguments[0]?.text === 'onRequest'
            && node.arguments[1]?.getText(source).includes('rateLimitMap')) {
            hooks.push(node.arguments[1].getText(source))
        }
        ts.forEachChild(node, visit)
    }
    visit(source)
    assert.equal(hooks.length, 1, 'one actual crash limiter hook must exist')
    assert.deepEqual([...found].sort(), [...names].sort(), 'production limiter state must be extracted')
    const js = ts.transpileModule(
        declarations.join('\n') + '\nconst hook = ' + hooks[0]
            + '\nconst limiter = { hook, max: RATE_LIMIT_MAX };',
        { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
    ).outputText
    return vm.runInNewContext(js + '\nlimiter', { Date })
}

async function withApp(run, proxySetting = '') {
    const limiter = loadCrashLimiter()
    // Empty setting exercises the production default. An L7 proxy must be
    // trusted explicitly; a loopback L4 forwarder does not authenticate XFF.
    const app = Fastify({ trustProxy: trustProxySetting(proxySetting) })
    app.addHook('onRequest', limiter.hook)
    app.post('/crash', async request => ({ ip: request.ip }))
    app.post('/debug', async () => ({ ok: true }))
    try { await run(app, limiter.max) } finally { await app.close() }
}

test('crash route query and encoded forms share the same request limit', async () => {
    await withApp(async (app, max) => {
        const urls = ['/crash', '/crash?sample=1', '/%63rash']
        for (let i = 0; i < max; i++) {
            const response = await app.inject({ method: 'POST', url: urls[i % urls.length], remoteAddress: '203.0.113.60' })
            assert.equal(response.statusCode, 200, urls[i % urls.length])
        }
        for (const url of urls) {
            const response = await app.inject({ method: 'POST', url, remoteAddress: '203.0.113.60' })
            assert.equal(response.statusCode, 429, url)
        }
    })
})

test('explicitly trusted same-host reverse proxy uses XFF and separates client buckets', async () => {
    await withApp(async (app, max) => {
        for (const ip of ['198.51.100.20', '198.51.100.21']) {
            for (let i = 0; i < max; i++) {
                const response = await app.inject({ method: 'POST', url: '/crash?proxy=nginx',
                    remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': ip } })
                assert.equal(response.statusCode, 200, `independent client ${ip}: request ${i + 1}`)
                assert.equal(response.json().ip, ip)
            }
            const blocked = await app.inject({ method: 'POST', url: '/crash',
                remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': ip } })
            assert.equal(blocked.statusCode, 429, `client ${ip} exhausted its own bucket`)
        }
    }, 'loopback')
})

test('direct clients cannot reset the crash bucket by rotating forged XFF', async () => {
    await withApp(async (app, max) => {
        const directIp = '203.0.113.70'
        for (let i = 0; i < max; i++) {
            const response = await app.inject({ method: 'POST', url: '/crash', remoteAddress: directIp,
                headers: { 'x-forwarded-for': `198.51.100.${i + 1}` } })
            assert.equal(response.statusCode, 200)
            assert.equal(response.json().ip, directIp)
        }
        for (const headers of [{}, { 'x-forwarded-for': '198.51.100.200' }]) {
            const blocked = await app.inject({ method: 'POST', url: '/%63rash?forged=1', remoteAddress: directIp, headers })
            assert.equal(blocked.statusCode, 429)
        }
        const otherClient = await app.inject({ method: 'POST', url: '/crash', remoteAddress: '203.0.113.71',
            headers: { 'x-forwarded-for': '198.51.100.200' } })
        assert.equal(otherClient.statusCode, 200, 'another direct peer has an independent bucket')
    })
})

test('default L4 loopback forwarding cannot change the bucket with forged XFF', async () => {
    await withApp(async (app, max) => {
        const remoteAddress = '127.0.0.1'
        for (let i = 0; i < max; i++) {
            const response = await app.inject({ method: 'POST', url: '/crash', remoteAddress,
                headers: { 'x-forwarded-for': `198.51.100.${i + 1}` } })
            assert.equal(response.statusCode, 200)
            assert.equal(response.json().ip, remoteAddress, 'L4 forwarding retains the immediate peer address')
        }
        for (const headers of [{}, { 'x-forwarded-for': '198.51.100.200' }]) {
            const blocked = await app.inject({ method: 'POST', url: '/crash?portproxy=1', remoteAddress, headers })
            assert.equal(blocked.statusCode, 429, 'all requests through this L4 peer share its bucket')
        }
    })
})

test('debug requests do not consume or inherit the crash limit', async () => {
    await withApp(async (app, max) => {
        const remoteAddress = '203.0.113.80'
        for (let i = 0; i <= max; i++) {
            const response = await app.inject({ method: 'POST', url: '/debug', remoteAddress })
            assert.equal(response.statusCode, 200)
        }
        for (let i = 0; i < max; i++) {
            const response = await app.inject({ method: 'POST', url: '/crash', remoteAddress })
            assert.equal(response.statusCode, 200)
        }
        const blocked = await app.inject({ method: 'POST', url: '/crash', remoteAddress })
        assert.equal(blocked.statusCode, 429)
        const debug = await app.inject({ method: 'POST', url: '/debug', remoteAddress })
        assert.equal(debug.statusCode, 200)
    })
})
