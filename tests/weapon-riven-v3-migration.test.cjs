const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Database = require('better-sqlite3')
const { fixture, load, db, app, gate, dir } = require('./helpers/weapon-riven-api-fixture.cjs')
const { weaponRivenRuleSet } = load('lib/weapon-riven/rules')
const { validateWeaponRivenQualities } = load('lib/weapon-riven/quality')
const { migrateWeaponRivenQualities } = load('data/initializers/weapon-riven-quality')
const rivens = load('data/domains/weaponRiven')
const snapshots = load('data/snapshots/player-snapshot')
const { getPlayerSnapshotSchemaFingerprint } = load('data/snapshots/schema-compatibility')
const { dispositionCoefficient } = require('./helpers/weapon-riven-v3-numeric-fixture.cjs')
require('./helpers/weapon-riven-legacy-value-model.cjs').pinLegacyValueModel(load('lib/weapon-riven/rules').weaponRivenRuleSet)
const weapon = 300101
const row = player => db.prepare('SELECT * FROM player_weapon_rivens WHERE player_id=? AND item_id=?').get(player.id,player.item)

function captureMigration(action, observe = () => {}) {
    const records = [], original = console.info
    console.info = (...args) => {
        if (args[0] !== '[weapon-riven:migrate-quality]') return original(...args)
        assert.equal(args.length,2)
        assert.equal(typeof args[1],'string')
        const record = JSON.parse(args[1])
        records.push(record)
        observe(record)
    }
    try { return { result:action(), records } }
    finally { console.info = original }
}

function migrationDb(t) {
    const database = new Database(':memory:')
    t.after(() => database.close())
    database.exec(`CREATE TABLE player_weapon_rivens (
        player_id INTEGER, riven_id INTEGER, item_id INTEGER, weapon_id INTEGER,
        affixes_json TEXT, pending_json TEXT, affix_version INTEGER,
        PRIMARY KEY(player_id,riven_id))`)
    const insert = database.prepare('INSERT INTO player_weapon_rivens VALUES (?,?,?,?,?,?,?)')
    return { database,
        add(player,affixes,pending = null,version = 1) {
            insert.run(player,player+10,16000001,weapon,JSON.stringify(affixes),
                pending === null ? null : JSON.stringify(pending),version)
        },
        rows: () => database.prepare('SELECT * FROM player_weapon_rivens ORDER BY player_id,riven_id').all() }
}

function assertQualityStorage(stored) {
    assert.equal(stored.affix_version,3)
    validateWeaponRivenQualities(JSON.parse(stored.affixes_json),weaponRivenRuleSet)
    if (stored.pending_json !== null) {
        const pending = JSON.parse(stored.pending_json)
        assert.equal(pending.affix_version,3)
        validateWeaponRivenQualities(pending.affixes,weaponRivenRuleSet)
        assert.deepEqual(Object.keys(pending).sort(),['affix_version','affixes','draw_id'])
    }
}

