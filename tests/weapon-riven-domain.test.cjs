const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weapon-riven-domain-'))
process.env.DATA_DIR = dir
const output = process.env.LENS_BUILD_OUT || path.resolve(__dirname, '../out')
const load = name => require(path.join(output, name))
const { getDb, setDbOverride } = load('data/db')
const accounts = load('data/domains/account')
const players = load('data/domains/player')
const items = load('data/domains/item')
const rivens = load('data/domains/weaponRiven')
const ops = load('data/domains/weapon-riven-operations')
const snapshots = load('data/snapshots/player-snapshot')
const db = getDb()
let sequence = 0
function player(balance = 30000) {
    const account = accounts.insertAccountSync({appId:'wf_cn',idpAlias:'',idpCode:'test',idpId:`riven-${++sequence}`,status:'normal'})
    const p = players.insertDefaultPlayerSync(account.id)
    items.setPlayerItemSync(p.id,2370099,balance)
    return p.id
}
function card(id, key = `fixture-${++sequence}`) {
    return db.transaction(() => rivens.insertWeaponRivenSync(id,100001,[[15990001,50]],key, () => 0))()
}
const rivenId = (id,slot) => rivens.getPlayerWeaponRivenSync(id,slot).riven_id

test('draw/select charge the escalating capped fee once and preserve rejected affixes', () => {
    const id = player(60000), slot = card(id)
    let balance = 60000
    for (const cost of [50,200,350,500,650,800,950,1100,1250,1400,1550,1700,1850,2000,2000]) {
        const before = rivens.getPlayerWeaponRivenSync(id,slot)
        assert.equal(before.next_cost,cost)
        assert.deepEqual(before.cost_options,[[2370099,cost],[10000320,1]])
        const result = ops.drawWeaponRivenSync(id,slot,before.riven_id,before.revision,() => 0.2)
        balance -= cost
        assert.equal(result.item_list[2370099],balance)
        assert.deepEqual(ops.drawWeaponRivenSync(id,slot,before.riven_id,before.revision,() => {throw Error('rerolled')}),result)
        const pending = result.weapon_riven_list[slot].pending
        const selected = ops.selectWeaponRivenSync(id,slot,before.riven_id,pending.draw_id,false)
        assert.deepEqual(selected.weapon_riven_list[slot].affixes,before.affixes)
        assert.equal(selected.weapon_riven_list[slot].pending,null)
        assert.equal(selected.weapon_riven_list[slot].revision,before.revision+2)
        assert.deepEqual(ops.selectWeaponRivenSync(id,slot,before.riven_id,pending.draw_id,true),selected)
        assert.equal(items.getPlayerItemSync(id,2370099),balance)
    }
})

test('insufficient balance, wrong owner, stale revision and battle mutations leave state intact', () => {
    const id = player(49), slot = card(id), other = player()
    const before = rivens.getPlayerWeaponRivenSync(id,slot)
    const insufficient = ops.drawWeaponRivenSync(id,slot,before.riven_id,1)
    assert.equal(insufficient.weapon_riven_conflict,true)
    assert.equal(insufficient.reason,'cost')
    assert.deepEqual(insufficient.weapon_riven_list[slot],before)
    const unowned = ops.drawWeaponRivenSync(other,slot,before.riven_id,1)
    assert.equal(unowned.weapon_riven_conflict,true)
    assert.deepEqual(unowned.weapon_riven_deleted,[slot])
    const staleRevision = ops.drawWeaponRivenSync(id,slot,before.riven_id,8)
    assert.equal(staleRevision.weapon_riven_conflict,true)
    assert.equal(staleRevision.reason,'riven_changed')
    assert.deepEqual(staleRevision.weapon_riven_list[slot],before)
    assert.deepEqual(rivens.getPlayerWeaponRivenSync(id,slot),before)
    assert.equal(items.getPlayerItemSync(id,2370099),49)
    db.prepare(`INSERT INTO players_active_quests(player_id,play_id,quest_id,category,
        use_boss_boost_point,use_boost_point,is_auto_start_mode,is_multi,is_multi_host,continue_count,started_at_ms)
        VALUES (?,'busy',1,1,0,0,0,0,0,0,0)`).run(id)
    for (const result of [ops.drawWeaponRivenSync(id,slot,before.riven_id,1),
        ops.dismantleWeaponRivenSync(id,slot,before.riven_id,'busy')]) {
        assert.equal(result.weapon_riven_conflict,true)
        assert.equal(result.reason,'battle_in_progress')
        assert.deepEqual(result.weapon_riven_list[slot],before)
    }
    db.prepare('DELETE FROM players_active_quests WHERE player_id=?').run(id)
})

