import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {context} from './helpers.mjs';
import {sign} from '../codecs.mjs';
import {recordCharacterView, readCharacterViews, VIEW_WINDOW_SECONDS} from '../character-views.mjs';
import {openDatabase} from '../sqlite-adapter.mjs';

const route = '/characters/c0/views', windowMs = VIEW_WINDOW_SECONDS * 1000;

test('view reads do not initialize identities, count or clean expired claims', async t => {
  const app = context(); t.after(() => app.close());
  app.db.raw.prepare('INSERT INTO community_character_view_visitors VALUES(?,?,?)').run('c0', 'expired-hash', app.now - windowMs);
  const before = app.db.raw.prepare('SELECT total_changes() n').get().n;
  const result = await app.call(route, {headers:{'CF-Connecting-IP':''}});
  assert.equal(result.status, 200); assert.equal(result.headers.get('set-cookie'), null);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual(result.json, {characterId:'c0', views:0, windowSeconds:1800});
  assert.equal(app.db.raw.prepare('SELECT total_changes() n').get().n, before);
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_character_views').get().n, 0);
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_character_view_visitors').get().n, 1);
});

test('rolling thirty-minute claims are atomic, character-specific and are not extended by repeats', async t => {
  const app = context(); t.after(() => app.close()); const at = app.now;
  const results = await Promise.all(Array.from({length:16}, () => recordCharacterView(app.db, 'c0', 'a', at)));
  assert.ok(results.every(result => result.views === 1));
  assert.equal((await recordCharacterView(app.db, 'c0', 'b', at)).views, 2);
  assert.equal((await recordCharacterView(app.db, 'c1', 'a', at)).views, 1);
  assert.equal((await recordCharacterView(app.db, 'c0', 'a', at + windowMs - 1)).views, 2);
  assert.equal(app.db.raw.prepare('SELECT last_counted_at FROM community_character_view_visitors WHERE character_id=? AND visitor_hash=?').get('c0','a').last_counted_at, at);
  const next = await Promise.all(Array.from({length:8}, () => recordCharacterView(app.db, 'c0', 'a', at + windowMs)));
  assert.ok(next.every(result => result.views === 3));
  assert.equal((await recordCharacterView(app.db, 'c0', 'a', at - 1)).views, 3, 'an older in-flight request cannot overwrite the latest claim');
});