test('startup migration caps both polarities across all players, commits the full batch and logs every affix once', t => {
    const local = migrationDb(t), configuration = structuredClone(weaponRivenRuleSet)
    configuration.disposition.weapons[weapon] = .1
    local.add(1,[[15990006,100],[15990015,100]],
        {draw_id:'startup-choice',affixes:[[15990009,100],[15990015,100]]})
    local.add(2,[[15990009,100]])
    local.add(3,[[15990006,1]])
    const transactionStates = []
    const migrated = captureMigration(() => migrateWeaponRivenQualities(local.database,undefined,configuration),
        () => transactionStates.push(local.database.inTransaction))
    assert.equal(migrated.result,3)
    const stored = local.rows()
    stored.forEach(assertQualityStorage)
    assert.deepEqual(JSON.parse(stored[0].affixes_json),[[15990006,1],[15990015,1]])
    assert.deepEqual(JSON.parse(stored[0].pending_json).affixes,[[15990009,1],[15990015,1]])
    assert.deepEqual(JSON.parse(stored[1].affixes_json),[[15990009,1]])
    const coefficient = dispositionCoefficient(.1,configuration)
    const budget = 360 * coefficient
    const quality = Number((.2 / budget).toFixed(6))
    assert.deepEqual(JSON.parse(stored[2].affixes_json),[[15990006,quality]])
    assert.equal(migrated.records.length,6)
    assert.ok(transactionStates.every(active => !active),'success logs must follow the migration transaction')
    assert.equal(migrated.records.filter(record => record.capped).length,5)
    for (const record of migrated.records) {
        assert.equal(record.riven_id,record.player_id+10)
        assert.equal(record.item_id,16000001)
        assert.equal(record.weapon_id,weapon)
        assert.equal(record.old_level,record.player_id === 3 ? 1 : 100)
        if (record.state === 'pending') assert.equal(record.draw_id,'startup-choice')
        else { assert.equal(record.state,'current'); assert.equal(record.draw_id,undefined) }
    }
    const negative = migrated.records.filter(record => record.affix_key === 15990015)
    assert.equal(negative.length,2)
    assert.ok(negative.every(record => record.old_value === -32 && record.new_value === -80 * coefficient && record.q === 1))
    const uncapped = migrated.records.find(record => record.player_id === 3)
    assert.equal(uncapped.old_value,.2)
    assert.equal(uncapped.new_value,budget*quality)
    assert.equal(uncapped.capped,false)
    const repeated = captureMigration(() => migrateWeaponRivenQualities(local.database,undefined,configuration))
    assert.deepEqual(repeated,{result:0,records:[]})
    assert.deepEqual(local.rows(),stored)
})

test('current and pending versions migrate independently and native q=1 remains untouched', t => {
    const local = migrationDb(t), configuration = structuredClone(weaponRivenRuleSet)
    configuration.disposition.weapons[weapon] = .1
    local.add(1,[[15990006,1],[15990015,.5]],{draw_id:'legacy-pending',affixes:[[15990009,100]]},3)
    local.add(2,[[15990006,100]],{draw_id:'native-pending',affixes:[[15990009,1]],affix_version:3})
    const original = local.rows()
    const migrated = captureMigration(() => migrateWeaponRivenQualities(local.database,undefined,configuration))
    assert.equal(migrated.result,2)
    const stored = local.rows()
    stored.forEach(assertQualityStorage)
    assert.equal(stored[0].affixes_json,original[0].affixes_json)
    assert.equal(stored[1].pending_json,original[1].pending_json)
    assert.deepEqual(JSON.parse(stored[0].pending_json).affixes,[[15990009,1]])
    assert.deepEqual(JSON.parse(stored[1].affixes_json),[[15990006,1]])
    assert.deepEqual(migrated.records.map(record => [record.player_id,record.state]),[[1,'pending'],[2,'current']])
    assert.deepEqual(captureMigration(() => migrateWeaponRivenQualities(local.database,undefined,configuration)),
        {result:0,records:[]})
})

test('real invalid legacy keys or levels still roll back the whole migration batch without success logs', t => {
    for (const invalid of [[[15999999,100]],[[15990006,101]]]) {
        for (const state of ['current','pending']) {
            const local = migrationDb(t)
            local.add(1,[[15990006,100]])
            local.add(2,state === 'current' ? invalid : [[15990006,100]],
                state === 'pending' ? {draw_id:'invalid-choice',affixes:invalid} : null)
            const before = local.rows()
            const result = captureMigration(() => assert.throws(() => migrateWeaponRivenQualities(local.database),
                /Missing historical weapon riven affix key|Invalid historical weapon riven level/))
            assert.deepEqual(local.rows(),before)
            assert.deepEqual(result.records,[])
        }
    }
})

