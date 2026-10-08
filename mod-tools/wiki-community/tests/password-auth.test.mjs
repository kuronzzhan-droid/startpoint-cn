import test from 'node:test';
import assert from 'node:assert/strict';
import {context, submission} from './helpers.mjs';
import {hashPassword, checkPassword, validatePassword} from '../password-crypto.mjs';
import {issueSession} from '../password-auth.mjs';
import {createEditor, changeOwnPassword, updateEditor} from '../account-repository.mjs';

const ownerEmail = 'owner@example.test', password = 'original owner password 123';
const tempPassword = 'temporary editor password 456', changedPassword = 'private changed password 789';
function passwordContext(t, options = {}) {
  const c = context({...options, env: {COMMUNITY_AUTH_MODE: 'password', COMMUNITY_OWNER_EMAIL: ownerEmail,
    COMMUNITY_PASSWORD_PEPPER: 'p'.repeat(40), ...options.env}});
  t.after(() => c.close()); return c;
}
const setup = (c, extra = {}) => c.call('/auth/bootstrap', {body: {email: ownerEmail, password, ...extra}});
async function login(c, email = ownerEmail, value = password) {
  const token = (await c.call('/development-challenge?action=admin_login')).json.token;
  return c.call('/auth/login', {body: {email, password: value, turnstileToken: token}});
}
async function add(c, email = 'editor@example.test', role) {
  return c.call('/admin/users', {body: {email, password: tempPassword, ...(role ? {role} : {})}});
}
test('password mode exposes no configured emails and admits only the configured owner once', async (t) => {
  const c = passwordContext(t, {env: {COMMUNITY_INITIAL_DEPUTY_EMAIL: 'deputy@example.test'}});
  const config = (await c.call('/config')).json;
  assert.equal(config.authMode, 'password'); assert.equal(config.needsSetup, true); assert.equal(config.bootstrapAvailable, true);
  assert.ok(!JSON.stringify(config).includes('@'));
  assert.equal((await setup(c, {email: 'intruder@example.test'})).status, 403);
  assert.equal((await setup(c, {password: 'short'})).status, 400);
  const result = await setup(c, {email: ' OWNER@example.test '});
  assert.equal(result.status, 201); assert.equal(result.json.role, 'owner'); assert.equal(result.json.mustChangePassword, false);
  assert.match(result.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Max-Age=28800/);
  assert.equal((await setup(c)).status, 409); assert.equal((await c.call('/config')).json.needsSetup, false);
  assert.equal((await c.call('/admin/users')).json.deputySuggestion.email, 'deputy@example.test');
  const rows = c.db.raw.prepare('SELECT * FROM community_auth_audit').all();
  assert.equal(rows.length, 1); assert.equal(rows[0].action, 'owner_bootstrap');
  assert.ok(!JSON.stringify(rows).includes(password));
});
test('no Access/header/development fallback, guest registration, cross-origin or forged-session access', async (t) => {
  const c = passwordContext(t);
  assert.equal((await c.admin()).status, 404);
  assert.equal((await c.call('/admin/me', {headers: {'Cf-Access-Authenticated-User-Email': ownerEmail, 'Cf-Access-Jwt-Assertion': 'forged'}})).status, 401);
  c.cookie = 'wf_community_admin_dev=' + 'A'.repeat(43);
  assert.equal((await c.call('/auth/me')).status, 401);
  assert.equal((await c.call('/auth/register', {body: {email: ownerEmail, password}})).status, 404);
  assert.equal((await c.call('/auth/bootstrap', {body: {email: ownerEmail, password}, headers: {Origin: 'https://evil.example'}})).status, 403);
  assert.equal((await c.call('/admin/users', {body: {email: ownerEmail, password}})).status, 401);
});
test('editor must change temporary password before team management, then can manage teams only', async (t) => {
  const c = passwordContext(t); await setup(c); const ownerCookie = c.cookie;
  const created = await add(c); assert.equal(created.status, 201); assert.equal(created.json.mustChangePassword, true);
  c.cookie = ''; assert.equal((await login(c, created.json.email, tempPassword)).status, 200);
  assert.equal((await c.call('/auth/me')).json.mustChangePassword, true);
  assert.equal((await c.call('/admin/me')).json.error, 'password_change_required');
  assert.equal((await c.create()).json.error, 'password_change_required');
  const oldCookie = c.cookie;
  assert.equal((await c.call('/auth/password', {body: {currentPassword: tempPassword, newPassword: changedPassword}})).status, 200);
  const newCookie = c.cookie; c.cookie = oldCookie;
  assert.equal((await c.call('/auth/me')).status, 401); c.cookie = newCookie;
  assert.equal((await c.create()).status, 201); assert.equal((await c.call('/admin/users')).status, 403);
  assert.equal((await add(c, 'attacker@example.test', 'owner')).status, 403);
  c.cookie = ownerCookie;
  const users = (await c.call('/admin/users')).json.items;
  assert.equal(users.length, 2); assert.ok(!/password_hash|password_version|session_hash|p1\$/.test(JSON.stringify(users)));
});
test('owner resets/disables editors with CAS, revokes all sessions and cannot disable self', async (t) => {
  const c = passwordContext(t); const owner = (await setup(c)).json, ownerCookie = c.cookie;
  const editor = (await add(c)).json;
  c.cookie = ''; await login(c, editor.email, tempPassword); const editorCookie = c.cookie;
  c.cookie = ownerCookie;
  const reset = await c.call(`/admin/users/${editor.id}`, {method: 'PATCH', body: {expectedRevision: 1, password: changedPassword}});
  assert.equal(reset.status, 200); assert.equal(reset.json.revision, 2); assert.equal(reset.json.mustChangePassword, true);
  assert.equal((await c.call(`/admin/users/${editor.id}`, {method: 'PATCH', body: {expectedRevision: 1, enabled: false}})).status, 409);
  c.cookie = editorCookie; assert.equal((await c.call('/auth/me')).status, 401);
  c.cookie = ''; assert.equal((await login(c, editor.email, tempPassword)).status, 401);
  assert.equal((await login(c, editor.email, changedPassword)).status, 200);
  const resetCookie = c.cookie; c.cookie = ownerCookie;
  assert.equal((await c.call(`/admin/users/${editor.id}`, {method: 'PATCH', body: {expectedRevision: 2, enabled: false}})).status, 200);
  c.cookie = resetCookie; assert.equal((await c.call('/auth/me')).status, 401); c.cookie = ownerCookie;
  assert.equal((await c.call(`/admin/users/${owner.id}`, {method: 'PATCH', body: {expectedRevision: 1, enabled: false}})).status, 403);
  assert.equal((await c.call(`/admin/users/${editor.id}`, {method: 'PATCH', body: {expectedRevision: 3, role: 'owner'}})).status, 400);
  assert.equal((await c.call(`/admin/users/${editor.id}`, {method: 'DELETE'})).status, 404);
});
test('deputy manages ordinary admins only and cannot see suggestions or affect owners/deputies', async (t) => {
  const c = passwordContext(t, {env: {COMMUNITY_INITIAL_DEPUTY_EMAIL: 'deputy@example.test'}});
  const owner = (await setup(c)).json, ownerCookie = c.cookie;
  const deputy = (await add(c, 'deputy@example.test', 'deputy')).json;
  const otherDeputy = (await add(c, 'second-deputy@example.test', 'deputy')).json;
  c.cookie = ''; await login(c, deputy.email, tempPassword);
  await c.call('/auth/password', {body: {currentPassword: tempPassword, newPassword: changedPassword}});
  const editor = await add(c); assert.equal(editor.status, 201); assert.equal(editor.json.role, 'editor');
  assert.equal((await add(c, 'forbidden@example.test', 'deputy')).status, 403);
  for (const target of [owner, otherDeputy])
    assert.equal((await c.call(`/admin/users/${target.id}`, {method: 'PATCH', body: {expectedRevision: target.revision, password: changedPassword}})).status, 403);
  assert.equal((await c.call(`/admin/users/${editor.json.id}`, {method: 'PATCH', body: {expectedRevision: 1, enabled: false}})).status, 200);
  const listed = (await c.call('/admin/users')).json;
  assert.deepEqual(new Set(listed.items.map((u) => u.id)), new Set([deputy.id, editor.json.id]));
  assert.equal(listed.deputySuggestion, undefined); assert.equal((await c.create()).status, 201);
  c.cookie = ownerCookie; assert.equal((await c.call('/admin/users')).json.deputySuggestion, undefined);
});
test('session tokens stored hashed only, eight-hour expiration and logout take effect', async (t) => {
  const c = passwordContext(t); await setup(c);
  const cookie = c.cookie, token = cookie.split('=')[1];
  const row = c.db.raw.prepare('SELECT * FROM community_sessions').get();
  assert.notEqual(row.token_hash, token); assert.equal(row.expires_at - row.created_at, 8 * 3600_000);
  assert.equal((await c.call('/auth/logout', {body: {}})).status, 200);
  c.cookie = cookie; assert.equal((await c.call('/auth/me')).status, 401);
  assert.equal((await login(c)).status, 200); c.now += 8 * 3600_000;
  assert.equal((await c.call('/auth/me')).status, 401);
});
test('password hashing retains spaces, uses random salts, fixed format and a separate pepper', async () => {
  const value = '  untrimmed long password  ', pepper = 'pepper'.repeat(8);
  const first = await hashPassword(value, pepper), second = await hashPassword(value, pepper);
  assert.match(first, /^p1\$100000\$/); assert.notEqual(first, second);
  assert.equal(await checkPassword(value, first, pepper), true);
  assert.equal(await checkPassword(value.trim(), first, pepper), false);
  assert.equal(await checkPassword(value, first, 'another'.repeat(8)), false);
  assert.equal(await checkPassword(value, 'corrupt', pepper), false);
});
test('login hides unknown/disabled/wrong password differences and consumes matching challenge once', async (t) => {
  const c = passwordContext(t); await setup(c);
  const unknown = await login(c, 'unknown@example.test', password);
  const wrong = await login(c, ownerEmail, changedPassword);
  assert.equal(unknown.status, 401); assert.deepEqual(unknown.json, wrong.json);
  const token = (await c.call('/development-challenge?action=like_team')).json.token;
  assert.equal((await c.call('/auth/login', {body: {email: ownerEmail, password, turnstileToken: token}})).status, 403);
  const valid = (await c.call('/development-challenge?action=admin_login')).json.token;
  assert.equal((await c.call('/auth/login', {body: {email: ownerEmail, password, turnstileToken: valid}})).status, 200);
  assert.equal((await c.call('/auth/login', {body: {email: ownerEmail, password, turnstileToken: valid}})).status, 403);
});
test('persistent email/IP rate limits precede hashing and do not store raw addresses', async (t) => {
  const c = passwordContext(t);
  for (let i = 0; i < 8; i++) assert.equal((await login(c, 'unknown@example.test')).status, 401);
  const blocked = await login(c, 'unknown@example.test'); assert.equal(blocked.status, 429); assert.ok(+blocked.headers.get('retry-after') > 0);
  assert.ok(!/unknown@|loopback|192\.0\.2/.test(JSON.stringify(c.db.raw.prepare('SELECT * FROM community_limits').all())));
  c.now += 900_000; assert.equal((await login(c, 'unknown@example.test')).status, 401);
  for (let i = 0; i < 19; i++) await login(c, `unknown${i}@example.test`);
  assert.equal((await login(c, 'one-more@example.test')).status, 429);
  // A full IP bucket rejects before the challenge and writes nothing.
  const token = (await c.call('/development-challenge?action=admin_login')).json.token;
  const changes = () => c.db.raw.prepare('SELECT total_changes() n').get().n, before = changes();
  assert.equal((await c.call('/auth/login', {body: {email: 'flood@example.test', password, turnstileToken: token}})).status, 429);
  assert.equal(changes() - before, 0);
  assert.ok(c.db.raw.prepare('SELECT count FROM community_limits').all().every((row) => row.count <= 20));
});
test('concurrent bootstrap and normalized duplicate creation yield one account and one audit per winner', async (t) => {
  const c = passwordContext(t);
  const bootstrap = await Promise.all([setup(c), setup(c), setup(c)]);
  assert.equal(bootstrap.filter((r) => r.status === 201).length, 1); assert.equal(bootstrap.filter((r) => r.status === 409).length, 2);
  const created = await Promise.all([add(c, 'Same@example.test'), add(c, 'same@example.test')]);
  assert.deepEqual(created.map((r) => r.status).sort(), [201, 409]);
  assert.equal(c.db.raw.prepare('SELECT count(*) AS count FROM community_users').get().count, 2);
  assert.equal(c.db.raw.prepare('SELECT count(*) AS count FROM community_auth_audit').get().count, 2);
});
test('old verified password cannot establish a session after reset or disable', async (t) => {
  const c = passwordContext(t); await setup(c); const user = (await add(c)).json;
  const before = c.db.raw.prepare('SELECT * FROM community_users WHERE id=?').get(user.id);
  await c.call(`/admin/users/${user.id}`, {method: 'PATCH', body: {expectedRevision: 1, password: changedPassword}});
  await assert.rejects(issueSession(c.db, before, c.now, true), (e) => e.code === 'login_failed');
  assert.equal(c.db.raw.prepare('SELECT count(*) AS count FROM community_sessions WHERE user_id=?').get(user.id).count, 0);
});
test('concurrent editor reset has one CAS winner and losing update cannot revoke the winner session', async (t) => {
  const c = passwordContext(t); await setup(c); const user = (await add(c)).json;
  const owner = c.db.raw.prepare("SELECT * FROM community_users WHERE role='owner'").get();
  owner.session_hash = c.db.raw.prepare('SELECT token_hash FROM community_sessions WHERE user_id=?').get(owner.id).token_hash;
  const row = c.db.raw.prepare('SELECT * FROM community_users WHERE id=?').get(user.id);
  const hash = await hashPassword(changedPassword, c.env.COMMUNITY_PASSWORD_PEPPER);
  const winner = await updateEditor(c.db, owner, row, true, hash, c.now);
  await issueSession(c.db, winner, c.now, true);
  await assert.rejects(updateEditor(c.db, owner, row, false, null, c.now), (e) => e.code === 'edit_conflict');
  assert.equal(c.db.raw.prepare('SELECT count(*) AS count FROM community_sessions WHERE user_id=?').get(user.id).count, 1);
});
test('self-password change returns its exact write version, never a concurrent reset version', async (t) => {
  const c = passwordContext(t); await setup(c); const user = (await add(c)).json;
  const owner = c.db.raw.prepare("SELECT * FROM community_users WHERE role='owner'").get();
  owner.session_hash = c.db.raw.prepare('SELECT token_hash FROM community_sessions WHERE user_id=?').get(owner.id).token_hash;
  c.cookie = ''; await login(c, user.email, tempPassword);
  const actor = c.db.raw.prepare('SELECT * FROM community_users WHERE id=?').get(user.id);
  actor.session_hash = c.db.raw.prepare('SELECT token_hash FROM community_sessions WHERE user_id=?').get(user.id).token_hash;
  const hash = await hashPassword(changedPassword, c.env.COMMUNITY_PASSWORD_PEPPER);
  const proxy = {...c.db, async batch(statements) {
    const result = await c.db.batch(statements);
    const current = c.db.raw.prepare('SELECT * FROM community_users WHERE id=?').get(user.id);
    await updateEditor(c.db, owner, current, true, await hashPassword(tempPassword, c.env.COMMUNITY_PASSWORD_PEPPER), c.now);
    return result;
  }};
  const written = await changeOwnPassword(proxy, actor, hash, c.now);
  assert.equal(written.password_version, 2);
  await assert.rejects(issueSession(c.db, written, c.now, true), (e) => e.code === 'login_failed');
});
test('account cap and actor-session guards hold inside transactions', async (t) => {
  const c = passwordContext(t); await setup(c);
  const owner = c.db.raw.prepare("SELECT * FROM community_users WHERE role='owner'").get();
  owner.session_hash = c.db.raw.prepare('SELECT token_hash FROM community_sessions WHERE user_id=?').get(owner.id).token_hash;
  const statement = c.db.raw.prepare(`INSERT INTO community_users(id,email,role,password_hash,must_change_password,created_at,updated_at) VALUES(?,?,'editor',?,1,?,?)`);
  for (let i = 0; i < 49; i++) statement.run(crypto.randomUUID(), `cap${i}@example.test`, owner.password_hash, c.now, c.now);
  await assert.rejects(createEditor(c.db, owner, 'overflow@example.test', owner.password_hash, c.now), (e) => e.code === 'user_limit');
  c.db.raw.prepare("DELETE FROM community_users WHERE email='cap0@example.test'").run();
  c.db.raw.prepare('DELETE FROM community_sessions').run();
  await assert.rejects(createEditor(c.db, owner, 'stale@example.test', owner.password_hash, c.now), (e) => e.code === 'admin_auth_required');
});
test('production bootstrap requires explicit token, secure cookie; login checks action and hostname', async (t) => {
  let verification = {success: true, action: 'admin_login', hostname: 'wiki.example'};
  const c = passwordContext(t, {production: true, env: {COMMUNITY_OWNER_BOOTSTRAP_TOKEN: 't'.repeat(40)},
    fetch: async () => Response.json(verification)});
  for (const bootstrapToken of [undefined, '', 'wrong'.repeat(8)]) assert.equal((await setup(c, {bootstrapToken})).status, 403);
  const result = await setup(c, {bootstrapToken: 't'.repeat(40)});
  assert.equal(result.status, 201); assert.match(result.headers.get('set-cookie'), /__Host-wf_community_admin=/); assert.match(result.headers.get('set-cookie'), /; Secure/);
  assert.equal((await c.call('/auth/login', {body: {email: ownerEmail, password, turnstileToken: 'test-token'}})).status, 200);
  verification = {...verification, action: 'like_team'};
  assert.equal((await c.call('/auth/login', {body: {email: ownerEmail, password, turnstileToken: 'test-token'}})).status, 403);
  c.env.COMMUNITY_PASSWORD_PEPPER = ''; assert.equal((await c.call('/auth/me')).status, 503);
});
test('untrusted bootstrap attempts cannot consume the owner login email allowance', async (t) => {
  const c = passwordContext(t, {production: true, env: {COMMUNITY_OWNER_BOOTSTRAP_TOKEN: 't'.repeat(40)},
    fetch: async () => Response.json({success: true, action: 'admin_login', hostname: 'wiki.example'})});
  await setup(c, {bootstrapToken: 't'.repeat(40)});
  for (let i = 0; i < 8; i++) assert.equal((await setup(c, {bootstrapToken: 'wrong'.repeat(8)})).status, 403);
  assert.equal((await c.call('/auth/login', {body: {email: ownerEmail, password, turnstileToken: 'test-token'},
    headers: {'CF-Connecting-IP': '192.0.2.44'}})).status, 200);
});
test('eight-character passwords work for bootstrap, login, creation, reset and first password change', async (t) => {
  const c = passwordContext(t), original = 'Qa8xTest', reset = 'Rst8Test', changed = 'New8Test';
  assert.throws(() => validatePassword('a'.repeat(7)), (e) => e.code === 'invalid_password');
  assert.throws(() => validatePassword('a'.repeat(129)), (e) => e.code === 'invalid_password');
  assert.equal(validatePassword('a'.repeat(128)).length, 128);
  assert.equal((await setup(c, {password: original})).status, 201);
  await c.call('/auth/logout', {body: {}});
  assert.equal((await login(c, ownerEmail, original)).status, 200);
  const ownerCookie = c.cookie;
  const editor = await c.call('/admin/users', {body: {email: 'length-fixture@example.test', password: original}});
  assert.equal(editor.status, 201);
  c.cookie = ''; assert.equal((await login(c, editor.json.email, original)).status, 200);
  const oldEditorCookie = c.cookie;
  c.cookie = ownerCookie;
  assert.equal((await c.call(`/admin/users/${editor.json.id}`, {method: 'PATCH', body: {expectedRevision: 1, password: reset}})).status, 200);
  c.cookie = oldEditorCookie; assert.equal((await c.call('/auth/me')).status, 401);
  c.cookie = ''; assert.equal((await login(c, editor.json.email, reset)).status, 200);
  assert.equal((await c.call('/admin/me')).json.error, 'password_change_required');
  assert.equal((await c.call('/auth/password', {body: {currentPassword: reset, newPassword: changed}})).status, 200);
  assert.equal((await c.call('/admin/me')).status, 200);
});
