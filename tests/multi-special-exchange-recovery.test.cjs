const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-multi-exchange-recovery-'))
process.env.DATA_DIR = isolated
process.env.SESSION_HOST = '127.0.0.1'
process.env.SESSION_PORT = '0'
process.env.CN_LOAD_CAPTURE_PATH = ''
require('ts-node/register/transpile-only')
const Fastify = require('fastify')
const { getDb } = require('../src/data/db')
const campaigns = require('../src/data/domains/campaign')
const items = require('../src/data/domains/item')
const characters = require('../src/data/domains/character')
const players = require('../src/data/domains/player')
const saves = require('../src/data/snapshots/player-snapshot')
const lounge = require('../src/lounge/state')
const table = require('../assets/multi_special_exchange_campaign_character.json')
const chosen = table['980005'][0]
let nextViewer = 99120000
async function makePlayer() {
    const account = require('../src/data/domains/account').insertAccountSync({appId:'wf_cn',idpAlias:'',idpCode:'test',idpId:'',status:'normal'})
    const player = players.insertDefaultPlayerSync(account.id)
    require('../src/data/activeAccount').saveAccountDefaultPlayer(account.id,player.id)
    const viewer = nextViewer++
    await require('../src/data/domains/session').insertSessionWithToken({token:String(viewer),accountId:account.id,expires:new Date(Date.now()+86400000),type:2})
    return {id:player.id,viewer}
}
function setCampaign(p,id,status,ticketItemId) { campaigns.updatePlayerMultiSpecialExchangeCampaignSync(p.id,{campaignId:id,status,ticketItemId}) }
function state(p,id) { return campaigns.getPlayerMultiSpecialExchangeCampaignsSync(p.id).find(c=>c.campaignId===id) }

