import test from 'node:test';
import assert from 'node:assert/strict';
import {context, submission, fixtureCatalog} from './helpers.mjs';
import {fingerprint, validateSubmission, chinaDay} from '../model.mjs';

test('阵容指纹固定队长，后两列完整互换等价，交换主合击不等价', async () => {
  const team = submission().team, swapped = structuredClone(team);
  for (const group of Object.keys(team)) [swapped[group][1], swapped[group][2]] = [swapped[group][2], swapped[group][1]];
  assert.equal(await fingerprint(team), await fingerprint(swapped));
  [swapped.main[0], swapped.unison[0]] = [swapped.unison[0], swapped.main[0]];
  assert.notEqual(await fingerprint(team), await fingerprint(swapped));
  const mismatched = structuredClone(team); [mismatched.weapon[1], mismatched.weapon[2]] = [mismatched.weapon[2], mismatched.weapon[1]];
  assert.notEqual(await fingerprint(team), await fingerprint(mismatched));
});
test('可信目录验证角色/魂珠/完整主位/元素/类型而不是客户端内容', () => {
  assert.equal(validateSubmission(submission(), fixtureCatalog).element, '火');
  for (const mutate of [(v) => v.team.main[1] = 'unknown', (v) => v.team.main[1] = '', (v) => v.team.unison[0] = 'c0',
    (v) => v.team.soul[0] = 'w2', (v) => v.element = 'fake', (v) => v.damageTypes = [], (v) => v.damageTypes = ['fake']]) {
    const value = submission(); mutate(value); assert.throws(() => validateSubmission(value, fixtureCatalog));
  }
  const value = submission(); value.element = 'universal'; value.team.unison = ['', '', ''];
  assert.equal(validateSubmission(value, fixtureCatalog).element, 'universal');
});
test('标题与署名单行兼容游戏码客户端，备注可以保留换行', () => {
  for (const field of ['title', 'author']) for (const separator of ['\n', '\r', '\t']) {
    const value = submission(); value[field] = `第一行${separator}第二行`;
    assert.throws(() => validateSubmission(value, fixtureCatalog));
  }
  const value = submission(); value.notes = '第一行\n第二行';
  assert.equal(validateSubmission(value, fixtureCatalog).notes, value.notes);
});
test('游客不能创建，伪邮箱头不获管理员权限', async (t) => {
  const app = context(); t.after(() => app.close());
  assert.equal((await app.call('/teams', {body: submission()})).status, 403);
  assert.equal((await app.create()).status, 401);
  assert.equal((await app.call('/admin/teams', {body: submission(), headers: {'Cf-Access-Authenticated-User-Email': 'admin@example.test'}})).status, 401);
  assert.equal(app.db.raw.prepare('SELECT count(*) AS n FROM community_teams').get().n, 0);
  const config = (await app.call('/config')).json;
  assert.equal(config.canSubmit, false); assert.equal(config.publishing, 'admin');
});
test('管理员创建立即公开并留下审计，元数据不同不重复收录阵容', async (t) => {
  const app = context(); t.after(() => app.close()); await app.admin();
  const created = await app.create(); assert.equal(created.status, 201); assert.equal(created.json.team.status, 'approved');
  assert.equal(created.json.team.element, '火');
  const value = submission(); value.title = '换个名字'; value.notes = '换备注'; value.element = 'universal'; value.damageTypes = ['direct'];
  const duplicate = await app.create(value); assert.equal(duplicate.status, 409); assert.equal(duplicate.json.existingId, created.json.team.id);
  assert.equal(app.db.raw.prepare('SELECT count(*) AS n FROM community_audit').get().n, 1);
  assert.equal((await app.call('/teams')).json.items.length, 1);
});
test('真实SQLite并发同阵容创建只保存一次且只审计一次', async (t) => {
  const app = context(); t.after(() => app.close()); await app.admin();
  const result = await Promise.all(Array.from({length: 12}, () => app.create()));
  assert.equal(result.filter((item) => item.status === 201).length, 1);
  assert.equal(result.filter((item) => item.status === 409).length, 11);
  assert.equal(app.db.raw.prepare('SELECT count(*) AS n FROM community_audit').get().n, 1);
});
test('隐藏队伍不在公共目录，不能点赞，重复不可通过重新投稿洗白', async (t) => {
  const app = context(); t.after(() => app.close()); await app.admin();
  const id = (await app.create()).json.team.id;
  assert.equal((await app.call(`/admin/teams/${id}`, {method: 'PATCH', body: {expectedRevision: 1, status: 'hidden'}})).status, 200);
  assert.equal((await app.call('/teams')).json.items.length, 0);
  assert.equal((await app.call(`/teams/${id}`)).status, 404);
  assert.equal((await app.create()).json.status, 'hidden');
  const token = await app.challenge();
  assert.equal((await app.call(`/teams/${id}/like`, {body: {turnstileToken: token}})).status, 404);
  assert.equal(app.db.raw.prepare('SELECT count(*) AS n FROM community_likes').get().n, 0);
});
test('每日点赞真实SQLite并发唯一计数及北京时间次日恢复', async (t) => {
  const app = context(); t.after(() => app.close()); await app.admin(); const id = (await app.create()).json.team.id;
  await app.call('/config');
  const tokens = await Promise.all(Array.from({length: 20}, () => app.challenge()));
  const results = await Promise.all(tokens.map((token) => app.call(`/teams/${id}/like`, {body: {turnstileToken: token}})));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 19);
  assert.equal(app.db.raw.prepare('SELECT likes FROM community_teams WHERE id=?').get(id).likes, 1);
  assert.equal((await app.call(`/teams/${id}`)).json.team.likedToday, true);
  app.now += 120_000;
  assert.equal(chinaDay(app.now).date, '2026-09-30');
  const next = await app.call(`/teams/${id}/like`, {body: {turnstileToken: await app.challenge()}});
  assert.equal(next.status, 200); assert.equal(next.json.likes, 2);
});
test('验证缺失、重放、动作不匹配不创建点赞', async (t) => {
  const app = context(); t.after(() => app.close()); await app.admin(); const id = (await app.create()).json.team.id;
  assert.equal((await app.call(`/teams/${id}/like`, {body: {turnstileToken: ''}})).status, 400);
  assert.equal((await app.call(`/teams/${id}/like`, {body: {turnstileToken: 'fake'}})).status, 403);
  const token = await app.challenge(); await app.call(`/teams/${id}/like`, {body: {turnstileToken: token}});
  assert.equal((await app.call(`/teams/${id}/like`, {body: {turnstileToken: token}})).status, 403);
  assert.equal(app.db.raw.prepare('SELECT count(*) AS n FROM community_likes').get().n, 1);
});
test('同源及请求大小门禁，无数据库或secret明确503', async (t) => {
  const app = context(); t.after(() => app.close()); await app.admin();
  assert.equal((await app.call('/admin/teams', {body: submission(), headers: {Origin: 'https://evil.example'}})).status, 403);
  assert.equal((await app.call('/admin/teams', {body: 'x'.repeat(17000)})).status, 413);
  app.env.COMMUNITY_COOKIE_SECRET = ''; const result = await app.call('/config');
  assert.equal(result.status, 503); assert.equal(result.json.enabled, false);
  assert.equal(app.db.raw.prepare('SELECT count(*) AS n FROM community_teams').get().n, 0);
});
test('管理员并发修改revision冲突不覆盖，并审计身份和前后内容', async (t) => {
  const app = context(); t.after(() => app.close()); await app.admin(); const id = (await app.create()).json.team.id;
  const results = await Promise.all(['修改A', '修改B'].map((title) => app.call(`/admin/teams/${id}`, {method: 'PATCH', body: {title, expectedRevision: 1}})));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const audit = app.db.raw.prepare("SELECT * FROM community_audit WHERE action='update'").all();
  assert.equal(audit.length, 1); assert.equal(audit[0].actor_email, 'dev-admin@example.test');
  assert.equal(JSON.parse(audit[0].before_json).title, '测试盘');
});
test('分页游标支持中文分类、热门排序及多伤害AND筛选', async (t) => {
  const app = context(); t.after(() => app.close()); await app.admin();
  for (let i = 0; i < 30; i++) {
    const value = submission(); value.team.unison = ['', '', '']; value.team.main = ['c0', `c${1 + i % 5}`, `c${6 + Math.floor(i / 5)}`];
    value.damageTypes = i % 2 ? ['skill'] : ['skill', 'direct']; assert.equal((await app.create(value)).status, 201);
  }
  const first = (await app.call('/teams?element=%E7%81%AB&sort=popular')).json;
  assert.equal(first.items.length, 24); assert.ok(first.nextCursor);
  const second = (await app.call(`/teams?element=%E7%81%AB&sort=popular&cursor=${first.nextCursor}`)).json;
  assert.equal(second.items.length, 6); assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 30);
  assert.equal((await app.call('/teams?damage=skill,direct')).json.items.length, 15);
});
