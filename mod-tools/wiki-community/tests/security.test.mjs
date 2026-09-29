import test from 'node:test';
import assert from 'node:assert/strict';
import {context, submission, jwtFixture} from './helpers.mjs';
import {authenticateAdmin} from '../admin-auth.mjs';
import {sign} from '../codecs.mjs';
import {rateLimit, challenge} from '../security.mjs';

const jwt = await jwtFixture();
const now = Date.parse('2026-09-29T15:59:00Z');
const jwksFetch = async (url) => {
  assert.equal(url, 'https://wiki-test.cloudflareaccess.com/cdn-cgi/access/certs');
  return Response.json({keys: [jwt.jwk]});
};
test('生产Access签名、issuer、audience、expiry、nbf、email白名单均验证', async (t) => {
  const app = context({production: true, fetch: jwksFetch}); t.after(() => app.close());
  const correct = await jwt.token(now);
  const make = (token) => new Request('https://wiki.example/api/community/admin/me', {headers: {'Cf-Access-Jwt-Assertion': token}});
  assert.deepEqual(await authenticateAdmin(make(correct), app.env, jwksFetch, now), {id: 'admin-id', email: 'admin@example.test'});
  for (const claims of [{iss: 'https://evil.example'}, {aud: ['other-audience']}, {exp: Math.floor(now / 1000)},
    {nbf: Math.floor(now / 1000) + 60}, {email: 'other@example.test'}, {email: ''}, {sub: ''}, {type: 'org'}])
    await assert.rejects(() => jwt.token(now, claims).then((token) => authenticateAdmin(make(token), app.env, jwksFetch, now)));
  const pieces = correct.split('.'); pieces[2] = pieces[2].slice(0, -5) + 'AAAAA';
  await assert.rejects(() => authenticateAdmin(make(pieces.join('.')), app.env, jwksFetch, now));
  await assert.rejects(() => jwt.token(now, {}, {alg: 'HS256'}).then((token) => authenticateAdmin(make(token), app.env, jwksFetch, now)));
});
test('生产登录不能靠裸邮箱头、开发Cookie或任意JWKS主机伪造', async (t) => {
  const app = context({production: true, fetch: jwksFetch}); t.after(() => app.close());
  const forged = await app.call('/admin/me', {headers: {'Cf-Access-Authenticated-User-Email': 'admin@example.test', Cookie: 'wf_community_dev_admin=fake'}});
  assert.equal(forged.status, 401);
  app.env.ACCESS_TEAM_DOMAIN = 'evil.example';
  assert.equal((await app.call('/admin/me', {headers: {'Cf-Access-Jwt-Assertion': await jwt.token(now)}})).status, 503);
});
test('生产管理员可以创建、匿名只可点赞；无生产开发登录接口', async (t) => {
  const app = context({production: true, fetch: async (url) => url.includes('/certs') ? jwksFetch(url) : Response.json({success: true, action: 'like_team', hostname: 'wiki.example'})});
  t.after(() => app.close()); const token = await jwt.token(now);
  const result = await app.call('/admin/teams', {body: submission(), headers: {'Cf-Access-Jwt-Assertion': token}});
  assert.equal(result.status, 201);
  assert.equal((await app.call('/teams', {body: submission()})).status, 403);
  assert.equal((await app.call('/development-admin-login', {body: {}})).status, 404);
  assert.equal((await app.call('/development-challenge?action=like_team')).status, 404);
  const like = await app.call(`/teams/${result.json.team.id}/like`, {body: {turnstileToken: 'official-token-fixture'}});
  assert.equal(like.status, 200);
});
test('生产Turnstile拒绝失败/错误hostname/action，不写赞；超时明确503', async (t) => {
  for (const verify of [{success: false}, {success: true, hostname: 'evil.example', action: 'like_team'},
    {success: true, hostname: 'wiki.example', action: 'create_team'}, null]) {
    const app = context({production: true, fetch: async (url) => {
      if (url.includes('/certs')) return jwksFetch(url);
      assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
      if (!verify) throw new Error('Offline'); return Response.json(verify);
    }}); t.after(() => app.close());
    const row = await app.call('/admin/teams', {body: submission(), headers: {'Cf-Access-Jwt-Assertion': await jwt.token(now)}});
    const result = await app.call(`/teams/${row.json.team.id}/like`, {body: {turnstileToken: 'test-token'}});
    assert.equal(result.status, verify ? 403 : 503);
    assert.equal(app.db.raw.prepare('SELECT count(*) AS n FROM community_likes').get().n, 0);
  }
});
test('签名匿名Cookie篡改不复用身份，生产secure/HttpOnly/SameSite', async (t) => {
  const app = context({production: true, fetch: jwksFetch}); t.after(() => app.close());
  const response = await app.call('/config'), cookie = response.headers.get('Set-Cookie');
  assert.match(cookie, /__Host-wf_community_visitor=/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /; Secure/);
  const saved = app.cookie; assert.equal((await app.call('/config')).headers.get('set-cookie'), null);
  app.cookie = saved.slice(0, -5) + 'AAAAA';
  assert.ok((await app.call('/config')).headers.get('set-cookie')); assert.notEqual(app.cookie, saved);
});

