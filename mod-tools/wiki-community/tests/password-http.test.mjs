import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, realpath, readdir, rm, symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startLocalServer} from '../local-server.mjs';
import {openDatabase} from '../sqlite-adapter.mjs';
import {localSecrets} from '../local-secrets.mjs';
import {fixtureCatalog, submission} from './helpers.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wf-wiki-password-test-')), site = path.join(root, 'site');
  await mkdir(site); await writeFile(path.join(site, 'index.html'), '<!doctype html><title>Password test</title>');
  return {root, site, db: path.join(root, 'community.sqlite')};
}
test('real HTTP password login, deputy onboarding and restart preserve accounts and secrets', async (t) => {
  const files = await fixture(t), settings = {...files, ownerEmail: 'owner@example.test', deputyEmail: 'deputy@example.test', trustedCatalog: fixtureCatalog};
  let app = await startLocalServer(settings), cookie = '';
  t.after(async () => {await app?.close(); await rm(files.root, {recursive: true, force: true});});
  async function call(route, body, method = body ? 'POST' : 'GET') {
    const response = await fetch(`${app.origin}/api/community${route}`, {method,
      headers: {Origin: app.origin, 'Content-Type': 'application/json', Cookie: cookie}, ...(body ? {body: JSON.stringify(body)} : {})});
    if (response.headers.get('set-cookie')) {
      const value = response.headers.get('set-cookie').split(';')[0], name = value.split('=')[0];
      cookie = [...cookie.split('; ').filter((item) => item && !item.startsWith(`${name}=`)), value].join('; ');
    }
    return {status: response.status, json: await response.json()};
  }
  assert.equal((await call('/development-admin-login', {})).status, 404);
  const password = 'private owner password 123456';
  assert.equal((await call('/auth/bootstrap', {email: settings.ownerEmail, password})).status, 201);
  const ownerCookie = cookie;
  const created = await call('/admin/users', {email: settings.deputyEmail, role: 'deputy', password: 'temporary deputy password 123'});
  assert.equal(created.status, 201);
  const secretsPath = files.db + '.secrets.json', before = await readFile(secretsPath, 'utf8');
  assert.ok(!before.includes(password));
  await app.close(); app = null; app = await startLocalServer(settings);
  assert.equal(await readFile(secretsPath, 'utf8'), before);
  cookie = ownerCookie; assert.equal((await call('/auth/me')).json.role, 'owner');
  assert.equal((await call('/config')).json.needsSetup, false);
  cookie = '';
  const token = (await call('/development-challenge?action=admin_login')).json.token;
  assert.equal((await call('/auth/login', {email: settings.deputyEmail, password: 'temporary deputy password 123', turnstileToken: token})).status, 200);
  assert.equal((await call('/admin/users')).status, 403);
  assert.equal((await call('/auth/password', {currentPassword: 'temporary deputy password 123', newPassword: 'private deputy password 456'})).status, 200);
  assert.equal((await call('/admin/teams', submission())).status, 201);
  assert.equal((await call('/admin/users')).json.items[0].role, 'deputy');
  assert.equal((await fetch(app.origin + '/community.sqlite.secrets.json')).status, 404);
});
test('legacy database migrates without losing teams while existing password accounts require original secrets', async (t) => {
  const files = await fixture(t), old = openDatabase(files.db);
  t.after(() => rm(files.root, {recursive: true, force: true}));
  old.raw.prepare(`INSERT INTO community_teams(id,fingerprint,title,notes,author,team_json,element,damage_mask,status,created_at,updated_at)
    VALUES('old-team','old-fingerprint','legacy','note','author','{}','火',1,'approved',1,1)`).run();
  old.close();
  const first = await localSecrets(files.db, files.site);
  assert.equal(first.database, await realpath(files.db)); assert.equal(first.secrets.COMMUNITY_PASSWORD_PEPPER.length, 64);
  const migrated = openDatabase(files.db);
  assert.equal(migrated.raw.prepare('SELECT title FROM community_teams').get().title, 'legacy');
  migrated.raw.prepare(`INSERT INTO community_users(id,email,role,password_hash,must_change_password,created_at,updated_at)
    VALUES('owner','owner@example.test','owner','fixture-hash',0,1,1)`).run(); migrated.close();
  await rm(files.db + '.secrets.json');
  await assert.rejects(localSecrets(files.db, files.site), /restore their original secrets/);
});
test('private files cannot live under static site, malformed secrets are never regenerated', async (t) => {
  const files = await fixture(t);
  t.after(() => rm(files.root, {recursive: true, force: true}));
  await assert.rejects(localSecrets(path.join(files.site, 'public.sqlite'), files.site), /outside the static site/);
  await writeFile(files.db + '.secrets.json', '{broken-secret');
  await assert.rejects(localSecrets(files.db, files.site), /restore it instead of regenerating/);
  assert.equal(await readFile(files.db + '.secrets.json', 'utf8'), '{broken-secret');
});

test('static directory aliases cannot bypass private file containment', async (t) => {
  const files = await fixture(t), alias = path.join(files.root, 'site-alias');
  t.after(() => rm(files.root, {recursive: true, force: true}));
  // Windows junctions need no symlink privilege and reproduce long/short path comparison.
  await symlink(files.site, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(await realpath(alias), await realpath(files.site));
  for (const site of [files.site, alias]) {
    for (const directory of [files.site, alias]) {
      await assert.rejects(localSecrets(path.join(directory, 'private.sqlite'), site), /outside the static site/);
      assert.deepEqual(await readdir(files.site), ['index.html'], 'rejection must not create private files');
    }
  }
  const first = await localSecrets(files.db, alias), second = await localSecrets(files.db, files.site);
  assert.equal(first.database, path.join(await realpath(files.root), 'community.sqlite'));
  assert.deepEqual(second, first, 'site aliases preserve the existing private secrets');
});

test('missing private file parents are rejected without creating directories', async (t) => {
  const files = await fixture(t), missing = path.join(files.root, 'missing');
  t.after(() => rm(files.root, {recursive: true, force: true}));
  await assert.rejects(localSecrets(path.join(missing, 'community.sqlite'), files.site), {code: 'ENOENT'});
  assert.deepEqual((await readdir(files.root)).sort(), ['site']);
});
test('private database and secret symlinks are rejected when host supports them', async (t) => {
  const files = await fixture(t), target = path.join(files.root, 'target'); await writeFile(target, '{}');
  t.after(() => rm(files.root, {recursive: true, force: true}));
  try {await symlink(target, files.db + '.secrets.json', 'file');}
  catch (error) {if (['EPERM', 'EACCES'].includes(error.code)) {t.skip('Windows host does not permit symlink creation'); return;} throw error;}
  await assert.rejects(localSecrets(files.db, files.site), /not a link/);
});
