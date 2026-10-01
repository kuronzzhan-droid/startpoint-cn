import test from 'node:test';
import assert from 'node:assert/strict';
import {privacyContext, privateSubmission} from './privacy-helpers.mjs';
import {fixtureCatalog} from './helpers.mjs';
import {listQuery, nextCursor} from '../model.mjs';

const catalog = {...fixtureCatalog, characters: {...fixtureCatalog.characters,
  c0: {element: '火', name: '玛丽安', variant: '通常版'},
  c1: {element: '水', name: '玛丽安', variant: '圣诞'},
  c3: {element: '水', name: 'Rolf', variant: '冰雪'},
  c10: {element: '水', name: 'Café', variant: '校园'}}};
const search = (app, q, extra = {}) => app.call(`/teams?${new URLSearchParams({q, ...extra})}`);
const ids = response => response.json.items.map(item => item.id).sort();
function numbered(index, extra = {}) {
  const value = privateSubmission(0, {visibility: 'public', title: '普通配队', notes: '', author: '', ...extra});
  for (let slot = 0; slot < 3; slot++) {
    const variant = Math.floor(index / (3 ** slot)) % 3;
    value.team.weapon[slot] = variant === 0 ? '' : `w${variant - 1}`;
  }
  return value;
}

test('public keyword searches title and guide text, without searching author or active game code', async t => {
  const app = await privacyContext(t, {catalog}); app.as('editor-a');
  const title = (await app.create(numbered(0, {title: '低配幻想开荒'}))).json.team;
  const note = (await app.create(numbered(1, {notes: '第三轮手动施放\n低配也可通关'}))).json.team;
  const author = (await app.create(numbered(2, {author: '低配幻想开荒'}))).json.team;
  const code = (await app.call(`/admin/teams/${author.id}/game-code`, {body: {expectedRevision: 1}})).json.gameCode;
  app.as('guest');
  assert.deepEqual(ids(await search(app, '低配')), [title.id, note.id].sort());
  assert.deepEqual(ids(await search(app, '手动施放')), [note.id]);
  assert.deepEqual(ids(await search(app, code)), []);
  assert.equal((await search(app, '低配')).headers.get('set-cookie'), null);
});

test('character name and version search includes main and unison, and combines with other filters', async t => {
  const app = await privacyContext(t, {catalog}); app.as('editor-a');
  const combined = numbered(0, {section: 'fantasy'});
  const first = (await app.create(combined)).json.team;
  const another = numbered(1, {section: 'abyss'});
  another.team.main = ['c6', 'c7', 'c8']; another.team.unison = ['c9', 'c10', 'c11'];
  const second = (await app.create(another)).json.team;
  app.as('guest');
  for (const q of ['玛丽安', '圣诞玛丽安', '玛丽安圣诞', '圣诞 玛丽安', '冰雪Rolf', 'rOlF'])
    assert.deepEqual(ids(await search(app, q)), [first.id]);
  assert.deepEqual(ids(await search(app, 'Cafe\u0301')), [second.id]);
  assert.deepEqual(ids(await search(app, '玛丽安', {section: 'abyss'})), []);
  assert.deepEqual(ids(await search(app, 'Rolf', {character: 'c10'})), []);
  assert.deepEqual(ids(await search(app, 'Café', {character: 'c10', element: '水', section: 'abyss'})), [second.id]);
});

test('keyword filtering happens before pagination and cursors bind the keyword', async t => {
  const app = await privacyContext(t, {catalog}); app.as('editor-a');
  const old = (await app.create(numbered(0, {notes: '最旧的独特攻略'}))).json.team;
  for (let i = 1; i < 27; i++) {
    app.now += 1000;
    assert.equal((await app.create(numbered(i, {notes: `分页攻略${i}`}))).status, 201);
  }
  app.as('guest');
  assert.ok(!(await app.call('/teams')).json.items.some(item => item.id === old.id));
  assert.deepEqual(ids(await search(app, '独特攻略')), [old.id]);
  const first = await search(app, '分页攻略'); assert.equal(first.json.items.length, 24);
  const second = await search(app, '分页攻略', {cursor: first.json.nextCursor}); assert.equal(second.json.items.length, 2);
  assert.equal(new Set([...ids(first), ...ids(second)]).size, 26);
  assert.equal((await search(app, '独特攻略', {cursor: first.json.nextCursor})).json.error, 'invalid_cursor');
  assert.equal((await search(app, '', {cursor: first.json.nextCursor})).json.error, 'invalid_cursor');
});

test('public keyword matches never reveal private, deleted or pending teams, including public-code private teams', async t => {
  const app = await privacyContext(t, {catalog}); app.as('editor-a');
  const visible = (await app.create(numbered(0, {title: '隐私测试', notes: '共同攻略'}))).json.team;
  const personal = (await app.create(numbered(1, {visibility: 'private', title: '隐私测试', notes: '共同攻略'}))).json.team;
  const hidden = (await app.create(numbered(2, {title: '隐私测试', notes: '共同攻略'}))).json.team;
  const pending = (await app.create(numbered(3, {title: '隐私测试', notes: '共同攻略'}))).json.team;
  await app.call(`/admin/teams/${personal.id}/game-code`, {body: {expectedRevision: 1}});
  await app.call(`/admin/teams/${hidden.id}`, {method: 'DELETE', body: {expectedRevision: 1}});
  app.db.raw.prepare("UPDATE community_teams SET status='pending' WHERE id=?").run(pending.id);
  for (const actor of ['guest', 'editor-a', 'owner']) {
    app.as(actor);
    for (const q of ['隐私测试', '共同攻略', '玛丽安'])
      assert.deepEqual(ids(await search(app, q, {scope: 'private', status: 'hidden'})), [visible.id]);
  }
  app.as('guest');
  assert.equal((await app.call(`/teams/${personal.id}`)).status, 404);
});

test('public keyword is literal, normalized and bounded', async t => {
  const app = await privacyContext(t, {catalog}); app.as('editor-a');
  const special = (await app.create(numbered(0, {title: 'Café', notes: "100%_\\尾 ' OR 1=1--"}))).json.team;
  await app.create(numbered(1, {notes: '100ABC尾'}));
  app.as('guest');
  for (const q of [' Cafe\u0301 ', '%', '_', '\\', '%_\\', "' OR 1=1--"])
    assert.deepEqual(ids(await search(app, q)), [special.id]);
  assert.deepEqual(ids(await search(app, "' OR 1=1--%")), []);
  assert.equal((await search(app, '🔥'.repeat(80))).status, 200);
  for (const q of ['🔥'.repeat(81), 'a\nb', '\u0000']) assert.equal((await search(app, q)).status, 400);
  assert.equal((await search(app, '   ')).json.items.length, 2);
});

test('maximum public Unicode keyword survives cursor encoding with all public filters', () => {
  const url = new URL(`https://wiki.example/teams?${new URLSearchParams({q: '🔥'.repeat(80),
    category: 'MOD毕业队', element: 'universal', damage: 'skill,ability,powerflip,direct',
    section: 'five-boss', code: 'has', sort: 'popular', character: 'c0'})}`);
  const query = listQuery(url, catalog);
  url.searchParams.set('cursor', nextCursor(query, {id: crypto.randomUUID(), likes: 900, created_at: 1790700000000}));
  assert.equal(listQuery(url, catalog).q, query.q);
});