test('活动券恢复、领取重试、加载与非空旧存档兼容',async t=>{
    const app = Fastify({logger:false})
    app.addHook('onSend',(_r,reply,payload,done)=>done(null,String(reply.getHeader('content-type')||'').startsWith('application/x-msgpack')&&typeof payload==='object'?JSON.stringify(payload):payload))
    await app.register(require('../src/routes/api/multiSpecialExchange').default,{prefix:'/exchange'})
    await app.register(require('../src/routes/api/lounge').default,{prefix:'/lounge'})
    await app.register(require('../src/routes/cn/load').default)
    await app.ready()
    t.after(async()=>{
        await app.close()
        lounge.resetLoungesForTests()
        await require('../src/multi/npc/player-party-pool').stopQuestNpcPartyPoolWorker()
        getDb().close()
        const target = path.resolve(isolated), boundary = path.resolve(os.tmpdir())+path.sep
        assert.ok(target.startsWith(boundary))
        fs.rmSync(target,{recursive:true,force:true})
    })
    const post = async(url,payload)=>{
        const r=await app.inject({method:'POST',url,payload})
        return {http:r.statusCode,type:String(r.headers['content-type']),body:r.json()}
    }
    const code=r=>r.body.data_headers?.result_code
    const draw=(p,id=3,route='single_draw_ticket')=>post(`/exchange/${route}`,{viewer_id:p.viewer,campaign_id:id})
    const exchange=(p,id=3,ticket=980005,character=chosen)=>post('/exchange/exchange_character',{viewer_id:p.viewer,campaign_id:id,ticket_item_id:ticket,character_id:character})
    const load=p=>post('/load',{viewer_id:p.viewer})
    const row=(r,id)=>r.body.data.multi_special_exchange_campaign_list.find(c=>c.campaign_id===id)

    await t.test('旧status3缺失或错误券身份从唯一实持券恢复，load可解析且兑换只扣一次',async()=>{
        for(const identity of [undefined,980007,980001]){
            const p=await makePlayer(); setCampaign(p,3,3,identity); items.setPlayerItemSync(p.id,980005,1)
            const loaded=await load(p)
            assert.equal(code(loaded),1)
            assert.equal(row(loaded,3).ticket_item_id,980005)
            const r=await exchange(p)
            assert.equal(code(r),1)
            assert.equal(items.getPlayerItemSync(p.id,980005),0)
            assert.equal(state(p,3).status,4)
        }
    })
    await t.test('歧义或无实持券的坏status3不发送给load且不改变持久记录',async()=>{
        const p=await makePlayer(); setCampaign(p,1,3)
        items.setPlayerItemSync(p.id,980001,1);items.setPlayerItemSync(p.id,980002,1)
        const before=state(p,1)
        assert.equal(row(await load(p),1),undefined)
        assert.equal(code(await exchange(p,1,980001,table['980001'][0])),4902)
        assert.deepEqual(state(p,1),before)
        items.setPlayerItemSync(p.id,980001,0);items.setPlayerItemSync(p.id,980002,0)
        assert.equal(row(await load(p),1),undefined)
        assert.deepEqual(state(p,1),before)
    })
    await t.test('unsupported4/5与未知活动不开放建房或发券，历史数据保留而load过滤',async()=>{
        const p=await makePlayer()
        for(const id of [4,5,999999]){
            setCampaign(p,id,1)
            const before=state(p,id)
            assert.equal(code(await draw(p,id)),4901)
            const created=await post('/lounge/create',{viewer_id:p.viewer,use_case:1,campaign_id:id})
            assert.equal(code(created),4511)
            assert.equal(lounge.getLoungeCountForTests(),0)
            assert.equal(row(await load(p),id),undefined)
            assert.deepEqual(state(p,id),before)
        }
    })
    await t.test('null、数组、错误use_case正常业务拒绝，不返回500',async()=>{
        const p=await makePlayer()
        for(const body of [null,[],{viewer_id:p.viewer,use_case:99,campaign_id:3},{viewer_id:p.viewer,use_case:true,campaign_id:3},{viewer_id:p.viewer,use_case:[1],campaign_id:3}]){
            const r=await post('/lounge/create',body)
            assert.equal(r.http,200);assert.ok(r.type.startsWith('application/x-msgpack'));assert.equal(code(r),4511)
        }
        for(const route of ['single_draw_ticket','multi_draw_ticket','exchange_character']){
            for(const body of [null,[]]){
                const r=await post(`/exchange/${route}`,body)
                assert.equal(r.http,200);assert.equal(code(r),4901)
            }
        }
    })
    await t.test('布尔与数组活动ID不被数字强制转换成有效活动',async()=>{
        const p=await makePlayer();setCampaign(p,1,1)
        for(const campaign_id of [true,[1]]) {
            assert.equal(code(await post('/exchange/single_draw_ticket',{viewer_id:p.viewer,campaign_id})),4901)
        }
        assert.equal(state(p,1).status,1)
        assert.ok(!items.getPlayerItemSync(p.id,980001))
    })
    await t.test('缺失资格建房和抽券拒绝，不生成任何活动记录',async()=>{
        const p=await makePlayer()
        const before=campaigns.getPlayerMultiSpecialExchangeCampaignsSync(p.id)
        assert.equal(code(await post('/lounge/create',{viewer_id:p.viewer,use_case:1,campaign_id:2})),4511)
        assert.equal(code(await draw(p,2)),4902)
        assert.deepEqual(campaigns.getPlayerMultiSpecialExchangeCampaignsSync(p.id),before)
    })
    await t.test('单人和多人抽券重试重放同一合法券，不二次支付',async()=>{
        for(const route of ['single_draw_ticket','multi_draw_ticket']){
            const p=await makePlayer()
            const rs=await Promise.all([draw(p,3,route),draw(p,3,route),draw(p,3,route)])
            assert.deepEqual(rs.map(code),[1,1,1])
            assert.ok(rs.every(r=>row(r,3).ticket_item_id===980005))
            assert.equal(items.getPlayerItemSync(p.id,980005),1)
            const exchanged=await Promise.all([exchange(p),exchange(p),exchange(p)])
            assert.deepEqual(exchanged.map(code),[1,1,1])
            assert.equal(items.getPlayerItemSync(p.id,980005),0)
            assert.equal(characters.getPlayerCharacterSync(p.id,chosen).stack,0)
            assert.equal(state(p,3).status,4)
        }
    })
    await t.test('status2保留已定券身份，抽取一次转status3',async()=>{
        const p=await makePlayer();setCampaign(p,1,2,980002)
        assert.equal(row(await load(p),1).status,2)
        const r=await draw(p,1,'multi_draw_ticket')
        assert.equal(code(r),1)
        assert.equal(row(r,1).ticket_item_id,980002)
        assert.equal(items.getPlayerItemSync(p.id,980002),1)
        assert.equal(state(p,1).status,3)
        assert.equal(code(await draw(p,1)),1)
        assert.equal(items.getPlayerItemSync(p.id,980002),1)
    })
    await t.test('status2旧空身份在单券期load→自动抽券→load恢复，坏身份不形成自动错误循环',async()=>{
        const p=await makePlayer();setCampaign(p,3,2)
        assert.equal(row(await load(p),3).ticket_item_id,980005)
        const rs=await Promise.all([draw(p,3,'multi_draw_ticket'),draw(p,3,'multi_draw_ticket')])
        assert.deepEqual(rs.map(code),[1,1])
        assert.equal(row(await load(p),3).status,3)
        assert.equal(items.getPlayerItemSync(p.id,980005),1)
        const invalid=await makePlayer();setCampaign(invalid,3,2,980007)
        assert.equal(row(await load(invalid),3),undefined)
        assert.equal(code(await draw(invalid)),4902)
        assert.equal(state(invalid,3).ticketItemId,980007)
        const alreadyHeld=await makePlayer();setCampaign(alreadyHeld,3,2,980005);items.setPlayerItemSync(alreadyHeld.id,980005,1)
        assert.equal(code(await draw(alreadyHeld)),1)
        assert.equal(items.getPlayerItemSync(alreadyHeld.id,980005),1)
    })
    await t.test('第一期status2空身份且无券是合法首次抽券，load自动续领后重试不再发券',async()=>{
        const p=await makePlayer();setCampaign(p,1,2)
        const loaded=await load(p)
        assert.equal(code(loaded),1)
        assert.equal(row(loaded,1).status,2)
        assert.equal(row(loaded,1).ticket_item_id,undefined)
        const first=await draw(p,1,'multi_draw_ticket')
        assert.equal(code(first),1)
        const ticket=row(first,1).ticket_item_id
        assert.ok([980001,980002,980003].includes(ticket))
        const reloaded=await load(p)
        assert.equal(row(reloaded,1).status,3)
        assert.equal(row(reloaded,1).ticket_item_id,ticket)
        const retries=await Promise.all([draw(p,1,'multi_draw_ticket'),draw(p,1,'multi_draw_ticket')])
        assert.deepEqual(retries.map(code),[1,1])
        assert.ok(retries.every(r=>row(r,1).ticket_item_id===ticket))
        assert.equal([980001,980002,980003].reduce((n,id)=>n+(items.getPlayerItemSync(p.id,id)||0),0),1)
    })
    await t.test('事务异常回滚不丢旧券资格且不重复支付',async()=>{
        const p=await makePlayer()
        getDb().exec(`CREATE TRIGGER exchange_recovery_fail BEFORE UPDATE ON players_multi_special_exchange_campaigns WHEN NEW.player_id=${p.id} BEGIN SELECT RAISE(ABORT,'test-failure'); END`)
        assert.equal((await draw(p)).http,500)
        assert.equal(state(p,3).status,1)
        assert.ok(!items.getPlayerItemSync(p.id,980005))
        getDb().exec('DROP TRIGGER exchange_recovery_fail')
        setCampaign(p,3,3);items.setPlayerItemSync(p.id,980005,1)
        getDb().exec(`CREATE TRIGGER exchange_recovery_fail BEFORE UPDATE ON players_multi_special_exchange_campaigns WHEN NEW.player_id=${p.id} BEGIN SELECT RAISE(ABORT,'test-failure'); END`)
        assert.equal((await exchange(p)).http,500)
        assert.equal(state(p,3).status,3);assert.equal(state(p,3).ticketItemId,null)
        assert.equal(items.getPlayerItemSync(p.id,980005),1)
        assert.equal(characters.getPlayerCharacterSync(p.id,chosen),null)
        getDb().exec('DROP TRIGGER exchange_recovery_fail')
    })
    await t.test('非空旧V2无券身份恢复后load可解析且可兑换，目标账号归属不变',async()=>{
        const source=await makePlayer(),target=await makePlayer()
        setCampaign(source,3,3);items.setPlayerItemSync(source.id,980005,1)
        const snapshot=saves.createPlayerSaveSnapshotV2Sync(source.id)
        const accountBefore=getDb().prepare('SELECT account_id FROM players WHERE id=?').get(target.id).account_id
        saves.restorePlayerSaveSnapshotV2Sync(snapshot,target.id)
        assert.equal(row(await load(target),3).ticket_item_id,980005)
        assert.equal(code(await exchange(target)),1)
        assert.equal(getDb().prepare('SELECT account_id FROM players WHERE id=?').get(target.id).account_id,accountBefore)
    })
    await t.test('V1缺ticket字段的非空导入不丢券，load恢复身份后可兑换',async()=>{
        const source=await makePlayer(),target=await makePlayer()
        setCampaign(source,3,3,980005);items.setPlayerItemSync(source.id,980005,1)
        const exported=(await load(source)).body.data
        delete row({body:{data:exported}},3).ticket_item_id
        const deserialized=require('../src/data/utils/deserialize-player').deserializePlayerData(target.id,exported)
        players.replacePlayerDataSync(deserialized)
        assert.equal(row(await load(target),3).ticket_item_id,980005)
        assert.equal(items.getPlayerItemSync(target.id,980005),1)
        assert.equal(code(await exchange(target)),1)
    })
})