test('pre-q archive import accepts capped current and pending, preserves pure pairs and logs destination card identity', async () => {
    const source = await fixture(), target = await fixture()
    const archive = snapshots.createPlayerSaveSnapshotV2Sync(source.id)
    const table = archive.data.tables.player_weapon_rivens
    table.rows[0][table.columns.indexOf('affixes_json')] = JSON.stringify([[15990006,100],[15990015,100]])
    table.rows[0][table.columns.indexOf('pending_json')] = JSON.stringify({draw_id:'old-overflow',
        affixes:[[15990009,100],[15990015,100]]})
    const index = table.columns.indexOf('affix_version')
    table.columns.splice(index,1)
    table.rows.forEach(values => values.splice(index,1))
    archive.schemaFingerprint = getPlayerSnapshotSchemaFingerprint(snapshots.PLAYER_SNAPSHOT_V2_TABLES,
        name => db.prepare(`PRAGMA table_info("${name}")`).all(),{beforeWeaponRivenQuality:true})
    const previous = weaponRivenRuleSet.disposition.weapons[weapon]
    try {
        weaponRivenRuleSet.disposition.weapons[weapon] = .1
        const imported = captureMigration(() => snapshots.restorePlayerSaveSnapshotV2Sync(archive,target.id))
        const stored = row(target)
        assertQualityStorage(stored)
        assert.deepEqual(JSON.parse(stored.affixes_json),[[15990006,1],[15990015,1]])
        assert.deepEqual(JSON.parse(stored.pending_json).affixes,[[15990009,1],[15990015,1]])
        assert.equal(imported.records.length,4)
        assert.ok(imported.records.every(record => record.player_id === target.id
            && record.riven_id === stored.riven_id && record.item_id === target.item && record.capped))
        assert.deepEqual(imported.records.map(record => record.state),['current','current','pending','pending'])
        const exported = snapshots.createPlayerSaveSnapshotV2Sync(target.id)
        assert.equal(exported.data.tables.player_weapon_rivens.rows.length,1)
        const repeated = captureMigration(() => rivens.getPlayerWeaponRivenSync(target.id,target.item))
        assert.deepEqual(repeated.records,[])
        assert.deepEqual(row(target),stored)
    } finally { weaponRivenRuleSet.disposition.weapons[weapon] = previous }
})

test('single-card and inventory reads migrate capped old saves lazily and only for the requested player', async () => {
    const first = await fixture(), second = await fixture()
    const update = db.prepare('UPDATE player_weapon_rivens SET affix_version=1,affixes_json=?,pending_json=? WHERE player_id=?')
    for (const player of [first,second]) update.run('[[15990006,100]]',
        JSON.stringify({draw_id:'read-choice',affixes:[[15990015,100]]}),player.id)
    const previous = weaponRivenRuleSet.disposition.weapons[weapon]
    try {
        weaponRivenRuleSet.disposition.weapons[weapon] = .1
        const single = captureMigration(() => rivens.getPlayerWeaponRivenSync(first.id,first.item))
        assert.equal(single.records.length,2)
        assertQualityStorage(row(first))
        assert.equal(row(second).affix_version,1)
        const inventory = captureMigration(() => rivens.getPlayerWeaponRivenListSync(second.id))
        assert.equal(inventory.records.length,2)
        assertQualityStorage(row(second))
        for (const card of [single.result,inventory.result[second.item]]) {
            for (const [,level,cap] of [...card.affixes,...card.pending.affixes]) assert.equal(level,cap)
        }
        const stored = row(first)
        assert.deepEqual(captureMigration(() => rivens.getPlayerWeaponRivenRowSync(first.id,first.item)).records,[])
        assert.deepEqual(row(first),stored)
    } finally { weaponRivenRuleSet.disposition.weapons[weapon] = previous }
})

after(async () => {
    await app.close(); db.close(); gate.close()
    fs.rmSync(dir,{recursive:true,force:true})
})
