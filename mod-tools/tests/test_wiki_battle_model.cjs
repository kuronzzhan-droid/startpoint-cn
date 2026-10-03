const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../wiki/battle-model.js'),F=require('./wiki_battle_fixture.cjs');
const create=()=>M.create(F.options());
const deploy=(s,id=1,c='c0',col=2,row=5)=>M.dispatch(s,{id,type:'deploy',characterId:c,col,row});
test('deployment charges exactly once and duplicate command cannot occupy another cell',()=>{
  const s=create();assert.equal(s.energy,60);assert.ok(deploy(s).ok);assert.equal(s.energy,40);
  assert.equal(deploy(s).ok,false);assert.equal(s.energy,40);assert.equal(s.units.length,1);
});
test('invalid coordinates, ids, occupied cells and enemy collision never charge',()=>{
  const s=create();for(const [i,c,x,y]of [[1,'c0',-1,0],[2,'c0',5,0],[3,'c0',1,Infinity],[4,'unknown',1,1]])assert.equal(deploy(s,i,c,x,y).ok,false);
  assert.equal(s.energy,60);deploy(s,5);assert.equal(deploy(s,6,'c1').ok,false);
  s.enemies=[F.enemy(99,1.5,1.5)];assert.equal(deploy(s,7,'c1',1,1).ok,false);assert.equal(s.energy,40);
});
test('six unique eligible IDs are required but different versions can coexist',()=>{
  const o=F.options();o.content.characters.c1.name=o.content.characters.c0.name;assert.equal(M.create(o).squad.length,6);
  assert.throws(()=>M.create({...o,squad:['c0','c0']}));assert.throws(()=>M.create({...o,squad:['x',...o.squad.slice(1)]}));
});
test('energy regenerates at three per second and is capped without drift',()=>{
  const s=create();for(let i=0;i<20;i++)M.advance(s);assert.equal(s.energy,63);
  for(let i=0;i<1000;i++)M.advance(s);assert.equal(s.energy,120);
});
test('death creates one coffin for exactly 400 active ticks and cannot be healed or redeployed',()=>{
  const s=create();deploy(s);s.units[0].hp=0;const ev=M.advance(s);assert.equal(ev.filter(e=>e.type==='death').length,1);
  assert.equal(s.coffins.length,1);assert.equal(s.units.length,0);assert.equal(deploy(s,2).ok,false);
  for(let i=0;i<399;i++)M.advance(s);assert.equal(s.coffins.length,1);
  assert.equal(M.advance(s).filter(e=>e.type==='returned').length,1);assert.equal(s.coffins.length,0);
  assert.ok(deploy(s,3).ok);assert.equal(s.units[0].hp,900);assert.equal(s.units[0].readyAtTick-s.tick,400);
});
test('paused ticks do not regenerate energy or advance coffin cooldown',()=>{
  const s=create();deploy(s);s.units[0].hp=0;M.advance(s);M.setPaused(s,true);const before=JSON.stringify(s);
  for(let i=0;i<1200;i++)assert.deepEqual(M.advance(s),[]);assert.equal(JSON.stringify(s),before);
  assert.equal(deploy(s,3,'c1',0,0).ok,false);M.setPaused(s,false);assert.equal(s.status,'running');
});
test('skill ready event occurs only once for the deployed lifetime',()=>{
  const s=create();deploy(s);let count=0;for(let i=0;i<450;i++)count+=M.advance(s).filter(e=>e.type==='ready').length;
  assert.equal(count,1);
});
test('dead enemy rewards only once and a simultaneous base death takes precedence',()=>{
  const s=create();s.enemies=[F.enemy(100,0,0,0)];s.baseHp=0;const events=M.advance(s);
  assert.equal(s.status,'lost');assert.equal(events.filter(e=>e.type==='result').length,1);
  const energy=s.energy;M.advance(s);assert.equal(s.energy,energy);
});
