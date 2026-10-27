const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const Database = require('better-sqlite3')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'weapon-riven-v12-save-'))
process.env.DATA_DIR = directory
const output = process.env.LENS_BUILD_OUT || path.resolve(__dirname, '../out')
const load = name => require(path.join(output, name))
const db = load('data/db').getDb()
const accounts = load('data/domains/account')
const players = load('data/domains/player')
const rivens = load('data/domains/weaponRiven')
const snapshots = load('data/snapshots/player-snapshot')
const { initializeWeaponRivens } = load('data/initializers/weapon-riven')
const { migrateWeaponRivenAffixes } = load('lib/weapon-riven/migrate-quality')
const { weaponRivenRuleSet } = load('lib/weapon-riven/rules')
const qualities = affixes => migrateWeaponRivenAffixes(100001, affixes, weaponRivenRuleSet)
let sequence = 0

function player() {
    const account = accounts.insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'test',
        idpId: `riven-v12-save-${++sequence}`, status: 'normal' })
    return players.insertDefaultPlayerSync(account.id).id
}
function fixture() {
    const id = player()
    const item = db.transaction(() => rivens.insertWeaponRivenSync(id, 100001,
        [[15990001, 50]], `v12-save-card-${++sequence}`, () => 0))()
    db.prepare(`UPDATE player_weapon_rivens SET locked=1,seen=1,pending_json=? WHERE player_id=?`)
        .run(JSON.stringify({ draw_id: 'old-pending', affixes: [[15990001, 70]] }), id)
    rivens.getPlayerWeaponRivenSync(id,item)
    return { id, item }
}
function state(id) {
    return db.prepare('SELECT * FROM player_weapon_rivens WHERE player_id=? ORDER BY item_id').all(id)
}
function oldArchive(id, { noCards = false, noFlags = true, noTower = false } = {}) {
    const archive = snapshots.createPlayerSaveSnapshotV2Sync(id)
    const omit = (table, column) => (noFlags && table === 'player_weapon_rivens' && ['locked', 'seen'].includes(column))
        || (noTower && table === 'players_rush_events' && column === 'tower_revision')
    if (noCards) {
        archive.summary.rowCount -= archive.data.tables.player_weapon_rivens.rows.length
        archive.summary.includedTableCount--
        delete archive.data.tables.player_weapon_rivens
    }
    const tables = snapshots.PLAYER_SNAPSHOT_V2_TABLES.filter(table => !(noCards && table === 'player_weapon_rivens'))
    const schema = tables.map(table => {
        const source = archive.data.tables[table]
        const kept = source.columns.map((column, index) => ({ column, index })).filter(({ column }) => !omit(table, column))
        source.columns = kept.map(({ column }) => column)
        source.rows = source.rows.map(row => kept.map(({ index }) => row[index]))
        return { table, columns: db.prepare(`PRAGMA table_info("${table}")`).all()
            .filter(column => !omit(table, column.name))
            .map(column => ({ name: column.name, type: column.type, notnull: column.notnull,
                defaultValue: column.dflt_value, pk: column.pk })) }
    })
    archive.schemaFingerprint = createHash('sha256').update(JSON.stringify(schema)).digest('hex')
    return archive
}

