import test from 'node:test';
import assert from 'node:assert/strict';
import {dungeonContext, dungeons, guide, pixel} from './dungeon-helpers.mjs';
import {privateSubmission} from './privacy-helpers.mjs';
import {writeGuide} from '../dungeon-guides.mjs';
import {deleteImage} from '../dungeon-images.mjs';

test('public guide starts empty; only real enabled admins may edit shared guides with same origin', async (t) => {
  const app = await dungeonContext(t), route = '/admin/dungeons/boss-fire';
  assert.deepEqual((await app.dungeonCall('/dungeons/boss-fire')).json, {guide: {
    id: 'boss-fire', text: '', revision: 0, teamIds: [], imageIds: [], images: [], updatedAt: null}, teams: []});
  assert.equal((await app.dungeonCall(route)).status, 401);
  assert.equal((await app.dungeonCall(route, {method: 'PATCH', body: guide(), headers: {'X-Role': 'owner'}})).status, 401);
  assert.equal((await app.dungeonCall('/dungeons/missing')).status, 404);
  assert.equal((await app.dungeonCall('/dungeons/boss-fire', {method: 'PATCH', body: guide()})).status, 405);
  app.as('editor-a');
  assert.equal((await app.dungeonCall(route, {method: 'PATCH', body: guide(), headers: {Origin: 'https://elsewhere.test'}})).status, 403);
  for (const [revision, actor] of ['editor-a', 'editor-b', 'deputy', 'owner'].entries()) {
    app.as(actor);
    const result = await app.dungeonCall(route, {method: 'PATCH', body: guide({expectedRevision: revision, text: actor})});
    assert.equal(result.status, 200); assert.equal(result.json.guide.revision, revision + 1);
  }
  app.as('editor-a'); app.db.raw.prepare("UPDATE community_users SET enabled=0 WHERE id='editor-a'").run();
  assert.equal((await app.dungeonCall(route, {method: 'PATCH', body: guide({expectedRevision: 4})})).status, 401);
  app.as('editor-b'); app.db.raw.prepare("UPDATE community_users SET must_change_password=1 WHERE id='editor-b'").run();
  assert.equal((await app.dungeonCall(route)).json.error, 'password_change_required');
  app.as('guest'); const publicGuide = (await app.dungeonCall('/dungeons/boss-fire')).json;
  assert.ok(!/email|created_by|actor_id|availableImages/.test(JSON.stringify(publicGuide)));
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_dungeon_audit').get().n, 4);
});

test('published team references retain code and likes; unlinking never deletes the original team', async (t) => {
  const app = await dungeonContext(t); app.as('editor-a');
  const team = (await app.create(privateSubmission(0, {visibility: 'public'}))).json.team;
  const code = (await app.call(`/admin/teams/${team.id}/game-code`, {body: {expectedRevision: team.revision}})).json.gameCode;
  app.db.raw.prepare('UPDATE community_teams SET likes=7 WHERE id=?').run(team.id);
  const saved = await app.dungeonCall('/admin/dungeons/boss-fire', {method: 'PATCH', body: guide({teamIds: [team.id]})});
  assert.equal(saved.status, 200); assert.equal(saved.json.teams[0].gameCode, code); assert.equal(saved.json.teams[0].likes, 7);
  assert.equal((await app.dungeonCall('/dungeons/boss-fire')).json.teams[0].id, team.id);
  await app.dungeonCall('/admin/dungeons/boss-fire', {method: 'PATCH', body: guide({expectedRevision: 1})});
  assert.deepEqual((await app.dungeonCall('/dungeons/boss-fire')).json.teams, []);
  assert.equal((await app.call(`/teams/${team.id}`)).json.team.likes, 7);
  assert.equal((await app.call(`/game-codes/${code}`)).status, 200);
});

test('private or hidden teams cannot be linked; later visibility changes immediately disappear publicly', async (t) => {
  const app = await dungeonContext(t); app.as('editor-a');
  const team = (await app.create(privateSubmission())).json.team;
  const route = '/admin/dungeons/boss-fire';
  assert.equal((await app.dungeonCall(route, {method: 'PATCH', body: guide({teamIds: [team.id]})})).json.error, 'references_unavailable');
  app.db.raw.prepare("UPDATE community_teams SET visibility='public' WHERE id=?").run(team.id);
  assert.equal((await app.dungeonCall(route, {method: 'PATCH', body: guide({teamIds: [team.id]})})).status, 200);
  for (const sql of ["visibility='private'", "visibility='public',status='hidden'"]) {
    app.db.raw.prepare(`UPDATE community_teams SET ${sql} WHERE id=?`).run(team.id);
    for (const actor of ['guest', 'editor-b', 'owner']) {
      app.as(actor); const result = await app.dungeonCall(actor === 'guest' ? '/dungeons/boss-fire' : route);
      assert.deepEqual(result.json.teams, []); assert.deepEqual(result.json.guide.teamIds, []);
      assert.ok(!JSON.stringify(result.json).includes(team.id));
    }
  }
});

