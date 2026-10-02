import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startLocalServer} from '../local-server.mjs';
import {fixtureCatalog} from './helpers.mjs';

test('real loopback HTTP accepts an 18KB valid board and keeps all other JSON routes at 16KB', async (t) => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'wf-wiki-tier-ranking-'));
  assert.equal(path.dirname(folder), path.resolve(os.tmpdir())); assert.ok(path.basename(folder).startsWith('wf-wiki-tier-ranking-'));
  await writeFile(path.join(folder, 'index.html'), '<title>Isolated tier ranking test</title>');
  const app = await startLocalServer({site: folder, db: ':memory:', authMode: 'access', trustedCatalog: fixtureCatalog});
  t.after(async () => {await app.close(); await rm(folder, {recursive: true, force: true});});
  const headers = {Origin: app.origin, 'Content-Type': 'application/json'};
  const own = await fetch(`${app.origin}/api/community/tier-rankings/me`);
  headers.Cookie = own.headers.get('set-cookie').split(';')[0];
  const token = async () => (await (await fetch(`${app.origin}/api/community/development-challenge?action=submit_tier_ranking`)).json()).token;
  const post = (route, body, method = 'POST') => fetch(`${app.origin}/api/community${route}`, {method, headers, body});
  const body = JSON.stringify({rows: {tier0: ['c0']}, turnstileToken: await token()}).padEnd(18000, ' ');
  assert.equal(Buffer.byteLength(body), 18000);
  const accepted = await post('/tier-rankings', body);
  assert.equal(accepted.status, 200); assert.equal((await accepted.json()).rankedCharacters, 1);
  for (const route of ['/ratings/characters/c0', '/admin/teams', '/tier-rankings/me', '/tier-rankings-extra'])
    assert.equal((await post(route, body)).status, 413, route);
  assert.equal((await post('/tier-rankings', body, 'PATCH')).status, 413);
  const maximum = JSON.stringify({rows: {}, turnstileToken: await token()}).padEnd(32768, ' ');
  const daily = await post('/tier-rankings/', maximum);
  assert.equal(daily.status, 409); assert.equal((await daily.json()).error, 'already_ranked');
  assert.equal((await post('/tier-rankings', maximum + ' ')).status, 413);
  assert.equal(app.database.raw.prepare('SELECT count(*) n FROM community_tier_rankings').get().n, 1);
  assert.equal(app.database.raw.prepare('SELECT count(*) n FROM community_character_ratings').get().n, 0);
});
