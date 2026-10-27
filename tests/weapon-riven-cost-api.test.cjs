const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { pack, unpack } = require('msgpackr')
const { fixture, post, storedState, beginBattle, currentCard, assertConflict, load, db, app, gate, dir } = require('./helpers/weapon-riven-api-fixture.cjs')

const ABYSS = 2370099, CRYSTAL = 10000320
const ABYSS_COSTS = [50,200,350,500,650,800,950,1100,1250,1400,1550,1700,1850,2000]
const items = load('data/domains/item')
app.register(load('routes/cn/load').default,{prefix:'/api/index.php'})

function assertOptions(card, count = card.roll_count) {
    const cost = ABYSS_COSTS[Math.min(count,ABYSS_COSTS.length-1)]
    assert.deepEqual(card.cost_options,[[ABYSS,cost],[CRYSTAL,1]])
    assert.equal(card.next_cost,cost)
}
function balances(p) {
    return [ABYSS,CRYSTAL].map(id => items.getPlayerItemSync(p.id,id) ?? 0)
}
function successfulCard(response,p) {
    assert.equal(response.status,200,JSON.stringify(response.body))
    assert.equal(response.body.data.weapon_riven_conflict,undefined)
    const card = response.body.data.weapon_riven_list[p.item]
    assertOptions(card)
    return card
}

test('default and explicit currency choices charge only the chosen item and share one roll count', async () => {
    const p = await fixture(60000)
    items.setPlayerItemSync(p.id,CRYSTAL,20)
    let expected = [60000,20]
    const choices = [undefined,CRYSTAL,ABYSS,CRYSTAL,ABYSS]
    for (let index=0; index<choices.length; index++) {
        const costItem = choices[index], before = currentCard(p)
        assertOptions(before,index)
        const response = await post(p,'draw',{api_count:index*2+1,revision:before.revision,
            ...(costItem === undefined ? {} : {cost_item_id:costItem})})
        const drawn = successfulCard(response,p)
        assert.equal(drawn.roll_count,index+1)
        const currencyIndex = costItem === CRYSTAL ? 1 : 0
        expected[currencyIndex] -= currencyIndex ? 1 : ABYSS_COSTS[index]
        assert.deepEqual(balances(p),expected)
        assert.equal(response.body.data.item_list[costItem ?? ABYSS],expected[currencyIndex])
        const selected = successfulCard(await post(p,'select',{api_count:index*2+2,
            draw_id:drawn.pending.draw_id,is_confirm:index%2 === 0}),p)
        assert.equal(selected.roll_count,index+1)
        assert.equal(selected.pending,null)
    }
})

test('crystal price stays one at and beyond the abyss cap', async () => {
    for (const count of [12,13,99]) {
        const p = await fixture()
        items.setPlayerItemSync(p.id,CRYSTAL,1)
        db.prepare('UPDATE player_weapon_rivens SET roll_count=? WHERE player_id=?').run(count,p.id)
        assertOptions(currentCard(p),count)
        const card = successfulCard(await post(p,'draw',{revision:1,cost_item_id:CRYSTAL}),p)
        assert.equal(card.roll_count,count+1)
        assert.deepEqual(balances(p),[10000,0])
    }
})

test('unsupported and malformed cost items return recoverable conflicts without changing state', async () => {
    const p = await fixture()
    items.setPlayerItemSync(p.id,CRYSTAL,10)
    const before = storedState(p)
    for (const cost_item_id of [1,0,-1,null,'2370099',2370099.5,true,[],{},Number.MAX_SAFE_INTEGER+1]) {
        const response = await post(p,'draw',{revision:1,cost_item_id})
        assertConflict(response,p,'cost')
        assertOptions(response.body.data.weapon_riven_list[p.item],0)
        assert.deepEqual(storedState(p),before)
    }
    successfulCard(await post(p,'draw',{revision:1,cost_item_id:CRYSTAL}),p)
    assert.deepEqual(balances(p),[10000,9])
})

test('insufficient or absent selected balances never fall back to another funded item or save a receipt', async () => {
    for (const cost_item_id of [ABYSS,CRYSTAL]) {
        for (const missing of [false,true]) {
            const p = await fixture()
            items.setPlayerItemSync(p.id,CRYSTAL,10)
            const cost = cost_item_id === ABYSS ? 50 : 1
            if (missing) db.prepare('DELETE FROM players_items WHERE player_id=? AND id=?').run(p.id,cost_item_id)
            else items.setPlayerItemSync(p.id,cost_item_id,cost-1)
            const before = storedState(p)
            assertConflict(await post(p,'draw',{revision:1,cost_item_id}),p,'cost')
            assert.deepEqual(storedState(p),before)
            items.setPlayerItemSync(p.id,cost_item_id,cost)
            successfulCard(await post(p,'draw',{revision:1,cost_item_id}),p)
            assert.deepEqual(balances(p),cost_item_id === ABYSS ? [0,10] : [10000,0])
        }
    }
})

test('concurrent mixed-currency retries create one pending choice and debit exactly one currency', async () => {
    const p = await fixture()
    items.setPlayerItemSync(p.id,CRYSTAL,10)
    const results = await Promise.all([CRYSTAL,ABYSS,CRYSTAL,ABYSS].map(cost_item_id =>
        post(p,'draw',{revision:1,cost_item_id})))
    const card = successfulCard(results[0],p)
    assert.equal(card.roll_count,1)
    for (const response of results) assert.deepEqual(successfulCard(response,p),card)
    const [abyss,crystal] = balances(p)
    assert.ok((abyss === 9950 && crystal === 10) || (abyss === 10000 && crystal === 9))
    assert.equal(db.prepare("SELECT COUNT(*) n FROM player_operation_receipts WHERE player_id=? AND operation='weapon_riven_draw'").get(p.id).n,1)
})

