import test from 'node:test';
import assert from 'node:assert/strict';
import {context} from './helpers.mjs';
import {sign} from '../codecs.mjs';

test('presence requires a configured browser identity and never mints a competing cookie', async (t) => {
  const app = context(); t.after(() => app.close());
  for (const cookie of ['', 'wf_community_visitor_dev=forged-cookie']) {
    const result = await app.call('/presence', {body:{}, headers:{Cookie:cookie}});
    assert.equal(result.status, 428); assert.equal(result.json.error, 'visitor_required');
    assert.equal(result.headers.get('set-cookie'), null);
  }
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_presence').get().n, 0);
  await app.call('/config'); const cookie = app.cookie;
  const result = await app.call('/presence', {body:{}});
  assert.equal(result.status, 200); assert.equal(result.json.onlineVisitors, 1);
  assert.equal(result.headers.get('set-cookie'), null); assert.equal(app.cookie, cookie);
  const id = cookie.split('=')[1].split('.')[0], row = app.db.raw.prepare('SELECT * FROM community_presence').get();
  assert.deepEqual(Object.keys(row), ['visitor_hash','last_seen']);
  assert.equal(row.visitor_hash, await sign(app.env.COMMUNITY_COOKIE_SECRET, `wiki-presence:${id}`));
  assert.equal(row.last_seen, app.now); assert.notEqual(row.visitor_hash, id);
  assert.deepEqual(result.json, (await app.call('/stats')).json);
});

test('multiple tabs share one visitor; distinct cookies count separately and only heartbeat at thirty minutes', async (t) => {
  const app = context(); t.after(() => app.close()); await app.call('/config');
  const original = app.cookie, baseTime = app.now;
  const results = await Promise.all(Array.from({length:4}, () => app.call('/presence', {body:{}, headers:{Cookie:original}})));
  assert.ok(results.every(result => result.status === 200 && result.json.onlineVisitors === 1));
  app.now += 1_799_999; await app.call('/presence', {body:{}});
  assert.equal(app.db.raw.prepare('SELECT last_seen FROM community_presence').get().last_seen, baseTime);
  app.now++; await app.call('/presence', {body:{}});
  assert.equal(app.db.raw.prepare('SELECT last_seen FROM community_presence').get().last_seen, baseTime + 1_800_000);
  app.cookie = ''; await app.call('/config');
  assert.equal((await app.call('/presence', {body:{}})).json.onlineVisitors, 2);
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_presence').get().n, 2);
  app.now += 1_800_000;
  assert.equal((await app.call('/stats')).json.onlineVisitors, 0);
  assert.equal((await app.call('/presence', {body:{}, headers:{Cookie:original}})).json.onlineVisitors, 1);
});

test('presence rejects cross-site requests, wrong methods and client-provided identity or timestamps', async (t) => {
  const app = context(); t.after(() => app.close()); await app.call('/config');
  for (const headers of [{Origin:'https://other.test'}, {Origin:''}, {'sec-fetch-site':'cross-site'}])
    assert.equal((await app.call('/presence', {body:{},headers})).status, 403);
  for (const method of ['GET','PUT','PATCH','DELETE','OPTIONS']) {
    const result = await app.call('/presence', {method});
    assert.equal(result.status, 405); assert.equal(result.headers.get('set-cookie'), null);
  }
  for (const method of ['POST','PUT','DELETE','PATCH','OPTIONS']) assert.equal((await app.call('/stats', {method})).status, 405);
  for (const body of [{visitorId:'another'}, {lastSeen:Date.now()}, {onlineVisitors:100}, '[]', 'null'])
    assert.equal((await app.call('/presence', {body})).status, 400);
  assert.equal((await app.call('/presence', {body:{}, headers:{'Content-Type':'text/plain'}})).status, 415);
  assert.equal((await app.call('/presence', {body:{text:'x'.repeat(128)}})).status, 413);
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_presence').get().n, 0);
});

test('presence uses the production signed cookie without administrator or Turnstile privileges', async (t) => {
  const app = context({production:true, fetch:() => {throw new Error('No external calls expected');}}); t.after(() => app.close());
  await app.call('/config'); assert.match(app.cookie, /^__Host-wf_community_visitor=/);
  const result = await app.call('/presence', {body:{}});
  assert.equal(result.status, 200); assert.equal(result.json.onlineVisitors, 1);
  assert.equal(result.headers.get('set-cookie'), null);
  assert.equal((await app.call('/admin/teams')).status, 401);
  assert.equal((await app.call('/stats', {headers:{Cookie:'', 'CF-Connecting-IP':''}})).status, 200);
});

test('presence rate limit is bounded per network and expired limit cleanup is bounded', async (t) => {
  const app = context({production:true}); t.after(() => app.close()); await app.call('/config');
  const expires = Math.floor(app.now / 60_000) * 60_000 + 60_000;
  const key = `presence:${await sign(app.env.COMMUNITY_IP_SALT, `${expires}:192.0.2.1`)}`;
  app.db.raw.prepare('INSERT INTO community_limits VALUES(?,?,?)').run(key, 300, expires);
  const denied = await app.call('/presence', {body:{}});
  assert.equal(denied.status, 429); assert.equal(denied.json.error, 'rate_limited');
  assert.equal(Number(denied.headers.get('retry-after')), Math.ceil((expires - app.now) / 1000));
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_presence').get().n, 0);
  app.now = expires;
  for (let i = 0; i < 1250; i++) app.db.raw.prepare('INSERT INTO community_limits VALUES(?,?,?)').run(`expired-${i}`, 1, app.now - 1);
  const accepted = await app.call('/presence', {body:{}});
  assert.equal(accepted.status, 200); assert.equal(accepted.json.onlineVisitors, 1);
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_limits WHERE key LIKE ?').get('expired-%').n, 250);
});
