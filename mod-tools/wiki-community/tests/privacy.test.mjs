import test from 'node:test';
import assert from 'node:assert/strict';
import {privacyContext, privateSubmission} from './privacy-helpers.mjs';
import {listQuery, nextCursor, validateSubmission} from '../model.mjs';
import {fixtureCatalog, submission} from './helpers.mjs';

test('private ownership is server assigned and visitors cannot enumerate, read or like personal teams', async (t) => {
  const app = await privacyContext(t); app.as('editor-a');
  const created = await app.create(privateSubmission(0, {createdBy: 'editor-b', created_by: 'owner', role: 'owner'}));
  assert.equal(created.status, 201); const item = created.json.team;
  assert.equal(item.visibility, 'private'); assert.equal(item.createdBy, 'editor-a'); assert.equal(item.gameCode, null);
  const ownerRecord = await app.call(`/admin/teams/${item.id}`);
  assert.equal(ownerRecord.json.team.id, item.id);
  app.as('guest');
  for (const suffix of ['', '?scope=all', '?scope=mine', '?scope=private', '?code=has', '?code=none']) {
    const result = await app.call(`/teams${suffix}`);
    assert.equal(result.status, 200); assert.deepEqual(result.json, {items: [], nextCursor: null});
    assert.ok(!JSON.stringify(result.json).includes('editor-a'));
  }
  assert.equal((await app.call(`/teams/${item.id}`)).status, 404);
  assert.equal((await app.call(`/teams/${item.id}/like`, {body: {turnstileToken: await app.challenge()}})).status, 404);
  assert.equal(app.db.raw.prepare('SELECT count(*) n FROM community_likes').get().n, 0);
  assert.equal(app.db.raw.prepare('SELECT count(*) n FROM community_game_codes').get().n, 0);
});

test('other editors cannot read, edit or manage private codes, including forged ownership and role', async (t) => {
  const app = await privacyContext(t); app.as('editor-a');
  const item = (await app.create(privateSubmission())).json.team;
  const code = (await app.call(`/admin/teams/${item.id}/game-code`, {body: {expectedRevision: 1}})).json.gameCode;
  const before = app.db.raw.prepare('SELECT count(*) n FROM community_audit').get().n;
  app.as('editor-b');
  assert.deepEqual((await app.call('/admin/teams')).json.items, []);
  assert.deepEqual((await app.call('/admin/teams?scope=mine')).json.items, []);
  assert.equal((await app.call('/admin/teams?scope=private')).status, 403);
  for (const [path, settings] of [
    [`/admin/teams/${item.id}`, {}],
    [`/admin/teams/${item.id}`, {method: 'PATCH', body: {expectedRevision: 999, title: '篡改', createdBy: 'editor-b', role: 'owner'}}],
    [`/admin/teams/${item.id}/game-code`, {}],
    [`/admin/teams/${item.id}/game-code`, {body: {expectedRevision: 1}}],
    [`/admin/teams/${item.id}/game-code/revoke`, {body: {expectedRevision: 1}}],
  ]) {
    const result = await app.call(path, settings); assert.equal(result.status, 404);
    assert.deepEqual(result.json, {error: 'not_found', message: '队伍不存在。'});
  }
  assert.equal(app.db.raw.prepare('SELECT count(*) n FROM community_audit').get().n, before);
  assert.equal((await app.call(`/game-codes/${code}`)).status, 200, 'explicitly published code remains usable');
  for (const actor of ['owner', 'deputy']) {
    app.as(actor);
    assert.equal((await app.call(`/admin/teams/${item.id}`)).status, 200);
    assert.equal((await app.call('/admin/teams?scope=private')).json.items[0].id, item.id);
    assert.equal((await app.call(`/admin/teams/${item.id}/game-code`)).json.gameCode, code);
  }
});

