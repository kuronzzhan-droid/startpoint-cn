const {test}=require('node:test'),assert=require('node:assert/strict')
const interval=global.setInterval
global.setInterval=(...args)=>{const t=interval(...args);t.unref();return t}
const load=name=>require(`../out/${name}`)
const rooms=load('multi/room/manager'),contracts=load('multi/state/battle-contract')
const {RoomCommandExecutor}=load('multi/coordinator/command-executor')
const {RoomCommandGateway}=load('multi/coordinator/command-gateway')
const {registerBattleCommandHandlers}=load('multi/coordinator/battle-command-handlers')
const session=load('multi/state/SessionManager').sessionManager
global.setInterval=interval
function fixture(t){
  const room={room_number:'702003',category:2,quest_id:1033004,lobby_generation:1,
    host_viewer_id:1,host_player_id:101,member_viewer_ids:[1,2],member_player_ids:{1:101,2:102},
    expected_real_viewer_ids:[1,2],mates:[],raising_state:4,settlement_return_pending:false,
    equipmentPartyIds:{1:1,2:1},lifecycle:{instanceId:'command-instance',battleSessionId:'command-run',phase:'BATTLE',version:3,sceneEpoch:0}}
  let current=room
  t.mock.method(rooms,'getRoom',()=>current)
  // This fixture begins in BATTLE; room creation/activation is covered by the
  // real HTTP integration. Keep this test focused on per-play claim ownership.
  t.mock.method(rooms,'setRoomBattle',()=>true)
  contracts.ensureBattleSessionContract(room)
  const executor=new RoomCommandExecutor();registerBattleCommandHandlers(executor)
  const gateway=new RoomCommandGateway(executor)
  const payload={roomNumber:room.room_number,roomInstanceId:room.lifecycle.instanceId,battleSessionId:room.lifecycle.battleSessionId,
    viewerId:2,playerId:102,playId:'command-play'}
  return {room,gateway,payload,replace:r=>current=r}
}
test('command preparation copies the start roster; commit/cancel use captured run and preserve parallel claims',async t=>{
  const x=fixture(t),body={room_number:x.room.room_number,viewer_id:2,play_id:x.payload.playId,category:2,quest_id:1033004,party_id:1,
    mate_party_ids:[],client_battle_party:{},mate_player_ids:[]}
  const prepare=()=>x.gateway.execute('battle.start.prepare',{body,playerId:102,fixedParty:false})
  const first=await prepare(),second=await prepare()
  assert.equal(first.status,'ready');assert.equal(second.status,'ready')
  first.room.expected_real_viewer_ids.push(999)
  assert.deepEqual(x.room.expected_real_viewer_ids,[1,2])
  assert.equal(contracts.getBattleSessionContract(x.room).members.get(2).playClaims,2)
  await x.gateway.execute('battle.play.cancel',x.payload)
  assert.equal(contracts.findBattlePlayBinding(x.room,2,102,x.payload.playId).playId,x.payload.playId)
  await x.gateway.execute('battle.play.commit',x.payload)
  const member=contracts.getBattleSessionContract(x.room).members.get(2)
  assert.equal(member.playCommitted,true);assert.equal(member.playClaims,0)
})
test('a durable abort event cannot clear the barriers of the next run or a reused room number',async t=>{
  const x=fixture(t),calls=[]
  contracts.bindBattlePlay(x.room,2,102,x.payload.playId)
  t.mock.method(session,'clearBattleExpectedCount',r=>calls.push(r))
  contracts.retainBattleSessionContract(x.room)
  x.room.lifecycle.battleSessionId='next-run';x.room.lobby_generation++
  contracts.ensureBattleSessionContract(x.room)
  const next=await x.gateway.execute('battle.abort.committed',x.payload)
  assert.equal(next.applied,false);assert.deepEqual(calls,[])
  x.replace({...x.room,lifecycle:{...x.room.lifecycle,instanceId:'replacement-instance'}})
  const replaced=await x.gateway.execute('battle.abort.committed',x.payload)
  assert.equal(replaced.applied,false);assert.deepEqual(calls,[])
})
test('late payment publishes only its original play; copied recovery state retains settled result',async t=>{
  const x=fixture(t)
  contracts.bindBattlePlay(x.room,2,102,x.payload.playId)
  contracts.markBattleMemberPhase(x.room,2,'FINALIZED')
  const recovery=await x.gateway.execute('battle.recovery',{viewerId:2,playerId:102,
    quest:{isMulti:true,roomNumber:x.room.room_number,category:2,questId:1033004,playId:x.payload.playId}})
  assert.equal(recovery.retained,true)
  const wrong=await x.gateway.execute('battle.settlement.committed',{...x.payload,generation:1,playId:'foreign-play'})
  assert.equal(wrong.applied,false);assert.equal(x.room.lifecycle.phase,'BATTLE')
  const settled=await x.gateway.execute('battle.settlement.committed',{...x.payload,generation:1})
  assert.equal(settled.applied,true);assert.equal(settled.snapshotPhase,'RETURN_PENDING')
  assert.equal(x.room.lifecycle.phase,'RETURNING')
  const query=await x.gateway.execute('battle.query',{roomNumber:x.room.room_number,viewerId:2,playerId:102,playId:x.payload.playId})
  query.room.lifecycle.phase='DISBANDED';query.binding.phase='RETIRED'
  assert.equal(x.room.lifecycle.phase,'RETURNING')
  assert.equal(contracts.findBattlePlayBinding(x.room,2,102,x.payload.playId).phase,'SETTLED')
})
test('payment without retained instance/run proof cannot mutate a current room through generation alone',async t=>{
  const x=fixture(t)
  const result=await x.gateway.execute('battle.settlement.committed',{
    roomNumber:x.room.room_number,generation:1,viewerId:2,playerId:102,playId:'old-paid-play',
  })
  assert.equal(result.applied,false);assert.equal(result.reason,'STALE_IDENTITY')
  assert.equal(x.room.lifecycle.phase,'BATTLE');assert.equal(x.room.settlement_return_pending,false)
})
