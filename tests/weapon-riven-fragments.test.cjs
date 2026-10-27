const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weapon-riven-fragments-'))
process.env.DATA_DIR = dir
const output = process.env.LENS_BUILD_OUT || path.resolve(__dirname, '../out')
const load = name => require(path.join(output, name))
const db = load('data/db').getDb()
const accounts = load('data/domains/account'), players = load('data/domains/player')
const items = load('data/domains/item'), rivens = load('data/domains/weaponRiven')
const ops = load('data/domains/weapon-riven-operations')
const receipts = load('data/domains/player-operation-receipt')
const snapshots = load('data/snapshots/player-snapshot')
const { weaponRivenRuleSet } = load('lib/weapon-riven/rules')
const fragmentId = 16000900
let sequence = 0
function fixture(balance = 7) {
    const account = accounts.insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'test',
        idpId: `fragments-${++sequence}`, status: 'normal' })
    const id = players.insertDefaultPlayerSync(account.id).id
    items.setPlayerItemSync(id, fragmentId, balance)
    const slot = db.transaction(() => rivens.insertWeaponRivenSync(id, 100001,
        [[15990001, 50]], `fragments-card-${++sequence}`, () => 0))()
    const riven = rivens.getPlayerWeaponRivenSync(id, slot)
    db.prepare('UPDATE players_parties SET ability_soul_1=? WHERE player_id=?').run(slot, id)
    return { id, slot, riven }
}
const dismantle = (p, key = 'fragment-request') => ops.dismantleWeaponRivenSync(p.id, p.slot, p.riven.riven_id, key)
function storedState(id) {
    return { tables: snapshots.createPlayerSaveSnapshotV2Sync(id).data.tables,
        receipts: db.prepare('SELECT * FROM player_operation_receipts WHERE player_id=? ORDER BY rowid').all(id) }
}

test('dismantle grants three fragments once and refreshes balances on stale identities and reused slots', () => {
    const p = fixture(), other = fixture()
    const result = dismantle(p)
    assert.deepEqual(result.item_list, { [p.slot]: 0, [fragmentId]: 10 })
    assert.ok(result.changed_parties.length > 0)
    assert.equal(items.getPlayerCollectedItemTotalSync(p.id, fragmentId), 3)
    assert.equal(items.getPlayerItemSync(other.id, fragmentId), 7)
    const receipt = receipts.getPlayerOperationReceiptSync(p.id, 'weapon_riven_dismantle', 'fragment-request')
    assert.deepEqual(receipt.response, result)
    items.setPlayerItemSync(p.id, fragmentId, 2)
    for (const key of ['fragment-request', 'relogged-request']) {
        const before = storedState(p.id), retry = dismantle(p, key)
        assert.equal(retry.weapon_riven_conflict, true)
        assert.equal(retry.reason, 'riven_changed')
        assert.deepEqual(retry.item_list, { [p.slot]: 0, [fragmentId]: 2 })
        assert.deepEqual(storedState(p.id), before)
    }
    const reused = db.transaction(() => rivens.insertWeaponRivenSync(p.id, 100001,
        [[15990001, 60]], 'fragment-reused', () => 0))()
    assert.equal(reused, p.slot)
    const replacement = rivens.getPlayerWeaponRivenSync(p.id, reused)
    const before = storedState(p.id), stale = dismantle(p)
    assert.equal(stale.weapon_riven_conflict, true)
    assert.deepEqual(stale.item_list, { [p.slot]: 1, [fragmentId]: 2 })
    assert.deepEqual(storedState(p.id), before)
    const fresh = ops.dismantleWeaponRivenSync(p.id, reused, replacement.riven_id, 'replacement-request')
    assert.equal(fresh.item_list[fragmentId], 5)
    assert.equal(items.getPlayerCollectedItemTotalSync(p.id, fragmentId), 6)
})