test('additive v1.1 migration retains exact cards, pending, indexes and root page; repeat is safe', () => {
    const legacy = new Database(':memory:')
    try {
        legacy.exec(`CREATE TABLE players(id INTEGER PRIMARY KEY);
            INSERT INTO players VALUES(1);
            CREATE TABLE five_boss_solo_runs(run_id TEXT PRIMARY KEY, riven_loadout_json TEXT NOT NULL DEFAULT '{}');
            CREATE TABLE five_boss_gauntlet_members(run_id TEXT, riven_loadout_json TEXT NOT NULL DEFAULT '{}');
            CREATE TABLE player_weapon_rivens(
                player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
                riven_id INTEGER NOT NULL CHECK(riven_id>0),
                item_id INTEGER NOT NULL CHECK(item_id BETWEEN 16000001 AND 16000200),
                weapon_id INTEGER NOT NULL CHECK(weapon_id>0), affixes_json TEXT NOT NULL,
                roll_count INTEGER NOT NULL DEFAULT 0 CHECK(roll_count>=0),
                revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), pending_json TEXT,
                source_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                PRIMARY KEY(player_id,riven_id), UNIQUE(player_id,item_id), UNIQUE(player_id,source_key));
            CREATE INDEX fixture_source ON player_weapon_rivens(source_key);`)
        legacy.prepare(`INSERT INTO player_weapon_rivens VALUES(1,7,16000001,100001,?,4,6,?,'old','created','updated')`)
            .run('[[15990001,20]]', '{"draw_id":"legacy","affixes":[[15990001,80]]}')
        const before = legacy.prepare('SELECT * FROM player_weapon_rivens').get()
        const root = legacy.prepare("SELECT rootpage FROM sqlite_master WHERE name='player_weapon_rivens'").get()
        initializeWeaponRivens(legacy)
        initializeWeaponRivens(legacy)
        assert.deepEqual(legacy.prepare('SELECT * FROM player_weapon_rivens').get(), { ...before, locked: 0, seen: 0,
            affix_version: 3, affixes_json: JSON.stringify(qualities([[15990001,20]])),
            pending_json: JSON.stringify({ draw_id: 'legacy', affixes: qualities([[15990001,80]]), affix_version: 3 }) })
        assert.deepEqual(legacy.prepare("SELECT rootpage FROM sqlite_master WHERE name='player_weapon_rivens'").get(), root)
        assert.ok(legacy.prepare("SELECT 1 FROM sqlite_master WHERE name='fixture_source'").get())
        const columns = legacy.prepare('PRAGMA table_info(player_weapon_rivens)').all()
        assert.deepEqual(columns.map(column => column.name), db.prepare('PRAGMA table_info(player_weapon_rivens)').all().map(column => column.name))
        for (const name of ['locked', 'seen']) {
            const column = columns.find(value => value.name === name)
            assert.deepEqual([column.type, column.notnull, column.dflt_value], ['INTEGER', 1, '0'])
            for (const invalid of [-1, 2, 0.5, null]) {
                assert.throws(() => legacy.prepare(`UPDATE player_weapon_rivens SET ${name}=?`).run(invalid), /constraint failed/i)
            }
        }
    } finally { legacy.close() }
})

test('new cards default to unseen/unlocked, and V2 carries flags while retaining stored affix pairs', () => {
    const source = fixture(), target = fixture()
    db.prepare('UPDATE player_weapon_rivens SET locked=0,seen=0 WHERE player_id=?').run(target.id)
    const archive = snapshots.createPlayerSaveSnapshotV2Sync(source.id)
    const original = structuredClone(archive)
    snapshots.restorePlayerSaveSnapshotV2Sync(archive, target.id)
    assert.deepEqual(state(target.id), state(source.id).map(row => ({ ...row, player_id: target.id })))
    assert.deepEqual(archive, original)
    const table = archive.data.tables.player_weapon_rivens
    assert.equal(table.rows[0][table.columns.indexOf('locked')], 1)
    assert.equal(table.rows[0][table.columns.indexOf('seen')], 1)
    assert.deepEqual(JSON.parse(table.rows[0][table.columns.indexOf('affixes_json')]), qualities([[15990001, 50]]))
    assert.deepEqual(JSON.parse(table.rows[0][table.columns.indexOf('pending_json')]).affixes, qualities([[15990001, 70]]))
    const fresh = player()
    db.transaction(() => rivens.insertWeaponRivenSync(fresh, 100001, [[15990001, 50]], 'fresh', () => 0))()
    assert.deepEqual([state(fresh)[0].locked, state(fresh)[0].seen], [0, 0])
})

