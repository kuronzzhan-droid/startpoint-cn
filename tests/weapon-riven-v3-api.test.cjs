const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { fixture, post, storedState, currentCard, load, db, app, gate, dir } = require('./helpers/weapon-riven-api-fixture.cjs')
const { weaponRivenRuleSet } = load('lib/weapon-riven/rules')
const { validateWeaponRivenQualities } = load('lib/weapon-riven/quality')
const { migrateWeaponRivenQualities } = load('data/initializers/weapon-riven-quality')
const rivens = load('data/domains/weaponRiven')
const snapshots = load('data/snapshots/player-snapshot')
const { getPlayerSnapshotSchemaFingerprint } = load('data/snapshots/schema-compatibility')
const row = p => db.prepare('SELECT * FROM player_weapon_rivens WHERE player_id=? AND item_id=?').get(p.id,p.item)
const success = response => { assert.equal(response.status,200,JSON.stringify(response.body)); assert.equal(response.body.data.weapon_riven_conflict,undefined); return response.body.data }

test('values endpoint persists q, keeps ordered keys, uses the shared price and never writes display L back on select', async () => {
    const p = await fixture(), before = row(p), old = JSON.parse(before.affixes_json)
    assert.equal(before.affix_version,3)
    const data = success(await post(p,'draw',{revision:before.revision,mode:'values'}))
    assert.equal(data.item_list[2370099],9950)
    const pending = JSON.parse(row(p).pending_json)
    assert.equal(pending.affix_version,3)
    validateWeaponRivenQualities(pending.affixes)
    assert.deepEqual(pending.affixes.map(([key]) => key),old.map(([key]) => key))
    for (const [,level,cap] of data.weapon_riven_list[p.item].pending.affixes) assert.ok(level<=cap)
    const retried = success(await post(p,'draw',{revision:before.revision,mode:'full'}))
    assert.deepEqual(retried,data)
    const chosen = success(await post(p,'select',{api_count:2,draw_id:pending.draw_id,is_confirm:true}))
    assert.deepEqual(JSON.parse(row(p).affixes_json),pending.affixes)
    assert.equal(chosen.weapon_riven_list[p.item].roll_count,1)
    assert.equal(chosen.weapon_riven_list[p.item].next_cost,200)
    assert.equal(row(p).affix_version,3)
})

test('current, pending, conflict and lock responses all calculate the latest decimal disposition', async () => {
    const p = await fixture()
    success(await post(p,'draw',{revision:1,mode:'values'}))
    const original = structuredClone(row(p)), weapon = original.weapon_id
    const previous = weaponRivenRuleSet.disposition.weapons[weapon]
    try {
        weaponRivenRuleSet.disposition.weapons[weapon] = 5
        const high = currentCard(p)
        weaponRivenRuleSet.disposition.weapons[weapon] = .49
        const low = currentCard(p)
        assert.equal(low.disposition,0)
        assert.ok(low.affixes[0][1] < high.affixes[0][1])
        assert.ok(low.pending.affixes[0][1] < high.pending.affixes[0][1])
        assert.deepEqual(row(p),original)
        const locked = success(await post(p,'lock',{api_count:2,locked:true})).weapon_riven_list[p.item]
        assert.deepEqual(locked.affixes,low.affixes)
        assert.deepEqual(locked.pending,low.pending)
        weaponRivenRuleSet.disposition.weapons[weapon] = .5
        assert.equal(currentCard(p).disposition,1)
        const conflict = (await post(p,'draw',{riven_id:original.riven_id+100,revision:1})).body.data
        assert.equal(conflict.weapon_riven_conflict,true)
        assert.equal(conflict.weapon_riven_list[p.item].disposition,1)
    } finally { weaponRivenRuleSet.disposition.weapons[weapon] = previous }
})

test('invalid modes return before debit and default draw still creates a valid full quality card', async () => {
    const p = await fixture(), before = storedState(p)
    for (const mode of ['',null,{},1,'VALUES']) {
        const response = await post(p,'draw',{revision:1,mode})
        assert.equal(response.status,400)
        assert.deepEqual(storedState(p),before)
    }
    success(await post(p,'draw',{revision:1}))
    validateWeaponRivenQualities(JSON.parse(row(p).pending_json).affixes)
})

