const test=require('node:test'),assert=require('node:assert/strict'),M=require('../wiki/battle-model.js'),E=require('../wiki/battle-effects.js'),F=require('./wiki_battle_fixture.cjs');
function setup(phases){const o=F.options();if(phases)o.content.characters.c0.skill.phases=phases;const s=M.create(o);M.dispatch(s,{id:1,type:'deploy',characterId:'c0',col:2,row:5});s.units[0].readyAtTick=0;s.units[0].nextActionTick=1e9;return s;}
const p=(type,extra={})=>({offset:0,selector:{team:type==='damage'||type==='dot'?'enemy':'ally',kind:'nearest',range:4},geometry:{kind:'single',center:'target'},effects:[{type,...extra}]});
test('cast needs a valid branch, charges once and resets full cooldown',()=>{
  const s=setup();assert.equal(M.dispatch(s,{id:2,type:'cast',unitId:s.units[0].id}).ok,false);assert.equal(s.energy,40);
  s.enemies=[F.enemy()];assert.ok(M.dispatch(s,{id:3,type:'cast',unitId:s.units[0].id}).ok);assert.equal(s.energy,25);
  assert.equal(M.dispatch(s,{id:4,type:'cast',unitId:s.units[0].id}).ok,false);assert.equal(s.energy,25);M.advance(s);assert.equal(s.enemies[0].hp,9700);
});
test('a full-health mixed shield can cast but pure heal cannot',()=>{
  const s=setup([p('heal',{ratio:.2})]);assert.equal(E.planCast(s,s.units[0].id),null);
  s.content.characters.c0.skill.phases.push(p('shield',{ratio:.1,duration:8}));assert.ok(E.planCast(s,s.units[0].id));
});
test('eight-second DoT applies exactly eight parts; death does not cancel emitted ground effect',()=>{
  const s=setup([p('dot',{amount:80,duration:8,interval:1})]);s.enemies=[F.enemy()];M.dispatch(s,{id:2,type:'cast',unitId:s.units[0].id});
  M.advance(s);s.units[0].hp=0;for(let i=0;i<160;i++)M.advance(s);assert.equal(s.enemies[0].hp,9920);
});
test('maintained aura ends on death and strongest buff falls back without extending',()=>{
  const s=setup([p('dot',{amount:80,duration:8,requiresCasterAlive:true})]);s.enemies=[F.enemy()];M.dispatch(s,{id:2,type:'cast',unitId:s.units[0].id});M.advance(s);s.units[0].hp=0;
  for(let i=0;i<160;i++)M.advance(s);assert.equal(s.enemies[0].hp,10000);
  const u={statuses:[{type:'attackUp',ratio:.5,until:10},{type:'attackUp',ratio:.2,until:30}]};
  assert.equal(E.modifier(u,'attackUp',9),.5);assert.equal(E.modifier(u,'attackUp',10),.2);assert.equal(E.modifier(u,'attackUp',30),0);
});
test('healing over time splits total amount and never heals a corpse',()=>{
  const s=setup([p('heal',{amount:80,duration:8})]);s.units[0].hp=500;M.dispatch(s,{id:2,type:'cast',unitId:s.units[0].id});
  for(let i=0;i<161;i++)M.advance(s);assert.equal(s.units[0].hp,580);
});
test('hit-dependent buff cannot be cast for free on an empty board',()=>{
  const dmg=p('damage',{amount:50}),buff=p('attackUp',{ratio:.2,duration:5});buff.requiresHit=0;
  const s=setup([dmg,buff]);assert.equal(E.planCast(s,s.units[0].id),null);s.enemies=[F.enemy()];assert.ok(E.planCast(s,s.units[0].id));
});
