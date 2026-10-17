const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'abyss-ui-repair-'))
process.env.GACHA_SEED_DIR = path.join(process.env.DATA_DIR, 'seeds')
fs.mkdirSync(process.env.GACHA_SEED_DIR)
const assets = require('../out/lib/assets')
const { getDb } = require('../out/data/db')
const { insertAccountSync } = require('../out/data/domains/account')
const { insertDefaultPlayerSync } = require('../out/data/domains/player')
const { saveAccountDefaultPlayer } = require('../out/data/activeAccount')
const { insertSessionWithToken } = require('../out/data/domains/session')
const rewards = require('../out/lib/leaderboard/rewards')
const settlement = require('../out/lib/leaderboard/settlement')
const db = getDb()
test.after(() => db.close())

test('normal emblems settle at fixed 800 for every random outcome; EX stays at 1000', () => {
    const fixed = require('../assets/rush_event_quest_folder.json')['700099']['1']
    assert.deepEqual(fixed.filter(x=>x.id===99),[{type:0,id:99,count:800}])
    const random = Math.random
    try {
        assert.ok(assets.getRogueEventConfig(700099).folder_clear_random.every(row=>!row.pool.includes(99)))
        for (const [roll,total] of [[0,800],[0.5,800],[0.999999,800]]) {
            Math.random=()=>roll
            assert.deepEqual(assets.getRushEventFolderClearRewards(700099,1).filter(x=>x.id===99),[{type:0,id:99,count:total}])
        }
        assert.equal(assets.getRushEventFolderClearRewards(700100,1).find(x=>x.id===99).count,1000)
    } finally { Math.random=random }
})

async function appWithPlayer() {
    const account=insertAccountSync({appId:'wf_cn',idpAlias:'',idpCode:'leiting',idpId:'',status:'normal'})
    const player=insertDefaultPlayerSync(account.id)
    saveAccountDefaultPlayer(account.id,player.id)
    const viewer=88000000+player.id
    await insertSessionWithToken({token:String(viewer),accountId:account.id,expires:new Date(Date.now()+86400000),type:2})
    const app=require('fastify')({logger:false})
    app.addHook('onSend',(_req,reply,payload,done)=>done(null,
        String(reply.getHeader('content-type')||'').startsWith('application/x-msgpack')&&typeof payload==='object'
            ?JSON.stringify(payload):payload))
    await app.register(require('../out/routes/api/shop').default,{prefix:'/shop'})
    await app.register(require('../out/routes/api/gacha').default,{prefix:'/gacha'})
    const post=(url,data)=>app.inject({method:'POST',url,payload:{viewer_id:viewer,api_count:1,...data}})
    return {app,player,post}
}

test('both shop entrances expose identical product IDs and purchase stock through the actual routes', async () => {
    const {app,player,post}=await appWithPlayer()
    try {
        const normal=assets.getEventShopItemsSync(11,700099)
        assert.ok(Object.keys(normal).length>0)
        assert.strictEqual(assets.getEventShopItemsSync(11,700100),normal)
        const list=async ids=>{
            const r=await post('/shop/get_sales_list',{shop_types:[],boss_coin_shop_category_ids:[],event_list:[{event_type:11,event_ids:ids}]})
            assert.equal(r.statusCode,200,r.payload);return r.json().data.sales_list
        }
        const before=await list([700099]);assert.ok(before.length>0)
        assert.deepEqual(await list([700100]),before)
        assert.deepEqual(await list([700099,700100]),before)
        const id=before[0].shop_item_id
        const {givePlayerItemSync}=require('../out/data/domains/item')
        givePlayerItemSync(player.id,2370099,100000)
        const bought=await post('/shop/buy',{shop_type:4,shop_item_id:id,number:1})
        assert.equal(bought.statusCode,200,bought.payload)
        const after=await list([700100])
        assert.deepEqual(after,await list([700099]))
        assert.notDeepEqual(after.find(x=>x.shop_item_id===id),before.find(x=>x.shop_item_id===id))
        assert.equal(require('../out/data/domains/shopPurchase').getPlayerShopPurchaseCountSync(player.id,id),1)
    } finally {await app.close()}
})