test('a failed counter increment rolls back its claim and a retry counts once', async t => {
  const app = context(); t.after(() => app.close());
  app.db.raw.exec("CREATE TRIGGER reject_view BEFORE INSERT ON community_character_views BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
  await assert.rejects(recordCharacterView(app.db, 'c0', 'a', app.now));
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_character_view_visitors').get().n, 0);
  assert.equal((await readCharacterViews(app.db, 'c0')).views, 0);
  app.db.raw.exec('DROP TRIGGER reject_view');
  assert.equal((await recordCharacterView(app.db, 'c0', 'a', app.now)).views, 1);
});

test('bounded expiry removes only deduplication records and never reduces cumulative totals', async t => {
  const app = context(); t.after(() => app.close());
  app.db.raw.prepare('INSERT INTO community_character_views VALUES(?,?)').run('c1', 250);
  for (let i = 0; i < 250; i++)
    app.db.raw.prepare('INSERT INTO community_character_view_visitors VALUES(?,?,?)').run('c1', `old-${i}`, app.now - windowMs);
  await recordCharacterView(app.db, 'c0', 'new', app.now);
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_character_view_visitors WHERE character_id=?').get('c1').n, 150);
  await recordCharacterView(app.db, 'c0', 'new', app.now);
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_character_view_visitors WHERE character_id=?').get('c1').n, 150);
  assert.equal((await readCharacterViews(app.db, 'c1')).views, 250);
  assert.equal((await recordCharacterView(app.db, 'c1', 'old-0', app.now)).views, 251);
});

test('HTTP counting requires an existing signed identity and stores only per-character HMACs', async t => {
  const app = context({production:true, fetch:() => {throw new Error('No external requests expected');}}); t.after(() => app.close());
  for (const cookie of ['', '__Host-wf_community_visitor=forged']) {
    const result = await app.call(route, {body:{}, headers:{Cookie:cookie}});
    assert.equal(result.status, 428); assert.equal(result.json.error, 'visitor_required');
    assert.equal(result.headers.get('set-cookie'), null);
  }
  await app.call('/config'); const cookie = app.cookie, id = cookie.split('=')[1].split('.')[0];
  const result = await app.call(route, {body:{}});
  assert.equal(result.status, 200); assert.deepEqual(result.json, {characterId:'c0',views:1,windowSeconds:1800});
  assert.equal(result.headers.get('set-cookie'), null); assert.equal(app.cookie, cookie);
  assert.equal((await app.call(route, {body:{}})).json.views, 1);
  await app.call('/characters/c1/views', {body:{}});
  const claims = app.db.raw.prepare('SELECT * FROM community_character_view_visitors ORDER BY character_id').all();
  assert.deepEqual(Object.keys(claims[0]), ['character_id','visitor_hash','last_counted_at']);
  assert.equal(claims[0].visitor_hash, await sign(app.env.COMMUNITY_COOKIE_SECRET, `character-view:c0:${id}`));
  assert.notEqual(claims[0].visitor_hash, claims[1].visitor_hash);
  assert.ok(!JSON.stringify(claims).includes(id)); assert.ok(!JSON.stringify(claims).includes('192.0.2.1'));
  app.cookie = ''; await app.call('/config');
  assert.equal((await app.call(route, {body:{}})).json.views, 2);
});

test('unknown or invisible characters, cross-origin, wrong methods and extra fields never count', async t => {
  const app = context(); t.after(() => app.close()); await app.call('/config');
  app.db.raw.prepare('INSERT INTO community_character_views VALUES(?,?)').run('not-public', 99);
  for (const id of ['not-public','__proto__','w0','%2f','a'.repeat(41)]) for (const method of ['GET','POST']) {
    const result = await app.call(`/characters/${id}/views`, {method, ...(method === 'POST' ? {body:{}} : {})});
    assert.equal(result.status, 404); assert.equal(result.headers.get('set-cookie'), null);
  }
  for (const headers of [{Origin:'https://other.test'},{Origin:''},{'sec-fetch-site':'cross-site'}])
    assert.equal((await app.call(route, {body:{},headers})).status, 403);
  for (const method of ['PUT','PATCH','DELETE','OPTIONS']) assert.equal((await app.call(route, {method})).status, 405);
  for (const body of [{views:100},{visitorId:'other'},{lastCountedAt:app.now},'[]','null'])
    assert.equal((await app.call(route, {body})).status, 400);
  assert.equal((await app.call(route, {body:{},headers:{'Content-Type':'text/plain'}})).status, 415);
  assert.equal((await app.call(route, {body:{text:'x'.repeat(128)}})).status, 413);
  assert.equal((await app.call(route)).json.views, 0);
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_character_view_visitors').get().n, 0);
});

test('network rate limits bound counting and do not claim a visitor window on rejection', async t => {
  const app = context({production:true}); t.after(() => app.close()); await app.call('/config');
  const expires = Math.floor(app.now / 60_000) * 60_000 + 60_000;
  const key = `character_view:${await sign(app.env.COMMUNITY_IP_SALT, `${expires}:192.0.2.1`)}`;
  app.db.raw.prepare('INSERT INTO community_limits VALUES(?,?,?)').run(key, 120, expires);
  const denied = await app.call(route, {body:{}});
  assert.equal(denied.status, 429); assert.equal(denied.json.error, 'rate_limited');
  assert.equal(Number(denied.headers.get('retry-after')), Math.ceil((expires - app.now) / 1000));
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_character_view_visitors').get().n, 0);
  app.now = expires;
  assert.equal((await app.call(route, {body:{}})).json.views, 1);
});

test('0010 migration is additive, repeatable, matches the schema and local reopen preserves totals', async t => {
  const folder = mkdtempSync(path.join(tmpdir(), 'wf-character-views-'));
  assert.equal(path.dirname(folder), path.resolve(tmpdir()));
  t.after(() => rmSync(folder, {recursive:true, force:true}));
  const file = path.join(folder, 'isolated.sqlite'); let db = openDatabase(file);
  db.raw.exec(`INSERT INTO community_users VALUES('owner','owner@example.test','owner',1,'fixture-hash',1,0,1,1,1);
    INSERT INTO community_teams(id,fingerprint,title,notes,author,team_json,element,damage_mask,status,created_at,updated_at)
      VALUES('team','fingerprint','Existing','Notes','Author','{}','火',1,'approved',1,1);
    INSERT INTO community_likes VALUES('team','visitor','2026-09-30',1);
    INSERT INTO community_game_codes VALUES('23456789ABCD','team','fingerprint',1,NULL);
    INSERT INTO community_character_ratings VALUES('c0','visitor',0,'2026-09-30',1);
    INSERT INTO community_tier_rankings VALUES('visitor','{"tier0":["c0"]}','2026-09-30',1);
    INSERT INTO community_presence VALUES('presence-hash',1);
    DROP TABLE community_character_view_visitors; DROP TABLE community_character_views;`);
  const names = ['community_users','community_teams','community_likes','community_game_codes','community_character_ratings','community_tier_rankings','community_presence'];
  const snapshot = () => names.map(name => db.raw.prepare(`SELECT * FROM ${name}`).all()), before = snapshot();
  const migration = readFileSync(new URL('../migrations/0010-character-views.sql', import.meta.url), 'utf8');
  db.raw.exec(migration); db.raw.exec(migration); assert.deepEqual(snapshot(), before);
  const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  assert.equal(migration.slice(migration.indexOf('CREATE TABLE')).trim(),
    schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS community_character_views'), schema.indexOf('CREATE TABLE IF NOT EXISTS community_dungeon_guides')).trim());
  await recordCharacterView(db, 'c0', 'fixture-hash', Date.now());
  db.close(); db = openDatabase(file);
  try {assert.deepEqual(snapshot(), before); assert.equal((await readCharacterViews(db,'c0')).views, 1);}
  finally {db.close();}
});
