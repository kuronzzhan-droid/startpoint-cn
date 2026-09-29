const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../wiki/community-client.js');
const response = (value, status = 200, retry = '') => ({ok: status < 400, status,
  json: async () => value, headers: {get: () => retry}});
const data = {characters: ['c1', 'c2', 'c3', 'c4'].map((id) => ({id})),
  equipment: [{id:'w1',soul:{available:true}}, {id:'w2',soul:{available:false}}]};

test('submission validates three main characters without requiring equipment or unisons', () => {
  const team = C.teamCopy({main: ['c1','c2','c3']});
  assert.equal(C.teamError(team, data), '');
  team.main[1] = ''; assert.match(C.teamError(team,data),/三个主位/);
  team.main[1] = 'c2'; team.unison[0] = 'c2'; assert.match(C.teamError(team,data),/重复/);
  team.unison[0] = 'c4'; team.soul[1] = 'w2'; assert.match(C.teamError(team,data),/魂珠/);
  team.soul[1] = 'w1'; assert.equal(C.teamError(team,data), '');
  team.weapon[2] = 'bad'; assert.match(C.teamError(team,data),/装备/);
});
test('import and query use known fields, stable filter order and escaped cursor', () => {
  const source = {main:['c1','c2','c3','extra'], weapon:[42,'w1'], arbitrary:'ignored'};
  const team = C.teamCopy(source); team.main[0] = 'changed';
  assert.equal(source.main[0],'c1'); assert.equal(team.main.length,3); assert.equal(team.weapon[0],'');
  assert.deepEqual(Object.keys(team),['main','unison','weapon','soul']);
  const query = new URLSearchParams(C.query({element:'火',sort:'popular',damageTypes:['direct','skill','<script>']},'x&y'));
  assert.equal(query.get('damage'),'skill,direct'); assert.equal(query.get('cursor'),'x&y');
  assert.equal(query.get('element'),'火'); assert.equal(query.get('sort'),'popular');
});
test('gameplay sections remain independent from categories and legacy general entries', () => {
  for (const section of ['abyss','fantasy','five-boss','general']) {
    const params = new URLSearchParams(C.query({section,category:'玩具盘',damageTypes:['direct'],sort:'popular'}));
    assert.equal(params.get('section'),section); assert.equal(params.get('category'),'玩具盘'); assert.equal(params.get('damage'),'direct');
  }
  for (const section of [undefined,'','arbitrary']) assert.equal(new URLSearchParams(C.query({section})).has('section'),false);
  assert.equal(C.sectionLabel('abyss'),'深渊连战'); assert.equal(C.sectionLabel(undefined),'通用/其他');
  assert.equal(C.sectionLabel('玩具盘'),'通用/其他');
});
test('code availability is an independent, allowlisted query filter', () => {
  for (const code of ['has','none']) assert.equal(new URLSearchParams(C.query({code,section:'abyss',category:'玩具盘'})).get('code'),code);
  for (const code of ['','invalid']) assert.equal(new URLSearchParams(C.query({code})).has('code'),false);
});
test('same-origin API sends JSON and credentials without querying any game endpoint', async () => {
  const calls = [], api = C.createApi(async (...args) => {calls.push(args); return response({id:'t1'});}, 'https:');
  await api.request('/teams/t1/like',{turnstileToken:'one-use'});
  assert.equal(calls[0][0],'/api/community/teams/t1/like');
  assert.equal(calls[0][1].credentials,'same-origin'); assert.equal(calls[0][1].method,'POST');
  assert.deepEqual(JSON.parse(calls[0][1].body),{turnstileToken:'one-use'});
});
test('offline mode never requests an API and disabled config can recover after retry', async () => {
  let calls=0;
  const offline=C.createApi(async()=>{calls++;},'file:'); await assert.rejects(offline.config(),/离线版/); assert.equal(calls,0);
  const api=C.createApi(async()=>response({enabled:++calls>1}), 'http:');
  await assert.rejects(api.config(),/暂未启用/); assert.equal((await api.config()).enabled,true);
  await api.config(); assert.equal(calls,2);
});
test('HTML fallback, connection failures and throttling produce actionable errors', async () => {
  const html=C.createApi(async()=>({json:async()=>{throw new SyntaxError();}}),'https:');
  await assert.rejects(html.config(),/暂未启用/);
  const network=C.createApi(async()=>{throw new TypeError('fetch failed');},'https:');
  await assert.rejects(network.request('/teams'),/填写的内容仍保留/);
  const limited=C.createApi(async()=>response({error:'rate_limited',message:'slow'},429,'17'),'https:');
  await assert.rejects(limited.request('/teams'),(error)=>{
    assert.equal(error.status,429); assert.match(C.message(error),/17 秒/); return true;
  });
});
test('duplicate and already-liked responses retain only server error metadata', async () => {
  const api=C.createApi(async()=>response({error:'duplicate',message:'exists',existingId:'t1',status:'hidden'},409),'https:');
  await assert.rejects(api.request('/teams',{}),(error)=>{
    assert.equal(error.code,'duplicate'); assert.equal(error.data.status,'hidden'); assert.match(C.message(error),/已收录/); return true;
  });
  assert.match(C.message({code:'already_liked'}),/北京时间/);
});
