const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weapon-riven-cap20-'))
process.env.DATA_DIR = dir
const output = process.env.LENS_BUILD_OUT || path.resolve(__dirname, '../out')
const load = name => require(path.join(output, name))
const db = load('data/db').getDb()
const accounts = load('data/domains/account'), players = load('data/domains/player')
const items = load('data/domains/item'), rivens = load('data/domains/weaponRiven')
const { grantWeaponRivenSync: grant } = load('data/domains/weapon-riven-grant')
const receipts = load('data/domains/player-operation-receipt')
const { weaponRivenRuleSet: rules } = load('lib/weapon-riven/rules')
const { validateWeaponRivenRuleSet } = load('lib/weapon-riven/validate-rules')
const unknown = 16000000, fragment = 16000900, affixes = [[15990006, 50]]
const noRandom = () => assert.fail('Replay and full-cap insertion must not draw random values')
let sequence = 0
function fixture(count, balance = 7) {
    const account = accounts.insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'test',
        idpId: `cap20-${++sequence}`, status: 'normal' })
    const id = players.insertDefaultPlayerSync(account.id).id
    items.setPlayerItemSync(id, unknown, 3)
    items.setPlayerItemSync(id, fragment, balance)
    db.prepare('DELETE FROM players_equipment WHERE player_id=?').run(id)
    load('data/domains/equipment').insertPlayerEquipmentSync(id, 100001,
        { level: 1, enhancementLevel: 0, protection: false, stack: 0 })
    db.prepare('UPDATE players_parties SET ability_soul_1=?,ability_soul_2=?,ability_soul_3=? WHERE player_id=?')
        .run(unknown, unknown, unknown, id)
    db.transaction(() => {
        for (let index = 0; index < count; index++) {
            assert.ok(rivens.insertWeaponRivenSync(id, 100001, affixes, `fixture-${index}`, () => 0))
        }
    })()
    return id
}
function state(id) {
    return { tables: load('data/snapshots/player-snapshot').createPlayerSaveSnapshotV2Sync(id).data.tables,
        sequence: db.prepare('SELECT * FROM player_weapon_riven_sequences WHERE player_id=?').get(id),
        receipts: db.prepare('SELECT * FROM player_operation_receipts WHERE player_id=? ORDER BY rowid').all(id) }
}
const cards = id => db.prepare('SELECT * FROM player_weapon_rivens WHERE player_id=? ORDER BY item_id').all(id)
const convert = (id, count, source = 'convert', random = () => 0) => rivens.convertUnknownWeaponRivensSync(id,
    { abilitySoulIds: Array(count).fill(unknown) }, source, random)

test('holding limit is 20 from the shared configuration and validates integer bounds 1..200', () => {
    assert.equal(rules.rules.items.holding_limit, 20)
    assert.equal(load('lib/weapon-riven/constants').MAX_WEAPON_RIVENS, 20)
    for (const limit of [1, 20, 200]) {
        const configuration = structuredClone(rules)
        configuration.rules.items.holding_limit = limit
        assert.doesNotThrow(() => validateWeaponRivenRuleSet(configuration))
    }
    for (const limit of [undefined, null, 0, -1, 1.5, 201, NaN, Infinity]) {
        const configuration = structuredClone(rules)
        configuration.rules.items.holding_limit = limit
        assert.throws(() => validateWeaponRivenRuleSet(configuration), /holding limit/)
    }
})

test('common grant stores the twentieth card then returns fragments without allocating another identity', () => {
    const id = fixture(19)
    const stored = grant(id, 100001, affixes, 'twentieth', () => 1 - Number.EPSILON)
    assert.deepEqual(stored.weapon_riven_granted, [16000200])
    assert.deepEqual(stored.weapon_riven_auto_dismantled, [])
    assert.equal(stored.weapon_riven_list[16000200].riven_id, 20)
    const fullCards = cards(id), beforeSequence = state(id).sequence
    const overflow = grant(id, 100001, affixes, 'overflow', noRandom)
    assert.deepEqual(overflow.weapon_riven_granted, [])
    assert.deepEqual(overflow.weapon_riven_list, {})
    assert.deepEqual(overflow.weapon_riven_deleted, [])
    assert.deepEqual(overflow.weapon_riven_auto_dismantled, [{ weapon_id: 100001,
        affixes: load('lib/weapon-riven/display').displayWeaponRivenAffixes(100001, affixes), rewards: [[fragment, 3]] }])
    assert.deepEqual(overflow.item_list, { [fragment]: 10 })
    assert.deepEqual(cards(id), fullCards)
    assert.deepEqual(state(id).sequence, beforeSequence)
    assert.equal(items.getPlayerCollectedItemTotalSync(id, fragment), 3)
    const beforeReplay = state(id)
    assert.deepEqual(grant(id, 100001, affixes, 'twentieth', noRandom), stored)
    assert.deepEqual(grant(id, 100001, affixes, 'overflow', noRandom), overflow)
    assert.deepEqual(state(id), beforeReplay)
    assert.deepEqual(receipts.getPlayerOperationReceiptSync(id, 'weapon_riven_grant', 'overflow').response, overflow)
})

