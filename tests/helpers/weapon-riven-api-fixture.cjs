
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto')
const { pack, unpack } = require('msgpackr')
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'weapon-riven-api-'))
process.env.DATA_DIR = path.join(dir,'db')
process.env.CLIENT_ADMISSION_CONFIG = path.join(dir,'policy.json')
process.env.CLIENT_ADMISSION_KEYS = path.join(dir,'keys.json')
const key = '23'.repeat(32)
fs.writeFileSync(process.env.CLIENT_ADMISSION_CONFIG,JSON.stringify({enforce:false,updateMessage:'fixture',
    builds:[{id:'riven-test',name:'fixture',enabled:true,allowUntil:null,capabilities:['weapon-riven-v1']}]}))
fs.writeFileSync(process.env.CLIENT_ADMISSION_KEYS,JSON.stringify({'riven-test':key}))
const output = process.env.LENS_BUILD_OUT || path.resolve(__dirname,'../../out')
const load = name => require(path.join(output,name))
const interval = global.setInterval
global.setInterval = (...args) => { const timer = interval(...args); timer.unref(); return timer }
const admission = load('lib/client-admission')
const route = load('routes/api/weaponRiven').default
global.setInterval = interval
const { getDb } = load('data/db')
const db = getDb()
const gate = admission.clientAdmission()
const app = require('fastify')({logger:false})
app.addContentTypeParser('application/x-msgpack',{parseAs:'buffer'},(_request,body,done) => {
    try { done(null,unpack(body)) } catch (error) { done(error) }
})
app.addHook('onSend',(_request,reply,payload,done) => done(null,
    String(reply.getHeader('content-type')).startsWith('application/x-msgpack') ? pack(payload) : payload))
app.register(route,{prefix:'/api/index.php/weapon_riven'})
let sequence=0
async function fixture(balance=10000) {
    const account = load('data/domains/account').insertAccountSync({appId:'wf_cn',idpAlias:'',idpCode:'test',idpId:`api-${++sequence}`,status:'normal'})
    const player = load('data/domains/player').insertDefaultPlayerSync(account.id)
    load('data/activeAccount').saveAccountDefaultPlayer(account.id,player.id)
    const viewer = 780000000+sequence
    await load('data/domains/session').insertSessionWithToken({token:String(viewer),accountId:account.id,expires:new Date(Date.now()+86400000),type:2})
    load('data/domains/item').setPlayerItemSync(player.id,2370099,balance)
    const item = db.transaction(() => load('data/domains/weaponRiven').insertWeaponRivenSync(player.id,300101,[[15990001,50]],'api-fixture', () => 0))()
    const challenge = gate.challenge({protocol:1,build:'riven-test'},String(viewer)).data
    const proof = crypto.createHmac('sha256',Buffer.from(key,'hex'))
        .update(admission.proofMessage('riven-test',challenge.challenge,challenge.nonce)).digest('hex')
    const token = gate.prove({challenge:challenge.challenge,proof},String(viewer)).data.token
    const session = `account-${viewer}`
    gate.bind(token,session)
    const rivenId = load('data/domains/weaponRiven').getPlayerWeaponRivenSync(player.id,item).riven_id
    return {id:player.id,viewer,item,rivenId,headers:{'x-sp-admission':token,'x-sp-session':session}}
}
async function post(p,action,extra={},capable=true) {
    const response = await app.inject({method:'POST',url:`/api/index.php/weapon_riven/${action}`,
        headers:{...(capable?p.headers:{}),'content-type':'application/x-msgpack'},
        payload:pack({viewer_id:p.viewer,api_count:1,item_id:p.item,riven_id:p.rivenId,...extra})})
    return {status:response.statusCode,body:String(response.headers['content-type']).startsWith('application/x-msgpack')
        ? unpack(response.rawPayload) : response.json()}
}
function storedState(p) {
    return Object.fromEntries(['player_weapon_rivens','players_items','players_parties','player_operation_receipts']
        .map(table => [table,db.prepare(`SELECT * FROM ${table} WHERE player_id=? ORDER BY rowid`).all(p.id)]))
}
function beginBattle(p) {
    db.prepare(`INSERT INTO players_active_quests(player_id,play_id,quest_id,category,
        use_boss_boost_point,use_boost_point,is_auto_start_mode,is_multi,is_multi_host,continue_count,started_at_ms)
        VALUES (?,'api-busy',1,1,0,0,0,0,0,0,0)`).run(p.id)
}
function currentCard(p) { return load('data/domains/weaponRiven').getPlayerWeaponRivenSync(p.id,p.item) }
function assertConflict(response,p,reason) {
    assert.equal(response.status,200,JSON.stringify(response.body))
    const data = response.body.data, card = currentCard(p)
    assert.equal(data.weapon_riven_conflict,true)
    assert.equal(data.reason,reason)
    assert.deepEqual(data.weapon_riven_list,card ? {[p.item]:card} : {})
    assert.deepEqual(data.weapon_riven_deleted,card ? [] : [p.item])
    assert.equal(data.item_list[p.item],card ? 1 : 0)
}

module.exports = { fixture, post, storedState, beginBattle, currentCard, assertConflict, load, db, app, gate, dir }
