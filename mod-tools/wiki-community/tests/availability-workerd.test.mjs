import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const runtimePath = process.env.WF_WIKI_MINIFLARE;
test('workerd Cache API caches public summaries but never a private or failed read', {skip:!runtimePath}, async (t) => {
  const {Miniflare,convertV4MiniflareOptions}=await import(pathToFileURL(runtimePath).href);
  const root=path.resolve(import.meta.dirname,'..');
  const entry=`import {publicSummary} from './public-summary-cache.mjs';
    let count=0;export default {async fetch(request) {
      try {return Response.json(await publicSummary(request,async()=>{
        count++;if(request.headers.get('x-fixture-fail'))throw Error('fixture failure');
        if(request.headers.get('x-fixture-delay'))await new Promise(resolve=>setTimeout(resolve,80));return {count};
      }));}catch{return new Response('unavailable',{status:503});}
    }};`;
  const options={modulesRoot:root,compatibilityDate:'2026-09-29',modules:[
    {type:'ESModule',path:path.join(root,'__availability_fixture.mjs'),contents:entry},
    {type:'ESModule',path:path.join(root,'public-summary-cache.mjs'),contents:await readFile(path.join(root,'public-summary-cache.mjs'),'utf8')},
  ]};
  const mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(options):options);t.after(()=>mf.dispose());
  const call=(route,headers={})=>mf.dispatchFetch('https://wiki.example/api/community'+route,{headers});
  assert.equal((await call('/stats',{'x-fixture-fail':'1'})).status,503);
  const first=await (await call('/stats')).json();assert.equal(first.count,2);
  assert.deepEqual(await (await call('/stats?random=2',{Cookie:'other-person'})).json(),first);
  const a=await (await call('/admin/teams')).json(),b=await (await call('/admin/teams')).json();
  assert.equal(b.count,a.count+1);
  assert.equal((await call('/tier-rankings',{'x-fixture-fail':'1'})).status,503);
  assert.equal((await call('/tier-rankings')).status,200);
  const burst=await Promise.all(Array.from({length:8},(_,i)=>call('/ratings/characters?burst='+i,{'x-fixture-delay':'1'}).then(r=>r.json())));
  assert.equal(new Set(burst.map(value=>value.count)).size,1);
  assert.equal(burst[0].count,7);
});
