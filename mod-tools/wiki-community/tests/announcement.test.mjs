import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {privacyContext} from './privacy-helpers.mjs';
import {readAnnouncement, updateAnnouncement} from '../announcement.mjs';
import {publicSummary} from '../public-summary-cache.mjs';

const path = '/admin/announcement';
const empty = {text: '', revision: 0, updatedAt: null};
const patch = (app, text, expectedRevision, settings = {}) => app.call(path,
  {method: 'PATCH', body: {text, expectedRevision}, ...settings});
const audits = (app) => app.db.raw.prepare('SELECT * FROM community_announcement_audit ORDER BY created_at').all();

test('public announcement starts empty, never issues a visitor cookie, and denies public writes', async (t) => {
  const app = await privacyContext(t);
  const response = await app.call('/announcement');
  assert.equal(response.status, 200); assert.deepEqual(response.json, empty);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal((await app.call('/announcement', {method: 'PATCH', body: {text: 'guest', expectedRevision: 0}})).status, 405);
  assert.equal((await app.call(path)).status, 401);
  assert.equal((await patch(app, 'forged', 0, {headers: {'X-Role': 'owner', 'Cf-Access-Authenticated-User-Email': 'owner@example.test'}})).status, 401);
  assert.equal(app.db.raw.prepare('SELECT count(*) n FROM community_announcement').get().n, 0);
  assert.equal(app.db.raw.prepare('SELECT count(*) n FROM community_limits').get().n, 0);
});

test('all verified admin roles edit plain text or clear it with audited revisions and no identity leakage', async (t) => {
  const app = await privacyContext(t);
  const values = ['公告第一行\r\n第二行', '<img src=x onerror=alert(1)>', ''];
  for (const [index, role] of ['editor-a', 'deputy', 'owner'].entries()) {
    app.as(role); app.now += 1000;
    const before = await app.call(path);
    assert.equal(before.json.revision, index);
    const response = await patch(app, values[index], index);
    assert.equal(response.status, 200);
    assert.deepEqual(response.json, {text: values[index].replace(/\r\n/g, '\n'), revision: index + 1, updatedAt: app.now});
    app.as('guest');
    const publicResponse = await app.call('/announcement');
    assert.deepEqual(publicResponse.json, response.json);
    assert.equal(publicResponse.headers.get('set-cookie'), null);
    assert.deepEqual(Object.keys(publicResponse.json).sort(), ['revision', 'text', 'updatedAt']);
  }
  const history = audits(app);
  assert.equal(history.length, 3);
  assert.equal(history[0].actor_id, 'editor-a'); assert.equal(history[1].actor_email, 'deputy@example.test');
  assert.deepEqual(JSON.parse(history[0].before_json), empty);
  assert.equal(JSON.parse(history[2].after_json).text, '');
  assert.equal(JSON.parse(history[2].after_json).revision, 3);
});

test('announcement input is bounded Unicode text, normalizes line endings, and rejects unknown fields and revisions', async (t) => {
  const app = await privacyContext(t); app.as('editor-a');
  for (const text of [null, 1, [], {}, '\t', 'a\u0000b', 'a\u001fb', 'a'.repeat(501), '😀'.repeat(501)])
    assert.equal((await patch(app, text, 0)).status, 400, JSON.stringify(text).slice(0, 60));
  for (const expectedRevision of [-1, 0.5, null, '0', Number.MAX_SAFE_INTEGER + 1])
    assert.equal((await patch(app, '正文', expectedRevision)).status, 400);
  assert.equal((await patch(app, '正文', 0, {body: {text: '正文', expectedRevision: 0, actor_id: 'owner'}})).json.error, 'invalid_fields');
  assert.equal((await patch(app, '正文', 0, {body: {expectedRevision: 0}})).status, 400);
  const full = await patch(app, '😀'.repeat(500), 0);
  assert.equal(full.status, 200); assert.equal([...full.json.text].length, 500);
  const normalized = await patch(app, ' \r\n e\u0301\rnext \n ', 1);
  assert.equal(normalized.status, 200); assert.equal(normalized.json.text, 'é\nnext');
  const cleared = await patch(app, ' \n ', 2);
  assert.equal(cleared.status, 200); assert.equal(cleared.json.text, '');
  assert.equal(audits(app).length, 3);
});

