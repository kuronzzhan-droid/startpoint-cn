import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommunityHandler} from '../handler.mjs';
import {fixtureCatalog, envFor} from './helpers.mjs';
import {publicSummary} from '../public-summary-cache.mjs';

test('D1 daily quota failures expose a safe reason, reset time and bounded retry hint', async () => {
  const now = Date.parse('2026-09-30T09:00:00Z');
  for (const kind of ['read','write']) {
    const db = {prepare() {throw new Error('D1_ERROR: query failed', {cause:new Error(
      `Your account has exceeded D1's free tier daily row ${kind} limit. Secret SQL should not appear.`)});}};
    const response = await createCommunityHandler(fixtureCatalog, {now:()=>now})(
      new Request('https://wiki.example/api/community/stats'), envFor(db));
    assert.equal(response.status,503); assert.equal(response.headers.get('retry-after'),'300');
    const body = await response.json();
    assert.equal(body.error,'database_quota_exceeded');
    assert.equal(body.resetAt,'2026-10-01T00:00:00.000Z');
    assert.equal(body.retryAfter,300); assert.doesNotMatch(JSON.stringify(body),/Secret SQL|D1_ERROR/);
  }
});

test('unknown failures remain generic and do not leak SQL or secrets', async () => {
  const db={prepare(){throw new Error('SELECT password_hash FROM community_users secret');}};
  const response=await createCommunityHandler(fixtureCatalog)(new Request('https://wiki.example/api/community/stats'),envFor(db));
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{error:'service_unavailable',message:'社区服务暂时不可用，请稍后重试。'});
});

function cacheFixture() {
  const values=new Map(),keys=[];
  return {keys,values,async match(request){keys.push(request);return values.get(request.url)?.clone();},
    async put(request,response){values.set(request.url,response.clone());}};
}
test('public aggregate cache shares results across visitors and irrelevant query strings without caching cookies', async () => {
  const cache=cacheFixture();let reads=0;
  const load=async()=>({items:[{id:'c0',average:5,voters:2}],reads:++reads});
  const one=await publicSummary(new Request('https://wiki.example/api/community/ratings/characters?x=1',{headers:{Cookie:'private'}}),load,cache);
  const two=await publicSummary(new Request('https://wiki.example/api/community/ratings/characters?x=2'),load,cache);
  assert.deepEqual(one,two);assert.equal(reads,1);assert.equal(cache.values.size,1);
  assert.ok(cache.keys.every(key=>key.method==='GET'&&!key.headers.has('cookie')));
  assert.equal([...cache.values.values()][0].headers.get('cache-control'),'public, max-age=30');
});
test('private reads, config, game codes, team visibility and writes always bypass aggregate cache', async () => {
  const cache=cacheFixture();let reads=0;
  for(const path of ['/config','/admin/teams','/teams','/teams/id','/ratings/characters/c0','/game-codes/23456789ABCD']) {
    const request=new Request('https://wiki.example/api/community'+path);
    await publicSummary(request,async()=>++reads,cache);await publicSummary(request,async()=>++reads,cache);
  }
  await publicSummary(new Request('https://wiki.example/api/community/tier-rankings',{method:'POST'}),async()=>++reads,cache);
  assert.equal(reads,13);assert.equal(cache.values.size,0);assert.equal(cache.keys.length,0);
});
test('cache failures cannot interrupt reads, and failed database queries are never cached', async () => {
  let reads=0;const request=new Request('https://wiki.example/api/community/stats');
  const broken={async match(){throw Error('cache down');},async put(){throw Error('cache down');}};
  assert.equal(await publicSummary(request,async()=>++reads,broken),1);
  const cache=cacheFixture();await assert.rejects(publicSummary(request,async()=>{throw Error('DB unavailable');},cache),/DB unavailable/);
  assert.equal(cache.values.size,0);
  assert.equal(await publicSummary(request,async()=>++reads,undefined),2);
});

test('simultaneous cold public summaries query once and separate routes remain independent', async () => {
  const cache=cacheFixture();let reads=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const load=async()=>{reads++;await gate;return {reads};};
  const calls=Array.from({length:12},(_,i)=>publicSummary(new Request(`https://wiki.example/api/community/tier-rankings?noise=${i}`),load,cache));
  const other=publicSummary(new Request('https://wiki.example/api/community/stats'),load,cache);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,2);release();
  const results=await Promise.all([...calls,other]);
  assert(results.every(value=>value.reads===2));assert.equal(cache.values.size,2);
});

test('a failed concurrent load rejects every waiter and the next request can recover', async () => {
  const cache=cacheFixture();let reads=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const load=async()=>{reads++;await gate;throw Error('fixture unavailable');};
  const request=new Request('https://wiki.example/api/community/stats');
  const calls=Array.from({length:8},()=>publicSummary(request,load,cache));
  const settled=Promise.allSettled(calls);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,1);release();
  assert((await settled).every(result=>result.status==='rejected'));
  assert.equal(cache.values.size,0);
  assert.deepEqual(await publicSummary(request,async()=>({recovered:true}),cache),{recovered:true});
});
