import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {context, fixtureCatalog} from './helpers.mjs';
import {communityStats, recordPresence} from '../community-stats.mjs';
import {openDatabase} from '../sqlite-adapter.mjs';

function rating(app, character, visitor, score = 3) {
  app.db.raw.prepare('INSERT INTO community_character_ratings VALUES(?,?,?,?,?)').run(character, visitor, score, '2026-09-30', app.now);
}
function tier(app, visitor, rows) {
  app.db.raw.prepare('INSERT INTO community_tier_rankings VALUES(?,?,?,?)').run(visitor, JSON.stringify(rows), '2026-09-30', app.now);
}

test('anonymous stats are read-only and expose counts with a timestamp, not visitor data', async (t) => {
  const app = context(); t.after(() => app.close());
  app.db.raw.prepare('INSERT INTO community_presence VALUES(?,?)').run('expired-hash', app.now - 120_000);
  app.db.raw.prepare('INSERT INTO community_limits VALUES(?,?,?)').run('old-limit', 1, app.now - 1);
  const before = app.db.raw.prepare('SELECT total_changes() n').get().n;
  const result = await app.call('/stats', {headers:{'CF-Connecting-IP':'', Cookie:''}});
  assert.equal(result.status, 200); assert.equal(result.headers.get('set-cookie'), null); assert.equal(app.cookie, '');
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual(result.json, {ratingVoters:0, tierVoters:0, totalVoters:0, onlineVisitors:0,
    asOf:new Date(app.now).toISOString(), presenceWindowSeconds:120});
  assert.equal(app.db.raw.prepare('SELECT total_changes() n').get().n, before);
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_presence').get().n, 1);
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_limits').get().n, 1);
});

test('participation counts unique visitors for each valid catalogue source and ignore property filters', async (t) => {
  const app = context(); t.after(() => app.close());
  rating(app, 'c0', 'a', 0); rating(app, 'c1', 'a', 5); rating(app, 'c1', 'b', 2);
  rating(app, 'uncollected', 'outside'); rating(app, '__proto__', 'outside-2');
  app.db.raw.exec('PRAGMA ignore_check_constraints=ON');
  rating(app, 'c2', 'bad-score', 6); rating(app, 'c3', 'fractional', 2.5);
  app.db.raw.exec('PRAGMA ignore_check_constraints=OFF');
  tier(app, 'a', {tier0:['c0','c1'],tier1:['c0']});
  tier(app, 'c', {between0:['c2'],tier4:['c3']});
  tier(app, 'empty', {}); tier(app, 'outside', {tier1:['gone']});
  tier(app, 'bad-row', {invented:['c1']}); tier(app, 'bad-array', {tier0:'c1'});
  tier(app, 'bad-id-type', {tier0:[1,{},null]});
  const result = await app.call('/stats?element=火');
  assert.equal(result.status, 200); assert.equal(result.json.ratingVoters, 2); assert.equal(result.json.tierVoters, 2);
  assert.equal(result.json.totalVoters, 3, 'visitor a belongs to both sources and must count only once');
  app.db.raw.prepare('UPDATE community_tier_rankings SET rows_json=? WHERE visitor_id=?').run('{}', 'a');
  app.now += 60_000;
  assert.equal((await app.call('/stats')).json.tierVoters, 1);
  const queries = [], counted = {prepare(sql) {queries.push(sql); return app.db.prepare(sql);}};
  assert.equal((await communityStats(counted, fixtureCatalog, app.now)).ratingVoters, 2);
  assert.equal(queries.length, 3);
  assert.ok(queries.every((sql) => !sql.includes('json_each')));
});

test('online visitors expire at exactly two minutes even without deletion; future data is excluded', async (t) => {
  const app = context(); t.after(() => app.close());
  for (const [hash, seen] of [['current',app.now], ['recent',app.now - 119_999], ['expired',app.now - 120_000], ['future',app.now + 1]])
    app.db.raw.prepare('INSERT INTO community_presence VALUES(?,?)').run(hash, seen);
  assert.equal((await app.call('/stats')).json.onlineVisitors, 2);
  app.now += 120_001;
  assert.equal((await app.call('/stats')).json.onlineVisitors, 0);
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_presence').get().n, 4);
});

test('heartbeat writes are atomically throttled and expired cleanup is bounded', async (t) => {
  const app = context(); t.after(() => app.close());
  await Promise.all(Array.from({length:8}, () => recordPresence(app.db, 'one-visitor', app.now)));
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_presence').get().n, 1);
  for (let i = 0; i < 250; i++) app.db.raw.prepare('INSERT INTO community_presence VALUES(?,?)').run(`old-${i}`, app.now - 120_000);
  const duplicate = await recordPresence(app.db, 'one-visitor', app.now + 29_999);
  assert.equal(duplicate[0].meta.changes, 0); assert.equal(duplicate[1].meta.changes, 0);
  assert.equal(app.db.raw.prepare('SELECT last_seen FROM community_presence WHERE visitor_hash=?').get('one-visitor').last_seen, app.now);
  const updated = await recordPresence(app.db, 'one-visitor', app.now + 30_000);
  assert.equal(updated[0].meta.changes, 1); assert.equal(updated[1].meta.changes, 100);
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_presence').get().n, 151);
});

test('additive presence migration is idempotent, preserves old data and is applied on local reopen', async (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), 'wf-wiki-presence-'));
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
    DROP TABLE community_presence;`);
  const names = ['community_users','community_teams','community_likes','community_game_codes','community_character_ratings','community_tier_rankings'];
  const snapshot = () => names.map(name => db.raw.prepare(`SELECT * FROM ${name}`).all());
  const before = snapshot(), migration = readFileSync(new URL('../migrations/0009-presence.sql', import.meta.url), 'utf8');
  db.raw.exec(migration); db.raw.exec(migration); assert.deepEqual(snapshot(), before);
  const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  assert.equal(migration.slice(migration.indexOf('CREATE TABLE')).trim(),
    schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS community_presence'), schema.indexOf('CREATE TABLE IF NOT EXISTS community_character_views')).trim());
  db.raw.exec('DROP TABLE community_presence'); db.close(); db = openDatabase(file);
  try {
    assert.deepEqual(snapshot(), before);
    assert.equal((await communityStats(db, fixtureCatalog, Date.now())).ratingVoters, 1);
    assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM community_presence').get().n, 0);
  } finally {db.close();}
});