test('pending survives a new database connection and accepted selection persists exactly once', () => {
    const id = player(), slot = card(id)
    const draw = ops.drawWeaponRivenSync(id,slot,rivenId(id,slot),1,() => 0.4)
    const otherConnection = new (require('better-sqlite3'))(path.join(dir,'wdfp_data.db'))
    setDbOverride(otherConnection)
    try {
        assert.deepEqual(rivens.getPlayerWeaponRivenListSync(id),draw.weapon_riven_list)
        const pending = draw.weapon_riven_list[slot].pending
        const accepted = ops.selectWeaponRivenSync(id,slot,rivenId(id,slot),pending.draw_id,true)
        assert.deepEqual(accepted.weapon_riven_list[slot].affixes,pending.affixes)
        assert.deepEqual(ops.selectWeaponRivenSync(id,slot,rivenId(id,slot),pending.draw_id,false),accepted)
    } finally { setDbOverride(null); otherConnection.close() }
})

test('old select retries cannot consume a later draw or a reused item slot', () => {
    const id = player(), slot = card(id)
    const first = ops.drawWeaponRivenSync(id,slot,rivenId(id,slot),1,() => 0.1).weapon_riven_list[slot]
    ops.selectWeaponRivenSync(id,slot,first.riven_id,first.pending.draw_id,true)
    const second = ops.drawWeaponRivenSync(id,slot,first.riven_id,3,() => 0.3).weapon_riven_list[slot]
    assert.deepEqual(ops.selectWeaponRivenSync(id,slot,first.riven_id,first.pending.draw_id,false).weapon_riven_list[slot],second)
    ops.dismantleWeaponRivenSync(id,slot,first.riven_id,'remove')
    assert.equal(card(id),slot)
    const fresh = rivens.getPlayerWeaponRivenSync(id,slot)
    assert.ok(fresh.riven_id > first.riven_id)
    const staleSelect = ops.selectWeaponRivenSync(id,slot,first.riven_id,second.pending.draw_id,true)
    assert.equal(staleSelect.weapon_riven_conflict,true)
    assert.deepEqual(staleSelect.weapon_riven_list[slot],fresh)
    const retry = ops.dismantleWeaponRivenSync(id,slot,first.riven_id,'remove')
    assert.equal(retry.weapon_riven_conflict,true)
    assert.deepEqual(retry.weapon_riven_deleted,[])
    assert.deepEqual(retry.weapon_riven_list[slot],fresh)
    assert.deepEqual(rivens.getPlayerWeaponRivenSync(id,slot),fresh)
})

test('dismantle clears every saved party category/group without touching another player', () => {
    const id = player(), other = player(), slot = card(id)
    card(other)
    for (const owner of [id,other]) {
        db.prepare('UPDATE players_parties SET ability_soul_1=?,ability_soul_3=? WHERE player_id=?').run(slot,slot,owner)
    }
    const before = db.prepare('SELECT COUNT(*) n FROM players_parties WHERE player_id=? AND ability_soul_1=?').get(id,slot).n
    assert.ok(before > 0)
    const result = ops.dismantleWeaponRivenSync(id,slot,rivenId(id,slot),'clear')
    assert.equal(result.changed_parties.length,before)
    assert.deepEqual(result.weapon_riven_deleted,[slot])
    assert.equal(db.prepare('SELECT COUNT(*) n FROM players_parties WHERE player_id=? AND (ability_soul_1=? OR ability_soul_3=?)').get(id,slot,slot).n,0)
    assert.ok(db.prepare('SELECT COUNT(*) n FROM players_parties WHERE player_id=? AND ability_soul_1=?').get(other,slot).n > 0)
    assert.equal(items.getPlayerItemSync(id,slot),null)
    assert.equal(items.getPlayerItemSync(other,slot),1)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM players_items WHERE id BETWEEN 16000001 AND 16000200').get().n,0)
})

test('V2 archives carry cards and pending while legacy V2 and V1 retain target cards and sequence', () => {
    const id = player(), slot = card(id)
    const pending = ops.drawWeaponRivenSync(id,slot,rivenId(id,slot),1,() => 0.2).weapon_riven_list[slot]
    const snapshot = snapshots.createPlayerSaveSnapshotV2Sync(id)
    assert.equal(snapshot.data.tables.player_weapon_rivens.rows.length,1)
    assert.equal(snapshot.data.tables.player_weapon_riven_sequences,undefined)
    snapshots.assertPlayerSnapshotCoverageSync(db)
    const legacy = structuredClone(snapshot)
    delete legacy.data.tables.player_weapon_rivens
    legacy.summary.includedTableCount--
    legacy.summary.rowCount--
    const schema = snapshots.PLAYER_SNAPSHOT_V2_TABLES.filter(table => table !== 'player_weapon_rivens').map(table => ({
        table, columns:db.prepare(`PRAGMA table_info("${table}")`).all().map(c => ({
            name:c.name,type:c.type,notnull:c.notnull,defaultValue:c.dflt_value,pk:c.pk}))
    }))
    legacy.schemaFingerprint = require('node:crypto').createHash('sha256').update(JSON.stringify(schema)).digest('hex')
    snapshots.restorePlayerSaveSnapshotV2Sync(legacy,id)
    assert.deepEqual(rivens.getPlayerWeaponRivenSync(id,slot),pending)
    const merged = load('data/utils').getMergedPlayerDataSync(id)
    players.replacePlayerDataSync(merged)
    assert.deepEqual(rivens.getPlayerWeaponRivenSync(id,slot),pending)
    snapshots.restorePlayerSaveSnapshotV2Sync(snapshot,id)
    assert.deepEqual(rivens.getPlayerWeaponRivenSync(id,slot),pending)
    ops.dismantleWeaponRivenSync(id,slot,pending.riven_id,'archive-delete')
    assert.equal(card(id),slot)
    assert.ok(rivens.getPlayerWeaponRivenSync(id,slot).riven_id > pending.riven_id)
})

