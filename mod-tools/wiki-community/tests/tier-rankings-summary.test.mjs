import test from 'node:test';
import assert from 'node:assert/strict';
import {context, fixtureCatalog} from './helpers.mjs';
import {listTierRankings} from '../tier-rankings.mjs';
import {listTierPlacements} from '../tier-ranking-store.mjs';

function rank(app, visitor, rows) {
  app.db.raw.prepare('INSERT INTO community_tier_rankings VALUES(?,?,?,?)').run(visitor, JSON.stringify(rows), '2026-09-30', app.now);
}
function rate(app, id, visitor, score) {
  app.db.raw.prepare('INSERT INTO community_character_ratings VALUES(?,?,?,?,?)').run(id, visitor, score, '2026-09-30', app.now);
}
const formula = {method: 'bayesian', priorVoters: 5, placementPrior: 3, ratingPrior: 2.5,
  tierMethod: 'raw-average', minimumTierVoters: 3};

test('public boards keep independent sources, raw displayed averages and zero votes without filling missing sources', async (t) => {
  const app = context(); t.after(() => app.close());
  const empty = (await app.call('/tier-rankings')).json;
  assert.deepEqual(empty.rankings, {placement: [], rating: []}); assert.deepEqual(empty.formula, formula);
  rank(app, 'a', {tier0: ['c0'], between0: ['c1'], between1: ['c3']});
  rate(app, 'c0', 'a', 0); rate(app, 'c2', 'a', 0); rate(app, 'c3', 'a', 5);
  assert.deepEqual((await app.call('/tier-rankings')).json, empty);
  app.now = Date.parse(empty.nextRefreshAt);
  const result = await app.call('/tier-rankings'); assert.equal(result.status, 200);
  assert.deepEqual(result.json.rankings, {
    placement: [
      {id: 'c0', average: 5, voters: 1, rankScore: 20 / 6, row: 'provisional'},
      {id: 'c1', average: 4.5, voters: 1, rankScore: 19.5 / 6, row: 'provisional'},
      {id: 'c3', average: 3.5, voters: 1, rankScore: 18.5 / 6, row: 'provisional'}
    ],
    rating: [
      {id: 'c3', average: 5, voters: 1, rankScore: 17.5 / 6, row: 'provisional'},
      {id: 'c0', average: 0, voters: 1, rankScore: 12.5 / 6, row: 'provisional'},
      {id: 'c2', average: 0, voters: 1, rankScore: 12.5 / 6, row: 'provisional'}
    ]
  });
  assert.deepEqual(result.json.formula, formula);
  assert.equal(result.headers.get('Set-Cookie'), null); assert.equal(app.cookie, '');
  assert.ok(!/visitor|claim|myScore|submittedToday|updatedAt|nextVoteAt|compositeScore|missingSources/.test(JSON.stringify(result.json)));
  rate(app, 'c0', 'b', 5);
  assert.deepEqual((await app.call('/tier-rankings')).json.rankings, result.json.rankings);
  app.now += 86400_000;
  const changed = (await app.call('/tier-rankings')).json.rankings;
  assert.deepEqual(changed.placement, result.json.rankings.placement);
  assert.notDeepEqual(changed.rating, result.json.rankings.rating);
  rank(app, 'b', {tier4: ['c3']});
  assert.deepEqual((await app.call('/tier-rankings')).json.rankings, changed);
  app.now += 86400_000;
  const placementChanged = (await app.call('/tier-rankings')).json.rankings;
  assert.notDeepEqual(placementChanged.placement, changed.placement);
  assert.deepEqual(placementChanged.rating, changed.rating);
});

test('established high and low scores outrank single extreme votes according to adjusted scores', async (t) => {
  const app = context(); t.after(() => app.close());
  rank(app, 'single', {tier0: ['c0'], tier4: ['c2']});
  rate(app, 'c0', 'single', 5); rate(app, 'c2', 'single', 0);
  for (let i = 0; i < 100; i++) {
    rank(app, `many-${i}`, {between0: ['c1'], tier4: ['c3']});
    rate(app, 'c1', `many-${i}`, i < 50 ? 4 : 5); rate(app, 'c3', `many-${i}`, 1);
  }
  const {rankings} = await listTierRankings(app.db, fixtureCatalog);
  assert.deepEqual(rankings.placement.map((item) => item.id), ['c1', 'c0', 'c2', 'c3']);
  assert.deepEqual(rankings.rating.map((item) => item.id), ['c1', 'c0', 'c2', 'c3']);
  assert.equal(rankings.rating[0].average, 4.5); assert.equal(rankings.rating[0].rankScore, 462.5 / 105);
  assert.equal(rankings.rating[2].average, 0); assert.equal(rankings.rating[3].average, 1);
});

test('equal adjusted scores prefer their own voter counts, then public ID, regardless of the other board', async (t) => {
  const app = context(); t.after(() => app.close());
  rank(app, 'a', {tier2: ['c0', 'c1', 'c2', 'c3']}); rank(app, 'b', {tier2: ['c3']});
  for (const id of ['c0', 'c1', 'c2']) {rate(app, id, 'a', 2); rate(app, id, 'b', 3);}
  rate(app, 'c2', 'c', 2); rate(app, 'c2', 'd', 3);
  const {rankings} = await listTierRankings(app.db, fixtureCatalog);
  assert.deepEqual(rankings.placement.map((item) => item.id), ['c3', 'c0', 'c1', 'c2']);
  assert.deepEqual(rankings.rating.map((item) => item.id), ['c2', 'c0', 'c1']);
  assert.ok(rankings.placement.every((item) => item.rankScore === 3));
  assert.ok(rankings.rating.every((item) => item.rankScore === 2.5));
});

test('raw averages determine tier boundaries before display rounding without extra SQL', async (t) => {
  const app = context(); t.after(() => app.close());
  for (let i = 0; i < 1000; i++) {
    const rows = {tier1: [], between1: []};
    rows[i < 499 ? 'tier1' : 'between1'].push('c0');
    rows[i < 501 ? 'tier1' : 'between1'].push('c1');
    rank(app, `visitor-${i}`, rows);
    rate(app, 'c2', `visitor-${i}`, i < 749 ? 5 : 4);
    rate(app, 'c3', `visitor-${i}`, i < 751 ? 5 : 4);
  }
  const queries = [], counted = {prepare(sql) {queries.push(sql); return app.db.prepare(sql);}};
  const {rankings} = await listTierRankings(counted, fixtureCatalog);
  assert.equal(queries.length, 2); assert.ok(queries.every((sql) => /GROUP BY/.test(sql)));
  assert.deepEqual(rankings.placement, [
    {id: 'c1', average: 3.75, voters: 1000, rankScore: 3765.5 / 1005, row: 'tier1'},
    {id: 'c0', average: 3.75, voters: 1000, rankScore: 3764.5 / 1005, row: 'between1'}
  ]);
  assert.deepEqual(rankings.rating, [
    {id: 'c3', average: 4.75, voters: 1000, rankScore: 4763.5 / 1005, row: 'tier0'},
    {id: 'c2', average: 4.75, voters: 1000, rankScore: 4761.5 / 1005, row: 'between0'}
  ]);
  const legacy = await listTierPlacements(app.db, fixtureCatalog);
  assert.deepEqual(legacy, [{id: 'c0', average: 3.75, voters: 1000}, {id: 'c1', average: 3.75, voters: 1000}]);
  const adjusted = await listTierPlacements(app.db, fixtureCatalog, {includeRankScore: true});
  assert.equal(adjusted.find((item) => item.id === 'c0').rankScore, 3764.5 / 1005);
});

test('aggregation counts each visitor at most once despite malformed legacy rows and excludes removed IDs', async (t) => {
  const app = context(); t.after(() => app.close());
  rank(app, 'a', {tier0: ['c0', 'c0', 'unknown', '__proto__'], tier1: ['c0'], between0: 'c1', bad: ['c2']});
  rate(app, 'unknown', 'a', 5);
  const {rankings} = await listTierRankings(app.db, fixtureCatalog);
  assert.deepEqual(rankings, {placement: [{id: 'c0', average: 5, voters: 1, rankScore: 20 / 6, row: 'provisional'}], rating: []});
});

test('third vote qualifies each source independently and two votes remain provisional at both extremes', async (t) => {
  const app = context(); t.after(() => app.close());
  for (let i = 0; i < 2; i++) {
    rank(app, `v${i}`, {tier0: ['c0'], tier4: ['c1']});
    rate(app, 'c0', `v${i}`, 0); rate(app, 'c1', `v${i}`, 5);
  }
  let {rankings} = await listTierRankings(app.db, fixtureCatalog);
  assert.ok([...rankings.placement, ...rankings.rating].every(item => item.row === 'provisional'));
  rank(app, 'v2', {tier0: ['c0'], tier4: ['c1']});
  rankings = (await listTierRankings(app.db, fixtureCatalog)).rankings;
  assert.equal(rankings.placement.find(item => item.id === 'c0').row, 'tier0');
  assert.equal(rankings.placement.find(item => item.id === 'c1').row, 'tier4');
  assert.ok(rankings.rating.every(item => item.row === 'provisional'));
  rate(app, 'c0', 'v2', 0); rate(app, 'c1', 'v2', 5);
  rankings = (await listTierRankings(app.db, fixtureCatalog)).rankings;
  assert.equal(rankings.rating.find(item => item.id === 'c0').row, 'tier4');
  assert.equal(rankings.rating.find(item => item.id === 'c1').row, 'tier0');
  app.db.raw.prepare("UPDATE community_tier_rankings SET rows_json='{}' WHERE visitor_id='v2'").run();
  rankings = (await listTierRankings(app.db, fixtureCatalog)).rankings;
  assert.ok(rankings.placement.every(item => item.row === 'provisional'));
  assert.ok(rankings.rating.every(item => item.row !== 'provisional'));
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
    const {rankings} = (await app.call('/tier-rankings')).json;
    assert.equal(rankings.placement[0].voters, 1); assert.equal(rankings.placement[0].average, 1);
    assert.deepEqual(rankings.rating, []);
  } finally {release(); await pending;}
});
