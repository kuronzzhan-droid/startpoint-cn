const test=require('node:test'),assert=require('node:assert/strict'),P=require('../wiki/battle-page.js');
test('leave protection follows mounted session even after hash changes; cancel restores previous state',async()=>{
 const state={status:'running'},events=[];let answer=false,connected=true;
 const guard=P.makeGuard({getState:()=>state,isConnected:()=>connected,pause:()=>{events.push('pause');state.status='paused';},resume:()=>{events.push('resume');state.status='running';},ask:async()=>answer});
 assert.equal(guard.isActive(),true);assert.equal(await guard.canLeave(),false);assert.deepEqual(events,['pause','resume']);
 state.status='paused';assert.equal(await guard.canLeave(),false);assert.equal(state.status,'paused');
 answer=true;assert.equal(await guard.canLeave(),true);assert.equal(state.status,'paused');connected=false;assert.equal(guard.isActive(),false);
});
test('finished or preparation views never ask to abandon combat',()=>{let state=null;const guard=P.makeGuard({getState:()=>state,isConnected:()=>true});assert.equal(guard.needsProtection(),false);state={status:'won'};assert.equal(guard.needsProtection(),false);state={status:'running'};assert.equal(guard.needsProtection(),true);});
