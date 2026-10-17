const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const out = process.env.STARPOINT_TEST_OUT_DIR || path.resolve(__dirname, '../out')
const state = require(path.join(out, 'multi/state/battle-contract'))
const { classifyMultiActiveQuestRecovery: recover } = require(path.join(out, 'lib/multi-active-quest-recovery'))
const snapshots = require(path.join(out, 'multi/settlement-snapshot'))
function room() {
  return { room_number: '812340', category: 2, quest_id: 1099001999, lobby_generation: 1,
    member_viewer_ids: [901,902], expected_real_viewer_ids: [901,902], member_player_ids: {901:41,902:42},
    lifecycle: {instanceId:'instance-a', battleSessionId:'instance-a:1:2:1099001999', sceneEpoch:0, version:1, phase:'BATTLE'} }
}
function connection(viewerId=901, id='cid-a') {
  return {viewerId, playerId:viewerId===901?41:42, connectionId:id, connectionGeneration:0, superseded:false}
}
test('frozen real roster excludes later lobby admissions and preserves per-play owner', () => {
  const r=room(), run=state.ensureBattleSessionContract(r)
  r.expected_real_viewer_ids.push(903)
  assert.deepEqual(run.viewerIds,[901,902])
  assert.equal(state.bindBattlePlay(r,901,41,'play-a'),true)
  assert.equal(state.bindBattlePlay(r,901,42,'forged'),false)
  assert.equal(state.bindBattlePlay(r,901,41,'different-play'),false)
  assert.equal(state.bindBattleConnection(r,connection(903)),false)
})
test('room-instance, battle, scene and optional version fence delayed commands independently', () => {
  const r=room(), expected=state.captureRoomCommandIdentity(r)
  assert.equal(state.roomCommandIdentityMatches(r,expected),true)
  for(const [key,value] of [['instanceId','replacement'],['battleSessionId','new-run'],['sceneEpoch',1]]) {
    const original=r.lifecycle[key]; r.lifecycle[key]=value
    assert.equal(state.roomCommandIdentityMatches(r,expected),false); r.lifecycle[key]=original
  }
  r.lobby_generation++; assert.equal(state.roomCommandIdentityMatches(r,expected),false); r.lobby_generation--
  assert.equal(state.roomCommandIdentityMatches(r,{...expected,version:2}),false)
})
test('same-play concurrent claims survive one failed request and release only after all failures',()=>{
  const r=room(),run=r.lifecycle.battleSessionId
  assert.equal(state.claimBattlePlay(r,901,41,'a'),true)
  assert.equal(state.claimBattlePlay(r,901,41,'a'),true)
  state.releaseBattlePlayClaim(r,901,'a',run)
  assert.equal(state.claimBattlePlay(r,901,41,'b'),false)
  state.bindBattlePlay(r,901,41,'a');state.releaseBattlePlayClaim(r,901,'a',run)
  assert.equal(state.claimBattlePlay(r,901,41,'b'),false)
  state.claimBattlePlay(r,902,42,'x');state.claimBattlePlay(r,902,42,'x')
  state.releaseBattlePlayClaim(r,902,'x',run);state.releaseBattlePlayClaim(r,902,'x',run)
  assert.equal(state.claimBattlePlay(r,902,42,'y'),true)
})
test('replacement connection cannot accept control from superseded socket or reused room number', () => {
  const r=room(), old=connection(), replacement=connection(901,'cid-b')
  assert.equal(state.bindBattleConnection(r,old),true)
  assert.equal(state.bindBattleConnection(r,replacement),true)
  assert.equal(state.battleConnectionMatches(r,old),false)
  assert.equal(state.battleConnectionMatches(r,replacement),true)
  r.lifecycle.instanceId='reused-room'; assert.equal(state.battleConnectionMatches(r,replacement),false)
})
test('five scene epochs retain run and play identity, and terminal members cannot re-enter loading', () => {
  const r=room(), run=state.ensureBattleSessionContract(r)
  state.bindBattlePlay(r,901,41,'five-boss-play')
  for(let epoch=0;epoch<5;epoch++) {
    assert.equal(run.sceneEpoch,epoch)
    state.markBattleMemberPhase(r,901,'READY'); state.markBattleMemberPhase(r,901,'ACTIVE')
    if(epoch<4) assert.equal(state.beginBattleSceneEpoch(r),epoch+1)
  }
  state.markBattleMemberPhase(r,901,'FINALIZED'); state.markBattleMemberPhase(r,901,'SETTLED')
  assert.equal(state.markBattleMemberPhase(r,901,'READY'),false)
  assert.equal(state.markBattleMemberPhase(r,901,'FINALIZED'),false)
  assert.equal(state.bindBattleConnection(r,connection()),false)
  assert.equal(state.findBattlePlayBinding(r,901,41,'five-boss-play').battleSessionId,run.battleSessionId)
})
test('load retains pending old result without advertising battle replay or deleting its play', () => {
  const r=room(); state.bindBattlePlay(r,902,42,'late-guest')
  const quest={isMulti:true,roomNumber:r.room_number,category:r.category,questId:r.quest_id,playId:'late-guest'}
  let binding=state.findBattlePlayBinding(r,902,42,quest.playId)
  assert.equal(recover(quest,r,902,false,binding).recoverable,true)
  r.lifecycle.phase='LOBBY'; r.lifecycle.battleSessionId=null
  binding=state.findBattlePlayBinding(r,902,42,quest.playId)
  assert.deepEqual(recover(quest,r,902,false,binding),{recoverable:false,reason:'result_pending',retained:true})
  r.lifecycle.phase='BATTLE'; r.lifecycle.battleSessionId='next-run'; r.lobby_generation++
  assert.equal(recover(quest,r,902,false,state.findBattlePlayBinding(r,902,42,quest.playId)).retained,true)
  assert.equal(recover(quest,r,902,false,null).reason,'battle_identity_missing')
  assert.equal(recover({...quest,playId:'forged'},r,902,false,binding).reason,'battle_identity_mismatch')
})
test('long-running battles retain identity; only completed-run retention expires', () => {
  const r=room();state.bindBattlePlay(r,901,41,'long-run')
  const run=state.getBattleSessionContract(r)
  run.createdAt=performance.now()-90*60_000
  assert.ok(state.findBattlePlayBinding(r,901,41,'long-run'))
  state.retainBattleSessionContract(r)
  r.lifecycle.battleSessionId=null;r.lifecycle.phase='LOBBY'
  assert.ok(state.findBattlePlayBinding(r,901,41,'long-run'))
  assert.equal(state.bindBattlePlay(r,902,42,'late-start',run.battleSessionId),true)
  run.retainedAt=performance.now()-16*60_000
  assert.equal(state.findBattlePlayBinding(r,901,41,'long-run'),undefined)
})
test('host return advances only finished snapshots from the same room instance', () => {
  const r=room(), make=(playerId,viewerId,playId,instance='instance-a')=>snapshots.registerMultiSettlementSnapshot({
    battleInstanceId: r.lifecycle.battleSessionId, roomInstanceId:instance, playerId,viewerId,playId,
    roomNumber:r.room_number, roomGeneration:1, activeQuest:{category:2,questId:r.quest_id,playId},
    participants:[],expectedRealViewerIds:[901,902],isHost:viewerId===901,isRescueGuest:false,
    isRescueFragmentEligible:false,isNewbieRescueGuest:false })
  make(41,901,'host'); make(42,902,'pending'); make(43,903,'other-instance','other')
  snapshots.transitionMultiSettlementSnapshot(41,'host','RETURN_PENDING')
  snapshots.transitionMultiSettlementSnapshot(43,'other-instance','RETURN_PENDING')
  snapshots.transitionRoomSettlementSnapshots(r.room_number,'LOBBY',1,'instance-a')
  assert.equal(snapshots.getMultiSettlementSnapshot(41,'host').lifecycle,'LOBBY')
  assert.equal(snapshots.getMultiSettlementSnapshot(42,'pending').lifecycle,'BATTLE')
  assert.equal(snapshots.getMultiSettlementSnapshot(43,'other-instance').lifecycle,'RETURN_PENDING')
})
