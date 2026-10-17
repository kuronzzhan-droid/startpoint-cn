const {test,after}=require('node:test'), assert=require('node:assert/strict')
const fs=require('node:fs'), os=require('node:os'), path=require('node:path'), {EventEmitter}=require('node:events')
const isolated=fs.mkdtempSync(path.join(os.tmpdir(),'sp-phase2-payment-'))
process.env.DATA_DIR=isolated
const out=process.env.STARPOINT_TEST_OUT_DIR||path.resolve(__dirname,'../out'), load=name=>require(path.join(out,name))
const originalInterval=global.setInterval
global.setInterval=(...args)=>{const t=originalInterval(...args);t.unref();return t}
const db=load('data/db').getDb(), rooms=load('multi/room/manager'), manager=load('multi/state/SessionManager').sessionManager
const coordinator=load('multi/coordinator/embedded').embeddedMultiCoordinator, roster=load('multi/room/rematch-roster')
const snapshots=load('multi/settlement-snapshot'), active=load('data/domains/quest_active'), parties=load('data/domains/party')
const players=load('data/domains/player'), items=load('data/domains/item')
global.setInterval=originalInterval
let seq=0
class Socket extends EventEmitter {
  destroyed=false;readable=true;writable=true;frames=[]
  write(data){this.frames.push(JSON.parse(data.replace(/\0$/,'')));return true}
  end(){this.writable=false} destroy(){this.destroyed=true;this.readable=this.writable=false}
}
function player() {
  const n=++seq, account=load('data/domains/account').insertAccountSync({appId:'wf_cn',idpAlias:'',idpCode:'test',idpId:`phase2-payment-${n}`,status:'normal'})
  const p=players.insertDefaultPlayerSync(account.id), viewerId=885000000+n
  load('data/activeAccount').saveAccountDefaultPlayer(account.id,p.id)
  load('data/domains/session').insertSessionWithTokenSync({token:String(viewerId),accountId:account.id,type:2,expires:new Date(Date.now()+86400000)})
  load('lib/character').givePlayerCharacterSync(p.id,111001)
  players.updatePlayerSync({id:p.id,stamina:100,partySlot:1})
  items.setPlayerItemSync(p.id,10000145,77)
  parties.updatePlayerPartySync(p.id,1,{category:1,name:'phase1',characterIds:[111001,null,null],unisonCharacterIds:[null,null,null],
    equipmentIds:[null,null,null],abilitySoulIds:[null,null,null],edited:true,options:{allowOtherPlayersToHealMe:true}},1)
  return {...p,viewerId,playId:`phase2-payment-play-${n}`}
}
function lobbyClient(room,p,cid) {
  const c=manager.createClient(new Socket(),p.viewerId,room.room_number,cid,p.id)
  c.roomGeneration=room.lobby_generation;c.enterData={};c.isReady=true
  c.yourself={viewerId:p.viewerId,playerId:p.id,connectionId:cid,comId:0,currentPartyId:1,state:[1],party:{equipments:[],abilitySoulIds:[]}}
  manager.addClientToRoom(c); rooms.addRoomMember(room.room_number,p.viewerId,p.id)
  return c
}
const startBody=(p,r)=>({viewer_id:p.viewerId,play_id:p.playId,category:r.category,quest_id:r.quest_id,party_id:1,room_number:r.room_number,
  use_boost_point:false,use_boss_boost_point:false,is_auto_start_mode:false,mate_player_ids:[],mate_party_ids:[],api_count:1})
const finishBody=(p,r)=>({viewer_id:p.viewerId,play_id:p.playId,category:r.category,quest_id:r.quest_id,is_accomplished:true,
  elapsed_time_ms:30000,score:100,add_mana:0,continue_count:0,statistics:{clear_phase:1,max_combo_count:0,
  party:{characters:[{id:111001}],unison_characters:[],equipments:[],ability_soul_ids:[]}},mate_player_result:[],api_count:2})

test('real HTTP: payment without retained room identity cannot return a replacement room; replay pays once',async()=>{
  const host=player(),guest=player(),r=rooms.createRoom(host.viewerId,host.id,1,2,1033004,0,111001)
  const originals=[lobbyClient(r,host,'payment-original-host'),lobbyClient(r,guest,'payment-original-guest')]
  for(const c of originals)c.mates=originals.map(p=>p.yourself)
  const app=require('fastify')({logger:false})
  app.addHook('onSend',(_req,reply,payload,done)=>done(null,String(reply.getHeader('content-type')).startsWith('application/x-msgpack')&&typeof payload==='object'?JSON.stringify(payload):payload))
  load('multi/http/battle').registerBattleRoutes(app);await app.ready()
  const post=(url,payload)=>app.inject({method:'POST',url,payload})
  let replacement
  try{
    const start=await post('/start',startBody(host,r));assert.equal(start.statusCode,200,start.body)
    assert.equal(active.getPlayerActiveQuestSync(host.id).playId,host.playId)
    // Simulate a missing ephemeral snapshot while the durable active play remains.
    snapshots.getMultiSettlementSnapshot(host.id,host.playId).expiresAt=0
    assert.equal(snapshots.getMultiSettlementSnapshot(host.id,host.playId),undefined)
    for(const c of originals){c.socket.destroy();manager.removeClient(c)}
    rooms.disbandRoom(r.room_number)
    const crypto=require('node:crypto'),originalRandom=crypto.randomInt
    crypto.randomInt=()=>Number(r.room_number)
    try{replacement=rooms.createRoom(host.viewerId,host.id,1,2,1033004,0,111001)}
    finally{crypto.randomInt=originalRandom}
    rooms.addRoomMember(replacement.room_number,guest.viewerId,guest.id)
    assert.equal(rooms.setRoomBattle(replacement.room_number),true)
    assert.equal(replacement.lobby_generation,r.lobby_generation,'same generation cannot prove the old instance')
    assert.notEqual(replacement.lifecycle.instanceId,r.lifecycle.instanceId)
    const currentRun=replacement.lifecycle.battleSessionId
    const paid=await post('/finish',finishBody(host,r));assert.equal(paid.statusCode,200,paid.body)
    assert.equal(active.getPlayerActiveQuestSync(host.id),null,'original durable result still settles')
    assert.equal(replacement.lifecycle.phase,'BATTLE')
    assert.equal(replacement.lifecycle.battleSessionId,currentRun)
    assert.equal(replacement.settlement_return_pending,false)
    const balance=players.getPlayerSync(host.id)
    for(const key of ['freeMana','paidMana','rankPoint'])assert.equal(typeof balance[key],'number')
    const replay=await post('/finish',finishBody(host,r))
    assert.equal(replay.statusCode,200,replay.body);assert.deepEqual(replay.json(),paid.json())
    const afterReplay=players.getPlayerSync(host.id)
    for(const key of ['freeMana','paidMana','rankPoint'])assert.equal(afterReplay[key],balance[key])
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM player_operation_receipts WHERE player_id=? AND operation=? AND request_key=?')
      .get(host.id,'quest_finish.multi',host.playId).count,1)
    assert.equal(items.getPlayerItemSync(host.id,10000145),77)
    assert.equal(replacement.lifecycle.phase,'BATTLE')
  }finally{await app.close();if(replacement)rooms.disbandRoom(replacement.room_number)}
})
after(()=>{
  db.close()
  const resolved=path.resolve(isolated),temp=path.resolve(os.tmpdir())+path.sep
  assert.ok(resolved.startsWith(temp)&&path.basename(resolved).startsWith('sp-phase2-payment-'))
  fs.rmSync(resolved,{recursive:true})
})
