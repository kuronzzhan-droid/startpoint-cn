import test from 'node:test';
import assert from 'node:assert/strict';
import {context, fixtureCatalog} from './helpers.mjs';
import {listTierRankings} from '../tier-rankings.mjs';

function rank(app, visitor, rows) {
  app.db.raw.prepare('INSERT INTO community_tier_rankings VALUES(?,?,?,?)').run(visitor, JSON.stringify(rows), '2026-09-30', app.now);
}
function rate(app, id, visitor, score) {
  app.db.raw.prepare('INSERT INTO community_character_ratings VALUES(?,?,?,?,?)').run(id, visitor, score, '2026-09-30', app.now);
}
test('dynamic board uses 70/30 weights, falls back to the only available source, preserves zero and omits unvoted characters', async (t) => {
  const app = context(); t.after(() => app.close());
  assert.deepEqual((await app.call('/tier-rankings')).json.items, []);
  rank(app, 'a', {tier0: ['c0'], between0: ['c1'], between1: ['c3']});
  rate(app, 'c0', 'a', 0); rate(app, 'c2', 'a', 0); rate(app, 'c3', 'a', 5);
  const result = await app.call('/tier-rankings'); assert.equal(result.status, 200);
  assert.deepEqual(result.json.formula, {placementWeight: 0.7, ratingWeight: 0.3});
  assert.deepEqual(result.json.items, [
    {id: 'c1', compositeScore: 4.5, row: 'between0', placementAverage: 4.5, placementVoters: 1, ratingAverage: null, ratingVoters: 0, missingSources: ['rating']},
    {id: 'c3', compositeScore: 3.95, row: 'tier1', placementAverage: 3.5, placementVoters: 1, ratingAverage: 5, ratingVoters: 1, missingSources: []},
    {id: 'c0', compositeScore: 3.5, row: 'between1', placementAverage: 5, placementVoters: 1, ratingAverage: 0, ratingVoters: 1, missingSources: []},
    {id: 'c2', compositeScore: 0, row: 'tier4', placementAverage: null, placementVoters: 0, ratingAverage: 0, ratingVoters: 1, missingSources: ['placement']}
  ]);
  assert.equal(result.headers.get('Set-Cookie'), null); assert.equal(app.cookie, '');
  assert.ok(!/visitor|claim|myScore|submittedToday|updatedAt|nextVoteAt/.test(JSON.stringify(result.json)));
});

test('ties prefer placement voters then rating voters and finally stable public ID ordering', async (t) => {
  const app = context(); t.after(() => app.close());
  rank(app, 'a', {tier2: ['c0', 'c1', 'c2', 'c3']}); rank(app, 'b', {tier2: ['c3']});
  for (const id of ['c0', 'c1', 'c2']) rate(app, id, 'a', 3);
  rate(app, 'c2', 'b', 3);
  assert.deepEqual((await listTierRankings(app.db, fixtureCatalog)).items.map((item) => item.id), ['c3', 'c2', 'c0', 'c1']);
});

test('aggregation counts each visitor at most once despite malformed legacy rows and excludes removed IDs', async (t) => {
  const app = context(); t.after(() => app.close());
  rank(app, 'a', {tier0: ['c0', 'c0', 'unknown', '__proto__'], tier1: ['c0'], between0: 'c1', bad: ['c2']});
  rate(app, 'unknown', 'a', 5);
  const result = await listTierRankings(app.db, fixtureCatalog);
  assert.equal(result.items.length, 1); assert.equal(result.items[0].id, 'c0');
  assert.equal(result.items[0].placementVoters, 1); assert.equal(result.items[0].compositeScore, 5);
});

test('delayed aggregate responses cannot replace the cookie used to submit a ranking', async (t) => {
  const app = context(); t.after(() => app.close()); let release, entered;
  const gate = new Promise((resolve) => {release = resolve;});
  const started = new Promise((resolve) => {entered = resolve;});
  app.env.COMMUNITY_DB = {...app.db, prepare(sql) {
    const statement = app.db.prepare(sql);
    return /AVG\(score\).*voters FROM/.test(sql) ? {...statement, async all() {entered(); await gate; return statement.all();}} : statement;
  }};
  const pending = app.call('/tier-rankings');
  try {
    await started; await app.call('/tier-rankings/me');
    const token = (await app.call('/development-challenge?action=submit_tier_ranking')).json.token;
    assert.equal((await app.call('/tier-rankings', {body: {rows: {tier0: ['c0']}, turnstileToken: token}})).status, 200);
    const cookie = app.cookie; release(); const aggregate = await pending;
    assert.equal(aggregate.headers.get('Set-Cookie'), null); assert.equal(app.cookie, cookie);
    app.now = Date.parse('2026-09-29T16:00:00Z');
    const nextToken = (await app.call('/development-challenge?action=submit_tier_ranking')).json.token;
    assert.equal((await app.call('/tier-rankings', {body: {rows: {tier4: ['c0']}, turnstileToken: nextToken}})).status, 200);
    assert.equal((await app.call('/tier-rankings')).json.items[0].placementVoters, 1);
  } finally {release(); await pending;}
});
