import test from 'node:test';
import assert from 'node:assert/strict';
import {context} from './helpers.mjs';

for (const [route, sqlPattern] of [['/aliases', /FROM community_aliases WHERE/], ['/teams', /SELECT community_teams\.\*/]]) {
  test(`a delayed first ${route} response cannot replace a rating identity or add a second voter next day`, async t => {
    const app = context(); t.after(() => app.close());
    let release, entered;
    const gate = new Promise(resolve => {release = resolve;}), started = new Promise(resolve => {entered = resolve;});
    app.env.COMMUNITY_DB = {...app.db, prepare(sql) {
      const statement = app.db.prepare(sql);
      if (!sqlPattern.test(sql)) return statement;
      const wrap = current => ({...current, bind: (...values) => wrap(current.bind(...values)),
        async all() {entered(); await gate; return current.all();}});
      return wrap(statement);
    }};
    const pending = app.call(route);
    try {
      await started;
      await app.call('/ratings/characters/c0');
      const token = (await app.call('/development-challenge?action=rate_character')).json.token;
      assert.equal((await app.call('/ratings/characters/c0', {body: {score: 0, turnstileToken: token}})).json.voters, 1);
      const ratingCookie = app.cookie;
      release(); const response = await pending;
      assert.equal(response.headers.has('Set-Cookie'), false); assert.ok(app.cookie === ratingCookie);
      app.now += 120_000;
      const nextToken = (await app.call('/development-challenge?action=rate_character')).json.token;
      const next = await app.call('/ratings/characters/c0', {body: {score: 5, turnstileToken: nextToken}});
      assert.equal(next.status, 200); assert.equal(next.json.voters, 1); assert.equal(next.json.average, 5);
      assert.equal(app.db.raw.prepare('SELECT count(*) n FROM community_character_ratings').get().n, 1);
    } finally {release(); await pending;}
  });
}

test('identity-independent reads and errors never create an unrelated visitor cookie', async t => {
  const app = context(); t.after(() => app.close());
  for (const path of ['/aliases', '/teams', '/teams?element=invalid', '/dungeons/missing',
    '/game-codes/23456789ABCD', '/no-such-endpoint', '/admin/teams']) {
    app.cookie = '';
    const result = await app.call(path);
    assert.equal(result.headers.has('Set-Cookie'), false, path);
    assert.equal(app.cookie, '', path);
  }
});

test('config and personal rating endpoints still initialize and reuse visitor identity', async t => {
  const app = context(); t.after(() => app.close());
  const config = await app.call('/config'); assert.match(config.headers.get('Set-Cookie'), /visitor/);
  const cookie = app.cookie;
  assert.equal((await app.call('/ratings/characters/c0')).headers.get('Set-Cookie'), null);
  assert.equal((await app.call('/tier-rankings/me')).headers.get('Set-Cookie'), null);
  assert.equal(app.cookie, cookie);
});
