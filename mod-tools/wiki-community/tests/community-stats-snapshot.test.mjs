import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openDatabase} from '../sqlite-adapter.mjs';
import {createParticipationCounter} from '../community-stats-counts.mjs';
import {readParticipationSnapshot} from '../community-stats-snapshot.mjs';
import {context, fixtureCatalog} from './helpers.mjs';

function rate(app, visitor) {
  app.db.raw.prepare('INSERT INTO community_character_ratings VALUES(?,?,?,?,?)').run('c0', visitor, 5, '2026-09-30', app.now);
}
function blockedScans(db) {
  let enter, release, scans = 0;
  const entered = new Promise(resolve => {enter = resolve;});
  const gate = new Promise(resolve => {release = resolve;});
  return {entered, release, get scans() {return scans;}, prepare(sql) {
    const statement = db.prepare(sql);
    if (!/SELECT (?:character_id,visitor_id,score|visitor_id,rows_json) FROM/.test(sql)) return statement;
    return {...statement, async all() {scans++; enter(); await gate; return statement.all();}};
  }};
}

test('cold contenders never all scan, and same-counter callers share one result', async (t) => {
  const app = context(); t.after(() => app.close()); rate(app, 'first');
  const db = blockedScans(app.db), counter = createParticipationCounter();
  const winner = counter(db, fixtureCatalog, app.now); await db.entered;
  const contenders = await Promise.allSettled(Array.from({length:8}, () => createParticipationCounter()(db, fixtureCatalog, app.now)));
  assert.ok(contenders.every(result => result.status === 'rejected' && result.reason.code === 'stats_refreshing'));
  const sameInstance = Array.from({length:8}, () => counter(db, fixtureCatalog, app.now));
  db.release();
  assert.equal((await winner).totalVoters, 1);
  assert.ok((await Promise.all(sameInstance)).every(result => result.totalVoters === 1));
  assert.equal(db.scans, 2);
});

test('vote changes during a scan cannot publish a mixed revision; stale reads stay marked', async (t) => {
  const app = context(); t.after(() => app.close()); rate(app, 'first');
  await createParticipationCounter()(app.db, fixtureCatalog, app.now);
  rate(app, 'second');
  const db = blockedScans(app.db), now = app.now + 60_000;
  const winner = createParticipationCounter()(db, fixtureCatalog, now); await db.entered;
  const old = await createParticipationCounter()(app.db, fixtureCatalog, now);
  assert.equal(old.totalVoters, 1); assert.equal(old.participationStale, true);
  rate(app, 'third'); db.release();
  const rejectedScan = await winner;
  assert.equal(rejectedScan.totalVoters, 1); assert.equal(rejectedScan.participationStale, true);
  const saved = app.db.raw.prepare('SELECT * FROM community_participation_snapshots').get();
  assert.equal(saved.total_voters, 1); assert.equal(saved.lease_owner, null); assert.equal(saved.refresh_after, now + 60_000);
  const rebuilt = await createParticipationCounter()(app.db, fixtureCatalog, now + 60_000);
  assert.equal(rebuilt.totalVoters, 3); assert.equal(rebuilt.participationStale, false);
});

test('late refresh cannot commit through, or release, a replacement lease', async (t) => {
  const app = context(); t.after(() => app.close()); rate(app, 'first');
  await createParticipationCounter()(app.db, fixtureCatalog, app.now); rate(app, 'second');
  const db = blockedScans(app.db), now = app.now + 60_000;
  const pending = createParticipationCounter()(db, fixtureCatalog, now); await db.entered;
  app.db.raw.prepare('UPDATE community_participation_snapshots SET lease_owner=?,lease_until=?').run('successor', now + 30000);
  db.release();
  assert.equal((await pending).totalVoters, 1);
  const saved = app.db.raw.prepare('SELECT * FROM community_participation_snapshots').get();
  assert.equal(saved.lease_owner, 'successor'); assert.equal(saved.total_voters, 1);
});

test('expired lease cannot publish and cold worker death remains bounded until next refresh', async (t) => {
  const app = context(); t.after(() => app.close()); rate(app, 'first');
  const db = blockedScans(app.db), pending = createParticipationCounter()(db, fixtureCatalog, app.now);
  await db.entered;
  app.db.raw.prepare('UPDATE community_participation_snapshots SET lease_until=?').run(app.now - 1);
  db.release(); await assert.rejects(pending, error => error.code === 'stats_refreshing');
  await assert.rejects(createParticipationCounter()(app.db, fixtureCatalog, app.now + 59_999), error => error.code === 'stats_refreshing');
  assert.equal((await createParticipationCounter()(app.db, fixtureCatalog, app.now + 60_000)).totalVoters, 1);
});

