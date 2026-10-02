import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../sqlite-adapter.mjs';
import {createDailyRankingReader, readDailyRankingSnapshot} from '../daily-ranking-snapshot.mjs';
import {listTierRankings} from '../tier-rankings.mjs';
import {fixtureCatalog} from './helpers.mjs';

const start = Date.parse('2026-10-02T04:00:00Z'), midnight = Date.parse('2026-10-02T16:00:00Z');
const migration = readFileSync(new URL('../migrations/0013-daily-ranking-snapshot.sql', import.meta.url), 'utf8');
function database(t) {
  const db = openDatabase(); db.raw.exec(migration); t.after(() => db.close()); return db;
}
function rate(db, visitor, score = 5) {
  db.raw.prepare('INSERT INTO community_character_ratings VALUES(?,?,?,?,?)').run('c0', visitor, score, '2026-10-02', start);
}
function rank(db, visitor, rows = {tier0:['c0']}) {
  db.raw.prepare('INSERT INTO community_tier_rankings VALUES(?,?,?,?)').run(visitor, JSON.stringify(rows), '2026-10-02', start);
}
function gateScan(db) {
  let enter, release, scans = 0;
  const entered = new Promise(resolve => {enter = resolve;}), gate = new Promise(resolve => {release = resolve;});
  return {entered, release, get scans() {return scans;}, prepare(sql) {
    const statement = db.prepare(sql);
    if (!/GROUP BY/.test(sql)) return statement;
    return {...statement, async all() {scans++; enter(); await gate; return statement.all();}};
  }};
}

test('one persisted snapshot covers both sources and remains unchanged until Beijing midnight across cold readers', async t => {
  const db = database(t); rate(db, 'first'); rank(db, 'first');
  let scans = 0;
  const compute = (connection, catalog) => {scans++; return listTierRankings(connection, catalog);};
  const today = await createDailyRankingReader({compute})(db, fixtureCatalog, start);
  assert.equal(today.asOf, '2026-10-02T04:00:00.000Z'); assert.equal(today.nextRefreshAt, '2026-10-02T16:00:00.000Z');
  assert.equal(today.refreshDay, '2026-10-02'); assert.equal(today.stale, false);
  assert.equal(today.rankings.placement[0].average, 5); assert.equal(today.rankings.rating[0].average, 5);
  rate(db, 'second', 0); rank(db, 'second', {tier4:['c0']});
  assert.deepEqual(await createDailyRankingReader({compute})(db, fixtureCatalog, midnight - 1), today);
  assert.equal(scans, 1);
  const tomorrow = await createDailyRankingReader({compute})(db, fixtureCatalog, midnight);
  assert.equal(scans, 2); assert.equal(tomorrow.refreshDay, '2026-10-03');
  assert.equal(tomorrow.rankings.placement[0].average, 3); assert.equal(tomorrow.rankings.rating[0].average, 2.5);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM community_daily_ranking_snapshots').get().n, 1);
});

test('same reader coalesces while cold workers do not scan through a live persisted lease', async t => {
  const raw = database(t); rate(raw, 'first');
  const db = gateScan(raw), reader = createDailyRankingReader(), first = reader(db, fixtureCatalog, start);
  await db.entered;
  const competitors = await Promise.allSettled(Array.from({length:5}, () => createDailyRankingReader()(db, fixtureCatalog, start)));
  assert.ok(competitors.every(result => result.status === 'rejected' && result.reason.code === 'rankings_refreshing'));
  const joined = Array.from({length:5}, () => reader(db, fixtureCatalog, start));
  db.release();
  const saved = await first;
  assert.ok((await Promise.all(joined)).every(value => value.asOf === saved.asOf)); assert.equal(db.scans, 2);
});

test('new day serves previous marked snapshot while one worker refreshes', async t => {
  const raw = database(t); rate(raw, 'first');
  await createDailyRankingReader()(raw, fixtureCatalog, start); rate(raw, 'second');
  const db = gateScan(raw), first = createDailyRankingReader()(db, fixtureCatalog, midnight);
  await db.entered;
  const old = await createDailyRankingReader()(raw, fixtureCatalog, midnight);
  assert.equal(old.stale, true); assert.equal(old.rankings.rating[0].voters, 1);
  db.release();
  const updated = await first; assert.equal(updated.stale, false); assert.equal(updated.rankings.rating[0].voters, 2);
});

test('failed scans retain previous data with persisted backoff instead of repeated whole-vote reads', async t => {
  const db = database(t); rate(db, 'first');
  await createDailyRankingReader()(db, fixtureCatalog, start);
  let failures = 0;
  const compute = () => {failures++; throw new Error('database busy');};
  const result = await createDailyRankingReader({compute})(db, fixtureCatalog, midnight);
  assert.equal(result.stale, true); assert.equal(failures, 1);
  await createDailyRankingReader({compute})(db, fixtureCatalog, midnight + 59_999); assert.equal(failures, 1);
  await createDailyRankingReader({compute})(db, fixtureCatalog, midnight + 60_000); assert.equal(failures, 2);
  assert.equal(db.raw.prepare('SELECT lease_owner FROM community_daily_ranking_snapshots').get().lease_owner, null);
});

test('first-scan failure and expired lease cannot invent an empty board or scan continuously', async t => {
  const db = database(t);
  await assert.rejects(readDailyRankingSnapshot(db, 'first', start, async () => {throw new Error('scan failed');}), /scan failed/);
  await assert.rejects(readDailyRankingSnapshot(db, 'first', start + 59_999, async () => {assert.fail('backoff');}), error => error.code === 'rankings_refreshing');
  const blocked = gateScan(db), pending = readDailyRankingSnapshot(blocked, 'expired', start, () => listTierRankings(blocked, fixtureCatalog));
  await blocked.entered;
  db.raw.prepare("UPDATE community_daily_ranking_snapshots SET lease_until=? WHERE catalog_hash='expired'").run(start - 1);
  blocked.release(); await assert.rejects(pending, error => error.code === 'rankings_refreshing');
  assert.equal(db.raw.prepare("SELECT payload_json FROM community_daily_ranking_snapshots WHERE catalog_hash='expired'").get().payload_json, null);
});

test('late publishers cannot overwrite or release replacement leases', async t => {
  const db = database(t), blocked = gateScan(db), pending = readDailyRankingSnapshot(blocked, 'owner', start, () => listTierRankings(blocked, fixtureCatalog));
  await blocked.entered;
  db.raw.prepare("UPDATE community_daily_ranking_snapshots SET lease_owner='successor',lease_until=? WHERE catalog_hash='owner'").run(start + 30_000);
  blocked.release(); await assert.rejects(pending, error => error.code === 'rankings_refreshing');
  assert.equal(db.raw.prepare("SELECT lease_owner FROM community_daily_ranking_snapshots WHERE catalog_hash='owner'").get().lease_owner, 'successor');
});

test('catalogue changes rebuild without publishing removed characters or mixing personal fields', async t => {
  const db = database(t); rate(db, 'first'); rank(db, 'first');
  await createDailyRankingReader()(db, fixtureCatalog, start);
  const catalog = {...fixtureCatalog, characters:{c1:fixtureCatalog.characters.c1}};
  const rebuilt = await createDailyRankingReader()(db, catalog, start);
  assert.deepEqual(rebuilt.rankings, {placement:[], rating:[]});
  assert.ok(!/visitor|myScore|claim|submittedToday/.test(JSON.stringify(rebuilt)));
});

test('edge namespace follows catalogue contents rather than object identity or entry order', async () => {
  const reader = createDailyRankingReader(), original = await reader.cacheKey(fixtureCatalog);
  const reordered = {...fixtureCatalog, characters:Object.fromEntries(Object.entries(fixtureCatalog.characters).reverse())};
  assert.equal(await reader.cacheKey(reordered), original);
  assert.notEqual(await reader.cacheKey({...fixtureCatalog, characters:{c0:fixtureCatalog.characters.c0}}), original);
});

test('malformed stored payload rebuilds after the persisted cooldown instead of becoming a false empty board', async t => {
  const db = database(t); rate(db, 'first');
  await createDailyRankingReader()(db, fixtureCatalog, start);
  db.raw.exec("UPDATE community_daily_ranking_snapshots SET payload_json='{}'");
  await assert.rejects(createDailyRankingReader()(db, fixtureCatalog, start + 59_999), error => error.code === 'rankings_refreshing');
  const rebuilt = await createDailyRankingReader()(db, fixtureCatalog, start + 60_000);
  assert.equal(rebuilt.rankings.rating[0].voters, 1); assert.equal(rebuilt.stale, false);
});

test('migration is reentrant and leaves vote content intact', async t => {
  const db = database(t); rate(db, 'first'); rank(db, 'first');
  const before = db.raw.prepare('SELECT * FROM community_character_ratings').all();
  db.raw.exec(migration); db.raw.exec(migration);
  assert.deepEqual(db.raw.prepare('SELECT * FROM community_character_ratings').all(), before);
  assert.deepEqual(db.raw.prepare('PRAGMA foreign_key_check').all(), []);
});
