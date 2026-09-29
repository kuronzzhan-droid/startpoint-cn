import {fail} from './model.mjs';
import {sign, verify} from './codecs.mjs';
export const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const COOKIE_AGE = 365 * 86400;
export const csv = (value) => typeof value === 'string' ? value.split(',').map((v) => v.trim()).filter(Boolean) : [];
export function productionReady(env) {
  return Boolean(env.COMMUNITY_DB?.prepare && env.COMMUNITY_COOKIE_SECRET?.length >= 32 && env.COMMUNITY_IP_SALT?.length >= 32 &&
    env.TURNSTILE_SECRET && env.TURNSTILE_SITE_KEY && csv(env.COMMUNITY_ALLOWED_HOSTNAMES).length);
}
export function sameOrigin(request) {
  const expected = new URL(request.url).origin;
  if (request.headers.get('origin') !== expected || request.headers.get('sec-fetch-site') === 'cross-site')
    fail(403, 'invalid_origin', '请从本站页面提交。');
}
export async function readJSON(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    fail(415, 'invalid_content_type', '请使用 JSON 格式提交。');
  if (Number(request.headers.get('content-length')) > 16384) fail(413, 'body_too_large', '提交内容过长。');
  if (!request.body) fail(400, 'invalid_json', '提交内容不能为空。');
  const reader = request.body.getReader(), chunks = []; let size = 0;
  while (true) {
    const {done, value} = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 16384) { await reader.cancel(); fail(413, 'body_too_large', '提交内容过长。'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) {bytes.set(chunk, at); at += chunk.length;}
  try {
    const value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { fail(400, 'invalid_json', 'JSON 格式错误。'); }
}
export function cookieValue(request, name) {
  return request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}
export async function visitor(request, env, now, development) {
  const name = development ? 'wf_community_visitor_dev' : '__Host-wf_community_visitor';
  const value = cookieValue(request, name), parts = value.split('.');
  if (parts.length === 3 && /^[a-f0-9-]{36}$/.test(parts[0]) && /^\d{10,13}$/.test(parts[1])) {
    const issued = Number(parts[1]);
    if (issued <= now && now - issued < COOKIE_AGE * 1000 && await verify(env.COMMUNITY_COOKIE_SECRET, `${parts[0]}.${parts[1]}`, parts[2]))
      return {id: parts[0], cookie: null};
  }
  const id = crypto.randomUUID(), payload = `${id}.${now}`;
  const cookie = `${name}=${payload}.${await sign(env.COMMUNITY_COOKIE_SECRET, payload)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_AGE}${development ? '' : '; Secure'}`;
  return {id, cookie};
}
export async function challenge(request, env, token, action, fetchImpl, development) {
  if (typeof token !== 'string' || !token || token.length > 2048) fail(400, 'challenge_required', '请先完成人机验证。');
  if (development) {
    if (!development.consume(token, action)) fail(403, 'challenge_failed', '本地测试验证已失效，请重新获取。');
    return;
  }
  const hosts = csv(env.COMMUNITY_ALLOWED_HOSTNAMES);
  let result;
  try {
    const response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      body: new URLSearchParams({secret: env.TURNSTILE_SECRET, response: token})
    });
    if (!response.ok) throw new Error(); result = await response.json();
  } catch { fail(503, 'challenge_unavailable', '验证服务暂时不可用，请稍后重试。'); }
  if (result.success !== true || result.action !== action || !hosts.includes(result.hostname) || result.hostname !== new URL(request.url).hostname)
    fail(403, 'challenge_failed', '人机验证失败或已过期，请重新验证。');
}
export async function rateLimit(db, request, env, action, now, development) {
  const ip = development ? 'loopback' : request.headers.get('CF-Connecting-IP');
  if (!ip || ip.length > 100) fail(503, 'client_address_unavailable', '暂时无法验证请求来源。');
  const windowMs = action === 'game_lookup' ? 60_000 : 3600_000, expires = Math.floor(now / windowMs) * windowMs + windowMs;
  const key = `${action}:${await sign(env.COMMUNITY_IP_SALT, `${expires}:${ip}`)}`;
  const max = action === 'game_lookup' ? 300 : 120;
  const row = await db.prepare(`INSERT INTO community_limits(key,count,expires_at) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`).bind(key, expires).first();
  if (row.count > max) fail(429, 'rate_limited', '操作过于频繁，请稍后再试。', {retryAfter: Math.ceil((expires - now) / 1000)});
  await db.prepare('DELETE FROM community_limits WHERE expires_at < ?').bind(now).run();
}
