import test from 'node:test';
import assert from 'node:assert/strict';
import {context, envFor} from './helpers.mjs';
import {privacyContext} from './privacy-helpers.mjs';
import {openDatabase} from '../sqlite-adapter.mjs';
import {createCommunityHandler} from '../handler.mjs';
const path = '/tier-rankings';
const token = async (app, action = 'submit_tier_ranking') => (await app.call(`/development-challenge?action=${action}`)).json.token;
const submit = async (app, rows = {between0: ['c0']}) => app.call(path, {body: {rows, turnstileToken: await token(app)}});

test('anonymous board submission uses signed own identity and cookie reset never exposes somebody else’s board', async (t) => {
  const app = context(); t.after(() => app.close()); const initial = await app.call(`${path}/me`);
  assert.equal(initial.json.submittedToday, false); assert.equal(initial.json.challengeAction, 'submit_tier_ranking');
  assert.match(initial.headers.get('Set-Cookie'), /HttpOnly; SameSite=Strict/);
  const accepted = await submit(app); assert.equal(accepted.status, 200); assert.equal(accepted.json.rankedCharacters, 1);
  app.cookie = ''; const reset = await app.call(`${path}/me`);
  assert.equal(reset.json.rankedCharacters, 0); assert.equal(reset.json.submittedToday, true);
  const repeated = await submit(app); assert.equal(repeated.status, 409); assert.equal(repeated.json.error, 'already_ranked');
  const {error, message, ...own} = repeated.json; assert.deepEqual(own, reset.json);
  assert.ok(!/visitor|claim|192\.0\./.test(JSON.stringify(own)));
});

test('invalid rows, forged identity, wrong method, oversized payload and cross-origin writes change no votes', async (t) => {
  const app = context(); t.after(() => app.close());
  for (const rows of [null, [], {pool: ['c0']}, {tier0: ['unknown']}, {tier0: ['c0', 'c0']}])
    assert.equal((await app.call(path, {body: {rows}})).status, 400);
  assert.equal((await app.call(path, {body: {rows: {}, visitorId: 'other'}})).json.error, 'invalid_fields');
  assert.equal((await app.call(path, {method: 'PUT', body: {rows: {}}})).status, 405);
  assert.equal((await app.call(`${path}/me`, {body: {rows: {}}})).status, 405);
  assert.equal((await app.call(`${path}/unknown`)).status, 404);
  assert.equal((await app.call('/tier-rankings-extra')).status, 404);
  assert.equal((await app.call(path, {body: {rows: {}, turnstileToken: 'x'.repeat(33000)}})).status, 413);
  assert.equal((await app.call(path, {body: {rows: {}}, headers: {Origin: 'https://evil.test'}})).status, 403);
  assert.equal(app.db.raw.prepare('SELECT count(*) n FROM community_tier_rankings').get().n, 0);
});

test('Turnstile is required, action-specific and single-use; existing character ratings stay independent', async (t) => {
  const app = context(); t.after(() => app.close());
  assert.equal((await app.call(path, {body: {rows: {}}})).json.error, 'challenge_required');
  assert.equal((await app.call(path, {body: {rows: {}, turnstileToken: await token(app, 'rate_character')}})).json.error, 'challenge_failed');
  const single = await token(app); assert.equal((await app.call(path, {body: {rows: {tier0: ['c0']}, turnstileToken: single}})).status, 200);
  assert.equal((await app.call(path, {body: {rows: {}, turnstileToken: single}})).json.error, 'challenge_failed');
  const rating = await app.call('/ratings/characters/c0', {body: {score: 0, turnstileToken: await token(app, 'rate_character')}});
  assert.equal(rating.status, 200); assert.equal(rating.json.average, 0);
  const before = (await app.call(path)).json.rankings;
  assert.deepEqual(before.placement, [{id: 'c0', average: 5, voters: 1, rankScore: 20 / 6, row: 'between1'}]);
  assert.deepEqual(before.rating, [{id: 'c0', average: 0, voters: 1, rankScore: 12.5 / 6, row: 'tier3'}]);
  app.now = Date.parse('2026-09-29T16:00:00Z'); assert.equal((await submit(app, {})).json.rankedCharacters, 0);
  const summary = (await app.call(path)).json.rankings;
  assert.deepEqual(summary.placement, []); assert.deepEqual(summary.rating, before.rating);
});