test('conversion crosses 19/20 within three slots and replays without random draws, debits or duplicate fragments', () => {
    for (const held of [18, 19, 20]) {
        const id = fixture(held), result = convert(id, 3)
        assert.equal(result.weapon_riven_granted.length, 20 - held)
        assert.equal(result.weapon_riven_auto_dismantled.length, held - 17)
        assert.equal(cards(id).length, 20)
        assert.equal(state(id).sequence.last_id, 20)
        assert.equal(result.item_list[unknown], 0)
        assert.equal(result.item_list[fragment], 7 + 3 * (held - 17))
        assert.equal(items.getPlayerCollectedItemTotalSync(id, fragment), 3 * (held - 17))
        assert.equal(db.prepare('SELECT COUNT(*) n FROM players_parties WHERE player_id=? AND '
            + '(ability_soul_1=? OR ability_soul_2=? OR ability_soul_3=?)').get(id, unknown, unknown, unknown).n, 0)
        for (const card of result.weapon_riven_auto_dismantled) assert.deepEqual(card.rewards, [[fragment, 3]])
        const before = state(id)
        assert.deepEqual(convert(id, 3, 'convert', noRandom), result)
        assert.deepEqual(state(id), before)
        assert.deepEqual(receipts.getPlayerOperationReceiptSync(id, 'weapon_riven_convert', 'convert').response, result)
    }
})

test('overflow grant remains dismantled after capacity reopens and refreshes current fragment balance', () => {
    const id = fixture(20), original = grant(id, 100001, affixes, 'fixed-overflow', noRandom)
    db.prepare('DELETE FROM player_weapon_rivens WHERE player_id=? AND item_id=16000001').run(id)
    items.setPlayerItemSync(id, fragment, 2)
    const before = state(id), replay = grant(id, 100001, affixes, 'fixed-overflow', noRandom)
    assert.deepEqual(replay.weapon_riven_auto_dismantled, original.weapon_riven_auto_dismantled)
    assert.deepEqual(replay.weapon_riven_granted, [])
    assert.deepEqual(replay.item_list, { [fragment]: 2 })
    assert.deepEqual(state(id), before)
    assert.equal(cards(id).length, 19)
})

test('overflow uses newly rolled affix counts and zero paid rolls; zero-refund still consumes unknowns', () => {
    const previous = rules.rules.dismantle_return
    try {
        rules.rules.dismantle_return = { item_id: fragment, base: 3, per_affix: 2, per_roll: 11 }
        const id = fixture(20), result = convert(id, 3, 'configured', () => 0.9)
        for (const card of result.weapon_riven_auto_dismantled) {
            assert.equal(card.affixes.length, 4)
            assert.deepEqual(card.rewards, [[fragment, 11]])
        }
        assert.equal(result.item_list[fragment], 40)
        assert.equal(items.getPlayerCollectedItemTotalSync(id, fragment), 33)
        for (const itemId of [fragment, null]) {
            rules.rules.dismantle_return = { item_id: itemId, base: 0, per_affix: 0, per_roll: 0 }
            const zeroId = fixture(20), zero = convert(zeroId, 1, 'zero')
            assert.equal(zero.item_list[unknown], 2)
            assert.equal(zero.weapon_riven_auto_dismantled.length, 1)
            assert.deepEqual(zero.weapon_riven_auto_dismantled[0].rewards, [])
            assert.equal(zero.item_list[fragment], undefined)
            assert.equal(items.getPlayerItemSync(zeroId, fragment), 7)
            assert.equal(items.getPlayerCollectedItemTotalSync(zeroId, fragment), 0)
        }
    } finally { rules.rules.dismantle_return = previous }
})

test('legacy holdings above 20 survive unchanged and only new rewards are automatically dismantled', () => {
    const previous = rules.rules.items.holding_limit
    let id
    try { rules.rules.items.holding_limit = 200; id = fixture(23) }
    finally { rules.rules.items.holding_limit = previous }
    const beforeCards = cards(id), beforeSequence = state(id).sequence
    const result = convert(id, 3)
    assert.deepEqual(result.weapon_riven_granted, [])
    assert.equal(result.weapon_riven_auto_dismantled.length, 3)
    assert.equal(result.item_list[fragment], 16)
    assert.equal(result.item_list[unknown], 0)
    assert.deepEqual(cards(id), beforeCards)
    assert.deepEqual(state(id).sequence, beforeSequence)
})

test('fragment overflow and grant/convert receipt failures roll back every conversion write', () => {
    for (const phase of ['balance-overflow', 'fragment-write', 'grant-receipt', 'convert-receipt']) {
        const id = fixture(19, phase === 'balance-overflow' ? Number.MAX_SAFE_INTEGER : 7), before = state(id)
        if (phase !== 'balance-overflow') {
            db.exec(phase === 'fragment-write'
                ? `CREATE TEMP TRIGGER cap20_failure BEFORE UPDATE ON players_items
                    WHEN NEW.player_id=${id} AND NEW.id=${fragment}
                    BEGIN SELECT RAISE(ABORT, 'cap20 rollback'); END`
                : `CREATE TEMP TRIGGER cap20_failure BEFORE INSERT ON player_operation_receipts
                    WHEN NEW.player_id=${id} AND NEW.operation='${phase === 'grant-receipt' ? 'weapon_riven_grant' : 'weapon_riven_convert'}'
                    ${phase === 'grant-receipt' ? "AND NEW.request_key='rollback:slot:1'" : ''}
                    BEGIN SELECT RAISE(ABORT, 'cap20 rollback'); END`)
        }
        try { assert.throws(() => convert(id, 3, 'rollback'), phase === 'balance-overflow' ? /safe integer range/ : /cap20 rollback/) }
        finally { if (phase !== 'balance-overflow') db.exec('DROP TRIGGER cap20_failure') }
        assert.deepEqual(state(id), before, `${phase} must restore cards, identities, inventory, parties and receipts`)
        if (phase === 'balance-overflow') items.setPlayerItemSync(id, fragment, 7)
        const retried = convert(id, 3, 'rollback')
        assert.equal(retried.weapon_riven_granted.length, 1)
        assert.equal(retried.weapon_riven_auto_dismantled.length, 2)
        assert.equal(retried.item_list[fragment], 13)
    }
})

after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })
