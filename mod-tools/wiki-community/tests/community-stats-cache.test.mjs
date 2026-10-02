import test from 'node:test';
import assert from 'node:assert/strict';
import {communityStats, PRESENCE_WINDOW_SECONDS} from '../community-stats.mjs';
import {createParticipationCounter} from '../community-stats-counts.mjs';
import {context, fixtureCatalog} from './helpers.mjs';

const voteSQL = /SELECT (?:character_id,visitor_id,score|visitor_id,rows_json) FROM/;
function measured(db, before = () => {}) {
  const queries = [];
  return {queries, prepare(sql) {queries.push(sql); before(sql); return db.prepare(sql);}};
}
function rate(app, id = 'c0', visitor = 'visitor') {
  app.db.raw.prepare('INSERT INTO community_character_ratings VALUES(?,?,?,?,?)').run(id, visitor, 5, '2026-09-30', app.now);
}

test('dirty snapshot waits sixty seconds, marks old counts stale and leaves online counts current', async (t) => {
  const app = context(); t.after(() => app.close());
  const db = measured(app.db), start = app.now;
  assert.equal((await communityStats(db, fixtureCatalog, start)).totalVoters, 0);
  rate(app); app.db.raw.prepare('INSERT INTO community_presence VALUES(?,?)').run('current', start);
  const old = await communityStats(db, fixtureCatalog, start + 59_999);
  assert.equal(old.totalVoters, 0); assert.equal(old.onlineVisitors, 1); assert.equal(old.participationStale, true);
  assert.equal(old.participationAsOf, new Date(start).toISOString());
  assert.equal(db.queries.filter(sql => voteSQL.test(sql)).length, 2);
  const fresh = await communityStats(db, fixtureCatalog, start + 60_000);
  assert.equal(fresh.totalVoters, 1); assert.equal(fresh.participationStale, false);
  assert.equal(db.queries.filter(sql => voteSQL.test(sql)).length, 4);
  const unchanged = await communityStats(db, fixtureCatalog, start + PRESENCE_WINDOW_SECONDS * 1000 + 1);
  assert.equal(unchanged.onlineVisitors, 0); assert.equal(unchanged.totalVoters, 1);
  assert.equal(db.queries.filter(sql => voteSQL.test(sql)).length, 4, 'unchanged votes do not expire into a rescan');
});

test('new counter instances reuse the database snapshot and catalogue hashes ignore object/order identity', async (t) => {
  const app = context(); t.after(() => app.close()); rate(app);
  const db = measured(app.db);
  assert.equal((await createParticipationCounter()(db, fixtureCatalog, app.now)).totalVoters, 1);
  for (let index = 0; index < 8; index++) {
    const clone = {characters:Object.fromEntries(Object.entries(fixtureCatalog.characters).reverse())};
    assert.equal((await createParticipationCounter()(db, clone, app.now + 86400_000)).totalVoters, 1);
  }
  assert.equal(db.queries.filter(sql => voteSQL.test(sql)).length, 2);
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_participation_snapshots').get().n, 1);
});

test('catalogue membership and database identities cannot share counts', async (t) => {
  const first = context(), second = context(); t.after(() => {first.close(); second.close();}); rate(first);
  const counter = createParticipationCounter(), catalog = {characters:{c0:{}}};
  assert.equal((await counter(first.db, catalog, first.now)).totalVoters, 1);
  delete catalog.characters.c0;
  assert.equal((await counter(first.db, catalog, first.now)).totalVoters, 0);
  assert.equal((await counter(second.db, fixtureCatalog, first.now)).totalVoters, 0);
});

test('editing and removing contributions rebuilds counts instead of accumulating old voters', async (t) => {
  const app = context(); t.after(() => app.close()); rate(app);
  app.db.raw.prepare('INSERT INTO community_tier_rankings VALUES(?,?,?,?)').run('ranker', '{"tier0":["c1"]}', 'day', app.now);
  const counter = createParticipationCounter();
  assert.equal((await counter(app.db, fixtureCatalog, app.now)).totalVoters, 2);
  app.db.raw.exec("UPDATE community_character_ratings SET character_id='removed'; UPDATE community_tier_rankings SET rows_json='{}';");
  assert.equal((await counter(app.db, fixtureCatalog, app.now + 60_000)).totalVoters, 0);
  app.db.raw.exec(`UPDATE community_character_ratings SET character_id='c0',score=0;
    UPDATE community_tier_rankings SET rows_json='{"tier0":["c0"]}';`);
  assert.equal((await counter(app.db, fixtureCatalog, app.now + 120_000)).totalVoters, 2);
  app.db.raw.exec('DELETE FROM community_character_ratings; DELETE FROM community_tier_rankings;');
  assert.equal((await counter(app.db, fixtureCatalog, app.now + 180_000)).totalVoters, 0);
});

test('failed refresh returns an explicitly stale snapshot and suppresses rescans for sixty seconds', async (t) => {
  const app = context(); t.after(() => app.close()); rate(app);
  let broken = false;
  const db = measured(app.db, sql => {if (broken && voteSQL.test(sql)) throw new Error('fixture scan unavailable');});
  const counter = createParticipationCounter();
  assert.equal((await counter(db, fixtureCatalog, app.now)).totalVoters, 1);
  rate(app, 'c1', 'second'); broken = true;
  const stale = await counter(db, fixtureCatalog, app.now + 60_000);
  assert.equal(stale.totalVoters, 1); assert.equal(stale.participationStale, true);
  const scans = db.queries.filter(sql => voteSQL.test(sql)).length;
  broken = false;
  assert.equal((await counter(db, fixtureCatalog, app.now + 119_999)).totalVoters, 1);
  assert.equal(db.queries.filter(sql => voteSQL.test(sql)).length, scans);
  assert.equal((await counter(db, fixtureCatalog, app.now + 120_000)).totalVoters, 2);
});

test('cold scan failure cannot become a zero count or a per-request retry storm', async (t) => {
  const app = context(); t.after(() => app.close());
  let broken = true;
  const db = measured(app.db, sql => {if (broken && voteSQL.test(sql)) throw new Error('fixture scan unavailable');});
  await assert.rejects(createParticipationCounter()(db, fixtureCatalog, app.now), /fixture scan unavailable/);
  broken = false;
  for (let i = 0; i < 5; i++) await assert.rejects(createParticipationCounter()(db, fixtureCatalog, app.now + 1000),
    error => error.code === 'stats_refreshing' && error.extra.retryAfter === 59);
  assert.equal(db.queries.filter(sql => voteSQL.test(sql)).length, 2);
  assert.equal((await createParticipationCounter()(db, fixtureCatalog, app.now + 60_000)).totalVoters, 0);
});

test('malformed or non-object tier documents do not create participants', async (t) => {
  const app = context(); t.after(() => app.close());
  const documents = ['bad-json', 'null', '[]', '"text"', '{"invented":["c0"]}', '{"tier0":"c0"}',
    '{"tier0":[{},1,null,"gone","__proto__"]}', '{"tier0":["c0"]}'];
  app.db.raw.exec('PRAGMA ignore_check_constraints=ON');
  documents.forEach((rows, i) => app.db.raw.prepare('INSERT INTO community_tier_rankings VALUES(?,?,?,?)').run(`v${i}`, rows, '2026-09-30', app.now));
  app.db.raw.exec('PRAGMA ignore_check_constraints=OFF');
  const result = await createParticipationCounter()(app.db, fixtureCatalog, app.now);
  assert.equal(result.totalVoters, 1); assert.equal(result.tierVoters, 1); assert.equal(result.ratingVoters, 0);
});

test('synchronous query failures have no unhandled promise rejections', async () => {
  const broken = {prepare() {throw new Error('fixture synchronous database failure');}};
  await assert.rejects(communityStats(broken, fixtureCatalog, 1_000), /fixture synchronous database failure/);
  await new Promise(resolve => setImmediate(resolve));
});
