import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {startLocalServer} from '../local-server.mjs';
import {fixtureCatalog, submission} from './helpers.mjs';

test('真实loopback HTTP + SQLite：静态MIME/Range、显式开发管理员、并发去重', async (t) => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'wf-wiki-community-test-'));
  await writeFile(path.join(folder, 'index.html'), '<!doctype html><title>Wiki test</title>');
  await writeFile(path.join(folder, 'data.js'), 'window.WF_WIKI={};');
  await writeFile(path.join(folder, 'voice.mp3'), Buffer.from([0, 1, 2, 3, 4, 5]));
  const app = await startLocalServer({site: folder, db: path.join(folder, 'test.sqlite'), trustedCatalog: fixtureCatalog});
  t.after(async () => {await app.close(); await rm(folder, {recursive: true, force: true});});
  const get = (route, options) => fetch(app.origin + route, options);
  assert.match((await get('/data.js')).headers.get('Content-Type'), /javascript/);
  const audio = await get('/voice.mp3', {headers: {Range: 'bytes=1-3'}});
  assert.equal(audio.status, 206); assert.deepEqual([...new Uint8Array(await audio.arrayBuffer())], [1, 2, 3]);
  const hostile = await new Promise((resolve, reject) => {
    const request = http.get(app.origin + '/api/community/config', {headers: {Host: 'evil.example'}}, (response) => {response.resume(); resolve(response.statusCode);});
    request.on('error', reject);
  });
  assert.equal(hostile, 403);
  const headers = {Origin: app.origin, 'Content-Type': 'application/json'};
  assert.equal((await get('/api/community/admin/teams', {method: 'POST', headers, body: JSON.stringify(submission())})).status, 401);
  const login = await get('/api/community/development-admin-login', {method: 'POST', headers, body: '{}'});
  headers.Cookie = login.headers.get('Set-Cookie').split(';')[0];
  const results = await Promise.all(Array.from({length: 8}, () => get('/api/community/admin/teams', {method: 'POST', headers, body: JSON.stringify(submission())})));
  assert.equal(results.filter((r) => r.status === 201).length, 1); assert.equal(results.filter((r) => r.status === 409).length, 7);
  assert.equal((await (await get('/api/community/teams')).json()).items.length, 1);
});
