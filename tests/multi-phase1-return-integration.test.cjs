const {test,after}=require('node:test'), assert=require('node:assert/strict')
const fs=require('node:fs'), os=require('node:os'), path=require('node:path'), {EventEmitter}=require('node:events')
const isolated=fs.mkdtempSync(path.join(os.tmpdir(),'sp-phase1-return-'))
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
  const n=++seq, account=load('data/domains/account').insertAccountSync({appId:'wf_cn',idpAlias:'',idpCode:'test',idpId:`phase1-${n}`,status:'normal'})
  const p=players.insertDefaultPlayerSync(account.id), viewerId=884000000+n
  load('data/activeAccount').saveAccountDefaultPlayer(account.id,p.id)
  load('data/domains/session').insertSessionWithTokenSync({token:String(viewerId),accountId:account.id,type:2,expires:new Date(Date.now()+86400000)})
  load('lib/character').givePlayerCharacterSync(p.id,111001)
  players.updatePlayerSync({id:p.id,stamina:100,partySlot:1})
  items.setPlayerItemSync(p.id,10000145,77)
  parties.updatePlayerPartySync(p.id,1,{category:1,name:'phase1',characterIds:[111001,null,null],unisonCharacterIds:[null,null,null],
    equipmentIds:[null,null,null],abilitySoulIds:[null,null,null],edited:true,options:{allowOtherPlayersToHealMe:true}},1)
  return {...p,viewerId,playId:`phase1-play-${n}`}
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
test('real HTTP: host return and Notify10 keep pending guest finish/load/restore eligible with independent deadline',async()=>{
  const host=player(),guest=player(),r=rooms.createRoom(host.viewerId,host.id,1,2,1033004,0,111001)
  const original=[lobbyClient(r,host,'phase1-host-original'),lobbyClient(r,guest,'phase1-guest-original')]
  for(const c of original)c.mates=original.map(p=>p.yourself)
  const app=require('fastify')({logger:false})
  app.addHook('onSend',(_req,reply,payload,done)=>done(null,String(reply.getHeader('content-type')).startsWith('application/x-msgpack')&&typeof payload==='object'?JSON.stringify(payload):payload))
  load('multi/http/battle').registerBattleRoutes(app);load('multi/http/lobby').registerLobbyRoutes(app);load('multi/http/room').registerRoomRoutes(app)
  await app.register(load('routes/cn/load').default);await app.ready()
  const post=(url,payload)=>app.inject({method:'POST',url,payload})
  try {
    for(const p of [host,guest]) {
      const response=await post('/start',startBody(p,r))
      assert.equal(response.statusCode,200,response.body);assert.equal(response.json().data.play_id,p.playId)
    }
    const mismatched=await post('/start',{...startBody(guest,r),play_id:'different-play-in-same-run'})
    assert.equal(mismatched.statusCode,200,mismatched.body)
    assert.equal(mismatched.json().data_headers.result_code,4050)
    assert.equal(active.getPlayerActiveQuestSync(guest.id).playId,guest.playId)
    const guestSnapshot=snapshots.getMultiSettlementSnapshot(guest.id,guest.playId), run=r.lifecycle.battleSessionId
    assert.equal(guestSnapshot.roomInstanceId,r.lifecycle.instanceId);assert.equal(guestSnapshot.battleInstanceId,run)
    for(const c of original){c.socket.destroy();manager.removeClient(c)}
    const hostFinish=await post('/finish',finishBody(host,r));assert.equal(hostFinish.statusCode,200,hostFinish.body)
    assert.equal(r.lifecycle.phase,'RETURNING');assert.equal(guestSnapshot.lifecycle,'BATTLE')
    const returning=lobbyClient(r,host,'phase1-host-return')
    assert.equal(manager.completeSettlementReturn(r.room_number),true)
    assert.equal(r.lifecycle.phase,'LOBBY');assert.equal(guestSnapshot.lifecycle,'BATTLE')
    load('multi/tcp/lobby').handleMessage(returning.socket,[0,[10]])
    await coordinator.enqueueRoomCommand(r.room_number,()=>{})
    assert.ok(rooms.isRoomMember(r,guest.viewerId));assert.deepEqual(roster.getReservedReturnViewerIds(r),[guest.viewerId])
    const loaded=await post('/load',{viewer_id:guest.viewerId})
    assert.equal(loaded.statusCode,200,loaded.body)
    assert.deepEqual(loaded.json().data.unfinished_multi_quest_list,[])
    assert.equal(active.getPlayerActiveQuestSync(guest.id).playId,guest.playId,'load must retain the exact result ledger')
    const late=await post('/finish',finishBody(guest,r));assert.equal(late.statusCode,200,late.body)
    assert.equal(r.lifecycle.phase,'LOBBY');assert.equal(guestSnapshot.lifecycle,'LOBBY')
    assert.equal(active.getPlayerActiveQuestSync(guest.id),null)
    const deadline=roster.getNextReturnDeadline(r)
    const replay=await post('/finish',finishBody(guest,r))
    assert.equal(replay.statusCode,200,replay.body);assert.deepEqual(replay.json(),late.json())
    assert.equal(roster.getNextReturnDeadline(r),deadline,'receipt replay must not extend a return lease')
    const restored=await post('/restore_room',{viewer_id:guest.viewerId,room_number:r.room_number})
    assert.equal(restored.statusCode,200,restored.body);assert.equal(restored.json().data.room_number,r.room_number)
    assert.notEqual(restored.json().data.raising_state,9)
    assert.ok(items.getPlayerItemSync(guest.id,10000145)>=77,'existing currency is preserved')
    assert.ok(load('data/domains/character').getPlayerCharacterSync(guest.id,111001),'owned playable character is preserved')
  } finally {manager.commitRoomDisband(r.room_number,'test_cleanup');await app.close()}
})
after(async()=>{
  await load('multi/npc/player-party-pool').stopQuestNpcPartyPoolWorker();db.close()
  const target=path.resolve(isolated), boundary=path.resolve(os.tmpdir())+path.sep
  assert.ok(target.startsWith(boundary)&&path.basename(target).startsWith('sp-phase1-return-'))
  fs.rmSync(target,{recursive:true,force:true})
})