test('administrator identity does not bypass daily or hourly limits; blocked requests write no extra board', async (t) => {
  const app = await privacyContext(t); app.as('owner');
  assert.equal((await submit(app)).status, 200); assert.equal((await submit(app)).json.error, 'already_ranked');
  app.db.raw.prepare("UPDATE community_limits SET count=120 WHERE key LIKE 'tier_ranking:%'").run();
  const limited = await submit(app, {}); assert.equal(limited.status, 429); assert.ok(limited.headers.get('Retry-After'));
  assert.equal(app.db.raw.prepare('SELECT count(*) n FROM community_tier_rankings').get().n, 1);
  assert.equal(app.db.raw.prepare('SELECT count(*) n FROM community_tier_ranking_claims').get().n, 1);
});

test('production verifies hostname/action and trusted client IP; changing IP cannot resubmit an existing identity', async (t) => {
  let action = 'rate_character', hostname = 'wiki.example';
  const app = context({production: true, fetch: async () => Response.json({success: true, action, hostname})}); t.after(() => app.close());
  const send = (headers = {}) => app.call(path, {body: {rows: {tier0: ['c0']}, turnstileToken: 'fixture'}, headers});
  assert.equal((await send()).status, 403); action = 'submit_tier_ranking'; hostname = 'evil.example';
  assert.equal((await send()).status, 403); hostname = 'wiki.example'; assert.equal((await send()).status, 200);
  const first = app.cookie; assert.match(first, /__Host-wf_community_visitor=/);
  app.cookie = ''; assert.equal((await app.call(`${path}/me`)).json.submittedToday, true);
  assert.equal((await send({'CF-Connecting-IP': '192.0.2.2'})).status, 200);
  app.cookie = first; assert.equal((await send({'CF-Connecting-IP': '192.0.2.2'})).json.error, 'already_ranked');
  assert.equal((await app.call(`${path}/me`, {headers: {'CF-Connecting-IP': ''}})).status, 503);
  assert.equal((await app.call(path)).json.rankings.placement[0].voters, 2);
});

test('a complete 572-character board with the maximum verification token uses a fixed three-statement transaction', async (t) => {
  const db = openDatabase(); t.after(() => db.close()); const queries = [], batches = [];
  const counted = {...db, prepare(sql) {queries.push(sql); return db.prepare(sql);}, batch(statements) {batches.push(statements.length); return db.batch(statements);}};
  const env = envFor(counted), ids = Array.from({length: 572}, (_, index) => `c${index.toString(16).padStart(12, '0')}`);
  const catalog = {characters: Object.fromEntries(ids.map((id) => [id, {element: '火'}])), equipment: {}, elements: ['火']};
  const handle = createCommunityHandler(catalog, {fetch: async () => Response.json({success: true, action: 'submit_tier_ranking', hostname: 'wiki.example'})});
  const body = JSON.stringify({rows: {tier0: ids}, turnstileToken: 'x'.repeat(2048)});
  assert.ok(Buffer.byteLength(body) < 16384);
  const result = await handle(new Request('https://wiki.example/api/community/tier-rankings', {
    method: 'POST', headers: {Origin: 'https://wiki.example', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1'}, body
  }), env);
  assert.equal(result.status, 200); assert.equal((await result.json()).rankedCharacters, 572);
  assert.deepEqual(batches, [3]); assert.equal(queries.length, 6);
  queries.length = 0;
  const summary = await handle(new Request('https://wiki.example/api/community/tier-rankings'), env);
  const resultBoards = (await summary.json()).rankings;
  assert.equal(resultBoards.placement.length, 572); assert.deepEqual(resultBoards.rating, []); assert.equal(queries.length, 2);
});

test('a later character score updates only the rating board and keeps one vote per player', async (t) => {
  const app = context(); t.after(() => app.close()); await submit(app);
  const rate = async (score) => app.call('/ratings/characters/c0', {body: {score, turnstileToken: await token(app, 'rate_character')}});
  assert.equal((await rate(2)).status, 200);
  const before = (await app.call(path)).json.rankings;
  assert.equal(before.rating[0].average, 2); assert.equal(before.rating[0].rankScore, 14.5 / 6);
  app.now = Date.parse('2026-09-29T16:00:00Z'); assert.equal((await rate(5)).status, 200);
  const updated = (await app.call(path)).json.rankings;
  assert.deepEqual(updated.placement, before.placement);
  assert.equal(updated.rating[0].average, 5); assert.equal(updated.rating[0].rankScore, 17.5 / 6); assert.equal(updated.rating[0].voters, 1);
  assert.equal(app.db.raw.prepare('SELECT count(*) n FROM community_character_ratings').get().n, 1);
  assert.equal(app.db.raw.prepare('SELECT count(*) n FROM community_tier_rankings').get().n, 1);
});