test('guide CAS rejects stale edits and validates fields, sizes, duplicates and unknown references', async (t) => {
  const app = await dungeonContext(t); app.as('editor-a'); const route = '/admin/dungeons/boss-fire';
  const text = '攻略'.repeat(15000);
  assert.equal((await app.dungeonCall(route, {method: 'PATCH', body: guide({text})})).status, 200);
  assert.equal((await app.dungeonCall(route, {method: 'PATCH', body: guide()})).json.error, 'edit_conflict');
  for (const extra of [{text: `${text}多`}, {expectedRevision: -1}, {teamIds: ['x']}, {imageIds: ['x']}, {html: '<b>raw</b>'},
    {teamIds: Array(31).fill(crypto.randomUUID())}, {imageIds: Array(13).fill(crypto.randomUUID())}]) {
    assert.equal((await app.dungeonCall(route, {method: 'PATCH', body: guide({expectedRevision: 1, ...extra})})).status, 400);
  }
  const invalid = await app.dungeonCall(route, {method: 'PATCH', body: guide({expectedRevision: 1, teamIds: [crypto.randomUUID()]})});
  assert.equal(invalid.status, 409);
  const literal = '<script>alert(1)</script>\n普通文字';
  const saved = await app.dungeonCall(route, {method: 'PATCH', body: guide({expectedRevision: 1, text: literal})});
  assert.equal(saved.json.guide.text, literal); assert.match(saved.headers.get('content-type'), /application\/json/);
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_dungeon_audit').get().n, 2);
});

test('SQL reference predicates reject a private transition between validation and guide commit', async (t) => {
  const app = await dungeonContext(t); app.as('editor-a');
  const team = (await app.create(privateSubmission(0, {visibility: 'public'}))).json.team;
  const db = {...app.db, async batch(statements) {
    app.db.raw.prepare("UPDATE community_teams SET visibility='private' WHERE id=?").run(team.id);
    return app.db.batch(statements);
  }};
  await assert.rejects(writeGuide(db, dungeons, 'boss-fire', guide({teamIds: [team.id]}), app.actors['editor-b'], app.now),
    {status: 409, code: 'references_unavailable'});
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_dungeon_guides').get().n, 0);
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_dungeon_audit').get().n, 0);
});

test('concurrent guide writers yield one winner and one audit entry', async (t) => {
  const app = await dungeonContext(t); const actor = app.actors['editor-a'];
  const results = await Promise.allSettled(['one', 'two'].map((text) => writeGuide(app.db, dungeons, 'boss-fire', guide({text}), actor, app.now)));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'edit_conflict');
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_dungeon_audit').get().n, 1);
});

test('images are private drafts until referenced, cannot be stolen across administrators/dungeons, and safely unpublish', async (t) => {
  const app = await dungeonContext(t); app.as('editor-a');
  const uploaded = await app.upload(); assert.equal(uploaded.status, 201);
  const image = uploaded.json.image, publicPath = `/dungeon-images/${image.id}`;
  const privatePath = `/admin/dungeons/boss-fire/images/${image.id}`;
  assert.equal((await app.dungeonCall(publicPath)).status, 404);
  assert.deepEqual((await app.dungeonCall(privatePath)).bytes, pixel);
  app.as('editor-b');
  assert.equal((await app.dungeonCall(privatePath)).status, 404);
  assert.deepEqual((await app.dungeonCall('/admin/dungeons/boss-fire')).json.availableImages, []);
  assert.equal((await app.dungeonCall('/admin/dungeons/boss-fire', {method: 'PATCH', body: guide({imageIds: [image.id]})})).status, 409);
  app.as('deputy'); assert.equal((await app.dungeonCall(privatePath)).status, 200);
  assert.equal((await app.dungeonCall('/admin/dungeons/event-water', {method: 'PATCH', body: guide({imageIds: [image.id]})})).status, 409);
  app.as('editor-a');
  assert.equal((await app.dungeonCall('/admin/dungeons/boss-fire', {method: 'PATCH', body: guide({imageIds: [image.id]})})).status, 200);
  app.as('guest'); const publicImage = await app.dungeonCall(publicPath);
  assert.equal(publicImage.status, 200); assert.deepEqual(publicImage.bytes, pixel);
  assert.equal(publicImage.headers.get('content-type'), 'image/png'); assert.equal(publicImage.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(publicImage.headers.get('cache-control'), 'no-store');
  assert.ok(!(await app.dungeonCall('/dungeons/boss-fire')).json.guide.images[0].previewUrl);
  app.as('editor-a'); assert.equal((await app.dungeonCall(privatePath, {method: 'DELETE'})).json.error, 'image_in_use');
  app.as('editor-b');
  assert.equal((await app.dungeonCall('/admin/dungeons/boss-fire', {method: 'PATCH', body: guide({expectedRevision: 1, imageIds: [image.id]})})).status, 200);
  assert.equal((await app.dungeonCall('/admin/dungeons/boss-fire', {method: 'PATCH', body: guide({expectedRevision: 2})})).status, 200);
  assert.equal((await app.dungeonCall(publicPath)).status, 404);
  assert.equal((await app.dungeonCall(privatePath, {method: 'DELETE'})).status, 404);
  app.as('editor-a'); assert.equal((await app.dungeonCall(privatePath, {method: 'DELETE'})).status, 200);
  assert.equal((await app.dungeonCall(privatePath)).status, 404);
});

test('image delete rechecks reference inside the transaction and never breaks a concurrent guide save', async (t) => {
  const app = await dungeonContext(t); app.as('editor-a'); const image = (await app.upload()).json.image;
  const db = {...app.db, async batch(statements) {
    app.db.raw.prepare("INSERT INTO community_dungeon_guides VALUES('boss-fire','new','[]',?,1,?)").run(JSON.stringify([image.id]), app.now);
    return app.db.batch(statements);
  }};
  await assert.rejects(deleteImage(db, dungeons, 'boss-fire', image.id, app.actors['editor-a'], app.now), {code: 'image_in_use'});
  assert.equal((await app.dungeonCall(`/dungeon-images/${image.id}`)).status, 200);
  assert.equal(app.db.raw.prepare("SELECT COUNT(*) n FROM community_dungeon_audit WHERE action='image_delete'").get().n, 0);
});
