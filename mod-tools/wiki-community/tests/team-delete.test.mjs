import test from 'node:test';
import assert from 'node:assert/strict';
import {privacyContext, privateSubmission} from './privacy-helpers.mjs';
import {dungeonContext, guide} from './dungeon-helpers.mjs';
import {deleteTeam, findAdminTeam} from '../repository.mjs';

const remove = (app, item, extra = {}) => app.call(`/admin/teams/${item.id}`, {
  method: 'DELETE', body: {expectedRevision: item.revision, ...extra}});
const codeFor = (app, item) => app.call(`/admin/teams/${item.id}/game-code`, {body: {expectedRevision: item.revision}});
const raw = (app, id) => app.db.raw.prepare('SELECT * FROM community_teams WHERE id=?').get(id);
const audits = (app) => app.db.raw.prepare('SELECT * FROM community_audit ORDER BY rowid').all();
const codes = (app) => app.db.raw.prepare('SELECT * FROM community_game_codes ORDER BY rowid').all();

test('deleting an own private team is recoverable, preserves its contents and permanently revokes the old code', async t => {
  const app = await privacyContext(t); app.as('editor-a');
  const item = (await app.create(privateSubmission())).json.team;
  const code = (await codeFor(app, item)).json.gameCode, before = raw(app, item.id);
  const result = await remove(app, item); assert.equal(result.status, 200);
  const removed = result.json.team;
  assert.equal(removed.status, 'hidden'); assert.equal(removed.gameCode, null); assert.equal(removed.revision, 2);
  for (const key of ['fingerprint', 'title', 'notes', 'author', 'team_json', 'visibility', 'created_by', 'likes', 'created_at'])
    assert.equal(raw(app, item.id)[key], before[key]);
  assert.equal((await app.call('/admin/teams?scope=mine&status=approved')).json.items.length, 0);
  assert.equal((await app.call('/admin/teams?scope=mine&status=hidden')).json.items[0].id, item.id);
  assert.equal((await app.call(`/game-codes/${code}`)).status, 404);
  assert.equal((await codeFor(app, removed)).status, 409);
  assert.ok(codes(app).every(row => row.revoked_at !== null));
  const deletedAudit = audits(app).filter(row => row.action === 'delete');
  assert.equal(deletedAudit.length, 1); assert.equal(deletedAudit[0].actor_id, 'editor-a');
  assert.equal(JSON.parse(deletedAudit[0].before_json).status, 'approved');
  assert.equal(JSON.parse(deletedAudit[0].after_json).status, 'hidden');
  const restored = await app.call(`/admin/teams/${item.id}`, {method: 'PATCH', body: {expectedRevision: 2, status: 'approved'}});
  assert.equal(restored.status, 200); assert.equal(restored.json.team.gameCode, null);
  assert.equal((await app.call(`/game-codes/${code}`)).status, 404);
  const nextCode = (await codeFor(app, restored.json.team)).json.gameCode;
  assert.notEqual(nextCode, code); assert.equal((await app.call(`/game-codes/${nextCode}`)).status, 200);
});

test('other editors cannot delete private teams, even with forged role or creator fields', async t => {
  const app = await privacyContext(t); app.as('editor-a');
  const item = (await app.create(privateSubmission())).json.team;
  const code = (await codeFor(app, item)).json.gameCode;
  const before = {row: raw(app, item.id), audit: audits(app), codes: codes(app)};
  app.as('editor-b');
  for (const extra of [{}, {role: 'owner', createdBy: 'editor-b'}, {expectedRevision: 999}])
    assert.equal((await remove(app, item, extra)).status, 404);
  assert.deepEqual({row: raw(app, item.id), audit: audits(app), codes: codes(app)}, before);
  assert.equal((await app.call(`/game-codes/${code}`)).status, 200);
});

for (const actor of ['owner', 'deputy']) test(`${actor} retains the right to delete another administrator's private team`, async t => {
  const app = await privacyContext(t); app.as('editor-a');
  const item = (await app.create(privateSubmission())).json.team;
  const code = (await codeFor(app, item)).json.gameCode;
  app.as(actor); assert.equal((await remove(app, item)).status, 200);
  assert.equal(raw(app, item.id).created_by, 'editor-a');
  assert.equal((await app.call(`/game-codes/${code}`)).status, 404);
});

test('editors retain existing shared public-team management permissions', async t => {
  const app = await privacyContext(t); app.as('editor-a');
  const item = (await app.create(privateSubmission(0, {visibility: 'public'}))).json.team;
  const code = (await codeFor(app, item)).json.gameCode;
  app.as('editor-b'); assert.equal((await remove(app, item)).status, 200);
  assert.equal(raw(app, item.id).created_by, 'editor-a');
  assert.equal((await app.call(`/teams/${item.id}`)).status, 404);
  assert.equal((await app.call('/teams')).json.items.length, 0);
  assert.equal((await app.call(`/game-codes/${code}`)).status, 404);
  assert.equal((await app.create(privateSubmission(0, {visibility: 'public'}))).status, 409, 'deleted fingerprints cannot be recreated to bypass moderation');
});