test('campus, Scutum and summer White exchange for 250 points; unrelated exclusions remain closed',async()=>{
    const {app,player,post}=await appWithPlayer()
    const g=require('../out/data/domains/gacha')
    const {getPlayerCharacterSync}=require('../out/data/domains/character')
    try {
        g.insertPlayerGachaInfoSync(player.id,{gachaId:990001,isAccountFirst:false,isDailyFirst:false,gachaExchangePoint:0})
        // The previous MOD rotation is exchangeable in the current effective pool.
        for(const id of [119989,149989,169989,149988,149990,139994]) {
            g.updatePlayerGachaInfoSync(player.id,{gachaId:990001,gachaExchangePoint:249})
            assert.equal((await post('/gacha/exchange_character',{gacha_id:990001,character_id:id})).statusCode,400)
            assert.equal(g.getPlayerGachaInfoSync(player.id,990001).gachaExchangePoint,249)
            g.updatePlayerGachaInfoSync(player.id,{gachaId:990001,gachaExchangePoint:250})
            const r=await post('/gacha/exchange_character',{gacha_id:990001,character_id:id})
            assert.equal(r.statusCode,200,r.payload)
            assert.equal(g.getPlayerGachaInfoSync(player.id,990001).gachaExchangePoint,0)
            assert.ok(getPlayerCharacterSync(player.id,id))
        }
        g.updatePlayerGachaInfoSync(player.id,{gachaId:990001,gachaExchangePoint:250})
        assert.equal(require('../out/lib/gacha-rules').getExchangeableGachaItem(assets.getGachaSync(990001),151153),null)
        for(const id of [151153])assert.equal((await post('/gacha/exchange_character',{gacha_id:990001,character_id:id})).statusCode,400)
        assert.equal(g.getPlayerGachaInfoSync(player.id,990001).gachaExchangePoint,250)
    } finally {await app.close()}
})

test('EX rewards upgrade the empty configuration without enabling a schedule or overwriting custom tiers',()=>{
    const key='rush:700100:1'
    const normalConfig=settlement.getLeaderboardSettlementConfigSync('rush:700099:1')
    const counts=[5,4,3,2,3]
    normalConfig.rewardTiers=normalConfig.rewardTiers.map((tier,index)=>({...tier,itemCount:counts[index]}))
    settlement.putLeaderboardSettlementConfigSync(normalConfig)
    const initial=settlement.getLeaderboardSettlementConfigSync(key)
    db.prepare('UPDATE leaderboard_settlement_configs SET reward_tiers_json=? WHERE competition_key=?').run('[]',key)
    const config=settlement.getLeaderboardSettlementConfigSync(key)
    assert.equal(config.autoEnabled,false);assert.equal(config.settleAtMs,null)
    assert.equal(require('../out/lib/leaderboard/availability').getLeaderboardAvailabilitySync(key).enabled,false)
    assert.equal(config.rewardTiers.length,5)
    config.rewardTiers.forEach((tier,i)=>{
        const normal=normalConfig.rewardTiers[i]
        for(const k of ['fromPercent','toPercent','itemId','itemCount'])assert.equal(tier[k],normal[k])
        assert.equal(tier.degreeId,9911201+i)
        assert.ok(require('../out/lib/content-master').degreeDefinitions[tier.degreeId])
    })
    const custom=config.rewardTiers.map(t=>({...t,itemCount:3}))
    settlement.putLeaderboardSettlementConfigSync({...config,rewardTiers:custom})
    assert.deepEqual(settlement.getLeaderboardSettlementConfigSync(key).rewardTiers,custom)
    assert.equal(initial.mailSubject,config.mailSubject)
})

test('EX settlement sends the new title and the configured tickets, once',()=>{
    const key='rush:700100:1'
    const config=settlement.getLeaderboardSettlementConfigSync(key)
    settlement.putLeaderboardSettlementConfigSync({...config,rewardTiers:rewards.buildAbyssExRewardRules(settlement.getLeaderboardSettlementConfigSync('rush:700099:1').rewardTiers)})
    const account=insertAccountSync({appId:'wf_cn',idpAlias:'',idpCode:'leiting',idpId:'',status:'normal'})
    const player=insertDefaultPlayerSync(account.id)
    const season=require('../out/lib/leaderboard/competition').getLeaderboardCompetitionSeasonSync(key)
    const run=db.prepare(`INSERT INTO leaderboard_runs (competition_key,player_id,season,status,started_at_ms,finished_at_ms,client_battle_ms,rounds_cleared,total_rounds,tracked_from_round,character_id_1)
        VALUES (?,?,?,'completed',1000,31000,30000,30,30,1,1)`).run(key,player.id,season)
    for(let floor=1;floor<=30;floor++)db.prepare(`INSERT INTO leaderboard_run_rounds (run_id,round_number,quest_id,client_battle_ms,server_elapsed_ms,started_at_ms,finished_at_ms)
        VALUES (?,?,?,1000,1000,?,?)`).run(run.lastInsertRowid,floor,700100000+floor,floor*1000,(floor+1)*1000)
    const outcome=settlement.settleLeaderboardSeasonSync(key,'isolated-test')
    assert.equal(outcome.rewardedPlayers,1)
    const mail=db.prepare('SELECT type_id,number FROM players_mails WHERE player_id=? ORDER BY type_id').all(player.id)
    assert.deepEqual(mail,[{type_id:999018,number:5},{type_id:9911201,number:1}])
    assert.equal(settlement.settleLeaderboardSeasonSync(key,'isolated-repeat').reason,'already-settled')
    assert.deepEqual(db.prepare('SELECT type_id,number FROM players_mails WHERE player_id=? ORDER BY type_id').all(player.id),mail)
})