test('private duplicate conflicts reveal no identifier or status to another editor', async (t) => {
  const app = await privacyContext(t); app.as('editor-a');
  const secret = (await app.create(privateSubmission())).json.team;
  app.as('editor-b');
  const duplicate = await app.create(privateSubmission());
  assert.equal(duplicate.status, 409);
  assert.deepEqual(duplicate.json, {error: 'duplicate', message: '这个阵容无法重复保存。'});
  const second = (await app.create(privateSubmission(1))).json.team;
  const edit = await app.call(`/admin/teams/${second.id}`, {method: 'PATCH', body: {...privateSubmission(), expectedRevision: 1}});
  assert.deepEqual(edit.json, duplicate.json);
  app.as('owner');
  const visibleConflict = await app.create(privateSubmission());
  assert.equal(visibleConflict.json.existingId, secret.id);
  assert.equal(app.db.raw.prepare('SELECT revision FROM community_teams WHERE id=?').get(second.id).revision, 1);
});

test('scope filters distinguish public, personal and manager-only private collections', async (t) => {
  const app = await privacyContext(t); app.as('editor-a');
  const own = (await app.create(privateSubmission())).json.team;
  const publicTeam = (await app.create(privateSubmission(1, {visibility: 'public'}))).json.team;
  app.as('editor-b'); const other = (await app.create(privateSubmission(2))).json.team;
  app.as('editor-a');
  const ids = async (query) => (await app.call(`/admin/teams${query}`)).json.items.map((item) => item.id).sort();
  assert.deepEqual(await ids(''), [own.id, publicTeam.id].sort());
  assert.deepEqual(await ids('?scope=public'), [publicTeam.id]);
  assert.deepEqual(await ids('?scope=mine'), [own.id]);
  app.as('owner');
  assert.deepEqual(await ids('?scope=all'), [own.id, publicTeam.id, other.id].sort());
  assert.deepEqual(await ids('?scope=private'), [own.id, other.id].sort());
  assert.deepEqual(await ids('?scope=mine'), []);
  assert.equal((await app.call('/admin/teams?scope=garbage')).json.error, 'invalid_scope');
  assert.equal((await app.call('/admin/teams?code=garbage')).json.error, 'invalid_code_filter');
});

test('only creator or managers can privatize a public team; ownership stays immutable', async (t) => {
  const app = await privacyContext(t); app.as('editor-a');
  const item = (await app.create(privateSubmission(0, {visibility: 'public'}))).json.team;
  app.as('editor-b');
  const updated = await app.call(`/admin/teams/${item.id}`, {method: 'PATCH', body: {expectedRevision: 1, title: '合法公开编辑', createdBy: 'editor-b'}});
  assert.equal(updated.status, 200); assert.equal(updated.json.team.createdBy, 'editor-a');
  const denied = await app.call(`/admin/teams/${item.id}`, {method: 'PATCH', body: {expectedRevision: 2, visibility: 'private'}});
  assert.equal(denied.status, 403); assert.equal(denied.json.error, 'team_owner_required');
  app.as('deputy');
  const moved = await app.call(`/admin/teams/${item.id}`, {method: 'PATCH', body: {expectedRevision: 2, visibility: 'private'}});
  assert.equal(moved.status, 200); assert.equal(moved.json.team.createdBy, 'editor-a');
  app.as('editor-a');
  assert.equal((await app.call(`/admin/teams/${item.id}`, {method: 'PATCH', body: {expectedRevision: 3, notes: '保留个人空间'}})).json.team.visibility, 'private');
  assert.equal((await app.call(`/teams/${item.id}`)).status, 404);
  assert.equal(validateSubmission(submission(), fixtureCatalog).visibility, 'public');
  for (const visibility of [null, 'hidden', 'mine', 0])
    assert.throws(() => validateSubmission({...submission(), visibility}, fixtureCatalog), {code: 'invalid_visibility'});
});

