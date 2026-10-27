const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weapon-riven-import-'))
process.env.DATA_DIR = dir
const output = process.env.LENS_BUILD_OUT || path.resolve(__dirname, '../out')
const load = name => require(path.join(output, name))
const db = load('data/db').getDb()
const accounts = load('data/domains/account')
const players = load('data/domains/player')
const items = load('data/domains/item')
const rivens = load('data/domains/weaponRiven')
const receipts = load('data/domains/player-operation-receipt')
const snapshots = load('data/snapshots/player-snapshot')
let sequence = 0
const fragmentId = 16000900
// Round 2: 16000901-16000919 are themed unknown (stackable) cards, never instances.
const themed = id => id >= 16000901 && id <= 16000919
const slots = Array.from({ length: 999 }, (_, index) => 16000001 + index).filter(id => id !== fragmentId && !themed(id))

function player() {
    const account = accounts.insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'test',
        idpId: `riven-import-${++sequence}`, status: 'normal' })
    const id = players.insertDefaultPlayerSync(account.id).id
    items.setPlayerItemSync(id, 16000000, 7)
    items.setPlayerItemSync(id, 16001000, 11)
    items.setPlayerItemSync(id, fragmentId, 13)
    return id
}
function card(id) {
    return db.transaction(() => rivens.insertWeaponRivenSync(id, 100001,
        [[15990001, 50]], `import-card-${++sequence}`, () => 0))()
}
function receipt(id) {
    const value = { playerId: id, operation: 'weapon_riven_dismantle', requestKey: 'retained',
        response: { fixture: 'target-owned' } }
    receipts.insertPlayerOperationReceiptSync(value)
    return value
}
function unsafeParties(id) {
    db.prepare(`UPDATE players_parties SET ability_soul_1=16000001,
        ability_soul_2=16000200,ability_soul_3=16000999 WHERE player_id=?`).run(id)
}
function assertImported(id, expectedReceipt) {
    assert.equal(db.prepare('SELECT COUNT(*) n FROM players_items WHERE player_id=? AND id BETWEEN 16000001 AND 16000999 AND id<>? AND id NOT BETWEEN 16000901 AND 16000919').get(id, fragmentId).n, 0)
    assert.equal(items.getPlayerItemSync(id, 16000000), 7)
    assert.equal(items.getPlayerItemSync(id, 16001000), 11)
    assert.equal(items.getPlayerItemSync(id, fragmentId), 13)
    const parties = db.prepare('SELECT ability_soul_1,ability_soul_2,ability_soul_3 FROM players_parties WHERE player_id=?').all(id)
    assert.ok(parties.length > 1)
    for (const party of parties) assert.deepEqual(Object.values(party), [16000001, null, null])
    assert.deepEqual(receipts.getPlayerOperationReceiptSync(id, expectedReceipt.operation, expectedReceipt.requestKey), expectedReceipt)
}
function pollutedSnapshot(id) {
    const archive = snapshots.createPlayerSaveSnapshotV2Sync(id)
    const table = archive.data.tables.players_items
    for (const slot of slots) {
        table.rows.push(table.columns.map(column => ({ id: slot, amount: 99, player_id: id })[column]))
    }
    archive.summary.rowCount += slots.length
    return archive
}
function asLegacy(archive) {
    archive.summary.rowCount -= archive.data.tables.player_weapon_rivens.rows.length
    delete archive.data.tables.player_weapon_rivens
    archive.summary.includedTableCount--
    const schema = snapshots.PLAYER_SNAPSHOT_V2_TABLES.filter(table => table !== 'player_weapon_rivens').map(table => ({
        table, columns: db.prepare(`PRAGMA table_info("${table}")`).all().map(column => ({
            name: column.name, type: column.type, notnull: column.notnull, defaultValue: column.dflt_value, pk: column.pk,
        })),
    }))
    archive.schemaFingerprint = createHash('sha256').update(JSON.stringify(schema)).digest('hex')
    return archive
}

// Fail if an import ever attempts a prohibited INSERT, even if it later deletes it.
db.exec(`CREATE TRIGGER reject_riven_inventory BEFORE INSERT ON players_items
    WHEN NEW.id BETWEEN 16000001 AND 16000999 AND NEW.id<>16000900 AND NEW.id NOT BETWEEN 16000901 AND 16000919
    BEGIN SELECT RAISE(ABORT, 'instance inventory insert reached SQL'); END`)

