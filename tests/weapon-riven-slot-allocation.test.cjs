const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weapon-riven-slots-'))
process.env.DATA_DIR = dir
const output = process.env.LENS_BUILD_OUT || path.resolve(__dirname, '../out')
const load = name => require(path.join(output, name))
const db = load('data/db').getDb()
const accounts = load('data/domains/account'), players = load('data/domains/player')
const items = load('data/domains/item'), rivens = load('data/domains/weaponRiven')
const unknown = 16000000, firstSlot = 16000001, lastSlot = 16000200
let sequence = 0
function player() {
    const account = accounts.insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'test',
        idpId: `riven-slots-${++sequence}`, status: 'normal' })
    const id = players.insertDefaultPlayerSync(account.id).id
    items.setPlayerItemSync(id, unknown, 3)
    db.prepare('DELETE FROM players_equipment WHERE player_id=?').run(id)
    for (const weapon of [300101, 100001]) {
        load('data/domains/equipment').insertPlayerEquipmentSync(id, weapon,
            { level: 1, enhancementLevel: 0, protection: false, stack: 0 })
    }
    return id
}
function insert(id, random, source = `card-${++sequence}`) {
    return db.transaction(() => rivens.insertWeaponRivenSync(id, 100001, [[15990001, 50]], source, random))()
}
function seededRandom(seed) {
    return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
}
function state(id) {
    return {
        cards: db.prepare('SELECT * FROM player_weapon_rivens WHERE player_id=? ORDER BY item_id').all(id),
        sequence: db.prepare('SELECT * FROM player_weapon_riven_sequences WHERE player_id=?').get(id),
        balance: items.getPlayerItemSync(id, unknown),
        receipts: db.prepare('SELECT * FROM player_operation_receipts WHERE player_id=? ORDER BY rowid').all(id),
    }
}
const noRandom = () => assert.fail('No random draw is allowed')

test('allocation samples only free slots, including both random endpoints and holes', () => {
    const id = player()
    assert.equal(insert(id, () => 0, 'first'), firstSlot)
    assert.equal(insert(id, () => 1 - Number.EPSILON, 'last'), lastSlot)
    assert.equal(insert(id, () => 0.5, 'middle'), 16000101)
    assert.equal(insert(id, () => 0.5, 'next'), 16000100)
    const before = state(id)
    assert.equal(insert(id, noRandom, 'middle'), 16000101)
    assert.deepEqual(state(id), before)
    // Another player's occupancy never removes this player's available slots.
    assert.equal(insert(player(), () => 0.5), 16000101)
})

test('the same seed reproduces slots, weapon and affixes through the conversion random source', () => {
    const convert = seed => rivens.convertUnknownWeaponRivensSync(player(),
        { abilitySoulIds: [unknown, unknown, unknown] }, 'seeded-conversion', seededRandom(seed))
    const first = convert(42), replay = convert(42), different = convert(43)
    assert.deepEqual(first.weapon_riven_granted, replay.weapon_riven_granted)
    assert.deepEqual(first.weapon_riven_list, replay.weapon_riven_list)
    assert.notDeepEqual(first.weapon_riven_granted, [firstSlot, firstSlot + 1, firstSlot + 2])
    assert.notDeepEqual(first.weapon_riven_granted, different.weapon_riven_granted)
    assert.equal(new Set(first.weapon_riven_granted).size, 3)
    assert.equal(first.item_list[unknown], 0)
    const id = player()
    const result = rivens.convertUnknownWeaponRivensSync(id, { abilitySoulIds: [unknown] }, 'once', () => 0.75)
    assert.deepEqual(result.weapon_riven_granted, [16000151])
    const before = state(id)
    assert.deepEqual(rivens.convertUnknownWeaponRivensSync(id, { abilitySoulIds: [unknown] }, 'once', noRandom), result)
    assert.deepEqual(state(id), before)
})

test('the 20-card limit preserves all 200 random slots and insertion retries consume no identity', () => {
    const id = player(), random = seededRandom(904)
    const allocated = Array.from({ length: 20 }, (_, index) => insert(id, random, `fill-${index}`))
    assert.equal(new Set(allocated).size, 20)
    assert.ok(allocated.some(slot => slot > firstSlot + 19))
    assert.ok(allocated.every(slot => slot >= firstSlot && slot <= lastSlot))
    const before = state(id)
    assert.equal(insert(id, noRandom, 'overflow'), null)
    assert.equal(insert(id, noRandom, 'fill-0'), allocated[0])
    assert.deepEqual(state(id), before)
    const reopened = allocated[7]
    db.prepare('DELETE FROM player_weapon_rivens WHERE player_id=? AND item_id=?').run(id, reopened)
    const occupied = new Set(allocated.filter(slot => slot !== reopened))
    const available = Array.from({ length: 200 }, (_, index) => firstSlot + index).filter(slot => !occupied.has(slot))
    const chosen = available[available.length - 1]
    assert.equal(insert(id, () => 1 - Number.EPSILON, 'one-free'), chosen)
    assert.equal(rivens.getPlayerWeaponRivenSync(id, chosen).riven_id, 21)
    assert.equal(state(id).cards.length, 20)
    assert.equal(items.getPlayerItemSync(id, unknown), 3)
    assert.equal(insert(id, noRandom, 'full-again'), null)
})

test('invalid allocation random values roll back without consuming identity or inventory', () => {
    const id = player(), before = state(id)
    for (const value of [-0.01, 1, Infinity, NaN]) {
        assert.throws(() => insert(id, () => value), /random source/)
        assert.deepEqual(state(id), before)
    }
    let calls = 0
    const affixRandom = () => 0
    // Conversion uses one weapon draw, then its normal affix draws, then allocation.
    load('lib/weapon-riven/rules').rollWeaponRivenQualities(100001, () => { calls++; return affixRandom() })
    const drawsBeforeAllocation = calls + 1
    calls = 0
    assert.throws(() => rivens.convertUnknownWeaponRivensSync(id, { abilitySoulIds: [unknown] },
        'invalid-allocation', () => calls++ < drawsBeforeAllocation ? 0 : NaN), /random source/)
    assert.deepEqual(state(id), before)
})

after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })
