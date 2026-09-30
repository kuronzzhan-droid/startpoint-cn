import test from 'node:test';
import assert from 'node:assert/strict';
import {context, fixtureCatalog} from './helpers.mjs';
import {listCharacterRatings, readRating} from '../character-ratings.mjs';

function seed(app, id, visitor, score) {
  app.db.raw.prepare('INSERT INTO community_character_ratings(character_id,visitor_id,score,vote_day,updated_at) VALUES(?,?,?,?,?)')
    .run(id, visitor, score, '2026-09-30', app.now);
}

test('public batch summary starts empty and preserves real zero ratings without visitor-specific state', async (t) => {
  const app = context(); t.after(() => app.close());
  const empty = await app.call('/ratings/characters');
  assert.deepEqual(empty.json, {items: []}); assert.equal(empty.headers.get('Set-Cookie'), null); assert.equal(app.cookie, '');
  seed(app, 'c0', 'private-visitor-a', 0);
  seed(app, 'c1', 'private-visitor-a', 2); seed(app, 'c1', 'private-visitor-b', 3);
  const response = await app.call('/ratings/characters');
  assert.equal(response.status, 200); assert.equal(response.headers.get('Set-Cookie'), null);
  assert.deepEqual(response.json, {items: [
    {id: 'c0', average: 0, voters: 1, rankScore: 12.5 / 6},
    {id: 'c1', average: 2.5, voters: 2, rankScore: 2.5}
  ]});
  assert.ok(!/visitor|myScore|ratedToday|nextVoteAt|claim|vote_day|updated_at/.test(JSON.stringify(response.json)));
  app.cookie = '';
  assert.deepEqual((await app.call('/ratings/characters', {headers: {'CF-Connecting-IP': '198.51.100.20'}})).json, response.json);
});

test('one GROUP BY query excludes uncollected targets and invalid scores and reflects latest-score replacement', async (t) => {
  const app = context(); t.after(() => app.close());
  seed(app, 'c0', 'first', 1); seed(app, 'c0', 'second', 2); seed(app, 'c0', 'third', 2);
  for (const id of ['unknown-character', 'w0', '__proto__']) seed(app, id, 'first', 5);
  app.db.raw.exec('PRAGMA ignore_check_constraints=ON');
  seed(app, 'c3', 'bad-score', 7); seed(app, 'c4', 'bad-score', 2.5);
  app.db.raw.exec('PRAGMA ignore_check_constraints=OFF');
  const queries = [], counted = {prepare(sql) {queries.push(sql); return app.db.prepare(sql);}};
  const result = await listCharacterRatings(counted, fixtureCatalog);
  assert.deepEqual(result, {items: [{id: 'c0', average: 1.67, voters: 3, rankScore: 17.5 / 8}]});
  assert.equal(queries.length, 1); assert.match(queries[0], /GROUP BY character_id/);
  app.db.raw.prepare('UPDATE community_character_ratings SET score=4 WHERE character_id=? AND visitor_id=?').run('c0', 'first');
  assert.deepEqual((await app.call('/ratings/characters')).json, {items: [{id: 'c0', average: 2.67, voters: 3, rankScore: 20.5 / 8}]});
  assert.deepEqual(await listCharacterRatings(app.db, {...fixtureCatalog, characters: {}}), {items: []});
});

test('summary route is read-only while original per-character GET and POST continue to work', async (t) => {
  const app = context(); t.after(() => app.close());
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    const response = await app.call('/ratings/characters', {method, body: {score: 5}});
    assert.equal(response.status, 405); assert.equal(response.json.error, 'method_not_allowed');
  }
  assert.equal((await app.call('/ratings/characters-extra')).status, 404);
  const empty = (await app.call('/ratings/characters/c0')).json;
  assert.equal(empty.voters, 0); assert.equal(empty.average, null); assert.equal(empty.rankScore, null);
  const token = (await app.call('/development-challenge?action=rate_character')).json.token;
  const vote = await app.call('/ratings/characters/c0', {body: {score: 5, turnstileToken: token}});
  assert.equal(vote.status, 200); assert.equal(vote.json.rankScore, 17.5 / 6);
  assert.deepEqual((await app.call('/ratings/characters/')).json, {items: [{id: 'c0', average: 5, voters: 1, rankScore: 17.5 / 6}]});
  const detail = (await app.call('/ratings/characters/c0')).json;
  assert.equal(detail.myScore, 5); assert.equal(detail.rankScore, vote.json.rankScore); assert.equal(detail.ratedToday, true);
  assert.equal(app.db.raw.prepare('SELECT count(*) n FROM community_character_ratings').get().n, 1);
});

test('detail scoring uses the unrounded average within its existing single query and retains personal state', async (t) => {
  const app = context(); t.after(() => app.close());
  seed(app, 'c0', 'first', 1); seed(app, 'c0', 'second', 2); seed(app, 'c0', 'third', 2);
  const queries = [], counted = {prepare(sql) {queries.push(sql); return app.db.prepare(sql);}};
  const result = await readRating(counted, 'c0', 'first', {day: '2026-09-30', claimKey: 'unused', nextVoteAt: 1234});
  assert.equal(queries.length, 1);
  assert.deepEqual(result, {average: 1.67, voters: 3, rankScore: 17.5 / 8, myScore: 1, ratedToday: true, nextVoteAt: 1234});
});

test('a delayed first summary cannot replace a detail rating cookie or add a second vote next day', async (t) => {
  const app = context(); t.after(() => app.close());
  let release, entered;
  const gate = new Promise((resolve) => {release = resolve;});
  const started = new Promise((resolve) => {entered = resolve;});
  app.env.COMMUNITY_DB = {...app.db, prepare(sql) {
    const statement = app.db.prepare(sql);
    return /GROUP BY character_id/.test(sql) ? {...statement, async all() {entered(); await gate; return statement.all();}} : statement;
  }};
  const pending = app.call('/ratings/characters');
  try {
    await started;
    const detail = await app.call('/ratings/characters/c0');
    assert.equal(detail.json.myScore, null); assert.match(detail.headers.get('Set-Cookie'), /wf_community_visitor_dev=/);
    const token = (await app.call('/development-challenge?action=rate_character')).json.token;
    const zero = await app.call('/ratings/characters/c0', {body: {score: 0, turnstileToken: token}});
    assert.equal(zero.json.voters, 1); assert.equal(zero.json.myScore, 0); assert.equal(zero.json.rankScore, 12.5 / 6);
    const ratingCookie = app.cookie;
    release(); const summary = await pending;
    assert.equal(summary.headers.get('Set-Cookie'), null); assert.equal(app.cookie, ratingCookie);
    app.now = Date.parse('2026-09-29T16:00:00Z');
    const nextDay = await app.call('/ratings/characters/c0');
    assert.equal(nextDay.json.ratedToday, false); assert.equal(nextDay.json.myScore, 0);
    const nextToken = (await app.call('/development-challenge?action=rate_character')).json.token;
    const replacement = await app.call('/ratings/characters/c0', {body: {score: 5, turnstileToken: nextToken}});
    assert.equal(replacement.status, 200); assert.equal(replacement.json.average, 5);
    assert.equal(replacement.json.voters, 1); assert.equal(replacement.json.myScore, 5); assert.equal(replacement.json.rankScore, 17.5 / 6);
    assert.equal(app.db.raw.prepare('SELECT count(*) n FROM community_character_ratings').get().n, 1);
  } finally {release(); await pending;}
});