test('DELETE requires an active full-permission login, same origin and only the current revision', async t => {
  const app = await privacyContext(t); app.as('editor-a');
  const item = (await app.create(privateSubmission())).json.team, before = raw(app, item.id);
  for (const expectedRevision of [undefined, null, '1', 0, 1.5, 999])
    assert.equal((await remove(app, item, {expectedRevision})).status, 409);
  assert.equal((await remove(app, item, {status: 'approved'})).status, 400);
  assert.equal((await app.call(`/admin/teams/${item.id}`, {method: 'DELETE', body: {expectedRevision: 1}, headers: {Origin: 'https://evil.test'}})).status, 403);
  app.as('guest'); assert.equal((await remove(app, item)).status, 401);
  app.as('editor-a');
  app.db.raw.prepare("UPDATE community_users SET must_change_password=1 WHERE id='editor-a'").run();
  assert.equal((await remove(app, item)).json.error, 'password_change_required');
  app.db.raw.prepare("UPDATE community_users SET must_change_password=0,enabled=0 WHERE id='editor-a'").run();
  assert.equal((await remove(app, item)).status, 401);
  assert.deepEqual(raw(app, item.id), before); assert.equal(audits(app).length, 1);
});

test('concurrent deletes produce one revision change and one audit; stale retry cannot revoke a later code', async t => {
  const app = await privacyContext(t); app.as('editor-a');
  const item = (await app.create(privateSubmission())).json.team;
  await codeFor(app, item);
  const results = await Promise.all([remove(app, item), remove(app, item)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(raw(app, item.id).revision, 2); assert.equal(audits(app).filter(r => r.action === 'delete').length, 1);
  const restored = (await app.call(`/admin/teams/${item.id}`, {method: 'PATCH', body: {expectedRevision: 2, status: 'approved'}})).json.team;
  const code = (await codeFor(app, restored)).json.gameCode;
  assert.equal((await remove(app, item)).status, 409);
  assert.equal((await app.call(`/game-codes/${code}`)).status, 200);
});

test('concurrent code generation and deletion cannot leave an active usable code', async t => {
  const app = await privacyContext(t); app.as('editor-a');
  const item = (await app.create(privateSubmission())).json.team;
  const [generated, removed] = await Promise.all([codeFor(app, item), remove(app, item)]);
  assert.equal(removed.status, 200); assert.ok([200, 409].includes(generated.status));
  assert.equal(raw(app, item.id).status, 'hidden'); assert.ok(codes(app).every(row => row.revoked_at !== null));
  if (generated.status === 200) assert.equal((await app.call(`/game-codes/${generated.json.gameCode}`)).status, 404);
  assert.equal((await codeFor(app, removed.json.team)).status, 409);
});

test('DELETE SQL rechecks access after another editor privatizes a pre-read public team', async t => {
  const app = await privacyContext(t); app.as('editor-a');
  const item = (await app.create(privateSubmission(0, {visibility: 'public'}))).json.team;
  await codeFor(app, item);
  const actor = app.actors['editor-b'], stale = await findAdminTeam(app.db, item.id, actor);
  const before = {audit: audits(app), codes: codes(app)};
  const db = {...app.db, async batch(statements) {
    app.db.raw.prepare("UPDATE community_teams SET visibility='private' WHERE id=?").run(item.id);
    return app.db.batch(statements);
  }};
  await assert.rejects(deleteTeam(db, stale, actor, app.now), {status: 404});
  assert.equal(raw(app, item.id).status, 'approved'); assert.equal(raw(app, item.id).revision, 1);
  assert.deepEqual({audit: audits(app), codes: codes(app)}, before);
});

test('failed audit rolls back both removal and code revocation', async t => {
  const app = await privacyContext(t); app.as('editor-a');
  const item = (await app.create(privateSubmission())).json.team;
  const code = (await codeFor(app, item)).json.gameCode, before = raw(app, item.id);
  app.db.raw.exec("CREATE TRIGGER reject_team_delete BEFORE INSERT ON community_audit WHEN NEW.action='delete' BEGIN SELECT RAISE(ABORT,'fixture'); END");
  assert.equal((await remove(app, item)).status, 503); assert.deepEqual(raw(app, item.id), before);
  assert.equal((await app.call(`/game-codes/${code}`)).status, 200);
});

test('an old team whose character left the catalog can still be safely deleted', async t => {
  const app = await privacyContext(t); app.as('editor-a');
  const item = (await app.create(privateSubmission())).json.team;
  const legacy = structuredClone(item.team); legacy.main[0] = 'no-longer-listed';
  app.db.raw.prepare('UPDATE community_teams SET team_json=? WHERE id=?').run(JSON.stringify(legacy), item.id);
  const before = raw(app, item.id);
  assert.equal((await remove(app, item)).status, 200);
  assert.equal(raw(app, item.id).team_json, before.team_json); assert.equal(raw(app, item.id).fingerprint, before.fingerprint);
});

test('deleted linked teams immediately disappear from public guides and cannot be newly linked', async t => {
  const app = await dungeonContext(t); app.as('editor-a');
  const item = (await app.create(privateSubmission(0, {visibility: 'public'}))).json.team;
  const code = (await codeFor(app, item)).json.gameCode;
  assert.equal((await app.dungeonCall('/admin/dungeons/boss-fire', {method: 'PATCH', body: guide({teamIds: [item.id]})})).status, 200);
  assert.equal((await remove(app, item)).status, 200);
  const result = (await app.dungeonCall('/dungeons/boss-fire')).json;
  assert.deepEqual(result.teams, []); assert.deepEqual(result.guide.teamIds, []);
  assert.ok(!JSON.stringify(result).includes(item.id)); assert.ok(!JSON.stringify(result).includes(code));
  assert.equal((await app.dungeonCall('/admin/dungeons/event-water', {method: 'PATCH', body: guide({teamIds: [item.id]})})).json.error, 'references_unavailable');
  const token = await app.challenge();
  assert.equal((await app.call(`/teams/${item.id}/like`, {body: {turnstileToken: token}})).status, 404);
  assert.equal(app.db.raw.prepare('SELECT count(*) n FROM community_likes').get().n, 0);
});
