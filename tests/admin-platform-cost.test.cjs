'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const http = require('node:http')
const zlib = require('node:zlib')
const ts = require('typescript')
const Sqlite = require('better-sqlite3')
const Fastify = require('fastify')
const root = path.resolve(__dirname, '..')

function loadTs(relative, replacements = {}, globals = {}, cache = new Map()) {
    const filename = path.resolve(root, relative)
    if (cache.has(filename)) return cache.get(filename).exports
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        reportDiagnostics: true,
    })
    assert.equal(output.diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0)
    const module = { exports: {} }; cache.set(filename, module)
    vm.runInNewContext(output.outputText, {
        module, exports: module.exports, process, __dirname: path.dirname(filename), Buffer, console,
        require(name) {
            if (name in replacements) return replacements[name]
            if (name.startsWith('.')) return loadTs(path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`)), replacements, globals, cache)
            return require(name)
        }, ...globals,
    }, { filename })
    return module.exports
}
const plain = value => JSON.parse(JSON.stringify(value))

function accountFixture(t) {
    const sql = []
    const db = new Sqlite(':memory:', { verbose: statement => sql.push(statement) }); t.after(() => db.close())
    db.exec(`CREATE TABLE accounts(id INTEGER PRIMARY KEY, admin_note TEXT, username TEXT, takeover_password TEXT, status TEXT);
        CREATE TABLE players(id INTEGER PRIMARY KEY, account_id INTEGER, name TEXT, comment TEXT, degree_id INTEGER);
        CREATE TABLE device_bindings(device_id INTEGER, account_id INTEGER, name TEXT);
        CREATE TABLE sessions(token TEXT, account_id INTEGER, type INTEGER);
        CREATE TABLE player_login_credentials(account_id INTEGER,created_at INTEGER);
        CREATE TABLE player_login_sessions(account_id INTEGER,expires_at INTEGER);
        CREATE TABLE account_transfer_audit(id INTEGER PRIMARY KEY,target_account_id INTEGER,source_viewer_id TEXT,old_device_id INTEGER,new_device_id INTEGER,source_player_count INTEGER,transferred_at TEXT,source TEXT);`)
    for (let id = 1; id <= 27; id++) {
        db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?)').run(id, id === 1 ? '\u00a0\u3000' : id % 3 ? `备注 ${id}` : null, id === 2 ? 'ÉLÈVE' : `user${id}`, id === 2 ? 'synthetic-secret-not-returned' : null, 'normal')
        db.prepare('INSERT INTO players VALUES (?,?,?,?,?)').run(id * 10, id, id === 2 ? 'Σίσυφος' : `角色${id}`, id === 3 ? '精确备注' : '', id)
        db.prepare('INSERT INTO device_bindings VALUES (?,?,?)').run(id + 1000, id, 'fixture-device')
        db.prepare('INSERT INTO sessions VALUES (?,?,2)').run(String(id + 100000), id)
    }
    db.prepare('INSERT INTO players VALUES (211,2,?,?,?)').run('second', 'extra comment', 3)
    db.prepare('INSERT INTO players VALUES (9999,999,?,?,?)').run('orphan', '', 0)
    db.prepare('INSERT INTO sessions VALUES (?,2,2)').run('999999')
    db.prepare('INSERT INTO player_login_credentials VALUES(2,123)').run()
    const expiry = Date.now() + 600_000
    db.prepare('INSERT INTO player_login_sessions VALUES(2,?)').run(expiry)
    db.prepare("INSERT INTO account_transfer_audit VALUES(1,2,'previous',1,2,3,'synthetic','title')").run()
    db.prepare("INSERT INTO account_transfer_audit VALUES(2,2,'latest',3,4,5,'synthetic-latest','in_game')").run()
    return { db, sql, expiry, selection: { activePlayerId: 211, defaultPlayers: { 2: 211, 3: 123456 } } }
}

async function legacyRows({ db, expiry, selection }) {
    const source = fs.readFileSync(path.join(root, 'src/routes/web_api/server.ts'), 'utf8')
    const begin = source.indexOf('    fastify.get("/accounts",')
    const end = source.indexOf('    // === Default save template', begin)
    assert.ok(begin > 0 && end > begin)
    let handler
    const code = ts.transpileModule(source.slice(begin, end), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    vm.runInNewContext(code, {
        fastify: { get(_url, callback) { handler = callback } },
        playerLoginAdminOverview: () => new Map([[2, { bound: true, boundAt: 123, sessionExpiresAt: expiry }]]),
        getAllAccountsSync: () => db.prepare('SELECT id,admin_note AS adminNote,username,takeover_password AS takeoverPassword FROM accounts ORDER BY id DESC').all(),
        getAdminPlayerSelectionState: () => selection,
        getAllAdminPlayerSummariesSync: () => db.prepare("SELECT id,account_id AS accountId,name,COALESCE(comment,'') AS comment,COALESCE(degree_id,0) AS degreeId FROM players ORDER BY id").all(),
        getAllDeviceBindingsSync: () => db.prepare('SELECT * FROM device_bindings').all(),
        getAllViewerSessionsSync: () => db.prepare('SELECT account_id AS accountId,token FROM sessions WHERE type=2 ORDER BY rowid').all(),
        getDb: () => db,
    })
    let rows; await handler({}, { send(value) { rows = value } })
    return plain(rows)
}

test('paged rows and single-account details preserve the existing full-account contract', async t => {
    const fixture = accountFixture(t), api = loadTs('src/lib/admin-account-overview.ts')
    const before = fixture.db.prepare('SELECT total_changes() AS count').get().count
    const expected = await legacyRows(fixture)
    fixture.sql.length = 0
    const first = plain(api.readAdminAccountPage(fixture.db, fixture.selection, 1, 20, ''))
    assert.deepEqual(first.rows, expected.slice(0, 20))
    assert.equal(first.total, 27); assert.equal(first.summary.saveCount, 28)
    const second = plain(api.readAdminAccountPage(fixture.db, fixture.selection, 2, 20, ''))
    assert.deepEqual(second.rows, expected.slice(20))
    assert.deepEqual(plain(api.readAdminAccountDetail(fixture.db, fixture.selection, 2)), expected.find(row => row.id === 2))
    assert.equal(api.readAdminAccountDetail(fixture.db, fixture.selection, 999), null)
    const last = api.readAdminAccountPage(fixture.db, fixture.selection, 999, 20, '')
    assert.equal(last.page, 2)
    assert.ok(fixture.sql.some(sql => /FROM players WHERE account_id IN/.test(sql)))
    assert.ok(!fixture.sql.some(sql => /SELECT \*|password_hash/.test(sql)))
    assert.equal(fixture.db.prepare('SELECT total_changes() AS count').get().count, before)
})

test('server search exactly matches old joined Unicode browser search and summary stays global', async t => {
    const fixture = accountFixture(t), api = loadTs('src/lib/admin-account-overview.ts')
    const legacy = await legacyRows(fixture)
    for (const query of ['élève', 'σίσυφος', '精确备注', '1002', 'extra comment', '2 100002', 'no match', '  USER27  ']) {
        const expected = legacy.filter(account => [account.id, account.viewerId, account.note, account.loginUsername,
            ...account.bindings.map(binding => binding.deviceId), ...account.players.flatMap(player => [player.id, player.name, player.comment]),
        ].filter(value => value != null).join(' ').toLowerCase().includes(query.trim().toLowerCase())).map(account => account.id)
        const page = plain(api.readAdminAccountPage(fixture.db, fixture.selection, 1, 100, query))
        assert.deepEqual(page.rows.map(account => account.id), expected, query)
        assert.equal(page.summary.accountCount, 27)
        assert.equal(page.summary.saveCount, 28)
        assert.equal(page.summary.unnotedAccountCount, 10)
        assert.equal(page.summary.unnotedSaveCount, 10)
    }
    const targets = plain(api.readAdminAccountTargets(fixture.db, fixture.selection))
    assert.equal(targets.accountCount, 27); assert.equal(targets.saveCount, 28)
    assert.deepEqual(targets.accounts.find(row => row.id === 2).players.map(row => row.id), [20, 211])
    assert.ok(!JSON.stringify(targets).includes('synthetic-secret'))
    assert.ok(targets.accounts.every(row => !('playerLogin' in row) && !('latestTransfer' in row)))
})

test('default metadata reuses unchanged identity, invalidates on external replacement and mutations, and never caches save contents', t => {
    const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'default-meta-cost-'))
    t.after(() => fs.rmSync(directory, { recursive: true }))
    const filename = path.join(directory, 'default_save.json')
    let reads = 0
    const snapshot = name => ({ schema: 'starpoint-cn-save', version: 2, scope: 'player-archive', summary: { playerName: name }, data: { bulky: 'synthetic'.repeat(1000) } })
    const fakeFs = {
        ...fs,
        readFileSync(file, ...args) { if (file === filename) reads++; return fs.readFileSync(file, ...args) },
    }
    // This cost test isolates metadata caching; full V2 domain validation is
    // covered by sidecar-persistence and the real save-transfer regressions.
    const api = loadTs('src/data/defaultSave.ts', { fs: fakeFs,
        './snapshots/player-snapshot': { validatePlayerSaveSnapshotV2Sync: value => value },
    }, { process: { ...process, env: { ...process.env, DATA_DIR: directory } } })
    assert.equal(api.getDefaultSaveMeta().exists, false)
    fs.writeFileSync(filename, JSON.stringify(snapshot('first')))
    const first = api.getDefaultSaveMeta(); first.playerName = 'changed-copy'
    const initialReads = reads
    assert.equal(api.getDefaultSaveMeta().playerName, 'first'); assert.equal(reads, initialReads)
    fs.writeFileSync(filename, JSON.stringify(snapshot('other-longer')))
    assert.equal(api.getDefaultSaveMeta().playerName, 'other-longer'); assert.equal(reads, initialReads + 1)
    api.saveDefaultSaveTemplate(snapshot('saved'))
    const afterWrite = reads
    assert.equal(api.getDefaultSaveMeta().playerName, 'saved'); assert.equal(reads, afterWrite)
    assert.equal(api.loadDefaultSaveTemplate().data.bulky.length, 9000); assert.equal(reads, afterWrite + 1)
    api.clearDefaultSaveTemplate(); assert.equal(api.getDefaultSaveMeta().exists, false)
    fs.writeFileSync(filename, '{invalid'); fs.writeFileSync(filename + '.bak', '{invalid-backup')
    assert.equal(api.getDefaultSaveMeta().status, 'invalid'); assert.equal(api.getDefaultSaveMeta().exists, true)
})

test('CDN static cache refreshes by source/key/TTL and does not replace live server fields', () => {
    let now = 0, reads = 0
    const { createAdminStaticCache } = loadTs('src/lib/admin-static-cache.ts')
    const cache = createAdminStaticCache(60_000, () => now), manifest = {}
    const read = () => ({ sample: ++reads })
    assert.equal(cache.get('root', manifest, read).sample, 1)
    now = 30_000; assert.equal(cache.get('root', manifest, read).sample, 1)
    assert.equal(cache.get('root', {}, read).sample, 2)
    assert.equal(cache.get('other-root', manifest, read).sample, 3)
    now = 100_000; assert.equal(cache.get('other-root', manifest, read).sample, 4)
})

function request(url, encoding) {
    return new Promise((resolve, reject) => {
        http.get(url, { headers: { 'accept-encoding': encoding } }, response => {
            const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('error', reject)
            response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks) }))
        }).on('error', reject)
    })
}

test('real synthetic HTTP negotiates br/gzip/identity, keeps Vary and immutable, and returns asset 404 with HTML no-cache', async t => {
    const phase = process.env.ADMIN_PLATFORM_TEST_DIR
    assert.ok(phase && path.isAbsolute(phase), 'Pass explicit task-owned ADMIN_PLATFORM_TEST_DIR; no live files are used')
    const directory = fs.mkdtempSync(path.join(phase, 'static-fixture-')); fs.mkdirSync(path.join(directory, 'assets'))
    const file = path.join(directory, 'assets', 'fixture-12345678.js')
    const bytes = Buffer.from('export const fixture=' + JSON.stringify('synthetic payload only '.repeat(3000)) + ';')
    const html = '<!doctype html><html><body>synthetic index only</body></html>'
    fs.writeFileSync(file, bytes); fs.writeFileSync(`${file}.br`, zlib.brotliCompressSync(bytes)); fs.writeFileSync(`${file}.gz`, zlib.gzipSync(bytes)); fs.writeFileSync(path.join(directory, 'index.html'), html)
    const api = loadTs('src/lib/admin-spa-static.ts'), app = Fastify()
    t.after(() => app.close())
    assert.equal(api.installAdminSpaStatic(app, directory), true)
    app.setNotFoundHandler((req, reply) => { if (!api.sendAdminSpaFallback(req, reply, directory)) reply.status(404).send({ error: 'Not Found' }) })
    const origin = await app.listen({ host: '127.0.0.1', port: 0 })
    for (const [encoding, expected] of [['identity', undefined], ['gzip', 'gzip'], ['br, gzip;q=0.8', 'br'], ['br;q=0, gzip;q=1', 'gzip']]) {
        const response = await request(`${origin}/admin/assets/fixture-12345678.js`, encoding)
        assert.equal(response.status, 200); assert.equal(response.headers['content-encoding'], expected)
        const decoded = expected === 'br' ? zlib.brotliDecompressSync(response.bytes) : expected === 'gzip' ? zlib.gunzipSync(response.bytes) : response.bytes
        assert.deepEqual(decoded, bytes)
        assert.match(response.headers.vary, /Accept-Encoding/i)
        assert.match(response.headers['cache-control'], /max-age=31536000, immutable/)
        assert.match(response.headers['content-type'], /javascript/)
    }
    for (const pathname of ['/admin/', '/admin/accounts?q=one', '/admin/players/123', '/admin/content/history', '/admin/content/history?character=1', '/admin/maintenance', '/admin/time', '/admin/gifts', '/admin/gifts/', '/admin/gifts?x=1']) {
        const response = await request(origin + pathname, 'identity')
        assert.equal(response.status, 200); assert.equal(response.bytes.toString(), html)
        assert.equal(response.headers['cache-control'], 'no-cache')
    }
    for (const pathname of ['/admin/assets/missing-12345678.js', '/admin/img/missing.png', '/admin/assets/missing.js?q=1', '/admin/content/not-a-page', '/admin/maintenance/missing.js', '/admin/gifts/missing.js']) {
        const response = await request(origin + pathname, 'identity')
        assert.equal(response.status, 404); assert.match(response.headers['content-type'], /application\/json/)
    }
})