test('stale and simultaneous announcement edits cannot overwrite a winner or create phantom audits', async (t) => {
  const app = await privacyContext(t), actor = {id: 'editor-a', email: 'editor-a@example.test'};
  for (const revision of [0, 1]) {
    const results = await Promise.allSettled(['甲', '乙'].map((text) =>
      updateAnnouncement(app.db, {text, expectedRevision: revision}, actor, app.now)));
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'edit_conflict');
  }
  app.as('editor-a');
  assert.equal((await patch(app, '过期覆盖', 0)).status, 409);
  assert.equal((await app.call(path)).json.revision, 2);
  assert.equal(audits(app).length, 2);
  app.db.raw.exec(`CREATE TRIGGER announcement_audit_failure BEFORE INSERT ON community_announcement_audit
    BEGIN SELECT RAISE(ABORT,'test audit failure'); END;`);
  const before = await readAnnouncement(app.db);
  assert.equal((await patch(app, '审计失败的正文', 2)).status, 503);
  assert.deepEqual(await readAnnouncement(app.db), before);
  assert.equal(audits(app).length, 2);
});

test('announcement mutation reuses same-origin, account state and admin rate limits', async (t) => {
  const app = await privacyContext(t); app.as('editor-a');
  assert.equal((await patch(app, '跨域', 0, {headers: {Origin: 'https://evil.example'}})).status, 403);
  assert.equal((await patch(app, '跨域', 0, {headers: {'Sec-Fetch-Site': 'cross-site'}})).status, 403);
  assert.equal((await app.call(path, {method: 'POST', body: {text: 'wrong method', expectedRevision: 0}})).status, 405);
  app.db.raw.prepare("UPDATE community_users SET must_change_password=1 WHERE id='editor-a'").run();
  assert.equal((await patch(app, '待改密', 0)).json.error, 'password_change_required');
  app.db.raw.prepare("UPDATE community_users SET must_change_password=0,enabled=0 WHERE id='editor-a'").run();
  assert.equal((await patch(app, '已停用', 0)).status, 401);
  app.db.raw.prepare("UPDATE community_users SET enabled=1 WHERE id='editor-a'").run();
  assert.equal((await patch(app, '合法公告', 0)).status, 200);
  app.db.raw.prepare("UPDATE community_limits SET count=120 WHERE key LIKE 'admin:%'").run();
  assert.equal((await patch(app, '超限公告', 1)).status, 429);
  assert.equal((await app.call(path)).json.text, '合法公告');
  assert.equal(audits(app).length, 1);
});

test('additive announcement migration preserves other records and can be repeated without resetting content', async (t) => {
  const app = await privacyContext(t); app.as('editor-a');
  const created = await app.create(); assert.equal(created.status, 201);
  const teams = app.db.raw.prepare('SELECT * FROM community_teams').all();
  const users = app.db.raw.prepare('SELECT * FROM community_users').all();
  app.db.raw.exec('DROP TABLE community_announcement_audit; DROP TABLE community_announcement;');
  const migration = readFileSync(new URL('../migrations/0012-community-announcement.sql', import.meta.url), 'utf8');
  app.db.raw.exec(migration);
  assert.deepEqual(await readAnnouncement(app.db), empty);
  assert.equal((await patch(app, '迁移后公告', 0)).status, 200);
  const before = await readAnnouncement(app.db), history = audits(app);
  app.db.raw.exec(migration);
  assert.deepEqual(await readAnnouncement(app.db), before);
  assert.deepEqual(audits(app), history);
  assert.deepEqual(app.db.raw.prepare('SELECT * FROM community_teams').all(), teams);
  assert.deepEqual(app.db.raw.prepare('SELECT * FROM community_users').all(), users);
  assert.throws(() => app.db.raw.prepare('INSERT INTO community_announcement VALUES(2,?,1,0)').run('多余公告'));
});

test('anonymous announcements share the existing 30-second cache but admin reads bypass it', async () => {
  const values = new Map(), writes = []; let loads = 0;
  const cache = {async match(key) {return values.get(key.url)?.clone();},
    async put(key, value) {writes.push(value.headers.get('Cache-Control')); values.set(key.url, value.clone());}};
  const load = async () => ({text: '公告', revision: ++loads, updatedAt: 1});
  const request = new Request('https://wiki.example/api/community/announcement');
  const results = await Promise.all([publicSummary(request, load, cache), publicSummary(request, load, cache)]);
  assert.equal(loads, 1); assert.deepEqual(results[0], results[1]);
  assert.deepEqual(await publicSummary(request, load, cache), results[0]);
  assert.equal(loads, 1); assert.deepEqual(writes, ['public, max-age=30']);
  const admin = new Request('https://wiki.example/api/community/admin/announcement');
  await publicSummary(admin, load, cache); await publicSummary(admin, load, cache);
  assert.equal(loads, 3); assert.equal(writes.length, 1);
});
