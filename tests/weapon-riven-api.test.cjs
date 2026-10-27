const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { fixture, post, storedState, beginBattle, currentCard, assertConflict, load, db, app, gate, dir } = require('./helpers/weapon-riven-api-fixture.cjs')
test('authenticated MessagePack draws serialize concurrent retries and persist choice identity', async () => {
    const p = await fixture()
    const draws = await Promise.all(Array.from({length:4},() => post(p,'draw',{revision:1})))
    for (const draw of draws) { assert.equal(draw.status,200,JSON.stringify(draw.body)); assert.deepEqual(draw.body.data,draws[0].body.data) }
    assert.equal(draws[0].body.data.item_list[2370099],9950)
    const drawId=draws[0].body.data.weapon_riven_list[p.item].pending.draw_id
    const choice = await post(p,'select',{api_count:2,draw_id:drawId,is_confirm:true})
    assert.equal(choice.status,200)
    assert.equal(choice.body.data.weapon_riven_list[p.item].pending,null)
    assert.deepEqual((await post(p,'select',{api_count:3,draw_id:drawId,is_confirm:false})).body.data,choice.body.data)
    assert.equal((await post(p,'draw',{revision:1})).status,200)
    assert.equal(load('data/domains/item').getPlayerItemSync(p.id,2370099),9950)
    const next = await post(p,'draw',{revision:3})
    assert.equal(next.status,200)
    assert.equal(next.body.data.item_list[2370099],9750)
})
test('API rejects missing capability, invalid select payload and insufficient funds without mutation', async () => {
    const p = await fixture(10)
    assert.equal((await post(p,'draw',{revision:1},false)).body.code,'capability_required')
    assert.equal((await post(p,'select',{draw_id:'x',is_confirm:1})).body.code,'invalid_argument')
    for (const action of ['draw','select','dismantle']) {
        for (const riven_id of [undefined,null,0,-1,'1',1.5,Number.MAX_SAFE_INTEGER+1]) {
            assert.equal((await post(p,action,{riven_id,revision:1,draw_id:'x',is_confirm:true})).body.code,'invalid_argument')
        }
    }
    const before = storedState(p)
    assertConflict(await post(p,'draw',{revision:1}),p,'cost')
    assert.deepEqual(storedState(p),before)
    assert.equal(load('data/domains/item').getPlayerItemSync(p.id,2370099),10)
})
test('dismantle returns cleared parties and repeated requests cannot delete a newly reused slot', async () => {
    const p = await fixture()
    db.prepare('UPDATE players_parties SET ability_soul_2=? WHERE player_id=?').run(p.item,p.id)
    const requests = await Promise.all(Array.from({length:4},() => post(p,'dismantle')))
    const deleted = requests.find(result => !result.body.data.weapon_riven_conflict)
    assert.ok(deleted)
    assert.equal(requests.filter(result => !result.body.data.weapon_riven_conflict).length,1)
    for (const result of requests) {
        assert.equal(result.status,200,JSON.stringify(result.body))
        assert.equal(result.body.data.item_list[16000900],3)
    }
    assert.equal(load('data/domains/item').getPlayerCollectedItemTotalSync(p.id,16000900),3)
    assert.equal(deleted.status,200,JSON.stringify(deleted.body))
    assert.deepEqual(deleted.body.data.weapon_riven_deleted,[p.item])
    assert.ok(deleted.body.data.party_info_list.length>0)
    assert.ok(deleted.body.data.party_info_list.every(party => party.ability_soul_ids[1] === null))
    db.transaction(() => load('data/domains/weaponRiven').insertWeaponRivenSync(p.id,300101,[[15990001,60]],'new-fixture', () => 0))()
    const retry = await post(p,'dismantle')
    assertConflict(retry,p,'riven_changed')
    assert.deepEqual(retry.body.data.weapon_riven_deleted,[])
    assert.equal(retry.body.data.item_list[p.item],1)
    assert.equal(retry.body.data.item_list[16000900],3)
    assert.equal(load('data/domains/item').getPlayerItemSync(p.id,p.item),1)
    p.headers['x-sp-session'] += '-new-login'
    gate.bind(p.headers['x-sp-admission'],p.headers['x-sp-session'])
    const newSession = await post(p,'dismantle')
    assertConflict(newSession,p,'riven_changed')
    const fresh = await post(p,'dismantle',{riven_id:currentCard(p).riven_id})
    assert.equal(fresh.status,200)
    assert.deepEqual(fresh.body.data.weapon_riven_deleted,[p.item])
    assert.equal(fresh.body.data.item_list[16000900],6)
})
test('all stale operations conflict before receipts for deleted cards and reused slots across sessions', async () => {
    const p = await fixture()
    const draw = await post(p,'draw',{revision:1})
    const drawId = draw.body.data.weapon_riven_list[p.item].pending.draw_id
    await post(p,'select',{api_count:2,draw_id:drawId,is_confirm:true})
    await post(p,'dismantle',{api_count:3})
    for (const reused of [false,true]) {
        if (reused) {
            const slot = db.transaction(() => load('data/domains/weaponRiven').insertWeaponRivenSync(p.id,300101,
                [[15990001,60]],'stale-reused', () => 0))()
            assert.equal(slot,p.item)
            assert.equal(currentCard(p).revision,1)
            assert.notEqual(currentCard(p).riven_id,p.rivenId)
            db.prepare('UPDATE players_parties SET ability_soul_1=? WHERE player_id=?').run(p.item,p.id)
        }
        for (const login of [0,1]) {
            if (login) {
                p.headers['x-sp-session'] += '-relogin'
                gate.bind(p.headers['x-sp-admission'],p.headers['x-sp-session'])
            }
            const before = storedState(p)
            for (const [action,extra] of [['draw',{revision:1}],['select',{api_count:2,draw_id:drawId,is_confirm:false}],
                ['dismantle',{api_count:3}]]) {
                assertConflict(await post(p,action,extra),p,'riven_changed')
                assert.deepEqual(storedState(p),before)
            }
        }
    }
    // A valid request for the new identity may reuse the same request counters.
    const fresh = await post(p,'draw',{riven_id:currentCard(p).riven_id,revision:1})
    assert.equal(fresh.status,200)
    assert.equal(fresh.body.data.weapon_riven_conflict,undefined)
    assert.equal(fresh.body.data.item_list[2370099],9900)
})
test('battle mutations return MessagePack conflicts and leave cards, balances, parties and receipts unchanged', async () => {
    for (const action of ['draw','select','dismantle']) {
        const p = await fixture()
        let extra = {revision:1}
        if (action === 'select') {
            const drawn = await post(p,'draw',{revision:1})
            extra = {api_count:2,draw_id:drawn.body.data.weapon_riven_list[p.item].pending.draw_id,is_confirm:true}
        }
        db.prepare('UPDATE players_parties SET ability_soul_2=? WHERE player_id=?').run(p.item,p.id)
        beginBattle(p)
        const before = storedState(p)
        assertConflict(await post(p,action,extra),p,'battle_in_progress')
        if (action === 'draw') assertConflict(await post(p,action,{revision:999}),p,'battle_in_progress')
        assert.deepEqual(storedState(p),before)
    }
})
test('replacement card identity separates successful draw receipts even with identical counters and revisions', async () => {
    const p = await fixture()
    await post(p,'draw',{revision:1})
    await post(p,'dismantle',{api_count:2})
    const slot = db.transaction(() => load('data/domains/weaponRiven').insertWeaponRivenSync(p.id,300101,
        [[15990001,60]],'counter-reused', () => 0))()
    assert.equal(slot,p.item)
    const fresh = await post(p,'draw',{riven_id:currentCard(p).riven_id,revision:1})
    assert.equal(fresh.status,200)
    assert.equal(fresh.body.data.weapon_riven_conflict,undefined)
    assert.equal(fresh.body.data.item_list[2370099],9900)
    assert.equal(fresh.body.data.weapon_riven_list[p.item].roll_count,1)
})
test('battle permits pending recovery and completed draw/select receipt reads without charging or changing the card', async () => {
    const p = await fixture()
    const draw = await post(p,'draw',{revision:1})
    const drawId = draw.body.data.weapon_riven_list[p.item].pending.draw_id
    beginBattle(p)
    const pending = await post(p,'draw',{api_count:2,revision:1})
    assert.equal(pending.status,200)
    assert.equal(pending.body.data.weapon_riven_conflict,undefined)
    assert.deepEqual(pending.body.data.weapon_riven_list,draw.body.data.weapon_riven_list)
    db.prepare('DELETE FROM players_active_quests WHERE player_id=?').run(p.id)
    const chosen = await post(p,'select',{api_count:3,draw_id:drawId,is_confirm:true})
    beginBattle(p)
    const before = storedState(p)
    assert.deepEqual((await post(p,'select',{api_count:4,draw_id:drawId,is_confirm:false})).body.data,chosen.body.data)
    const priorDraw = await post(p,'draw',{revision:1})
    assert.equal(priorDraw.status,200)
    assert.equal(priorDraw.body.data.weapon_riven_conflict,undefined)
    assert.deepEqual(priorDraw.body.data.weapon_riven_list,chosen.body.data.weapon_riven_list)
    assert.deepEqual(storedState(p),before)
})
after(async () => { await app.close(); gate.close(); db.close(); fs.rmSync(dir,{recursive:true,force:true}) })
