const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const output=path.resolve(__dirname,'../out');

// Execute actual compiled handlers/queue/contracts; never import player DB or listeners.
function harness(t,{timerDelay}={}) {
 let room,clock=1000,current;const timers=[],frames=[],warnings=[],cache=new Map(),clients=new Map();
 const real=new Set(['multi/tcp/lobby','multi/tcp/handshake','multi/coordinator/room-command-handlers',
  'multi/coordinator/five-boss-command-handlers','multi/coordinator/embedded','multi/coordinator/command-protocol',
  'multi/coordinator/command-executor','multi/coordinator/command-gateway','multi/state/battle-contract',
  'multi/room/rematch-roster','multi/coordinator/business-rpc','multi/coordinator/runtime-role','lib/shutdown-state']);
 const session={clients,findClientBySocket:s=>[...clients.values()].find(c=>c.socket===s),getClient:(v,r)=>clients.get(`${v}@${r}`),
  getClientsInRoom:(r,g)=>[...clients.values()].filter(c=>c.roomNumber===r&&(g===undefined||c.roomGeneration===g)),
  isRoomRestoreBlocked:()=>false,isSupersededSocket:()=>false,isRetiredLobbySocket:()=>false,
  isHostOnline:(v,r)=>!!session.getClient(v,r)?.enterData,
  createClient:(s,v,r,cid,p)=>({socket:s,viewerId:v,playerId:p,roomNumber:r,connectionId:cid,roomGeneration:1,
   connectionGeneration:1,isBattle:false,superseded:false,enterData:null,mates:[],clientState:{tryTransition(){}}}),
  addClientToRoom(c){const key=`${c.viewerId}@${c.roomNumber}`,old=clients.get(key);c.roomInstanceId=room.lifecycle.instanceId;
   c.connectionGeneration=(old?.connectionGeneration??0)+1;clients.set(key,c);current=c;
   if(old&&old!==c){old.superseded=true;load('multi/tcp/lobby').clearPendingFiveBossReturnEnter?.(old,'connection_replaced')}return {ok:true}},
  removeClient(c){load('multi/tcp/lobby').clearPendingFiveBossReturnEnter?.(c,'connection_removed');if(session.getClient(c.viewerId,c.roomNumber)===c)clients.delete(`${c.viewerId}@${c.roomNumber}`)},
  sendJson:(s,f)=>{frames.push({socket:s,frame:structuredClone(f)});s.frames.push(structuredClone(f));return 'sent'},
  broadcastToRoom(){},clearBattleExpectedCount(){},cancelHostReconnectGrace(){},beginRescueGuestWait(){},
  completeSettlementReturn(){return load('multi/coordinator/embedded').embeddedMultiCoordinator.completeSettlementReturn(room).ok},
  beginSettlementReturnGrace(){},
  commitRoomDisband(){load('multi/tcp/lobby').clearLobbyRoomState(room.room_number);room.lifecycle.phase='DISBANDED';for(const c of clients.values()){session.sendJson(c.socket,[1,[6,'multibattle_room_dismissed']]);c.socket.end()}},
 };
 const mocks={
  'multi/state/SessionManager':{sessionManager:session},
  'multi/room/manager':{getRoom:r=>room?.room_number===r?room:undefined,getRoomMemberPlayerId:(_,v)=>room.member_player_ids[v],
   updateHostEntryTime(){},addRoomMember(_,v,p){if(!room.member_viewer_ids.includes(v))room.member_viewer_ids.push(v);room.member_player_ids[v]=p;load('multi/room/rematch-roster').markMemberReturned(room,v);return true}},
  'multi/coordinator/room-start-claims':{hasRoomStartClaims:()=>false,deferPinnedRoomControl:()=>false},
  'multi/settlement-snapshot':{},'multi/five-boss/contract':{isFiveBossGauntletQuest:(c,q)=>c===2&&q===1099001},
  'multi/five-boss/lobby-runtime':{clearFiveBossProofStatus(){}},'multi/five-boss/connection-diagnostic':{fiveBossConnectionDiagnostics:{}},
  'multi/battle-telemetry':{battleTelemetry:{begin(){},end(){}}},'lib/game-logging':{gameVerboseLog(){}},
  'multi/coordinator/business-facts':{applyPlayerBusinessFacts:()=>true,notifyRealtimePresence(){}},
  'multi/types':{ClientState:{Handshaking:1}},'multi/npc/controller':{},'multi/npc/equipment-policy':{},
  'multi/room/equipment-ready':{},'multi/tcp/autoplay-mode':{},'multi/tcp/disconnect-diagnostics':{markTcpDisconnectReason(){}},
  'multi/room/admission':{recordRoomAdmissionBypass(){},recordRoomAdmissionDenial(){},roomAdmissionRegistry:{release(){}}},
  'multi/recruitment':{},'multi/ai-fill':{},'multi/room/sharing':{},'lib/multi-active-quest-recovery':{},
  'multi/mode15-room-gate':{isMode15RoomClosed:()=>false,getMode15HostRoomGate:()=>null},
 };
 function schedule(fn,ms){
  if(timerDelay!==undefined&&ms>=1000){const timer=setTimeout(()=>{clock=200000;fn()},timerDelay);timer.unref();timers.push({fn,ms,timer});return timer}
  const timer={fn,ms,unref(){},cleared:false};timers.push(timer);return timer;
 }
 function load(name){if(Object.hasOwn(mocks,name))return mocks[name];if(cache.has(name))return cache.get(name).exports;
  if(!real.has(name))throw Error('Blocked dependency '+name);
  const filename=path.join(output,name+'.js'),m={exports:{}};cache.set(name,m);
  const requireScoped=spec=>{if(spec==='perf_hooks'||spec==='node:perf_hooks')return {performance:{now:()=>clock}};
   if(['crypto','node:crypto','node:async_hooks','node:timers/promises'].includes(spec))return require(spec);
   if(!spec.startsWith('.'))throw Error('Blocked package '+spec);
   return load(path.relative(output,path.resolve(path.dirname(filename),spec)).replaceAll('\\','/').replace(/\.js$/,''))};
  const context={process,Buffer,setTimeout:schedule,clearTimeout:timer=>{if(timer?.fn)timer.cleared=true;else clearTimeout(timer)},
   setImmediate,clearImmediate,console:{log(){},warn:s=>warnings.push(s),error:s=>warnings.push(s)}};
  const run=new vm.Script('(function(require,module,exports,setTimeout,clearTimeout,console){'+fs.readFileSync(filename,'utf8')+'\n})',{filename}).runInThisContext();
  run(requireScoped,m,m.exports,context.setTimeout,context.clearTimeout,context.console);return m.exports;
 }
 const oldChild=process.env.MULTI_REALTIME_OWNER_CHILD,oldParent=process.env.MULTI_REALTIME_PROCESS;
 process.env.MULTI_REALTIME_OWNER_CHILD='1';process.env.MULTI_REALTIME_PROCESS='0';
 t.after(()=>{load('multi/tcp/lobby').clearLobbyRoomState(room.room_number);for(const x of timers)if(x.timer)clearTimeout(x.timer);
  if(oldChild===undefined)delete process.env.MULTI_REALTIME_OWNER_CHILD;else process.env.MULTI_REALTIME_OWNER_CHILD=oldChild;
  if(oldParent===undefined)delete process.env.MULTI_REALTIME_PROCESS;else process.env.MULTI_REALTIME_PROCESS=oldParent});
 const rpc=load('multi/coordinator/business-rpc');rpc.installRealtimeBusinessTransport(async(kind,p)=>{
  if(kind==='__tcp_work_begin__')return {commandId:p.workId,ownerEpoch:'test-owner',admissionToken:'a'.repeat(64)};
  if(kind==='__tcp_work_end__')return true;
  if(kind==='player.handshake')return {playerId:p.viewerId===1?101:102,player:{name:'test',rank:1,partySlot:1},party:{characters:[]}};
  return true;
 });
 const contracts=load('multi/state/battle-contract'),roster=load('multi/room/rematch-roster'),coordinator=load('multi/coordinator/embedded').embeddedMultiCoordinator;
 room={room_number:'702003',category:2,quest_id:1099001,lobby_generation:1,host_viewer_id:1,host_player_id:101,
  host_entry_time:1,room_sequence:1,share_room_options:0,member_viewer_ids:[1,2],member_player_ids:{1:101,2:102},
  expected_real_viewer_ids:[1,2],mates:[],raising_state:4,settlement_return_pending:false,five_boss_runtime:{runId:'five-run'},
  lifecycle:{instanceId:'test-instance',battleSessionId:'battle-run',phase:'BATTLE',version:3,sceneEpoch:0}};
 contracts.ensureBattleSessionContract(room);contracts.bindBattlePlay(room,1,101,'host-play');contracts.bindBattlePlay(room,2,102,'guest-play');
 const executor=new(load('multi/coordinator/command-executor').RoomCommandExecutor)();
 load('multi/coordinator/room-command-handlers').registerRoomCommandHandlers(executor);
 load('multi/coordinator/five-boss-command-handlers').registerFiveBossCommandHandlers(executor);
 const gateway=new(load('multi/coordinator/command-gateway').RoomCommandGateway)(executor);
 class Socket extends EventEmitter{frames=[];destroyed=false;readable=true;writable=true;
  end(){this.writable=false;this.emit('end');this.destroy()}
  destroy(){if(this.destroyed)return;this.destroyed=true;this.readable=this.writable=false;this.emit('close')}
 }
 async function connect(viewer=1,cid='host-cid'){const s=new Socket();await load('multi/tcp/handshake').handleHandshake(s,{socklet:'cooperation_room',room_number:room.room_number,viewerId:viewer,connection_id:cid,questCategory:2,questId:1099001});assert.equal(s.frames[0]?.[0],0);return {socket:s,client:session.findClientBySocket(s)}}
 const enter=(x,data={party:{},autoStart:false})=>load('multi/tcp/lobby').handleMessage(x.socket,[0,[0,data,1]]);
 const personal=()=>gateway.execute('fiveBoss.terminal',{roomNumber:room.room_number,runId:'five-run',runStatus:'active',playerId:101,viewerId:1,playId:'host-play'});
 const terminal=(status='settled')=>gateway.execute('fiveBoss.terminal',{roomNumber:room.room_number,runId:'five-run',runStatus:status});
 const prepare=()=>gateway.execute('room.prepare',{roomNumber:room.room_number,viewerId:1,identity:coordinator.identity(room),mode15Closed:false,category:2,questId:1099001});
 return {room,session,timers,frames,warnings,connect,enter,personal,terminal,prepare,gateway,contracts,roster,coordinator,rpc,load,setClock:x=>clock=x};
}
test('early host Enter completes once after actual prepare/handshake and terminal, without early room mutation',async t=>{
 const x=harness(t);await x.personal();assert.equal((await x.prepare()).connection.raising_state,1);
 const c=await x.connect();const original=JSON.stringify(x.room.expected_real_viewer_ids);
 await x.enter(c);assert.equal(c.client.enterData,null);assert.equal(x.room.lifecycle.phase,'BATTLE');assert.equal(JSON.stringify(x.room.expected_real_viewer_ids),original);
 await x.terminal();assert.equal(c.socket.frames.filter(f=>f[0]===1&&f[1]?.[0]===0).length,1);
 assert.notEqual(c.client.enterData,null);assert.equal(x.room.lifecycle.phase,'LOBBY');assert.deepEqual([...x.roster.getReservedReturnViewerIds(x.room)],[2]);
 assert.equal(x.room.readyCountdownPending,false);
});
test('duplicate pending Enter does not extend deadline, accumulate listeners or replay payload twice',async t=>{
 const x=harness(t);await x.personal();const c=await x.connect();await x.enter(c);
 const count=x.timers.filter(timer=>timer.ms===180000).length;
 x.setClock(12000);await x.enter(c,{party:{},autoStart:true});
 assert.equal(x.timers.filter(timer=>timer.ms===180000).length,count);
 assert.equal(c.socket.listenerCount('end'),1);assert.equal(c.socket.listenerCount('close'),1);
 await x.terminal();assert.equal(c.socket.frames.filter(f=>f[0]===1&&f[1]?.[0]===0).length,1);
 assert.equal(c.client.yourself.autoStart,false);assert.equal(c.socket.listenerCount('end'),0);assert.equal(c.socket.listenerCount('close'),0);
});
test('Heartbeat and Ready/Start while pending cannot complete Enter or open another battle',async t=>{
 const x=harness(t);await x.personal();const c=await x.connect();await x.enter(c);
 await x.load('multi/tcp/lobby').handleMessage(c.socket,[0,[4]]);
 await x.load('multi/tcp/lobby').handleMessage(c.socket,[0,[3,[1]]]);
 await x.load('multi/tcp/lobby').handleMessage(c.socket,[0,[6]]);
 assert.equal(c.client.enterData,null);assert.equal(x.room.lifecycle.phase,'BATTLE');assert.equal(x.room.lobby_generation,1);
 assert.equal(c.socket.frames.filter(f=>f[0]===1&&f[1]?.[0]===0).length,0);
});
test('same CID replacement clears old pending and terminal welcomes only the current socket',async t=>{
 const x=harness(t);await x.personal();const first=await x.connect();await x.enter(first);
 const next=await x.connect(1,'host-cid');assert.equal(first.socket.listenerCount('end'),0);assert.equal(first.socket.listenerCount('close'),0);
 await x.enter(next);first.socket.destroy();await x.terminal();
 assert.equal(first.socket.frames.filter(f=>f[0]===1&&f[1]?.[0]===0).length,0);
 assert.equal(next.socket.frames.filter(f=>f[0]===1&&f[1]?.[0]===0).length,1);
});
test('disconnect clears pending listeners and stale timeout cannot affect a replacement',async t=>{
 const x=harness(t);await x.personal();const first=await x.connect();await x.enter(first);
 const oldTimer=x.timers.find(timer=>timer.ms===180000);first.socket.destroy();
 assert.equal(first.socket.listenerCount('end'),0);assert.equal(first.socket.listenerCount('close'),0);
 x.setClock(200000);const next=await x.connect();await x.enter(next);oldTimer.fn();await x.coordinator.drain();
 assert.equal(next.socket.destroyed,false);await x.terminal();assert.notEqual(next.client.enterData,null);
});
for(const fence of ['instance','generation','play','run'])test(`terminal cannot replay pending Enter across changed ${fence}`,async t=>{
 const x=harness(t);await x.personal();const c=await x.connect();await x.enter(c);
 if(fence==='instance')x.room.lifecycle.instanceId='replacement-instance';
 if(fence==='generation')x.room.lobby_generation=2;
 if(fence==='play')x.contracts.getBattleSessionContract(x.room).members.get(1).playId='replacement-play';
 if(fence==='run')x.room.five_boss_runtime.runId='replacement-run';
 await x.gateway.execute('fiveBoss.terminal',{roomNumber:x.room.room_number,runId:x.room.five_boss_runtime.runId,runStatus:'settled'});
 assert.equal(c.socket.frames.filter(f=>f[0]===1&&f[1]?.[0]===0).length,0);assert.equal(c.client.enterData,null);
 assert.equal(c.socket.listenerCount('end'),0);assert.equal(c.socket.listenerCount('close'),0);
});
test('global abort clears pending and dismisses the waiter instead of welcoming or starting',async t=>{
 const x=harness(t);await x.personal();const c=await x.connect();await x.enter(c);await x.terminal('aborted');
 assert.equal(x.room.lifecycle.phase,'DISBANDED');assert.equal(c.socket.destroyed,true);assert.equal(c.socket.listenerCount('close'),0);
 assert.equal(c.socket.frames.some(f=>f[0]===1&&f[1]?.[0]===6),true);assert.equal(c.client.enterData,null);
});
test('ordinary, uncommitted host and guest Enter do not gain BATTLE admission',async t=>{
 const x=harness(t);const host=await x.connect();await x.enter(host);assert.equal(host.socket.listenerCount('end'),0);
 await x.personal();const guest=await x.connect(2,'guest-cid');await x.enter(guest);assert.equal(guest.socket.listenerCount('end'),0);
 x.room.quest_id=1033004;await x.enter(host);assert.equal(host.socket.listenerCount('end'),0);
 assert.equal(host.client.enterData,null);assert.equal(guest.client.enterData,null);assert.equal(x.room.lifecycle.phase,'BATTLE');
});
test('oversized deferred Enter is explicitly dismissed without aborting the run',async t=>{
 const x=harness(t);await x.personal();const c=await x.connect();await x.enter(c,{party:{padding:'x'.repeat(262144)}});
 assert.equal(c.socket.destroyed,true);assert.equal(x.session.getClient(1,x.room.room_number),undefined);
 assert.equal(c.socket.frames.some(f=>f[0]===1&&f[1]?.[0]===6),true);assert.equal(x.room.lifecycle.phase,'BATTLE');
});
test('real Node timeout after ended TCP work clears inherited ALS and rejects the waiter in owner queue',async t=>{
 const x=harness(t,{timerDelay:20});await x.personal();const c=await x.connect();let clean=false;
 const remove=x.session.removeClient;
 x.session.removeClient=client=>{assert.equal(x.rpc.getRealtimeBusinessAdmission(),undefined);
  assert.doesNotThrow(()=>x.rpc.retainRealtimeBusinessTail(Promise.resolve()));clean=true;remove(client)};
 await x.rpc.runWithRealtimeBusinessAdmission({expired:'old-command-proof'},()=>x.rpc.runWithTcpBusinessAdmission(()=>x.enter(c)));
 let deadline;
 try {await Promise.race([
  new Promise(resolve=>c.socket.destroyed?resolve():c.socket.once('close',resolve)),
  new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('real pending timer did not close waiter within 2s')),2000)}),
 ])}finally{clearTimeout(deadline)}
 await x.coordinator.drain();
 assert.equal(clean,true);assert.equal(c.socket.destroyed,true);assert.equal(c.client.enterData,null);
 assert.equal(c.socket.frames.some(f=>f[0]===1&&f[1]?.[0]===6),true);assert.equal(x.room.lifecycle.phase,'BATTLE');
});
for(const at of [180999,181000])test(`terminal queued before timeout checks the actual deadline at ${at}ms`,async t=>{
 const x=harness(t);await x.personal();const c=await x.connect();await x.enter(c);x.setClock(at);await x.terminal();
 const welcomes=c.socket.frames.filter(f=>f[0]===1&&f[1]?.[0]===0).length;
 assert.equal(welcomes,at<181000?1:0);assert.equal(c.socket.destroyed,at>=181000);
 if(at>=181000)assert.equal(c.socket.frames.some(f=>f[0]===1&&f[1]?.[0]===6),true);
});
for(const kind of ['synchronous','asynchronous'])test(`${kind} unavailable room queue closes only the waiter without out-of-queue removal`,async t=>{
 const x=harness(t);await x.personal();const c=await x.connect();await x.enter(c);let removed=0;
 x.session.removeClient=()=>removed++;
 const enqueue=x.coordinator.enqueueRoomCommand;
 x.coordinator.enqueueRoomCommand=()=>{if(kind==='synchronous')throw Error('owner unavailable');return Promise.reject(Error('owner unavailable'))};
 x.setClock(200000);x.timers.find(timer=>timer.ms===180000).fn();await new Promise(resolve=>setImmediate(resolve));
 x.coordinator.enqueueRoomCommand=enqueue;
 assert.equal(removed,0);assert.equal(c.socket.destroyed,true);assert.equal(c.socket.listenerCount('close'),0);
 assert.equal(x.room.lifecycle.phase,'BATTLE');
});