test('V1 filters every reserved instance inventory ID and retains target cards, receipts and high-water', () => {
    const id = player(), slot = card(id), savedReceipt = receipt(id)
    db.prepare('UPDATE player_weapon_riven_sequences SET last_id=50 WHERE player_id=?').run(id)
    unsafeParties(id)
    const before = rivens.getPlayerWeaponRivenSync(id, slot)
    const merged = load('data/utils').getMergedPlayerDataSync(id)
    for (const item of slots) merged.itemList[item] = 99
    merged.itemList['016000001'] = 12
    players.replacePlayerDataSync(merged)
    assertImported(id, savedReceipt)
    assert.deepEqual(rivens.getPlayerWeaponRivenSync(id, slot), before)
    assert.equal(merged.itemList[slot], 99, 'filter must not rewrite the source inventory')
    db.prepare('DELETE FROM player_weapon_rivens WHERE player_id=?').run(id)
    assert.equal(card(id), slot)
    assert.equal(rivens.getPlayerWeaponRivenSync(id, slot).riven_id, 51)
})

test('V2 filters inventory before SQL while importing cards and cleaning only target invalid references', () => {
    const source = player(), target = player(), untouched = player()
    card(source); card(target); card(untouched)
    db.prepare('UPDATE player_weapon_rivens SET riven_id=100 WHERE player_id=?').run(source)
    db.prepare('UPDATE player_weapon_riven_sequences SET last_id=200 WHERE player_id=?').run(target)
    unsafeParties(source); unsafeParties(untouched)
    const untouchedBefore = db.prepare('SELECT * FROM players_parties WHERE player_id=?').all(untouched)
    const savedReceipt = receipt(target), archive = pollutedSnapshot(source)
    const original = structuredClone(archive)
    snapshots.restorePlayerSaveSnapshotV2Sync(archive, target)
    assertImported(target, savedReceipt)
    assert.deepEqual(rivens.getPlayerWeaponRivenListSync(target), rivens.getPlayerWeaponRivenListSync(source))
    assert.deepEqual(archive, original, 'restore must not rewrite the source archive')
    assert.deepEqual(db.prepare('SELECT * FROM players_parties WHERE player_id=?').all(untouched), untouchedBefore)
    db.prepare('DELETE FROM player_weapon_rivens WHERE player_id=?').run(target)
    const slot = card(target)
    assert.equal(rivens.getPlayerWeaponRivenSync(target, slot).riven_id, 201)
})

test('legacy V2 filters inventory and validates party references against retained destination ownership', () => {
    const source = player(), target = player(), slot = card(target), savedReceipt = receipt(target)
    unsafeParties(source)
    const before = rivens.getPlayerWeaponRivenSync(target, slot)
    snapshots.restorePlayerSaveSnapshotV2Sync(asLegacy(pollutedSnapshot(source)), target)
    assertImported(target, savedReceipt)
    assert.deepEqual(rivens.getPlayerWeaponRivenSync(target, slot), before)
})

for (const legacy of [false, true]) {
    test(`${legacy ? 'legacy ' : ''}V2 limits each imported party without consuming cards or limiting unknowns`, () => {
        const source = player(), target = player(), owner = legacy ? target : source
        const owned = [card(owner), card(owner), card(owner)]
        const cardsBefore = rivens.getPlayerWeaponRivenListSync(owner)
        const read = db.prepare(`SELECT category,group_id,slot,ability_soul_1,ability_soul_2,ability_soul_3
            FROM players_parties WHERE player_id=? ORDER BY category,slot,group_id`)
        const parties = read.all(source)
        assert.ok(parties.length >= 4)
        const souls = [
            [owned[2], owned[0], owned[1]],
            [16000000, 16000000, 16000000],
            [16000000, owned[1], owned[0]],
            [owned[2], null, null],
        ]
        const expected = [[owned[2], null, null], souls[1], [16000000, owned[1], null], souls[3]]
        const update = db.prepare(`UPDATE players_parties SET ability_soul_1=?,ability_soul_2=?,ability_soul_3=?
            WHERE player_id=? AND category=? AND group_id=? AND slot=?`)
        souls.forEach((ids, index) => {
            const key = parties[index]
            update.run(...ids, source, key.category, key.group_id, key.slot)
        })
        const expectedParties = read.all(source).map((party, index) => index >= expected.length ? party : {
            ...party, ability_soul_1: expected[index][0], ability_soul_2: expected[index][1], ability_soul_3: expected[index][2],
        })
        // An already valid row must not be rewritten by the normalization pass.
        const valid = parties[3]
        db.exec(`CREATE TRIGGER reject_unchanged_riven_party BEFORE UPDATE ON players_parties
            WHEN OLD.player_id=${target} AND OLD.category=${valid.category}
                AND OLD.group_id=${valid.group_id} AND OLD.slot=${valid.slot}
            BEGIN SELECT RAISE(ABORT, 'unchanged party was rewritten'); END`)
        try {
            const archive = snapshots.createPlayerSaveSnapshotV2Sync(source)
            snapshots.restorePlayerSaveSnapshotV2Sync(legacy ? asLegacy(archive) : archive, target)
        } finally { db.exec('DROP TRIGGER reject_unchanged_riven_party') }
        assert.deepEqual(read.all(target), expectedParties)
        assert.equal(Object.keys(rivens.getPlayerWeaponRivenListSync(target)).length, 3)
        assert.deepEqual(rivens.getPlayerWeaponRivenListSync(target), cardsBefore)
    })
}

