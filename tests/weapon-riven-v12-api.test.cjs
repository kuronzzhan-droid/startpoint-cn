const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { fixture, post, storedState, beginBattle, currentCard, assertConflict, load, db, app, gate, dir } = require('./helpers/weapon-riven-api-fixture.cjs')
require('./helpers/weapon-riven-legacy-value-model.cjs').pinLegacyValueModel(load('lib/weapon-riven/rules').weaponRivenRuleSet)

function insert(p, source, affixes = [[15990001, 40]]) {
    return db.transaction(() => load('data/domains/weaponRiven').insertWeaponRivenSync(p.id,300101,affixes,source, () => 0))()
}
function row(p) { return db.prepare('SELECT * FROM player_weapon_rivens WHERE player_id=? AND item_id=?').get(p.id,p.item) }

test('v1.2 responses retain disposition, cap and refund while current and pending storage uses q pairs', async () => {
    const p = await fixture()
    const rules = load('lib/weapon-riven/rules')
    const card = currentCard(p)
    assert.equal(card.locked,0)
    assert.equal(card.seen,0)
    assert.equal(card.disposition,Math.round(rules.getWeaponRivenDisposition(card.weapon_id)))
    const definition = rules.weaponRivenRuleSet.affixes.affixes.find(row => row.key === 15990001)
    const legacy = definition.legacy_encoding
    const oldMagnitude = Math.abs(Math.round(legacy.raw_lo + (legacy.raw_hi-legacy.raw_lo)*49/99)/legacy.raw_per_unit)
    const expectedLevel = Math.round(1 + 99*(oldMagnitude-definition.lo)/(definition.hi-definition.lo))
    assert.deepEqual(card.affixes,[[15990001,expectedLevel,rules.getWeaponRivenAffixCapLevel(card.weapon_id,15990001)]])
    assert.deepEqual(card.dismantle_return,[[16000900,3]])
    assert.equal(row(p).affix_version,3)
    assert.ok(JSON.parse(row(p).affixes_json).every(([key,q]) => key===15990001 && q>=0 && q<=1))
    const drawn = (await post(p,'draw',{revision:1})).body.data.weapon_riven_list[p.item]
    const pending = JSON.parse(row(p).pending_json).affixes
    assert.ok(drawn.pending.affixes.every(([key,level,cap]) => cap === rules.getWeaponRivenAffixCapLevel(drawn.weapon_id,key,rules.weaponRivenRuleSet,pending)))
    assert.ok(JSON.parse(row(p).pending_json).affixes.every(pair => pair.length === 2))
    const selected = (await post(p,'select',{api_count:2,draw_id:drawn.pending.draw_id,is_confirm:true})).body.data.weapon_riven_list[p.item]
    assert.deepEqual(selected.affixes,drawn.pending.affixes)
    assert.ok(JSON.parse(row(p).affixes_json).every(pair => pair.length === 2))
    const refund = await post(p,'dismantle',{api_count:3})
    assert.equal(refund.body.data.item_list[16000900],selected.dismantle_return[0][1])
})

test('unknown historical keys cannot fabricate q or cap and reject before changing any card', async () => {
    const p = await fixture()
    const before = storedState(p)
    assert.throws(() => insert(p,'unknown-history',[[15999999,42]]),/Missing historical weapon riven affix key/)
    assert.deepEqual(storedState(p),before)
})

test('lock is authenticated, idempotent under concurrency and blocks dismantle without changing any balance or party', async () => {
    const p = await fixture()
    db.prepare('UPDATE players_parties SET ability_soul_1=? WHERE player_id=?').run(p.item,p.id)
    assert.equal((await post(p,'lock',{locked:1},false)).body.code,'capability_required')
    const responses = await Promise.all(Array.from({length:4},() => post(p,'lock',{locked:1})))
    for (const response of responses) {
        assert.equal(response.status,200)
        assert.equal(response.body.data.weapon_riven_list[p.item].locked,1)
        assert.equal(response.body.data.weapon_riven_list[p.item].revision,2)
        assert.deepEqual(response.body.data,responses[0].body.data)
    }
    const before = storedState(p)
    assertConflict(await post(p,'dismantle',{api_count:2}),p,'locked')
    assert.deepEqual(storedState(p),before)
    assert.deepEqual((await post(p,'lock',{locked:true})).body.data,responses[0].body.data)
    assert.deepEqual(storedState(p),before)
    const unlocked = await post(p,'lock',{locked:false})
    assert.equal(unlocked.body.data.weapon_riven_list[p.item].locked,0)
    assert.equal(unlocked.body.data.weapon_riven_list[p.item].revision,3)
    assert.equal((await post(p,'dismantle',{api_count:2})).body.data.item_list[16000900],3)
})