test('pending and receipt recovery precede cost validation, even after switching items or draining balances', async () => {
    const p = await fixture()
    items.setPlayerItemSync(p.id,CRYSTAL,1)
    const drawn = successfulCard(await post(p,'draw',{revision:1,cost_item_id:CRYSTAL}),p)
    items.setPlayerItemSync(p.id,ABYSS,0)
    beginBattle(p)
    for (const cost_item_id of [ABYSS,CRYSTAL,null,999]) {
        const before = storedState(p)
        assert.deepEqual(successfulCard(await post(p,'draw',{revision:1,cost_item_id}),p),drawn)
        assert.deepEqual(storedState(p),before)
    }
    const recovered = successfulCard(await post(p,'draw',{api_count:2,revision:1,cost_item_id:null}),p)
    assert.deepEqual(recovered,drawn)
    assert.deepEqual(balances(p),[0,0])
    db.prepare('DELETE FROM players_active_quests WHERE player_id=?').run(p.id)
    const selected = successfulCard(await post(p,'select',{api_count:3,draw_id:drawn.pending.draw_id,is_confirm:true}),p)
    const before = storedState(p)
    for (const api_count of [1,2]) {
        assert.deepEqual(successfulCard(await post(p,'draw',{api_count,revision:1,cost_item_id:ABYSS}),p),selected)
    }
    assertConflict(await post(p,'draw',{api_count:4,revision:1,cost_item_id:null}),p,'riven_changed')
    assert.deepEqual(storedState(p),before)
})

test('draw transaction rolls back selected debit, pending and receipt when either later write fails', async () => {
    for (const cost_item_id of [ABYSS,CRYSTAL]) {
        for (const phase of ['card','receipt']) {
            const p = await fixture()
            items.setPlayerItemSync(p.id,CRYSTAL,10)
            const before = storedState(p)
            const target = phase === 'card' ? 'UPDATE ON player_weapon_rivens' : 'INSERT ON player_operation_receipts'
            db.exec(`CREATE TEMP TRIGGER fail_riven_cost_write BEFORE ${target}
                WHEN NEW.player_id=${p.id}
                BEGIN SELECT RAISE(ABORT, 'riven cost rollback fixture'); END`)
            try {
                const response = await post(p,'draw',{revision:1,cost_item_id})
                assert.equal(response.status,500,JSON.stringify(response.body))
                assert.deepEqual(storedState(p),before)
            } finally { db.exec('DROP TRIGGER fail_riven_cost_write') }
            const drawn = successfulCard(await post(p,'draw',{revision:1,cost_item_id}),p)
            assert.equal(drawn.roll_count,1)
            assert.deepEqual(balances(p),cost_item_id === ABYSS ? [9950,10] : [10000,9])
        }
    }
})

test('random generation failure after debit rolls back both currencies and the draw identity', async () => {
    const draw = load('data/domains/weapon-riven-operations').drawWeaponRivenSync
    for (const costItemId of [ABYSS,CRYSTAL]) {
        const p = await fixture()
        items.setPlayerItemSync(p.id,CRYSTAL,10)
        const before = storedState(p)
        assert.throws(() => draw(p.id,p.item,p.rivenId,1,
            () => { throw Error('cost random fixture') },'cost-random',costItemId),/cost random fixture/)
        assert.deepEqual(storedState(p),before)
        const result = draw(p.id,p.item,p.rivenId,1,() => 0.2,'cost-random',costItemId)
        assertOptions(result.weapon_riven_list[p.item],1)
        assert.deepEqual(balances(p),costItemId === ABYSS ? [9950,10] : [10000,9])
    }
})

test('cost options survive real load, lock, seen, grants and conversion receipt refreshes', async () => {
    const p = await fixture()
    const response = await app.inject({method:'POST',url:'/api/index.php/load',
        headers:{...p.headers,'content-type':'application/x-msgpack'},payload:pack({viewer_id:p.viewer})})
    assert.equal(response.statusCode,200,response.body)
    assertOptions(unpack(response.rawPayload).data.user_weapon_riven_list[p.item],0)
    successfulCard(await post(p,'lock',{locked:true}),p)
    successfulCard(await post(p,'seen',{item_ids:[p.item]}),p)
    const grant = load('data/domains/weapon-riven-grant').grantWeaponRivenSync
    const granted = grant(p.id,300101,[[15990001,50]],'cost-option-grant',() => 0)
    for (const card of Object.values(granted.weapon_riven_list)) assertOptions(card,0)
    assert.deepEqual(grant(p.id,300101,[[15990001,50]],'cost-option-grant',() => 0),granted)
    items.setPlayerItemSync(p.id,16000000,1)
    db.prepare(`INSERT OR IGNORE INTO players_equipment(player_id,id,level,enhancement_level,protection,stack)
        VALUES (?,?,1,0,0,1)`).run(p.id,300101)
    const convert = load('data/domains/weapon-riven-conversion').convertUnknownWeaponRivensSync
    const loadout = {abilitySoulIds:[16000000,null,null]}
    const converted = convert(p.id,loadout,'cost-option-conversion',() => 0.2)
    assert.equal(converted.weapon_riven_granted.length,1)
    for (const card of Object.values(converted.weapon_riven_list)) assertOptions(card,0)
    assert.deepEqual(convert(p.id,loadout,'cost-option-conversion',() => 0.2),converted)
})

after(async () => { await app.close(); gate.close(); db.close(); fs.rmSync(dir,{recursive:true,force:true}) })
