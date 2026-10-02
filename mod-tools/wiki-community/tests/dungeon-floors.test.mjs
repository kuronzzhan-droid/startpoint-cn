import test from 'node:test';
import assert from 'node:assert/strict';
import {privacyContext, privateSubmission} from './privacy-helpers.mjs';
import {guide, pixel} from './dungeon-helpers.mjs';
import {floorParent} from '../dungeon-floors.mjs';
import {requireDungeon} from '../dungeon-model.mjs';
import {writeGuide} from '../dungeon-guides.mjs';
import catalog from '../dungeon-catalog.mjs';

const normal = 'event-rush-700099', ex = 'event-rush-700100', fantasy = 'event-rush-700098';
const floor = (id, number) => `${id}-floor-${number}`;

test('only verified floor scopes of an existing mode are accepted', async (t) => {
  const app = await privacyContext(t);
  for (const [mode, count, extra] of [[normal, 30, 'endless'], [ex, 30, 'endless'], [fantasy, 15, 'practice']]) {
    for (const key of [1, count, extra]) {
      assert.equal(floorParent(floor(mode, key)), mode);
      assert.equal((await app.call(`/dungeons/${floor(mode, key)}`)).status, 200);
    }
    for (const key of [0, -1, count + 1, '01', '1.5', '1-floor-2', 'unknown', extra === 'endless' ? 'practice' : 'endless']) {
      assert.equal((await app.call(`/dungeons/${floor(mode, key)}`)).status, 404);
    }
  }
  assert.equal(floorParent('event-rush-999999-floor-1'), null);
  assert.throws(() => requireDungeon({items:[]}, floor(normal, 1)), {status:404});
  assert.throws(() => requireDungeon({items:[{id:'boss-1-99'}]}, 'boss-1-99-floor-1'), {status:404});
});

test('mode-wide, normal, EX and fantasy floors edit independently, retaining old guides and original teams', async (t) => {
  const app = await privacyContext(t); app.as('editor-a');
  const team = (await app.create(privateSubmission(0, {visibility:'public'}))).json.team;
  const ids = [normal, floor(normal, 1), floor(normal, 2), floor(ex, 1), floor(fantasy, 1)];
  for (const id of ids) {
    const result = await app.call(`/admin/dungeons/${id}`, {method:'PATCH', body:guide({text:id, teamIds:[team.id]})});
    assert.equal(result.status, 200); assert.equal(result.json.guide.revision, 1);
  }
  const changed = await app.call(`/admin/dungeons/${floor(normal, 1)}`, {method:'PATCH', body:guide({expectedRevision:1, text:'修改第一层'})});
  assert.equal(changed.status, 200); assert.equal(changed.json.guide.revision, 2); assert.deepEqual(changed.json.teams, []);
  for (const id of ids.filter((id) => id !== floor(normal, 1))) {
    const result = await app.call(`/dungeons/${id}`);
    assert.equal(result.json.guide.text, id); assert.equal(result.json.guide.revision, 1);
    assert.equal(result.json.teams[0].id, team.id);
  }
  assert.equal((await app.call(`/teams/${team.id}`)).status, 200);
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_dungeon_audit').get().n, 6);
});

test('floor edits enforce authentication and visibility on every public read', async (t) => {
  const app = await privacyContext(t), id = floor(ex, 30), path = `/admin/dungeons/${id}`;
  assert.equal((await app.call(path, {method:'PATCH', body:guide()})).status, 401);
  app.as('editor-a');
  const team = (await app.create(privateSubmission(0, {visibility:'public'}))).json.team;
  assert.equal((await app.call(path, {method:'PATCH', body:guide({teamIds:[team.id]})})).status, 200);
  app.db.raw.prepare("UPDATE community_teams SET visibility='private' WHERE id=?").run(team.id);
  app.as('guest'); const read = await app.call(`/dungeons/${id}`);
  assert.deepEqual(read.json.teams, []); assert.deepEqual(read.json.guide.teamIds, []);
  assert.ok(!JSON.stringify(read.json).includes(team.id));
  app.as('editor-b');
  assert.equal((await app.call(path, {method:'PATCH', body:guide({expectedRevision:1, teamIds:[team.id]})})).json.error, 'references_unavailable');
});

test('concurrent writes to one floor conflict without touching the adjacent floor', async (t) => {
  const app = await privacyContext(t), id = floor(normal, 9);
  const results = await Promise.allSettled(['A', 'B'].map((text) => writeGuide(app.db, catalog, id,
    guide({text}), app.actors['editor-a'], app.now)));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'edit_conflict');
  assert.equal((await app.call(`/dungeons/${floor(normal, 10)}`)).json.guide.revision, 0);
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_dungeon_audit').get().n, 1);
});

test('each floor image stays private until published and cannot be reused on another floor', async (t) => {
  const app = await privacyContext(t); app.as('editor-a');
  const id = floor(fantasy, 15), other = floor(fantasy, 14);
  const response = await app.handle(new Request(`${app.origin}/api/community/admin/dungeons/${id}/images`, {
    method:'POST', headers:{Origin:app.origin, Cookie:app.cookie, 'Content-Type':'image/png', 'CF-Connecting-IP':'192.0.2.1'}, body:pixel,
  }), app.env);
  assert.equal(response.status, 201); const image = (await response.json()).image;
  assert.equal((await app.call(`/dungeon-images/${image.id}`)).status, 404);
  assert.equal((await app.call(`/admin/dungeons/${other}`, {method:'PATCH', body:guide({imageIds:[image.id]})})).status, 409);
  assert.equal((await app.call(`/admin/dungeons/${id}`, {method:'PATCH', body:guide({imageIds:[image.id]})})).status, 200);
  const publicGuide = (await app.call(`/dungeons/${id}`)).json.guide;
  assert.equal(publicGuide.images[0].id, image.id); assert.ok(!publicGuide.images[0].previewUrl);
  const displayed = await app.handle(new Request(`${app.origin}${image.url}`), app.env);
  assert.equal(displayed.status, 200); assert.deepEqual(new Uint8Array(await displayed.arrayBuffer()), pixel);
  assert.equal((await app.call(`/dungeons/${other}`)).json.guide.images.length, 0);
  assert.equal((await app.call(`/admin/dungeons/${id}`, {method:'PATCH', body:guide({expectedRevision:1})})).status, 200);
  assert.equal((await app.call(`/dungeon-images/${image.id}`)).status, 404);
});