test('exact old V2 fingerprints import historical pairs with default flags, with or without tower revision', () => {
    for (const noTower of [false, true]) {
        const source = fixture(), target = fixture()
        const archive = oldArchive(source.id, { noTower })
        const original = structuredClone(archive)
        snapshots.restorePlayerSaveSnapshotV2Sync(archive, target.id)
        assert.deepEqual(state(target.id), state(source.id).map(row => ({ ...row, player_id: target.id, locked: 0, seen: 0 })))
        assert.deepEqual(archive, original)
    }
})

test('pre-card V2 and V1 preserve target locked/seen, pending and sequence high-water', () => {
    const source = player()
    for (const version of ['V1', 'V2', 'V2-before-tower']) {
        const target = fixture(), before = state(target.id)
        db.prepare('UPDATE player_weapon_riven_sequences SET last_id=90 WHERE player_id=?').run(target.id)
        if (version === 'V1') players.replacePlayerDataSync(load('data/utils').getMergedPlayerDataSync(target.id))
        else snapshots.restorePlayerSaveSnapshotV2Sync(oldArchive(source, {
            noCards: true, noTower: version === 'V2-before-tower',
        }), target.id)
        assert.deepEqual(state(target.id), before)
        assert.equal(db.prepare('SELECT last_id FROM player_weapon_riven_sequences WHERE player_id=?').get(target.id).last_id, 90)
    }
})

test('archive rejects invalid states and projected triplets before any target replacement', () => {
    const source = fixture(), target = fixture(), before = snapshots.createPlayerSaveSnapshotV2Sync(target.id).data.tables
    const archive = snapshots.createPlayerSaveSnapshotV2Sync(source.id)
    for (const column of ['locked', 'seen']) {
        for (const invalid of [-1, 2, 0.5, '1', true, null, undefined]) {
            const bad = structuredClone(archive), table = bad.data.tables.player_weapon_rivens
            table.rows[0][table.columns.indexOf(column)] = invalid
            assert.throws(() => snapshots.restorePlayerSaveSnapshotV2Sync(bad, target.id), /locked|seen/)
        }
    }
    for (const column of ['affixes_json', 'pending_json']) {
        const bad = structuredClone(archive), table = bad.data.tables.player_weapon_rivens
        table.rows[0][table.columns.indexOf(column)] = JSON.stringify(column === 'affixes_json'
            ? [[15990001, 50, 80]] : { draw_id: 'triplet', affixes: [[15990001, 50, 80]] })
        assert.throws(() => snapshots.restorePlayerSaveSnapshotV2Sync(bad, target.id), /invalid riven or pending/)
    }
    assert.deepEqual(snapshots.createPlayerSaveSnapshotV2Sync(target.id).data.tables, before)
})

test('missing flag columns require the exact old fingerprint; partial schemas cannot borrow its compatibility', () => {
    const source = fixture(), target = fixture(), current = snapshots.createPlayerSaveSnapshotV2Sync(source.id)
    const missing = oldArchive(source.id)
    missing.schemaFingerprint = current.schemaFingerprint
    assert.throws(() => snapshots.restorePlayerSaveSnapshotV2Sync(missing, target.id), /列定义/)
    const falseOld = structuredClone(current)
    falseOld.schemaFingerprint = oldArchive(source.id).schemaFingerprint
    assert.throws(() => snapshots.restorePlayerSaveSnapshotV2Sync(falseOld, target.id), /列定义/)
    const partial = oldArchive(source.id), table = partial.data.tables.player_weapon_rivens
    table.columns.push('locked'); table.rows.forEach(row => row.push(0))
    assert.throws(() => snapshots.restorePlayerSaveSnapshotV2Sync(partial, target.id), /列定义/)
    const unknown = structuredClone(current)
    unknown.schemaFingerprint = '0'.repeat(64)
    assert.throws(() => snapshots.restorePlayerSaveSnapshotV2Sync(unknown, target.id), /数据库结构/)
})

after(() => {
    db.close()
    const resolved = path.resolve(directory)
    assert.ok(path.basename(resolved).startsWith('weapon-riven-v12-save-'))
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()))
    fs.rmSync(resolved, { recursive: true, force: true })
})
