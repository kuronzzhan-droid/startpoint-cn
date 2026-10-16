// /load write-transaction budget and response stability.
//
// Each fixture runs in a child process with a frozen clock and a fresh
// database: a first /load initializes the save, the fixture then puts the
// save into a state that one of the load-time repairs handles, and the second
// /load is measured. The test asserts how many write transactions and COMMITs
// the second /load performs.
//
// Set CN_LOAD_BASELINE_ROOT to another build of this repository (a directory
// containing out/, assets/ and node_modules/) to additionally assert that the
// response bytes and the persisted player rows are identical to that build.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { performance } = require('node:perf_hooks')

const FIXED_NOW = Date.parse('2026-10-10T04:00:00.000Z')
const FIXTURES = ['clean', 'daily', 'mana', 'abyss', 'mission', 'all']

function freezeClock() {
    const RealDate = Date
    class FixedDate extends RealDate {
        constructor(...args) { if (args.length === 0) super(FIXED_NOW); else super(...args) }
        static now() { return FIXED_NOW }
    }
    global.Date = FixedDate
}

function countWrites(db) {
    const counts = { begins: 0, commits: 0, implicitWrites: 0 }
    const probe = db.prepare('SELECT 1')
    const proto = Object.getPrototypeOf(probe)
    const run = proto.run
    proto.run = function (...args) {
        const sql = this.source.trim().toUpperCase()
        if (sql.startsWith('BEGIN')) counts.begins++
        else if (sql.startsWith('COMMIT')) counts.commits++
        else if (!this.reader && !this.database.inTransaction) counts.implicitWrites++
        return run.apply(this, args)
    }
    const exec = db.exec
    db.exec = function (sql) {
        const text = String(sql).trim().toUpperCase()
        if (text.startsWith('BEGIN')) counts.begins++
        else if (text.startsWith('COMMIT')) counts.commits++
        return exec.call(this, sql)
    }
    return counts
}

function dumpPlayerRows(db, playerId) {
    const hash = crypto.createHash('sha256')
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all()
        .map(row => row.name)
    for (const table of tables) {
        const columns = db.prepare(`PRAGMA table_info("${table}")`).all().map(column => column.name)
        const owner = columns.includes('player_id') ? 'player_id' : (table === 'players' ? 'id' : null)
        if (owner === null) continue
        const order = columns.map(column => `"${column}"`).join(',')
        // SQLite's own clock (datetime('now')) is not frozen with the process clock.
        const rows = db.prepare(`SELECT * FROM "${table}" WHERE "${owner}"=? ORDER BY ${order}`).all(playerId)
            .map(row => { const copy = { ...row }; delete copy.updated_at; return copy })
        hash.update(table).update(JSON.stringify(rows))
        if (process.env.CN_LOAD_DUMP_DIR) {
            fs.appendFileSync(path.join(process.env.CN_LOAD_DUMP_DIR, 'rows.txt'), table + ' ' + JSON.stringify(rows) + '\n')
        }
    }
    return hash.digest('hex')
}

