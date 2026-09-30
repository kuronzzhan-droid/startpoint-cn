import test from 'node:test';
import assert from 'node:assert/strict';
import {createStatisticsAvailability} from '../statistics-availability.mjs';
import {ApiError} from '../model.mjs';
import {createCommunityHandler} from '../handler.mjs';
import {fixtureCatalog,envFor} from './helpers.mjs';

const request = path => new Request(`https://wiki.example/api/community/${path}`, {headers:{'CF-Connecting-IP':'192.0.2.10'}});
const noCache = () => undefined;
function edgeCache() {
  const entries = new Map();
  return {entries, async match(key) {return entries.get(key.url)?.clone();},
    async put(key,value) {entries.set(key.url,value.clone());}};
}

test('failed statistics pause subsequent calls before any D1 access and recover after cooldown', async () => {
  const guard=createStatisticsAvailability({cache:noCache}),db={};let calls=0;
  const load=async()=>{calls++;throw Error('private SQL');};
  await assert.rejects(guard(request('presence'),db,1000,load),error=>error.status===503&&error.code==='statistics_paused'&&error.extra.retryAfter===300);
  for(let i=0;i<8;i++) await assert.rejects(guard(request('stats'),db,2000,load),error=>error.code==='statistics_paused');
  assert.equal(calls,1);
  assert.deepEqual(await guard(request('stats'),db,301000,async()=>({ready:true})),{ready:true});
});

test('a cold or recovery burst has one failing database probe', async () => {
  const guard=createStatisticsAvailability({cache:noCache}),db={};let calls=0,release;
  const blocked=new Promise(resolve=>{release=resolve;});
  const load=async()=>{calls++;await blocked;throw Error('database unavailable');};
  const jobs=Array.from({length:20},()=>guard(request('presence'),db,1000,load));
  const settled=Promise.allSettled(jobs);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
  release();assert((await settled).every(item=>item.status==='rejected'));assert.equal(calls,1);
});

test('successful probe followers execute their own operation rather than sharing private results', async () => {
  const guard=createStatisticsAvailability({cache:noCache}),db={};let calls=0;
  const values=await Promise.all(Array.from({length:8},(_,i)=>guard(request('presence'),db,1000,async()=>{calls++;return {visitor:i};})));
  assert.equal(calls,8);assert.deepEqual(values.map(x=>x.visitor),[0,1,2,3,4,5,6,7]);
});

test('concurrent visitors never inherit the first visitor identity or validation error', async () => {
  const guard=createStatisticsAvailability({cache:noCache}),db={};let release,calls=0;
  const pending=new Promise(resolve=>{release=resolve;});
  const first=guard(request('presence'),db,1000,async()=>{await pending;throw new ApiError(428,'visitor_required','identity');});
  const rejected=assert.rejects(first,error=>error.code==='visitor_required');
  const second=guard(request('stats'),db,1000,async()=>{calls++;return 42;});
  release();await rejected;assert.equal(await second,42);assert.equal(calls,1);
});

test('a new configured database namespace ignores the previous database edge pause on the same host', async () => {
  const cache=edgeCache(),guard=createStatisticsAvailability({cache:()=>cache});
  await assert.rejects(guard(request('stats'),{},1000,async()=>{throw Error('old DB');},'db-a'));
  assert.equal(await guard(request('stats'),{},1001,async()=>42,'db-b'),42);
});

test('bad input, visitor identity errors, rate limits and snapshot refresh contention do not open global circuit', async () => {
  const guard=createStatisticsAvailability({cache:noCache}),db={};
  for(const [status,code] of [[400,'invalid_fields'],[428,'visitor_required'],[429,'rate_limited'],[503,'statistics_refreshing']]) {
    await assert.rejects(guard(request('presence'),db,1000,async()=>{throw new ApiError(status,code,'safe');}),error=>error.code===code);
    assert.equal(await guard(request('stats'),db,1001,async()=>42),42);
  }
});

test('quota pause is safe, shared via edge cache across instances, and expires at next UTC day', async () => {
  const cache=edgeCache(),db={},at=Date.parse('2026-09-30T23:58:00Z');let calls=0;
  const first=createStatisticsAvailability({cache:()=>cache});
  await assert.rejects(first(request('stats'),db,at,async()=>{calls++;throw Error("D1's free tier daily row read limit SECRET");}),
    error=>error.code==='database_quota_exceeded'&&error.extra.retryAfter===120&&error.extra.resetAt==='2026-10-01T00:00:00.000Z');
  const second=createStatisticsAvailability({cache:()=>cache});
  await assert.rejects(second(request('presence'),{},at+1000,async()=>{calls++;}),error=>error.extra.retryAfter===119);
  assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(await [...cache.entries.values()][0].clone().json()),/SECRET|visitor|cookie/i);
  assert.equal(await second(request('stats'),{},at+120000,async()=>7),7);
});

test('cache failure, malformed marker and separate database/origin do not block valid statistics', async () => {
  const broken={async match(){throw Error();},async put(){throw Error();}},guard=createStatisticsAvailability({cache:()=>broken}),db={};
  await assert.rejects(guard(request('stats'),db,1000,async()=>{throw Error();}));
  assert.equal(await guard(request('stats'),{},1000,async()=>8),8);
  assert.equal(await guard(new Request('https://another.example/api/community/stats'),db,1000,async()=>9),9);
  const malformed=createStatisticsAvailability({cache:()=>({match:async()=>Response.json({error:'private',until:9999999999999})})});
  assert.equal(await malformed(request('stats'),{},1000,async()=>10),10);
});

test('handler statistics circuit never opens a global ban on game lookup or configuration', async () => {
  let queries=0;const db={prepare(){queries++;throw Error('database unavailable');}};
  const handle=createCommunityHandler(fixtureCatalog,{now:()=>1000}),env=envFor(db);
  assert.equal((await handle(request('stats'),env)).status,503);const first=queries;
  assert.equal((await handle(request('presence'),env)).status,503);assert.equal(queries,first);
  await handle(request('game-codes/ABCDEFGHJKLM'),env);assert(queries>first);
  const after=queries;await handle(request('config'),env);assert(queries>after);
});
