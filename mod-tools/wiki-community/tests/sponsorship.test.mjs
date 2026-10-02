import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../sqlite-adapter.mjs';
import {readSponsorship, updateSponsorship, adminSponsorshipRoute} from '../sponsorship.mjs';

const owner = {id:'owner',email:'owner@example.test',role:'owner'};
const deputy = {id:'deputy',email:'deputy@example.test',role:'deputy'};
const empty = {enabled:false,title:'',description:'',imageUrl:'',targetUrl:'',revision:0,updatedAt:null};
const migration = () => readFileSync(new URL('../migrations/0016-sponsorship.sql',import.meta.url),'utf8');
const body = patch => ({enabled:false,title:'测试赞助',description:'赞助说明',imageUrl:'https://cdn.example.com/banner.webp',
  targetUrl:'https://sponsor.example.com/info',expectedRevision:0,...patch});
function database(t) {const db=openDatabase();db.raw.exec(migration());t.after(()=>db.close());return db;}
const request = (method='GET',value) => new Request('https://wiki.example/api/community/admin/sponsorship',
  {method,headers:{'Content-Type':'application/json'},...(value===undefined?{}:{body:JSON.stringify(value)})});
const audits = db => db.raw.prepare('SELECT * FROM community_sponsorship_audit ORDER BY created_at').all();

test('sponsorship defaults off and disabled public reads redact the saved draft',async t=>{
  const db=database(t);assert.deepEqual(await readSponsorship(db),empty);
  assert.deepEqual(await adminSponsorshipRoute(request(),db,owner,1),empty);
  const saved=await updateSponsorship(db,body(),owner,1000);
  assert.equal(saved.enabled,false);assert.equal(saved.title,'测试赞助');assert.equal(saved.revision,1);
  assert.deepEqual(await readSponsorship(db),{...empty,revision:1,updatedAt:1000});
  assert.deepEqual(await adminSponsorshipRoute(request(),db,deputy,1001),saved);
  assert.equal(audits(db).length,1);
});

test('only owners and deputies can read drafts or write; forged or missing roles are denied before database access',async t=>{
  const db=database(t);
  for(const actor of [null,{}, {id:'owner',role:'owner'}, {id:'editor',email:'editor@example.test',role:'editor'},
    {id:'owner',email:'owner@example.test',role:'admin'}, {id:'owner',email:'owner@example.test'}]) {
    const status=actor?.id&&actor?.email?403:401;
    for(const method of ['GET','PATCH']) await assert.rejects(adminSponsorshipRoute(request(method,method==='PATCH'?body():undefined),db,actor,1000),e=>e.status===status);
    await assert.rejects(updateSponsorship(db,body(),actor,1000),e=>e.status===status);
  }
  assert.deepEqual(await readSponsorship(db),empty);assert.equal(audits(db).length,0);
  const first=await adminSponsorshipRoute(request('PATCH',body({enabled:true})),db,owner,1000);
  const second=await adminSponsorshipRoute(request('PATCH',body({enabled:false,expectedRevision:1})),db,deputy,2000);
  assert.equal(first.enabled,true);assert.equal(second.enabled,false);
  assert.deepEqual(audits(db).map(row=>row.actor_id),['owner','deputy']);
});

test('enabled text-only sponsors work and disabling removes every public creative field',async t=>{
  const db=database(t),saved=await updateSponsorship(db,body({enabled:true,imageUrl:''}),owner,1000);
  assert.deepEqual(await readSponsorship(db),saved);
  assert.deepEqual(Object.keys(saved).sort(),Object.keys(empty).sort());
  await updateSponsorship(db,body({enabled:false,expectedRevision:1}),owner,2000);
  assert.deepEqual(await readSponsorship(db),{...empty,revision:2,updatedAt:2000});
  for(const patch of [{title:''},{targetUrl:''}])await assert.rejects(updateSponsorship(db,body({enabled:true,expectedRevision:2,...patch}),owner,3000),e=>e.status===400);
});

test('bounded Unicode plain text is preserved as text; invalid types, control bytes and fields do not save',async t=>{
  const db=database(t);
  for(const patch of [{enabled:1},{enabled:'false'},{title:null},{description:[]},{title:'x'.repeat(61)},
    {description:'😀'.repeat(161)},{title:'x\ny'},{description:'x\u0000y'},{imageUrl:null},{targetUrl:{}},
    {expectedRevision:-1},{expectedRevision:0.5},{expectedRevision:'0'},{expectedRevision:Number.MAX_SAFE_INTEGER},
    {actor_id:'someone'}, {revision:999}]) await assert.rejects(updateSponsorship(db,body(patch),owner,1000),e=>e.status===400);
  assert.equal(audits(db).length,0);
  const saved=await updateSponsorship(db,body({title:'  <img src=x onerror=alert(1)>  ',description:' e\u0301 ',imageUrl:''}),owner,1000);
  assert.equal(saved.title,'<img src=x onerror=alert(1)>');assert.equal(saved.description,'é');
  const bounded=await updateSponsorship(db,body({title:'😀'.repeat(60),description:'😀'.repeat(160),expectedRevision:1}),deputy,2000);
  assert.equal([...bounded.title].length,60);assert.equal([...bounded.description].length,160);
});

test('URLs reject unsafe schemes, credentials, ports, private or ambiguous hosts and non-raster images',async t=>{
  const db=database(t);
  // Use the repository's conventional private test address while retaining rejection coverage.
  const invalid=['javascript:alert(1)','data:image/png;base64,AAA','http://example.com/a.png','//example.com/a.png',
    'https://user:pass@example.com/a.png','https://example.com:8443/a.png','https://localhost/a.png',
    'https://site.localhost/a.png','https://machine.local/a.png','https://host.internal/a.png','https://intranet/a.png',
    'https://127.0.0.1/a.png','https://127.1/a.png','https://2130706433/a.png','https://0x7f000001/a.png',
    'https://10.0.0.1/a.png','https://172.16.0.1/a.png','https://192.168.1.10/a.png','https://169.254.169.254/a.png',
    'https://[::1]/a.png','https://[::ffff:127.0.0.1]/a.png','https://[fc00::1]/a.png',
    'https://example.com\\@localhost/a.png','https://exa\nmple.com/a.png','https://example.com/a%00.png'];
  for(const value of invalid)for(const field of ['imageUrl','targetUrl'])
    await assert.rejects(updateSponsorship(db,body({[field]:value}),owner,1000),e=>e.status===400,`${field} ${JSON.stringify(value)}`);
  for(const imageUrl of ['https://example.com/a.svg','https://example.com/a.SVG?format=png','https://example.com/a.html',
    '/media/not-a-hash.png','/media/'+ 'a'.repeat(40)+'.png','/media/'+ 'a'.repeat(63)+'.png',
    '/media/'+ 'a'.repeat(64)+'.svg','/api/community/private.png','/media/../private.png'])
    await assert.rejects(updateSponsorship(db,body({imageUrl}),owner,1000),e=>e.status===400,imageUrl);
  assert.equal(audits(db).length,0);
  const local='/media/'+ 'a'.repeat(64)+'.png';
  const saved=await updateSponsorship(db,body({enabled:true,imageUrl:local,targetUrl:'https://sponsor.example.com:443/info?a=1#about'}),owner,1000);
  assert.equal(saved.imageUrl,local);assert.equal(saved.targetUrl,'https://sponsor.example.com/info?a=1#about');
  const normalized=await updateSponsorship(db,body({imageUrl:local.slice(1),expectedRevision:1}),owner,2000);
  assert.equal(normalized.imageUrl,local);
});

test('concurrent CAS has one winner and one audit; audit failure rolls back sponsorship edits',async t=>{
  const db=database(t);
  for(const expectedRevision of [0,1]) {
    const results=await Promise.allSettled(['甲','乙'].map(title=>updateSponsorship(db,body({title,expectedRevision}),owner,1000+expectedRevision)));
    assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
    assert.equal(results.find(row=>row.status==='rejected').reason.code,'edit_conflict');
  }
  assert.equal(audits(db).length,2);
  await assert.rejects(updateSponsorship(db,body(),owner,3000),e=>e.status===409);
  const before=await adminSponsorshipRoute(request(),db,owner,3000),history=audits(db);
  db.raw.exec("CREATE TRIGGER sponsor_audit_failure BEFORE INSERT ON community_sponsorship_audit BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END;");
  await assert.rejects(updateSponsorship(db,body({enabled:true,expectedRevision:2}),owner,3000),/fixture audit failure/);
  assert.deepEqual(await adminSponsorshipRoute(request(),db,owner,3000),before);assert.deepEqual(audits(db),history);
});

test('admin route rejects wrong methods, non-JSON and oversized bodies',async t=>{
  const db=database(t);
  for(const method of ['POST','PUT','DELETE'])await assert.rejects(adminSponsorshipRoute(request(method,body()),db,owner,1000),e=>e.status===405);
  await assert.rejects(adminSponsorshipRoute(new Request('https://wiki.example',{method:'PATCH',body:'{}'}),db,owner,1000),e=>e.status===415);
  await assert.rejects(adminSponsorshipRoute(request('PATCH',body({description:'x'.repeat(17000)})),db,owner,1000),e=>e.status===413);
});

test('additive migration is repeatable, preserves configuration/audits and all other records',async t=>{
  const db=database(t);db.raw.prepare('INSERT INTO community_limits VALUES(?,?,?)').run('fixture-limit',3,10000);
  const original=db.raw.prepare('SELECT * FROM community_limits').all();
  await updateSponsorship(db,body({enabled:true}),deputy,1000);
  const saved=await readSponsorship(db),history=audits(db);
  db.raw.exec(migration());db.raw.exec(migration());
  assert.deepEqual(await readSponsorship(db),saved);assert.deepEqual(audits(db),history);
  assert.deepEqual(db.raw.prepare('SELECT * FROM community_limits').all(),original);
  assert.deepEqual(db.raw.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.throws(()=>db.raw.prepare('INSERT INTO community_sponsorship VALUES(2,0,?,?,?,?,1,0)').run('','','',''));
});