test('验证接口不跟随重定向，且不会把密钥发给另一个主机', async () => {
  const request = new Request('https://wiki.example/api/community/auth/login');
  const env = {TURNSTILE_SECRET: 'fixture-only', COMMUNITY_ALLOWED_HOSTNAMES: 'wiki.example'};
  let calls = 0;
  const redirect = async (_url, options) => {
    calls++; assert.equal(options.redirect, 'manual'); assert.ok(options.signal instanceof AbortSignal);
    return new Response(null, {status: 302, headers: {Location: 'https://untrusted.example/'}});
  };
  await assert.rejects(challenge(request, env, 'fixture-only', 'admin_login', redirect, null),
    (error) => error.status === 503 && error.code === 'challenge_unavailable');
  assert.equal(calls, 1);
  await assert.rejects(challenge(request, env, 'fixture-only', 'admin_login', async () => Response.json(null), null),
    (error) => error.status === 403 && error.code === 'challenge_failed');
});

test('Access JWKS读取同样拒绝重定向，不缓存错误密钥', async (t) => {
  const app = context({production: true}); t.after(() => app.close());
  const request = new Request('https://wiki.example/api/community/admin/me', {headers: {'Cf-Access-Jwt-Assertion': await jwt.token(now)}});
  await assert.rejects(authenticateAdmin(request, app.env, async (_url, options) => {
    assert.equal(options.redirect, 'manual');
    return new Response(null, {status: 302, headers: {Location: 'https://untrusted.example/keys'}});
  }, now), (error) => error.status === 503 && error.code === 'admin_auth_unavailable');
  assert.equal((await authenticateAdmin(request, app.env, jwksFetch, now)).id, 'admin-id');
});
test('IP辅助限频原子执行只落HMAC标识并返回可读重试时间', async (t) => {
  const app = context({production: true, fetch: jwksFetch}); t.after(() => app.close());
  const req = new Request('https://wiki.example/api/community/teams', {headers: {'CF-Connecting-IP': '192.0.2.55'}});
  await Promise.all(Array.from({length: 120}, () => rateLimit(app.db, req, app.env, 'like', now)));
  await assert.rejects(() => rateLimit(app.db, req, app.env, 'like', now), (error) => error.status === 429 && error.extra.retryAfter > 0);
  const row = app.db.raw.prepare('SELECT * FROM community_limits').get();
  assert.equal(row.count, 121); assert.ok(!JSON.stringify(row).includes('192.0.2.55'));
});
test('未绑定D1或真实Turnstile配置生产明确503，环境开发旗标不生效', async (t) => {
  const app = context({production: true, fetch: jwksFetch}); t.after(() => app.close());
  app.env.DEVELOPMENT = true; app.env.TURNSTILE_SECRET = '';
  assert.equal((await app.call('/config')).status, 503);
  app.env.TURNSTILE_SECRET = 'test'; app.env.COMMUNITY_DB = null;
  assert.equal((await app.call('/config')).status, 503);
});