test('valid-card party limit failures roll back V2 ownership and all imported data', () => {
    const source = player(), target = player(), owned = [card(source), card(source), card(source)]
    db.prepare(`UPDATE players_parties SET ability_soul_1=?,ability_soul_2=?,ability_soul_3=?
        WHERE player_id=?`).run(...owned, source)
    const archive = snapshots.createPlayerSaveSnapshotV2Sync(source)
    const before = snapshots.createPlayerSaveSnapshotV2Sync(target)
    db.exec(`CREATE TRIGGER reject_riven_party_limit BEFORE UPDATE OF ability_soul_2 ON players_parties
        WHEN OLD.player_id=${target} AND OLD.ability_soul_2=${owned[1]} AND NEW.ability_soul_2 IS NULL
        BEGIN SELECT RAISE(ABORT, 'party limit rollback fixture'); END`)
    try {
        assert.throws(() => snapshots.restorePlayerSaveSnapshotV2Sync(archive, target), /party limit rollback fixture/)
    } finally { db.exec('DROP TRIGGER reject_riven_party_limit') }
    assert.deepEqual(snapshots.createPlayerSaveSnapshotV2Sync(target).data.tables, before.data.tables)
})

test('invalid-party cleanup failures roll back the complete V1 and V2 import', () => {
    for (const version of [1, 2]) {
        const id = player()
        card(id); unsafeParties(id)
        // Keep one dangling instance: v3's write boundary removes additional
        // instances before ownership cleanup, which would bypass this trigger.
        db.prepare(`UPDATE players_parties SET ability_soul_1=NULL,ability_soul_3=NULL
            WHERE player_id=?`).run(id)
        const before = snapshots.createPlayerSaveSnapshotV2Sync(id)
        const archive = version === 1 ? load('data/utils').getMergedPlayerDataSync(id) : pollutedSnapshot(id)
        db.exec(`CREATE TRIGGER reject_riven_cleanup BEFORE UPDATE OF ability_soul_2 ON players_parties
            WHEN OLD.player_id=${id} AND OLD.ability_soul_2=16000200 AND NEW.ability_soul_2 IS NULL
            BEGIN SELECT RAISE(ABORT, 'cleanup rollback fixture'); END`)
        try {
            const originalError = console.error
            console.error = () => {}
            try {
                assert.throws(() => version === 1 ? players.replacePlayerDataSync(archive)
                    : snapshots.restorePlayerSaveSnapshotV2Sync(archive, id), /cleanup rollback fixture/)
            } finally { console.error = originalError }
        } finally { db.exec('DROP TRIGGER reject_riven_cleanup') }
        assert.deepEqual(snapshots.createPlayerSaveSnapshotV2Sync(id).data.tables, before.data.tables)
    }
})

test('generic inventory writes reject both active and reserved riven IDs without raising the 20-card capacity', () => {
    const id = player()
    for (const slot of [16000001, 16000200, 16000201, 16000999]) {
        assert.throws(() => items.givePlayerItemSync(id, slot, 1), /cannot be written/)
        assert.throws(() => items.setPlayerItemSync(id, slot, 1), /cannot be written/)
    }
    assert.equal(load('lib/weapon-riven/constants').MAX_WEAPON_RIVENS, 20)
    assert.equal(items.givePlayerItemSync(id, fragmentId, 3), 16)
    assert.deepEqual(items.getPlayerItemsByIdsSync(id, [fragmentId, 16000999]), { [fragmentId]: 16 })
    assert.equal(items.getPlayerCollectedItemTotalSync(id, fragmentId), 3)
})

after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })
