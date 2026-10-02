import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {privacyContext} from './privacy-helpers.mjs';

const path = '/admin/sponsorship';
const empty = {enabled:false,title:'',description:'',imageUrl:'',targetUrl:'',revision:0,updatedAt:null};
const creative = (expectedRevision = 0, extra = {}) => ({enabled:false,title:'合作伙伴',description:'赞助说明',
  imageUrl:'https://cdn.example.com/banner.webp',targetUrl:'https://sponsor.example.com/info',expectedRevision,...extra});
const patch = (app, value = creative(), settings = {}) => app.call(path,{method:'PATCH',body:value,...settings});
const auditCount = app => app.db.raw.prepare('SELECT COUNT(*) n FROM community_sponsorship_audit').get().n;

test('public sponsorship is off by default and never initializes identities or limit records', async t => {
  const app = await privacyContext(t);
  const response = await app.call('/sponsorship');
  assert.equal(response.status,200); assert.deepEqual(response.json,empty);
  assert.equal(response.headers.get('set-cookie'),null); assert.equal(app.cookie,'');
  assert.equal(response.headers.get('cache-control'),'no-store');
  for (const method of ['POST','PATCH','PUT','DELETE']) {
    const denied = await app.call('/sponsorship',{method,body:creative()});
    assert.equal(denied.status,405); assert.equal(denied.headers.get('set-cookie'),null);
  }
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_limits').get().n,0);
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_sponsorship').get().n,0);
  assert.equal(auditCount(app),0);
});

test('anonymous and forged administrator headers cannot read drafts or mutate sponsorship', async t => {
  const app = await privacyContext(t);
  for (const headers of [{}, {'X-Role':'owner','Cf-Access-Authenticated-User-Email':'owner@example.test'},
    {Cookie:'wf_community_admin_dev=forged-owner','X-Role':'deputy'}]) {
    assert.equal((await app.call(path,{headers})).status,401);
    const denied = await patch(app,creative(),{headers});
    assert.equal(denied.status,401); assert.equal(denied.headers.get('set-cookie'),null);
  }
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_limits').get().n,0);
  assert.equal(auditCount(app),0); assert.deepEqual((await app.call('/sponsorship')).json,empty);
});

test('owner and deputy manage drafts while ordinary editors cannot read or write them', async t => {
  const app = await privacyContext(t); app.as('owner');
  assert.deepEqual((await app.call(path)).json,empty);
  const draft = await patch(app); assert.equal(draft.status,200); assert.equal(draft.json.revision,1);
  for (const role of ['editor-a','editor-b']) {
    app.as(role);
    assert.equal((await app.call(path)).status,403);
    const denied = await patch(app,creative(1,{enabled:true}));
    assert.equal(denied.status,403); assert.equal(denied.json.error,'owner_required');
  }
  app.as('guest'); const hidden = await app.call('/sponsorship');
  assert.deepEqual(hidden.json,{...empty,revision:1,updatedAt:app.now}); assert.equal(hidden.headers.get('set-cookie'),null);
  app.as('deputy'); assert.deepEqual((await app.call(path)).json,draft.json);
  app.now += 1000;
  const enabled = await patch(app,creative(1,{enabled:true,imageUrl:''}));
  assert.equal(enabled.status,200); assert.equal(enabled.json.revision,2); assert.equal(enabled.json.updatedAt,app.now);
  app.as('guest'); const visible = await app.call('/sponsorship');
  assert.deepEqual(visible.json,enabled.json); assert.equal(visible.headers.get('set-cookie'),null);
  assert.ok(!/actor_|email|owner|deputy/.test(JSON.stringify(visible.json)));
  app.as('owner'); const disabled = await patch(app,creative(2)); assert.equal(disabled.status,200);
  app.as('guest'); assert.deepEqual((await app.call('/sponsorship')).json,{...empty,revision:3,updatedAt:app.now});
  assert.deepEqual(app.db.raw.prepare('SELECT actor_id FROM community_sponsorship_audit ORDER BY rowid').all().map(row=>row.actor_id),['owner','deputy','owner']);
});

test('sponsorship enforces same origin, current account status, required password changes and admin limits', async t => {
  const app = await privacyContext(t); app.as('deputy');
  for (const headers of [{Origin:'https://evil.example'},{Origin:''},{'Sec-Fetch-Site':'cross-site'}])
    assert.equal((await patch(app,creative(),{headers})).status,403);
  for (const method of ['POST','PUT','DELETE']) assert.equal((await app.call(path,{method,body:creative()})).status,405);
  app.db.raw.prepare("UPDATE community_users SET must_change_password=1 WHERE id='deputy'").run();
  assert.equal((await app.call(path)).json.error,'password_change_required');
  assert.equal((await patch(app)).json.error,'password_change_required');
  app.db.raw.prepare("UPDATE community_users SET must_change_password=0,enabled=0 WHERE id='deputy'").run();
  assert.equal((await app.call(path)).status,401); assert.equal((await patch(app)).status,401);
  assert.equal(auditCount(app),0);
  app.db.raw.prepare("UPDATE community_users SET enabled=1 WHERE id='deputy'").run();
  assert.equal((await patch(app)).status,200);
  app.db.raw.prepare("UPDATE community_limits SET count=120 WHERE key LIKE 'admin:%'").run();
  const limited = await patch(app,creative(1,{enabled:true}));
  assert.equal(limited.status,429); assert.ok(Number(limited.headers.get('retry-after'))>0);
  assert.equal((await app.call(path)).json.revision,1); assert.equal(auditCount(app),1);
});

test('HTTP edits preserve CAS conflicts and invalid URLs never enter public content', async t => {
  const app = await privacyContext(t); app.as('deputy');
  assert.equal((await patch(app,creative(0,{enabled:true,imageUrl:'javascript:alert(1)'}))).status,400);
  assert.equal((await patch(app,creative(0,{targetUrl:'https://127.0.0.1/private'}))).status,400);
  assert.equal(auditCount(app),0);
  const accepted = await patch(app,creative(0,{enabled:true,imageUrl:'media/'+ 'a'.repeat(64)+'.png'}));
  assert.equal(accepted.status,200); assert.equal(accepted.json.imageUrl,'/media/'+ 'a'.repeat(64)+'.png');
  const stale = await patch(app,creative(0,{title:'旧版本覆盖'}));
  assert.equal(stale.status,409); assert.equal(stale.json.error,'edit_conflict');
  assert.equal(auditCount(app),1); assert.deepEqual((await app.call('/sponsorship')).json,accepted.json);
});

test('0016 can be applied twice without resetting sponsorship or changing existing teams and users', async t => {
  const app = await privacyContext(t); app.as('owner');
  assert.equal((await app.create()).status,201);
  const teams = app.db.raw.prepare('SELECT * FROM community_teams').all(), users = app.db.raw.prepare('SELECT * FROM community_users').all();
  app.db.raw.exec('DROP TABLE community_sponsorship_audit; DROP TABLE community_sponsorship;');
  const migration = readFileSync(new URL('../migrations/0016-sponsorship.sql',import.meta.url),'utf8');
  app.db.raw.exec(migration);
  assert.deepEqual((await app.call('/sponsorship')).json,empty);
  const saved = await patch(app,creative(0,{enabled:true})); assert.equal(saved.status,200);
  const audits = app.db.raw.prepare('SELECT * FROM community_sponsorship_audit').all();
  app.db.raw.exec(migration); app.db.raw.exec(migration);
  assert.deepEqual((await app.call(path)).json,saved.json);
  assert.deepEqual(app.db.raw.prepare('SELECT * FROM community_sponsorship_audit').all(),audits);
  assert.deepEqual(app.db.raw.prepare('SELECT * FROM community_teams').all(),teams);
  assert.deepEqual(app.db.raw.prepare('SELECT * FROM community_users').all(),users);
  assert.deepEqual(app.db.raw.prepare('PRAGMA foreign_key_check').all(),[]);
});