test('0011 is reentrant, preserves every old table and installs automatically on local reopen', async (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), 'wf-participation-migration-'));
  t.after(() => rmSync(folder, {recursive:true, force:true}));
  const file = path.join(folder, 'legacy.sqlite'), raw = new DatabaseSync(file);
  const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  const [legacy, additions] = schema.split('-- Internal aggregate cache only;');
  raw.exec(legacy);
  raw.exec("INSERT INTO community_character_ratings VALUES('c0','visitor',5,'2026-09-30',1)");
  const names = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name);
  const snapshot = () => names.map(name => raw.prepare(`SELECT * FROM ${name}`).all());
  const before = snapshot(), migration = readFileSync(new URL('../migrations/0011-participation-snapshots.sql', import.meta.url), 'utf8');
  assert.equal(`-- Internal aggregate cache only;${additions}`.split('-- Maintenance cadence only:')[0].trim(), migration.trim());
  raw.exec(migration); raw.exec(migration); assert.deepEqual(snapshot(), before);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'community_participation_%'").get().n, 6);
  assert.equal(raw.prepare('SELECT revision FROM community_participation_revision').get().revision, 0);
  raw.exec('PRAGMA integrity_check'); assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(), []);
  for (const name of raw.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'community_participation_%'").all()) raw.exec(`DROP TRIGGER ${name.name}`);
  raw.exec('DROP TABLE community_participation_snapshots; DROP TABLE community_participation_revision;'); raw.close();
  const reopened = openDatabase(file);
  try {assert.equal((await createParticipationCounter()(reopened, fixtureCatalog, Date.now())).totalVoters, 1);}
  finally {reopened.close();}
});

test('each inserted, updated or deleted vote invalidates once and preserves changes() semantics', async (t) => {
  const app = context(); t.after(() => app.close());
  const statements = [
    "INSERT INTO community_character_ratings VALUES('c0','v',0,'day',1)",
    "UPDATE community_character_ratings SET score=5 WHERE visitor_id='v'",
    "DELETE FROM community_character_ratings WHERE visitor_id='v'",
    `INSERT INTO community_tier_rankings VALUES('v','{"tier0":["c0"]}','day',1)`,
    `UPDATE community_tier_rankings SET rows_json='{}' WHERE visitor_id='v'`,
    "DELETE FROM community_tier_rankings WHERE visitor_id='v'"
  ];
  statements.forEach((sql, i) => {
    app.db.raw.exec(sql);
    assert.equal(app.db.raw.prepare('SELECT revision FROM community_participation_revision').get().revision, i + 1);
    assert.equal(app.db.raw.prepare('SELECT changes() n').get().n, 1);
  });
});

test('new snapshots reject partial, fractional and invalid-date payloads', (t) => {
  const app = context(); t.after(() => app.close());
  const insert = app.db.raw.prepare(`INSERT INTO community_participation_snapshots
    (catalog_hash,revision,rating_voters,tier_voters,total_voters,computed_at) VALUES('bad',0,?,?,?,?)`);
  for (const values of [[null,0,0,app.now], [0,null,0,app.now], [0,0,null,app.now],
    [0.5,0,1,app.now], [0,0,0,8_700_000_000_000_000], [0,0,0,-1]]) {
    assert.throws(() => insert.run(...values), /CHECK constraint failed/);
  }
});

test('legacy invalid snapshots rebuild at the same revision without bypassing cooldown or lease', async (t) => {
  const app = context(); t.after(() => app.close());
  // Simulate a cache created by an older schema with weaker payload checks.
  app.db.raw.exec(`DROP TABLE community_participation_snapshots;
    CREATE TABLE community_participation_snapshots (
      catalog_hash TEXT PRIMARY KEY,revision INTEGER NOT NULL DEFAULT -1,
      rating_voters INTEGER,tier_voters INTEGER,total_voters INTEGER,computed_at INTEGER,
      refresh_after INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,lease_owner TEXT)`);
  let scans = 0;
  const compute = async () => {scans++; return {ratingVoters:1,tierVoters:1,totalVoters:1};};
  for (const [key, rating, computedAt] of [['partial',null,app.now], ['date',0,8_700_000_000_000_000]]) {
    app.db.raw.prepare(`INSERT INTO community_participation_snapshots
      (catalog_hash,revision,rating_voters,tier_voters,total_voters,computed_at,refresh_after,lease_until)
      VALUES(?,0,?,0,0,?,?,?)`).run(key, rating, computedAt, app.now + 60_000, app.now + 90_000);
    for (const now of [app.now, app.now + 60_000]) {
      await assert.rejects(readParticipationSnapshot(app.db, key, now, compute), error => error.code === 'stats_refreshing');
    }
    const before = scans, rebuilt = await readParticipationSnapshot(app.db, key, app.now + 90_000, compute);
    assert.equal(scans, before + 1); assert.equal(rebuilt.totalVoters, 1);
    assert.equal(rebuilt.participationStale, false);
    assert.equal(rebuilt.participationAsOf, new Date(app.now + 90_000).toISOString());
    await readParticipationSnapshot(app.db, key, app.now + 90_001, compute);
    assert.equal(scans, before + 1);
  }
});