test('configured bonuses use confirmed affixes and paid roll_count while a pending candidate is discarded', () => {
    const p = fixture(0), previous = weaponRivenRuleSet.rules.dismantle_return
    weaponRivenRuleSet.rules.dismantle_return = { item_id: fragmentId, base: 3, per_affix: 2, per_roll: 5 }
    try {
        db.prepare('UPDATE player_weapon_rivens SET affixes_json=?,affix_version=3,roll_count=4,pending_json=? WHERE player_id=?')
            .run(JSON.stringify([[15990001, .9], [15990002, .9]]),
                JSON.stringify({ draw_id: 'unselected', affix_version: 3,
                    affixes: [[15990001, .95], [15990002, .95], [15990003, .95]] }), p.id)
        assert.equal(dismantle(p).item_list[fragmentId], 27)
        assert.equal(items.getPlayerCollectedItemTotalSync(p.id, fragmentId), 27)
    } finally { weaponRivenRuleSet.rules.dismantle_return = previous }
})

test('legacy zero-refund receipts and restored cards do not receive retroactive fragment grants', () => {
    for (const includeItems of [true, false]) {
        const p = fixture(), old = { weapon_riven_list: {}, weapon_riven_deleted: [p.slot], changed_parties: [] }
        if (includeItems) old.item_list = { [p.slot]: 0 }
        receipts.insertPlayerOperationReceiptSync({ playerId: p.id, operation: 'weapon_riven_dismantle',
            requestKey: 'old-zero-refund', response: old })
        const before = storedState(p.id)
        const replay = dismantle(p, 'old-zero-refund')
        assert.deepEqual(replay.item_list, { [p.slot]: 1, [fragmentId]: 7 })
        assert.deepEqual(storedState(p.id), before)
        assert.equal(items.getPlayerCollectedItemTotalSync(p.id, fragmentId), 0)
    }
    const p = fixture(), archive = snapshots.createPlayerSaveSnapshotV2Sync(p.id)
    dismantle(p)
    snapshots.restorePlayerSaveSnapshotV2Sync(archive, p.id)
    const before = storedState(p.id)
    assert.deepEqual(dismantle(p).item_list, { [p.slot]: 1, [fragmentId]: 7 })
    assert.deepEqual(storedState(p.id), before)
})

test('battle conflicts refresh fragment totals without changing the card, parties, inventory or receipts', () => {
    const p = fixture()
    db.prepare(`INSERT INTO players_active_quests(player_id,play_id,quest_id,category,
        use_boss_boost_point,use_boost_point,is_auto_start_mode,is_multi,is_multi_host,continue_count,started_at_ms)
        VALUES (?,'fragments-busy',1,1,0,0,0,0,0,0,0)`).run(p.id)
    const before = storedState(p.id), result = dismantle(p)
    assert.equal(result.weapon_riven_conflict, true)
    assert.equal(result.reason, 'battle_in_progress')
    assert.deepEqual(result.item_list, { [p.slot]: 1, [fragmentId]: 7 })
    assert.deepEqual(storedState(p.id), before)
})

test('fragment grant and receipt failures roll back deletion, party cleanup, balance and acquisition totals', () => {
    for (const phase of ['grant', 'receipt']) {
        const p = fixture(), before = storedState(p.id)
        db.exec(phase === 'grant'
            ? `CREATE TEMP TRIGGER fail_fragment_write BEFORE UPDATE ON players_items
                WHEN NEW.player_id=${p.id} AND NEW.id=${fragmentId}
                BEGIN SELECT RAISE(ABORT, 'fragment rollback fixture'); END`
            : `CREATE TEMP TRIGGER fail_fragment_write BEFORE INSERT ON player_operation_receipts
                WHEN NEW.player_id=${p.id} AND NEW.operation='weapon_riven_dismantle'
                BEGIN SELECT RAISE(ABORT, 'fragment rollback fixture'); END`)
        try { assert.throws(() => dismantle(p), /fragment rollback fixture/) }
        finally { db.exec('DROP TRIGGER fail_fragment_write') }
        assert.deepEqual(storedState(p.id), before)
        assert.equal(dismantle(p).item_list[fragmentId], 10)
    }
})

test('overflowing fragment balances fail without deleting the card or producing a receipt', () => {
    const p = fixture(Number.MAX_SAFE_INTEGER), before = storedState(p.id)
    assert.throws(() => dismantle(p), /safe integer range/)
    assert.deepEqual(storedState(p.id), before)
})

after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })
