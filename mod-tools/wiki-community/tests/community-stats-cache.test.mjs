import test from 'node:test';
import assert from 'node:assert/strict';
import {communityStats} from '../community-stats.mjs';
import {createParticipationCounter} from '../community-stats-counts.mjs';
import {context, fixtureCatalog} from './helpers.mjs';

function countedDatabase(db) {
  const queries = [];
  return {queries, prepare(sql) { queries.push(sql); return db.prepare(sql); }};
}

test('participation cache lasts 60 seconds while online visitors remain fresh', async (t) => {
  const app = context(); t.after(() => app.close());
  const db = countedDatabase(app.db), start = app.now;
  assert.equal((await communityStats(db, fixtureCatalog, start)).totalVoters, 0);
  app.db.raw.prepare('INSERT INTO community_character_ratings VALUES(?,?,?,?,?)').run('c0', 'visitor', 5, '2026-09-30', start);
  app.db.raw.prepare('INSERT INTO community_presence VALUES(?,?)').run('current', start);
  const cached = await communityStats(db, fixtureCatalog, start + 59_999);
  assert.equal(cached.totalVoters, 0); assert.equal(cached.onlineVisitors, 1);
  assert.equal(db.queries.length, 4, 'only indexed online COUNT repeats during the voting cache lifetime');
  assert.equal((await communityStats(db, fixtureCatalog, start + 60_000)).totalVoters, 1);
  assert.equal(db.queries.length, 7);
  assert.equal((await communityStats(db, fixtureCatalog, start + 120_001)).onlineVisitors, 0);
});

test('participation caches isolate databases and catalogue identities', async (t) => {
  const first = context(), second = context(); t.after(() => { first.close(); second.close(); });
  first.db.raw.prepare('INSERT INTO community_character_ratings VALUES(?,?,?,?,?)').run('c0', 'visitor', 5, '2026-09-30', first.now);
  const counter = createParticipationCounter();
  assert.equal((await counter(first.db, fixtureCatalog, first.now)).totalVoters, 1);
  assert.equal((await counter(second.db, fixtureCatalog, first.now)).totalVoters, 0);
  assert.equal((await counter(first.db, {characters: {}}, first.now)).totalVoters, 0);
});

test('concurrent cold and expired statistics requests share one voting scan', async () => {
  let release, reads = 0;
  const gate = () => new Promise((resolve) => { release = resolve; });
  let pending = gate();
  const db = {prepare() { return {async all() { reads++; await pending; return {results: []}; }}; }};
  const counter = createParticipationCounter();
  for (const now of [1_000, 61_000]) {
    const before = reads, calls = Array.from({length: 8}, () => counter(db, fixtureCatalog, now));
    await Promise.resolve();
    assert.equal(reads, before + 2); release();
    assert.deepEqual(await Promise.all(calls), Array.from({length: 8}, () => ({ratingVoters:0, tierVoters:0, totalVoters:0})));
    pending = gate();
  }
});

test('synchronous prepare failures join every started query rejection', async () => {
  const broken = {prepare() { throw new Error('fixture synchronous database failure'); }};
  await assert.rejects(communityStats(broken, fixtureCatalog, 1_000), /fixture synchronous database failure/);
  const mixed = {prepare(sql) {
    if (sql.includes('community_tier_rankings')) throw new Error('fixture second prepare failure');
    return {all:async () => { throw new Error('fixture first query failure'); }, bind() { return this; }, first:async () => ({onlineVisitors:0})};
  }};
  await assert.rejects(communityStats(mixed, fixtureCatalog, 1_000), /fixture .* failure/);
  await new Promise((resolve) => setImmediate(resolve));
});

test('expired refresh failures reject without zeroing counts or poisoning later retries', async () => {
  let unavailable = false, scans = 0;
  const db = {prepare(sql) { return {async all() {
    scans++; if (unavailable) throw new Error('fixture database unavailable');
    return {results: sql.includes('community_character_ratings') ? [{character_id:'c0', visitor_id:'v', score:0}] : []};
  }}; }};
  const counter = createParticipationCounter();
  assert.equal((await counter(db, fixtureCatalog, 1_000)).totalVoters, 1);
  unavailable = true;
  await assert.rejects(counter(db, fixtureCatalog, 61_000), /fixture database unavailable/);
  assert.equal(scans, 4);
  unavailable = false;
  assert.equal((await counter(db, fixtureCatalog, 61_001)).totalVoters, 1);
  assert.equal(scans, 6);
  await counter(db, fixtureCatalog, 500);
  assert.equal(scans, 8, 'a backwards clock does not leave future-dated cache entries valid');
});

test('malformed or non-object tier documents do not create participants', async () => {
  const documents = ['bad-json', 'null', '[]', '"text"', '{"invented":["c0"]}', '{"tier0":"c0"}',
    '{"tier0":[{},1,null,"gone","__proto__"]}', '{"tier0":["c0"]}'];
  const db = {prepare(sql) { return {async all() { return {results: sql.includes('community_tier_rankings')
    ? documents.map((rows_json, i) => ({visitor_id:`v${i}`, rows_json})) : []}; }}; }};
  assert.deepEqual(await createParticipationCounter()(db, fixtureCatalog, 1_000), {ratingVoters:0, tierVoters:1, totalVoters:1});
});
