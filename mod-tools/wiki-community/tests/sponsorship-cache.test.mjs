import test from 'node:test';
import assert from 'node:assert/strict';
import {publicSummary} from '../public-summary-cache.mjs';

test('sponsor reads coalesce and expire at the next half-hour without caching admin drafts',async()=>{
  const values=new Map(),writes=[];let loads=0;
  const cache={async match(key){return values.get(key.url)?.clone();},
    async put(key,value){writes.push(value.headers.get('Cache-Control'));values.set(key.url,value.clone());}};
  const load=async()=>({enabled:false,revision:++loads});
  const request=new Request('https://wiki.example/api/community/sponsorship');
  const now=1_799_000;
  const responses=await Promise.all([publicSummary(request,load,cache,now),publicSummary(request,load,cache,now)]);
  assert.deepEqual(responses[0],responses[1]);assert.equal(loads,1);assert.deepEqual(writes,['public, max-age=1']);
  assert.deepEqual(await publicSummary(request,load,cache,now),responses[0]);
  const next=await publicSummary(request,load,cache,1_800_000);assert.equal(next.revision,2);
  assert.deepEqual(writes,['public, max-age=1','public, max-age=1800']);
  const admin=new Request('https://wiki.example/api/community/admin/sponsorship');
  await publicSummary(admin,load,cache,now);await publicSummary(admin,load,cache,now);
  assert.equal(loads,4);assert.equal(writes.length,2);
});