test('private code publication is explicit, does not list the team and effective-code filters track revocation', async (t) => {
  const app = await privacyContext(t); app.as('editor-a');
  const item = (await app.create(privateSubmission())).json.team;
  const base = `/admin/teams/${item.id}`;
  assert.equal((await app.call('/admin/teams?scope=mine&code=none')).json.items.length, 1);
  const code = (await app.call(`${base}/game-code`, {body: {expectedRevision: 1}})).json.gameCode;
  assert.equal((await app.call('/admin/teams?scope=mine&code=has')).json.items[0].id, item.id);
  assert.equal((await app.call('/admin/teams?scope=mine&code=none')).json.items.length, 0);
  assert.deepEqual(Object.keys((await app.call(`/game-codes/${code}`)).json).sort(), ['active', 'team', 'title']);
  assert.equal((await app.call('/teams?code=has')).json.items.length, 0);
  for (const [revision, visibility] of [[1, 'public'], [2, 'private']]) {
    const changed = await app.call(base, {method: 'PATCH', body: {expectedRevision: revision, visibility}});
    assert.equal(changed.json.team.gameCode, code); assert.equal((await app.call(`/game-codes/${code}`)).status, 200);
  }
  assert.equal((await app.call(base, {method: 'PATCH', body: {expectedRevision: 3, status: 'hidden'}})).status, 200);
  assert.equal((await app.call(`/game-codes/${code}`)).status, 404);
  assert.equal((await app.call('/admin/teams?scope=mine&code=has')).json.items.length, 0);
  assert.equal((await app.call('/admin/teams?scope=mine&code=none')).json.items.length, 1);
  assert.equal((await app.call(`${base}/game-code`, {body: {expectedRevision: 4}})).status, 409);
  await app.call(base, {method: 'PATCH', body: {expectedRevision: 4, status: 'approved'}});
  const nextCode = (await app.call(`${base}/game-code`, {body: {expectedRevision: 5}})).json.gameCode;
  assert.notEqual(nextCode, code);
  await app.call(base, {method: 'PATCH', body: {...privateSubmission(1), expectedRevision: 5}});
  assert.equal((await app.call(`/game-codes/${nextCode}`)).status, 404);
});

test('admin cursor binds scope, effective-code filter and verified administrator identity', async (t) => {
  const app = await privacyContext(t); app.as('editor-a');
  const item = (await app.create(privateSubmission())).json.team;
  const row = app.db.raw.prepare('SELECT * FROM community_teams WHERE id=?').get(item.id);
  const url = new URL('https://wiki.example/api/community/admin/teams?scope=mine&code=none');
  const query = listQuery(url, fixtureCatalog, true, app.actors['editor-a']), cursor = nextCursor(query, row);
  assert.equal((await app.call(`/admin/teams?scope=mine&code=none&cursor=${cursor}`)).status, 200);
  for (const suffix of ['scope=all&code=none', 'scope=mine&code=has'])
    assert.equal((await app.call(`/admin/teams?${suffix}&cursor=${cursor}`)).json.error, 'invalid_cursor');
  app.as('editor-b');
  assert.equal((await app.call(`/admin/teams?scope=mine&code=none&cursor=${cursor}`)).json.error, 'invalid_cursor');
  app.as('owner');
  assert.equal((await app.call(`/admin/teams?scope=mine&code=none&cursor=${cursor}`)).json.error, 'invalid_cursor');
});

test('effective-code filtering runs before pagination and includes only accessible current codes', async (t) => {
  const app = await privacyContext(t); app.as('editor-a');
  const oldest = (await app.create(privateSubmission())).json.team;
  await app.call(`/admin/teams/${oldest.id}/game-code`, {body: {expectedRevision: 1}});
  for (let index = 0; index < 27; index++) {
    const value = privateSubmission(1, {visibility: 'public'});
    value.team.weapon = [index % 3 === 0 ? '' : `w${index % 3 - 1}`,
      Math.floor(index / 3) % 3 === 0 ? '' : `w${Math.floor(index / 3) % 3 - 1}`,
      Math.floor(index / 9) % 3 === 0 ? '' : `w${Math.floor(index / 9) % 3 - 1}`];
    app.now += 1000; assert.equal((await app.create(value)).status, 201);
  }
  const coded = await app.call('/admin/teams?code=has');
  assert.deepEqual(coded.json.items.map((item) => item.id), [oldest.id]); assert.equal(coded.json.nextCursor, null);
  const none = await app.call('/admin/teams?code=none');
  assert.equal(none.json.items.length, 24); assert.ok(none.json.nextCursor);
  assert.equal((await app.call(`/admin/teams?code=none&cursor=${none.json.nextCursor}`)).json.items.length, 3);
  app.as('editor-b'); assert.deepEqual((await app.call('/admin/teams?code=has')).json, {items: [], nextCursor: null});
});