test('locking protects dismantling while allowing paid draws and selections', async () => {
    const p = await fixture()
    await post(p,'lock',{locked:1})
    const draw = await post(p,'draw',{api_count:2,revision:2})
    assert.equal(draw.status,200)
    const pending = draw.body.data.weapon_riven_list[p.item].pending
    const before = storedState(p)
    assertConflict(await post(p,'dismantle',{api_count:3}),p,'locked')
    assert.deepEqual(storedState(p),before)
    const chosen = await post(p,'select',{api_count:4,draw_id:pending.draw_id,is_confirm:false})
    assert.equal(chosen.status,200)
    assert.equal(chosen.body.data.weapon_riven_list[p.item].locked,1)
    assert.equal(chosen.body.data.weapon_riven_list[p.item].pending,null)
})

test('lock verifies permanent identity for foreign, deleted and reused slots', async () => {
    const p = await fixture(), other = await fixture()
    const foreignSlot = insert(other,'foreign-only')
    const before = storedState(other)
    const foreign = await post(p,'lock',{item_id:foreignSlot,riven_id:2,locked:1})
    assert.equal(foreign.body.data.weapon_riven_conflict,true)
    assert.deepEqual(foreign.body.data.weapon_riven_deleted,[foreignSlot])
    assert.deepEqual(storedState(other),before)
    await post(p,'dismantle')
    assertConflict(await post(p,'lock',{locked:1}),p,'riven_changed')
    assert.equal(insert(p,'reused'),p.item)
    const fresh = storedState(p)
    assertConflict(await post(p,'lock',{locked:1}),p,'riven_changed')
    assert.deepEqual(storedState(p),fresh)
})

test('seen atomically marks the owned batch, deduplicates and reports absent slots without touching other players', async () => {
    const p = await fixture(), other = await fixture()
    const second = insert(p,'seen-second'), foreignOnly = insert(other,'other-second')
    assert.equal(second,foreignOnly)
    const third = insert(other,'other-third')
    const otherBefore = storedState(other)
    const request = {item_id:undefined,riven_id:undefined,item_ids:[p.item,second,p.item,third]}
    assert.equal((await post(p,'seen',request,false)).body.code,'capability_required')
    const response = await post(p,'seen',request)
    assert.equal(response.status,200)
    assert.deepEqual(Object.keys(response.body.data.weapon_riven_list),[String(p.item),String(second)])
    for (const card of Object.values(response.body.data.weapon_riven_list)) {
        assert.equal(card.seen,1)
        assert.equal(card.revision,2)
    }
    assert.deepEqual(response.body.data.weapon_riven_deleted,[third])
    assert.deepEqual(storedState(other),otherBefore)
    const before = storedState(p)
    assert.deepEqual((await post(p,'seen',request)).body.data,response.body.data)
    assert.deepEqual(storedState(p),before)
    assert.deepEqual((await post(p,'seen',{item_ids:[]})).body.data.weapon_riven_list,{})
})

test('battle rejects state changes atomically while permitting already-applied lock and seen reads', async () => {
    const p = await fixture()
    await post(p,'seen',{item_ids:[p.item]})
    const second = insert(p,'battle-unseen')
    beginBattle(p)
    const before = storedState(p)
    assertConflict(await post(p,'lock',{locked:1}),p,'battle_in_progress')
    const batch = await post(p,'seen',{item_ids:[p.item,second]})
    assert.equal(batch.status,200)
    assert.equal(batch.body.data.reason,'battle_in_progress')
    assert.equal(batch.body.data.weapon_riven_list[second].seen,0)
    assert.equal((await post(p,'lock',{locked:0})).body.data.weapon_riven_conflict,undefined)
    assert.equal((await post(p,'seen',{item_ids:[p.item]})).body.data.weapon_riven_conflict,undefined)
    assert.deepEqual(storedState(p),before)
})

test('invalid lock and seen payloads fail before mutations', async () => {
    const p = await fixture(), before = storedState(p)
    for (const locked of [undefined,null,-1,2,'1',[],{}]) {
        assert.equal((await post(p,'lock',{locked})).body.code,'invalid_argument')
    }
    for (const item_ids of [undefined,null,{},[16000000],[16000201],['16000001'],[1.5],Array(201).fill(p.item)]) {
        assert.equal((await post(p,'seen',{item_ids})).body.code,'invalid_argument')
    }
    assert.deepEqual(storedState(p),before)
})

test('draw with a revision predating lock or seen returns a recoverable conflict without charging', async () => {
    for (const action of ['lock','seen']) {
        const p = await fixture()
        await post(p,action,action === 'lock' ? {locked:1} : {item_ids:[p.item]})
        const before = storedState(p)
        assertConflict(await post(p,'draw',{api_count:2,revision:1}),p,'riven_changed')
        assert.deepEqual(storedState(p),before)
        const draw = await post(p,'draw',{api_count:2,revision:currentCard(p).revision})
        assert.equal(draw.status,200)
        assert.equal(draw.body.data.weapon_riven_conflict,undefined)
        assert.equal(draw.body.data.item_list[2370099],9950)
    }
})

after(async () => { await app.close(); gate.close(); db.close(); fs.rmSync(dir,{recursive:true,force:true}) })
