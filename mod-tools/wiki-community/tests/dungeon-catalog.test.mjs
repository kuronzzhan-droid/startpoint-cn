import test from 'node:test';
import assert from 'node:assert/strict';
import dungeonCatalog from '../dungeon-catalog.mjs';
import {privacyContext, privateSubmission} from './privacy-helpers.mjs';
import {guide} from './dungeon-helpers.mjs';

const normal = 'event-rush-700099', ex = 'event-rush-700100';

test('trusted catalog exposes verified normal and EX event IDs without treating endless quest IDs as events', async (t) => {
  const app = await privacyContext(t);
  assert.equal(dungeonCatalog.items.filter((item) => item.id === ex).length, 1);
  assert.equal(dungeonCatalog.items.find((item) => item.id === ex).title, '深渊连战EX');
  assert.equal(new Set(dungeonCatalog.items.map((item) => item.id)).size, dungeonCatalog.items.length);
  for (const id of [normal, ex]) {
    const result = await app.call(`/dungeons/${id}`);
    assert.equal(result.status, 200);
    assert.equal(result.json.guide.id, id);
    assert.equal(result.json.guide.revision, 0);
    assert.equal((await app.call(`/admin/dungeons/${id}`, {method: 'PATCH', body: guide()})).status, 401);
  }
  for (const id of ['event-rush-700100099', 'event-rush-700101', 'series-gauntlets']) {
    assert.equal((await app.call(`/dungeons/${id}`)).status, 404);
  }
});

test('normal and EX guides keep separate revisions, team references and audit records', async (t) => {
  const app = await privacyContext(t); app.as('editor-a');
  const team = (await app.create(privateSubmission(0, {visibility: 'public'}))).json.team;
  const first = await app.call(`/admin/dungeons/${normal}`, {method: 'PATCH', body: guide({text: '普通深渊攻略'})});
  const second = await app.call(`/admin/dungeons/${ex}`, {method: 'PATCH', body: guide({text: 'EX 独立攻略', teamIds: [team.id]})});
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  assert.equal(first.json.guide.revision, 1); assert.equal(second.json.guide.revision, 1);
  assert.equal((await app.call(`/admin/dungeons/${ex}`, {method: 'PATCH', body: guide()})).json.error, 'edit_conflict');
  app.as('guest');
  const normalRead = (await app.call(`/dungeons/${normal}`)).json;
  const exRead = (await app.call(`/dungeons/${ex}`)).json;
  assert.equal(normalRead.guide.text, '普通深渊攻略'); assert.deepEqual(normalRead.teams, []);
  assert.equal(exRead.guide.text, 'EX 独立攻略'); assert.equal(exRead.teams[0].id, team.id);
  assert.deepEqual(app.db.raw.prepare('SELECT dungeon_id FROM community_dungeon_audit ORDER BY dungeon_id').all()
    .map((row) => row.dungeon_id), [normal, ex]);
});
