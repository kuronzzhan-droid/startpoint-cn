const test = require('node:test')
const assert = require('node:assert/strict')
const content = require('../out/lib/content-master')
const fresh = [139994,139993,159998,159997,159996,169992,129991]
test('winning runtime pools retain eligibility and exact pickup rates across mirrors',()=>{
    for(const [id,weight,total] of [[990001,2000,150000],[990002,10000,950000]]) {
        const pool=content.serverGachas[id]
        assert.deepEqual(pool,require('../assets/gacha.json')[id])
        assert.deepEqual(pool,require(id===990001?'../assets/gacha_cnmod.json':'../assets/gacha_rank_p5b.json')[id])
        const rows=pool.pool['1'],by=new Map(rows.map(row=>[row.id,row]))
        assert.equal(rows.reduce((sum,row)=>sum+row.odds,0),total)
        assert.equal(by.size,rows.length)
        for(const cid of fresh) {
            assert.equal(by.get(cid).odds,weight)
            assert.equal(by.get(cid).isExchangeable,true)
            assert.equal(content.serverCharacters[cid].rarity,5)
            assert.ok(content.cdnCharacters[cid]&&content.cdnCharacterTexts[cid]&&content.serverManaNodes[cid])
        }
        for(const cid of [10,113001,141003,153001,163001])assert.equal(by.has(cid),false)
        assert.equal(by.get(179981).odds,id===990001?1000:10000)
        assert.equal(by.get(179981).isExchangeable,true)
        if(id===990002) {
            assert.equal(by.get(179986).odds,0)
            assert.equal(by.get(179986).isExchangeable,false)
        } else {
            for(const cid of [149990,119989,149989,169989,149988,119993,119994,119995,129993,129994,129995,129996,129998,139996,149991,149992,149993,149994,159999,169993]) {
                assert.equal(by.get(cid).odds,1000)
                // Five previously enabled roles plus the 15 legacy MOD roles.
                assert.equal(by.get(cid).isExchangeable,true)
            }
        }
    }
})
test('new degrees resolve and the EX theme does not activate the leaderboard schedule',()=>{
    for(const id of [...Array.from({length:14},(_,i)=>9910049+i),9911101,9911102,9911103,...Array.from({length:5},(_,i)=>9911201+i)])assert.ok(content.degreeDefinitions[id])
    const theme=require('../assets/abyss_ex_campus_season_template.json')
    assert.equal(theme.enabled,false);assert.equal(theme.event_id,700100);assert.equal(theme.season,null)
    assert.deepEqual(theme.degree_tiers.map(x=>x.toPercent),[2,5,10,20,100])
    assert.ok(theme.degree_tiers.every(x=>!('itemCount'in x)&&!('itemId'in x)))
    for(let id=9900007;id<=9900011;id++)assert.ok(content.degreeDefinitions[id])
})