async function scenario(root, fixture) {
    freezeClock()
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-load-writes-'))
    process.env.DATA_DIR = directory
    process.env.GACHA_SEED_DIR = path.join(directory, 'seeds')
    const out = name => require(path.join(root, 'out', name))
    const Fastify = require(path.join(root, 'node_modules', 'fastify'))
    const { pack } = require(path.join(root, 'node_modules', 'msgpackr'))
    const { getDb } = out('data/db')
    const players = out('data/domains/player')
    const characters = out('data/domains/character')
    const rush = out('data/domains/rushEvent')
    const account = out('data/domains/account').insertAccountSync({
        appId: 'wf_cn', idpAlias: '', idpCode: 'fixture', idpId: 'load-writes', status: 'normal',
    })
    const player = players.insertDefaultPlayerSync(account.id)
    out('data/activeAccount').saveAccountDefaultPlayer(account.id, player.id)
    const viewerId = 82000456
    const db = getDb()
    db.prepare('INSERT INTO sessions (token,account_id,expires,type) VALUES (?,?,?,2)')
        .run(String(viewerId), account.id, '2099-01-01T00:00:00Z')
    const ids = Object.keys(require(path.join(root, 'assets', 'character.json'))).map(Number)
        .slice(0, Number(process.env.CN_LOAD_CHARACTER_LIMIT || 40))
    db.transaction(() => {
        for (const id of ids) {
            if (!characters.playerOwnsCharacterSync(player.id, id)) characters.insertDefaultPlayerCharacterSync(player.id, id)
        }
    })()

    const app = Fastify({ logger: false })
    let captured = null
    app.addHook('onSend', async (_request, _reply, payload) => {
        captured = payload
        return typeof payload === 'object' && payload !== null && !Buffer.isBuffer(payload) ? JSON.stringify({}) : payload
    })
    await app.register(out('routes/cn/load').default, { prefix: '/api/index.php' })
    const load = async () => {
        captured = null
        const response = await app.inject({
            method: 'POST', url: '/api/index.php/load',
            headers: { 'content-type': 'application/json', res_ver: '1.4.117' },
            payload: JSON.stringify({ viewer_id: viewerId }),
        })
        assert.equal(response.statusCode, 200, response.body)
        return Buffer.from(pack(captured))
    }

    await load()
    // A save written by older code: every repair below has something to do.
    const applied = {}
    if (fixture === 'daily' || fixture === 'all') {
        db.prepare('UPDATE players SET last_login_time=? WHERE id=?')
            .run(new Date(FIXED_NOW - 36 * 3600 * 1000).toISOString(), player.id)
        applied.daily = 1
    }
    if (fixture === 'mana' || fixture === 'all') {
        applied.mana = db.prepare('DELETE FROM players_characters_bond_tokens WHERE player_id=? AND character_id IN (?,?)')
            .run(player.id, ids[0], ids[1]).changes
    }
    if (fixture === 'abyss' || fixture === 'all') {
        for (const eventId of [700099, 700100]) {
            if (rush.getPlayerRushEventSync(player.id, eventId) === null) {
                rush.insertPlayerRushEventSync(player.id, rush.getDefaultPlayerRushEventSync(eventId))
            }
        }
        applied.abyss = db.prepare('UPDATE players_rush_events SET tower_revision=NULL, active_rush_battle_folder_id=2 WHERE player_id=? AND event_id IN (700099,700100)')
            .run(player.id).changes
    }
    if (fixture === 'mission' || fixture === 'all') {
        // One learned mana node (not a full board) advances a beginner mission
        // whose progress row the reconciliation has to create.
        const nodeId = Number(Object.keys(out('lib/assets').getCharacterManaNodesSync(ids[2], 1))[0])
        db.prepare('INSERT INTO players_characters_mana_nodes (value,character_id,player_id) VALUES (?,?,?)')
            .run(nodeId, ids[2], player.id)
        applied.missionRowsBefore = 1 + db.prepare('SELECT COUNT(*) AS n FROM players_active_missions WHERE player_id=?')
            .get(player.id).n
    }
    if (fixture === 'units') {
        // Each repair helper used by /load, called on its own: no write
        // transaction when the save is current, exactly one when it is not.
        const progress = out('data/domains/abyss-tower-progress')
        const helpers = out('lib/character-helpers')
        const reconciliation = out('lib/mission/active-reconciliation')
        const { getContentSnapshot } = out('content/runtime/content-snapshot')
        const reconcile = () => reconciliation.reconcileActiveMissionFacts({
            playerId: player.id, repository: getContentSnapshot().repository, now: FIXED_NOW,
        })
        const calls = {
            abyss: () => progress.refreshPlayerAbyssTowersSync(player.id),
            mana: () => helpers.reconcilePlayerManaBoardCompletionSync(player.id),
            mission: reconcile,
        }
        const result = {}
        const counts = countWrites(db)
        const measure = (name, call) => {
            const begins = counts.begins
            const value = call()
            result[name] = counts.begins - begins
            return value
        }
        for (const [name, call] of Object.entries(calls)) measure(`${name}.clean`, call)
        for (const eventId of [700099, 700100]) {
            if (rush.getPlayerRushEventSync(player.id, eventId) === null) {
                rush.insertPlayerRushEventSync(player.id, rush.getDefaultPlayerRushEventSync(eventId))
            }
        }
        db.prepare('UPDATE players_rush_events SET tower_revision=NULL WHERE player_id=? AND event_id IN (700099,700100)').run(player.id)
        db.prepare('DELETE FROM players_characters_bond_tokens WHERE player_id=? AND character_id=?').run(player.id, ids[0])
        const nodeId = Number(Object.keys(out('lib/assets').getCharacterManaNodesSync(ids[2], 1))[0])
        db.prepare('INSERT INTO players_characters_mana_nodes (value,character_id,player_id) VALUES (?,?,?)')
            .run(nodeId, ids[2], player.id)
        measure('abyss.repair', calls.abyss)
        measure('mana.repair', calls.mana)
        result.missionDeltas = measure('mission.repair', calls.mission).length
        for (const [name, call] of Object.entries(calls)) measure(`${name}.repaired`, call)
        result.towerRevisions = db.prepare('SELECT COUNT(*) AS n FROM players_rush_events WHERE player_id=? AND event_id IN (700099,700100) AND tower_revision IS NOT NULL').get(player.id).n
        await app.close()
        db.close()
        return { fixture, units: result }
    }
    const before = dumpPlayerRows(db, player.id)

    const counts = countWrites(db)
    const startedAt = performance.now()
    const body = await load()
    const loadMs = performance.now() - startedAt
    const measured = { ...counts }
    const after = dumpPlayerRows(db, player.id)
    if (applied.missionRowsBefore !== undefined) {
        applied.mission = db.prepare('SELECT COUNT(*) AS n FROM players_active_missions WHERE player_id=?')
            .get(player.id).n - (applied.missionRowsBefore - 1)
        delete applied.missionRowsBefore
    }
    await app.close()
    db.close()
    return {
        fixture, applied, counts: measured,
        changed: before !== after,
        response: crypto.createHash('sha256').update(body).digest('hex'),
        rows: after,
        bytes: body.length,
        loadMs,
    }
}

