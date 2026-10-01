import test from 'node:test';
import assert from 'node:assert/strict';
import {privacyContext, privateSubmission} from './privacy-helpers.mjs';
import {fixtureCatalog} from './helpers.mjs';
import {listQuery, nextCursor} from '../model.mjs';

const search = (app, q, extra = {}) => app.call(`/admin/teams?${new URLSearchParams({q, ...extra})}`);
const ids = result => result.json.items.map(item => item.id).sort();
function numberedSubmission(index, extra = {}) {
  const value = privateSubmission(0, {...extra});
  for (let slot = 0; slot < 3; slot++) {
    const variant = Math.floor(index / (3 ** slot)) % 3;
    value.team.weapon[slot] = variant === 0 ? '' : `w${variant - 1}`;
  }
  return value;
}

test('admin search filters the whole result before pagination and preserves category/scope/status filters', async t => {
  const app = await privacyContext(t); app.as('editor-a');
  const old = (await app.create(numberedSubmission(0, {title: '最早的特殊盘'}))).json.team;
  for (let i = 1; i < 27; i++) {
    app.now += 1000;
    assert.equal((await app.create(numberedSubmission(i, {title: `其他盘${i}`}))).status, 201);
  }
  assert.ok(!(await app.call('/admin/teams')).json.items.some(item => item.id === old.id));
  assert.deepEqual(ids(await search(app, '特殊盘', {scope: 'mine', status: 'approved', category: '萌新启航'})), [old.id]);
  assert.deepEqual(ids(await search(app, '特殊盘', {scope: 'public'})), []);
  assert.deepEqual(ids(await search(app, '特殊盘', {category: '玩具盘'})), []);
  const first = await search(app, '其他盘'); assert.equal(first.json.items.length, 24); assert.ok(first.json.nextCursor);
  const second = await search(app, '其他盘', {cursor: first.json.nextCursor}); assert.equal(second.json.items.length, 2);
  assert.equal(new Set([...first.json.items, ...second.json.items].map(item => item.id)).size, 26);
  assert.equal((await search(app, '特殊盘', {cursor: first.json.nextCursor})).json.error, 'invalid_cursor');
  assert.equal((await search(app, '', {cursor: first.json.nextCursor})).json.error, 'invalid_cursor');
});

test('search OR terms cannot bypass private ownership; managers retain the broader scope', async t => {
  const app = await privacyContext(t); app.as('editor-a');
  const other = (await app.create(numberedSubmission(0, {title: '共享关键词', author: '共同作者'}))).json.team;
  const shared = (await app.create(numberedSubmission(1, {title: '共享关键词', author: '共同作者', visibility: 'public'}))).json.team;
  app.as('editor-b');
  const own = (await app.create(numberedSubmission(2, {title: '共享关键词', author: '共同作者'}))).json.team;
  for (const q of ['共享关键词', '共同作者']) {
    assert.deepEqual(ids(await search(app, q)), [shared.id, own.id].sort());
    assert.deepEqual(ids(await search(app, q, {scope: 'mine'})), [own.id]);
    const blocked = await search(app, q, {scope: 'private'}); assert.equal(blocked.status, 403);
  }
  for (const actor of ['owner', 'deputy']) {
    app.as(actor); assert.deepEqual(ids(await search(app, '共同作者')), [other.id, shared.id, own.id].sort());
  }
});

test('active code search follows ownership, visibility, revocation and deletion', async t => {
  const app = await privacyContext(t); app.as('editor-a');
  const item = (await app.create(numberedSubmission(0, {title: '独立队伍'}))).json.team;
  const code = (await app.call(`/admin/teams/${item.id}/game-code`, {body: {expectedRevision: 1}})).json.gameCode;
  assert.deepEqual(ids(await search(app, code.toLowerCase(), {code: 'has'})), [item.id]);
  assert.deepEqual(ids(await search(app, code, {code: 'none'})), []);
  app.as('editor-b'); assert.deepEqual(ids(await search(app, code)), []);
  app.as('owner'); assert.deepEqual(ids(await search(app, code)), [item.id]);
  await app.call(`/admin/teams/${item.id}/game-code/revoke`, {body: {expectedRevision: 1}});
  assert.deepEqual(ids(await search(app, code)), []);
  const next = (await app.call(`/admin/teams/${item.id}/game-code`, {body: {expectedRevision: 1}})).json.gameCode;
  await app.call(`/admin/teams/${item.id}`, {method: 'DELETE', body: {expectedRevision: 1}});
  assert.deepEqual(ids(await search(app, next, {status: 'hidden'})), []);
  assert.deepEqual(ids(await search(app, '独立队伍', {status: 'hidden'})), [item.id]);
  assert.deepEqual(ids(await search(app, '独立队伍', {status: 'approved'})), []);
  app.as('editor-b'); assert.deepEqual(ids(await search(app, '独立队伍', {status: 'hidden'})), []);
});

test('percent, underscore, backslash and quotes are literal search terms', async t => {
  const app = await privacyContext(t); app.as('editor-a');
  const special = (await app.create(numberedSubmission(0, {title: "文字100%_\\尾 ' OR 1=1--"}))).json.team;
  const normal = (await app.create(numberedSubmission(1, {title: '文字100ABC尾'}))).json.team;
  assert.notEqual(special.id, normal.id);
  for (const q of ['%', '_', '\\', '%_\\', "' OR 1=1--"])
    assert.deepEqual(ids(await search(app, q)), [special.id]);
  assert.deepEqual(ids(await search(app, "' OR 1=1--%")), []);
});

test('admin search is bounded and normalized, while anonymous access uses only the public search route', async t => {
  const app = await privacyContext(t); app.as('editor-a');
  const item = (await app.create(numberedSubmission(0, {title: 'Café 公开', visibility: 'public'}))).json.team;
  assert.deepEqual(ids(await search(app, ' Cafe\u0301 ')), [item.id]);
  assert.equal((await search(app, '字'.repeat(80))).status, 200);
  for (const q of ['字'.repeat(81), 'a\nb', '\u0000']) assert.equal((await search(app, q)).status, 400);
  app.as('guest'); assert.equal((await search(app, '')).status, 401);
  const publicResult = await app.call(`/teams?q=${'x'.repeat(81)}`);
  assert.equal(publicResult.status, 400);
  assert.deepEqual(ids(await app.call('/teams?q=Caf%C3%A9')), [item.id]);
});

test('maximum Unicode search term round-trips through a cursor with all admin filters', () => {
  const actor = {id: crypto.randomUUID(), role: 'deputy'};
  const params = new URLSearchParams({q: '🔥'.repeat(80), category: 'MOD毕业队', element: 'universal',
    damage: 'skill,ability,powerflip,direct', section: 'five-boss', scope: 'private', code: 'has', sort: 'popular', status: 'approved'});
  const url = new URL(`https://wiki.example/admin/teams?${params}`), query = listQuery(url, fixtureCatalog, true, actor);
  const cursor = nextCursor(query, {id: crypto.randomUUID(), likes: 1234567890, created_at: 1790700000000});
  url.searchParams.set('cursor', cursor);
  assert.equal(listQuery(url, fixtureCatalog, true, actor).q, query.q);
});
