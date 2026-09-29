import test from 'node:test';
import assert from 'node:assert/strict';
import {context} from './helpers.mjs';
import {privacyContext} from './privacy-helpers.mjs';
const path = '/ratings/characters/c0';
async function token(app, action = 'rate_character') {return (await app.call(`/development-challenge?action=${action}`)).json.token;}

test('anonymous HTTP rating returns signed-cookie own state; cookie reset exposes no other voter score', async (t) => {
  const app = context(); t.after(() => app.close());
  const initial = await app.call(path);
  assert.equal(initial.json.average, null); assert.equal(initial.json.voters, 0);
  assert.match(initial.headers.get('Set-Cookie'), /HttpOnly; SameSite=Strict/);
  const response = await app.call(path, {body: {score: 0, turnstileToken: await token(app)}});
  assert.deepEqual(response.json, {average: 0, voters: 1, myScore: 0, ratedToday: true, nextVoteAt: Date.parse('2026-09-29T16:00:00Z')});
  app.cookie = '';
  const reset = await app.call(path); assert.equal(reset.json.myScore, null); assert.equal(reset.json.ratedToday, true);
  const duplicate = await app.call(path, {body: {score: 5, turnstileToken: await token(app)}});
  assert.equal(duplicate.status, 409); assert.equal(duplicate.json.error, 'already_rated');
  const {error, message, ...record} = duplicate.json;
  assert.deepEqual(record, reset.json); assert.ok(!/visitor|claim|192\.0\./.test(JSON.stringify(record)));
});

test('invalid score, target, forged visitor, cross-origin, wrong challenge or replay never changes ratings', async (t) => {
  const app = context(); t.after(() => app.close());
  for (const score of [-1, 6, 1.5, '5', null]) assert.equal((await app.call(path, {body: {score}})).status, 400);
  assert.equal((await app.call('/ratings/characters/missing')).status, 404);
  assert.equal((await app.call('/ratings/weapons/w0')).status, 404);
  assert.equal((await app.call(path, {body: {score: 3, visitorId: 'other'}})).json.error, 'invalid_fields');
  assert.equal((await app.call(path, {body: {score: 3}, headers: {Origin: 'https://evil.test'}})).status, 403);
  assert.equal((await app.call(path, {body: {score: 3}})).json.error, 'challenge_required');
  assert.equal((await app.call(path, {body: {score: 3, turnstileToken: await token(app, 'like_team')}})).json.error, 'challenge_failed');
  assert.equal(app.db.raw.prepare('SELECT count(*) n FROM community_character_ratings').get().n, 0);
  const oneToken = await token(app);
  assert.equal((await app.call(path, {body: {score: 3, turnstileToken: oneToken}})).status, 200);
  assert.equal((await app.call('/ratings/characters/c1', {body: {score: 5, turnstileToken: oneToken}})).json.error, 'challenge_failed');
  assert.equal(app.db.raw.prepare('SELECT count(*) n FROM community_character_ratings').get().n, 1);
});

test('administrator sessions do not bypass public rating limits and rate limiting writes no extra vote', async (t) => {
  const app = await privacyContext(t); app.as('owner');
  assert.equal((await app.call(path, {body: {score: 5, turnstileToken: await token(app)}})).status, 200);
  assert.equal((await app.call(path, {body: {score: 2, turnstileToken: await token(app)}})).json.error, 'already_rated');
  app.db.raw.prepare("UPDATE community_limits SET count=120 WHERE key LIKE 'rating:%'").run();
  assert.equal((await app.call('/ratings/characters/c1', {body: {score: 2, turnstileToken: await token(app)}})).status, 429);
  assert.equal(app.db.raw.prepare('SELECT count(*) n FROM community_character_ratings').get().n, 1);
  assert.equal(app.db.raw.prepare('SELECT count(*) n FROM community_character_rating_claims').get().n, 1);
});

test('production rating checks Turnstile action and hostname and HMACs server-supplied client IP', async (t) => {
  let action = 'like_team';
  const app = context({production: true, fetch: async (request) => {
    assert.equal(String(request), 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    return Response.json({success: true, action, hostname: 'wiki.example'});
  }}); t.after(() => app.close());
  assert.equal((await app.call(path, {body: {score: 4, turnstileToken: 'fixture'}})).status, 403);
  action = 'rate_character';
  assert.equal((await app.call(path, {body: {score: 4, turnstileToken: 'fixture'}})).status, 200);
  const firstCookie = app.cookie;
  app.cookie = ''; assert.equal((await app.call(path)).json.ratedToday, true);
  const nextIp = {'CF-Connecting-IP': '192.0.2.2'};
  assert.equal((await app.call(path, {body: {score: 2, turnstileToken: 'fixture'}, headers: nextIp})).json.voters, 2);
  app.cookie = firstCookie;
  assert.equal((await app.call(path, {body: {score: 1, turnstileToken: 'fixture'}, headers: nextIp})).json.error, 'already_rated');
  assert.equal((await app.call(path, {headers: {'CF-Connecting-IP': ''}})).status, 503);
  assert.ok(!JSON.stringify(app.db.raw.prepare('SELECT * FROM community_character_rating_claims').all()).includes('192.0.2.'));
});