test('restoring a previously selected pending draw replays its original choice instead of trapping the card', () => {
    for (const confirm of [true,false]) {
        const id = player(), slot = card(id)
        const draw = ops.drawWeaponRivenSync(id,slot,rivenId(id,slot),1,() => 0.3).weapon_riven_list[slot]
        const archive = snapshots.createPlayerSaveSnapshotV2Sync(id)
        const chosen = ops.selectWeaponRivenSync(id,slot,draw.riven_id,draw.pending.draw_id,confirm)
        snapshots.restorePlayerSaveSnapshotV2Sync(archive,id)
        db.prepare(`INSERT INTO players_active_quests(player_id,play_id,quest_id,category,
            use_boss_boost_point,use_boost_point,is_auto_start_mode,is_multi,is_multi_host,continue_count,started_at_ms)
            VALUES (?,'restored-busy',1,1,0,0,0,0,0,0,0)`).run(id)
        const blocked = ops.selectWeaponRivenSync(id,slot,draw.riven_id,draw.pending.draw_id,!confirm)
        assert.equal(blocked.weapon_riven_conflict,true)
        assert.equal(blocked.reason,'battle_in_progress')
        assert.deepEqual(blocked.weapon_riven_list[slot],draw)
        db.prepare('DELETE FROM players_active_quests WHERE player_id=?').run(id)
        const retry = ops.selectWeaponRivenSync(id,slot,draw.riven_id,draw.pending.draw_id,!confirm)
        assert.deepEqual(retry,chosen)
        assert.equal(ops.drawWeaponRivenSync(id,slot,draw.riven_id,3,() => 0.4).weapon_riven_list[slot].roll_count,2)
    }
})

test('imported identity high-water survives deleting all cards before creating another', () => {
    const source = player(), target = player(), slot = card(source)
    db.prepare('UPDATE player_weapon_rivens SET riven_id=100 WHERE player_id=?').run(source)
    const archive = snapshots.createPlayerSaveSnapshotV2Sync(source)
    snapshots.restorePlayerSaveSnapshotV2Sync(archive,target)
    ops.dismantleWeaponRivenSync(target,slot,rivenId(target,slot),'import-delete')
    assert.equal(card(target),slot)
    assert.equal(rivens.getPlayerWeaponRivenSync(target,slot).riven_id,101)
})

test('generic inventory writes cannot create or duplicate player-local riven slots', () => {
    const id = player(), slot = card(id)
    for (const item of [slot,slot+1]) {
        assert.throws(() => items.givePlayerItemSync(id,item,2),/cannot be written/)
        assert.throws(() => items.setPlayerItemSync(id,item,1),/cannot be written/)
    }
    assert.deepEqual(items.getPlayerItemsByIdsSync(id,[slot,slot+1]),{[slot]:1})
    assert.equal(db.prepare('SELECT COUNT(*) n FROM players_items WHERE id BETWEEN 16000001 AND 16000200').get().n,0)
})

test('malformed archive affixes and pending fail validation before replacing player state', () => {
    const id = player(), slot = card(id), before = rivens.getPlayerWeaponRivenListSync(id)
    const archive = snapshots.createPlayerSaveSnapshotV2Sync(id)
    for (const [field,value] of [['affixes_json','{'],['affixes_json','[[15990001,101]]'],
        ['pending_json','{}'],['pending_json','{"draw_id":"valid","affixes":[]}']]) {
        const invalid = structuredClone(archive), table=invalid.data.tables.player_weapon_rivens
        table.rows[0][table.columns.indexOf(field)] = value
        assert.throws(() => snapshots.restorePlayerSaveSnapshotV2Sync(invalid,id),/invalid riven or pending/)
        assert.deepEqual(rivens.getPlayerWeaponRivenListSync(id),before)
    }
})

after(() => { db.close(); fs.rmSync(dir,{recursive:true,force:true}) })