async function runChild(root, fixture) {
    const { stdout } = await promisify(execFile)(process.execPath, [__filename, '--child', root, fixture], {
        windowsHide: true, timeout: 120000, maxBuffer: 10_000_000,
    })
    const line = stdout.split('\n').find(text => text.startsWith('RESULT '))
    assert.ok(line, stdout)
    return JSON.parse(line.slice('RESULT '.length))
}

if (process.argv[2] === '--child') {
    scenario(process.argv[3], process.argv[4]).then(result => {
        console.log('RESULT ' + JSON.stringify(result))
        process.exit(0)
    }, error => { console.error(error); process.exit(1) })
} else {
    const root = path.resolve(__dirname, '..')
    const baseline = process.env.CN_LOAD_BASELINE_ROOT
    test('write scope opens one transaction lazily and rolls back on failure', async () => {
        const { getDb } = require('../out/data/db')
        const { runPersistenceWriteScope, runPersistenceTransactionSync } = require('../out/lib/persistence-coordinator')
        const db = getDb()
        db.exec('CREATE TABLE IF NOT EXISTS write_scope_probe (value INTEGER NOT NULL)')
        const counts = countWrites(db)
        const context = { domain: 'player', playerId: 1, operation: 'write_scope_probe' }
        const values = () => db.prepare('SELECT value FROM write_scope_probe ORDER BY value').all().map(row => row.value)

        assert.equal(await runPersistenceWriteScope(context, scope => { values(); return scope.began }), false)
        assert.deepEqual(counts, { begins: 0, commits: 0, implicitWrites: 0 })

        await runPersistenceWriteScope(context, scope => {
            scope.write(() => db.prepare('INSERT INTO write_scope_probe VALUES (1)').run())
            // A nested domain transaction and a plain statement join the scope.
            runPersistenceTransactionSync(context, () => db.prepare('INSERT INTO write_scope_probe VALUES (2)').run())
            db.prepare('INSERT INTO write_scope_probe VALUES (3)').run()
            scope.finish()
            assert.equal(db.inTransaction, false)
            values()
        })
        assert.deepEqual(values(), [1, 2, 3])
        assert.deepEqual(counts, { begins: 1, commits: 1, implicitWrites: 0 })

        await assert.rejects(runPersistenceWriteScope(context, scope => {
            scope.write(() => db.prepare('INSERT INTO write_scope_probe VALUES (4)').run())
            throw new Error('section failed')
        }), /section failed/)
        assert.equal(db.inTransaction, false)
        assert.deepEqual(values(), [1, 2, 3])

        // A caught failure inside one write keeps neither its partial rows nor
        // aborts the other writes of the section.
        await runPersistenceWriteScope(context, scope => {
            assert.throws(() => scope.write(() => {
                db.prepare('INSERT INTO write_scope_probe VALUES (5)').run()
                throw new Error('repair failed')
            }), /repair failed/)
            scope.write(() => db.prepare('INSERT INTO write_scope_probe VALUES (6)').run())
        })
        assert.deepEqual(values(), [1, 2, 3, 6])
    })
    test('load repair helpers open a write transaction only when they write', { timeout: 300000 }, async () => {
        const { units } = await runChild(root, 'units')
        console.log('UNITS ' + JSON.stringify(units))
        assert.deepEqual(units, {
            'abyss.clean': 0, 'mana.clean': 0, 'mission.clean': 0,
            'abyss.repair': 1, 'mana.repair': 1, 'mission.repair': 1, missionDeltas: units.missionDeltas,
            'abyss.repaired': 0, 'mana.repaired': 0, 'mission.repaired': 0,
            towerRevisions: 2,
        })
        assert.ok(units.missionDeltas > 0)
    })
    for (const fixture of FIXTURES) {
        test(`load write transactions: ${fixture}`, { timeout: 300000 }, async () => {
            const current = await runChild(root, fixture)
            console.log('CURRENT ' + JSON.stringify(current))
            for (const [name, rows] of Object.entries(current.applied)) {
                assert.ok(rows > 0, `fixture ${name} must change the save`)
            }
            const writes = current.counts.begins + current.counts.implicitWrites
            const commits = current.counts.commits + current.counts.implicitWrites
            // The login timestamp is rewritten on every /load, so even a fully
            // repaired save performs one write; every repair joins it.
            assert.equal(writes, 1, JSON.stringify(current.counts))
            assert.equal(commits, 1, JSON.stringify(current.counts))
            if (fixture !== 'clean') assert.equal(current.changed, true)
            if (baseline) {
                const reference = await runChild(path.resolve(baseline), fixture)
                console.log('BASELINE ' + JSON.stringify(reference))
                assert.equal(current.response, reference.response, 'response bytes')
                assert.equal(current.bytes, reference.bytes)
                assert.equal(current.rows, reference.rows, 'persisted rows')
            }
        })
    }
}