test('exact pre-q archives migrate current and pending L once; a native q=1 survives snapshot roundtrip', async () => {
    const source = await fixture(), target = await fixture()
    const archive = snapshots.createPlayerSaveSnapshotV2Sync(source.id)
    const table = archive.data.tables.player_weapon_rivens
    table.rows[0][table.columns.indexOf('affixes_json')] = '[[15990001,1]]'
    table.rows[0][table.columns.indexOf('pending_json')] = JSON.stringify({draw_id:'old-choice',affixes:[[15990001,50]]})
    const index = table.columns.indexOf('affix_version')
    table.columns.splice(index,1); table.rows.forEach(values => values.splice(index,1))
    archive.schemaFingerprint = getPlayerSnapshotSchemaFingerprint(snapshots.PLAYER_SNAPSHOT_V2_TABLES,
        name => db.prepare(`PRAGMA table_info("${name}")`).all(),{beforeWeaponRivenQuality:true})
    snapshots.restorePlayerSaveSnapshotV2Sync(archive,target.id)
    const migrated = row(target)
    assert.equal(migrated.affix_version,3)
    assert.ok(JSON.parse(migrated.affixes_json)[0][1] < 1)
    assert.equal(JSON.parse(migrated.pending_json).affix_version,3)
    assert.equal(migrateWeaponRivenQualities(db,target.id),0)
    assert.deepEqual(row(target),migrated)
    db.prepare('UPDATE player_weapon_rivens SET affixes_json=?,pending_json=NULL WHERE player_id=?').run('[[15990001,1]]',source.id)
    snapshots.restorePlayerSaveSnapshotV2Sync(snapshots.createPlayerSaveSnapshotV2Sync(source.id),target.id)
    assert.equal(JSON.parse(row(target).affixes_json)[0][1],1)
    assert.equal(row(target).affix_version,3)
})

test('unknown quality keys are rejected before archive replacement or direct insertion; disabled historical keys remain valid', async () => {
    const source = await fixture(), target = await fixture()
    const original = snapshots.createPlayerSaveSnapshotV2Sync(source.id)
    const before = snapshots.createPlayerSaveSnapshotV2Sync(target.id).data.tables
    for (const column of ['affixes_json','pending_json']) {
        const archive = structuredClone(original), table = archive.data.tables.player_weapon_rivens
        table.rows[0][table.columns.indexOf(column)] = JSON.stringify(column === 'affixes_json'
            ? [[15999999,.5]] : {draw_id:'unknown-q-key',affixes:[[15999999,.5]],affix_version:3})
        assert.throws(() => snapshots.restorePlayerSaveSnapshotV2Sync(archive,target.id),/invalid riven or pending/)
        assert.deepEqual(snapshots.createPlayerSaveSnapshotV2Sync(target.id).data.tables,before)
    }
    assert.throws(() => db.transaction(() => rivens.insertWeaponRivenSync(target.id,300101,
        [[15999999,.5]],'unknown-q-insert',() => 0,3))(),/Missing historical weapon riven affix key/)
    assert.deepEqual(snapshots.createPlayerSaveSnapshotV2Sync(target.id).data.tables,before)
    const historical = weaponRivenRuleSet.affixes.affixes.find(affix => !affix.enabled)
    assert.ok(historical)
    const valid = structuredClone(original), table = valid.data.tables.player_weapon_rivens
    table.rows[0][table.columns.indexOf('affixes_json')] = JSON.stringify([[historical.key,.5]])
    table.rows[0][table.columns.indexOf('pending_json')] = JSON.stringify({draw_id:'disabled-history',
        affixes:[[historical.key,.6]],affix_version:3})
    snapshots.restorePlayerSaveSnapshotV2Sync(valid,target.id)
    assert.equal(currentCard(target).affixes[0][0],historical.key)
    assert.equal(currentCard(target).pending.affixes[0][0],historical.key)
})

after(async () => {
    await app.close(); db.close()
    gate.close()
    fs.rmSync(dir,{recursive:true,force:true})
})
