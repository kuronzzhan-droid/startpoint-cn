import test from 'node:test';
import assert from 'node:assert/strict';
import {privacyContext} from './privacy-helpers.mjs';

test('alias routes require real admin authentication and same origin; guest sees no actor data', async (t) => {
  const app = await privacyContext(t), path = '/admin/aliases/character/c0';
  assert.deepEqual((await app.call('/aliases')).json, {items: []});
  assert.equal((await app.call(path)).status, 401);
  assert.equal((await app.call(path, {method: 'PATCH', body: {aliases: ['伪造'], expectedRevision: 0},
    headers: {'Cf-Access-Authenticated-User-Email': 'owner@example.test', 'X-Role': 'owner'}})).status, 401);
  app.as('editor-a');
  assert.deepEqual((await app.call(path)).json, {kind: 'character', id: 'c0', aliases: [], revision: 0});
  assert.equal((await app.call(path, {method: 'PATCH', body: {aliases: ['无效跨站'], expectedRevision: 0}, headers: {Origin: 'https://evil.test'}})).status, 403);
  const updated = await app.call(path, {method: 'PATCH', body: {aliases: ['团长'], expectedRevision: 0}});
  assert.equal(updated.status, 200); assert.equal(updated.json.revision, 1); assert.ok(!updated.json.item);
  app.as('guest'); const listed = (await app.call('/aliases')).json;
  assert.deepEqual(listed.items, [updated.json]); assert.ok(!/actor|email|editor-a|updated/.test(JSON.stringify(listed)));
  assert.equal((await app.call('/aliases', {method: 'PATCH', body: {aliases: ['游客写入'], expectedRevision: 1}})).status, 404);
});

test('all three verified admin roles can edit or clear and stale revision or unknown targets fail', async (t) => {
  const app = await privacyContext(t), path = '/admin/aliases/weapon/w0';
  let revision = 0;
  for (const role of ['editor-a', 'deputy', 'owner']) {
    app.as(role);
    const result = await app.call(path, {method: 'PATCH', body: {aliases: [role], expectedRevision: revision}});
    assert.equal(result.status, 200); revision++; assert.equal(result.json.revision, revision);
  }
  assert.equal((await app.call(path, {method: 'PATCH', body: {aliases: ['过期编辑'], expectedRevision: 0}})).json.error, 'edit_conflict');
  for (const target of ['/admin/aliases/weapon/c0', '/admin/aliases/character/missing', '/admin/aliases/other/w0'])
    assert.equal((await app.call(target, {method: 'PATCH', body: {aliases: ['不存在'], expectedRevision: 0}})).status, 404);
  const cleared = await app.call(path, {method: 'PATCH', body: {aliases: [], expectedRevision: revision}});
  assert.equal(cleared.json.revision, revision + 1); assert.deepEqual(cleared.json.aliases, []);
  assert.deepEqual((await app.call('/aliases')).json, {items: []});
  assert.equal(app.db.raw.prepare('SELECT count(*) n FROM community_alias_audit').get().n, 4);
});

test('XSS and SQL-looking aliases stay bounded JSON strings and writes obey ordinary admin rate limiting', async (t) => {
  const app = await privacyContext(t); app.as('editor-a');
  const path = '/admin/aliases/character/c0', strings = ['<script>alert(1)</script>', "x');DROP TABLE users;--", '😀'.repeat(32)];
  const result = await app.call(path, {method: 'PATCH', body: {aliases: strings, expectedRevision: 0}});
  assert.equal(result.status, 200); assert.match(result.headers.get('Content-Type'), /application\/json/);
  assert.equal(result.headers.get('X-Content-Type-Options'), 'nosniff'); assert.deepEqual(result.json.aliases, strings);
  assert.equal((await app.call(path, {method: 'PATCH', body: {aliases: ['😀'.repeat(33)], expectedRevision: 1}})).status, 400);
  assert.equal((await app.call(path, {method: 'PATCH', body: {aliases: ['伪造'], expectedRevision: 1, actor_id: 'owner'}})).json.error, 'invalid_fields');
  app.db.raw.prepare("UPDATE community_limits SET count=120 WHERE key LIKE 'admin:%'").run();
  assert.equal((await app.call(path, {method: 'PATCH', body: {aliases: ['限频后'], expectedRevision: 1}})).status, 429);
  assert.deepEqual((await app.call(path)).json.aliases, strings);
  assert.equal(app.db.raw.prepare('SELECT count(*) n FROM community_alias_audit').get().n, 1);
});
