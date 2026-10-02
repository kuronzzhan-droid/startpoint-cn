import {openDatabase} from '../sqlite-adapter.mjs';
import {createCommunityHandler} from '../handler.mjs';
import {developmentTools} from '../development.mjs';
import {base64url, encodeJSON, utf8} from '../codecs.mjs';
export const fixtureCatalog = {version: 'test', elements: ['火', '水', '无'],
  characters: Object.fromEntries(Array.from({length: 12}, (_, i) => [`c${i}`, {element: i ? '水' : '火'}])),
  equipment: {w0: {soul: true}, w1: {soul: true}, w2: {soul: false}}};
export const submission = () => ({title: '测试盘', author: '测试署名', notes: '只在临时测试数据库保存', category: '萌新启航', element: 'auto', damageTypes: ['skill'],
  team: {main: ['c0', 'c1', 'c2'], unison: ['c3', 'c4', 'c5'], weapon: ['w0', 'w1', ''], soul: ['w1', 'w0', '']}});
export function envFor(db) {
  return {COMMUNITY_DB: db, COMMUNITY_COOKIE_SECRET: 'c'.repeat(40), COMMUNITY_IP_SALT: 'i'.repeat(40),
    COMMUNITY_ALLOWED_HOSTNAMES: 'wiki.example', TURNSTILE_SECRET: 'test-secret', TURNSTILE_SITE_KEY: 'test-key',
    ACCESS_TEAM_DOMAIN: 'wiki-test.cloudflareaccess.com', ACCESS_AUD: 'test-audience', ADMIN_EMAILS: 'admin@example.test'};
}
export async function jwtFixture() {
  const keys = await crypto.subtle.generateKey({name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'}, true, ['sign', 'verify']);
  const jwk = {...await crypto.subtle.exportKey('jwk', keys.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig'};
  return {jwk, async token(now, extra = {}, header = {}) {
    const first = encodeJSON({alg: 'RS256', kid: 'test-key', ...header});
    const second = encodeJSON({iss: 'https://wiki-test.cloudflareaccess.com', aud: ['test-audience'], type: 'app', sub: 'admin-id',
      email: 'admin@example.test', exp: Math.floor(now / 1000) + 3600, nbf: Math.floor(now / 1000) - 1, ...extra});
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, utf8.encode(`${first}.${second}`));
    return `${first}.${second}.${base64url(new Uint8Array(sig))}`;
  }};
}
export function context(options = {}) {
  let now = Date.parse('2026-09-29T15:59:00Z');
  const db = options.db || openDatabase(), env = {...envFor(db), ...options.env};
  const development = options.production ? undefined : developmentTools(env.COMMUNITY_COOKIE_SECRET, () => now);
  const handle = createCommunityHandler(options.catalog || fixtureCatalog, {development, now: () => now, ...(options.fetch ? {fetch: options.fetch} : {})});
  const origin = options.production ? 'https://wiki.example' : 'http://127.0.0.1:8890';
  let cookie = '';
  async function call(route, settings = {}) {
    const method = settings.method || (settings.body ? 'POST' : 'GET');
    const headers = {Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1', Cookie: cookie, ...settings.headers};
    const request = new Request(`${origin}/api/community${route}`, {method, headers,
      ...(settings.body !== undefined ? {body: typeof settings.body === 'string' ? settings.body : JSON.stringify(settings.body)} : {})});
    const result = await handle(request, env);
    const newCookie = result.headers.get('set-cookie');
    if (newCookie) {
      const value = newCookie.split(';')[0], name = value.split('=')[0];
      cookie = [...cookie.split('; ').filter((item) => item && !item.startsWith(`${name}=`)), value].join('; ');
    }
    return {status: result.status, headers: result.headers, json: result.status === 302 ? null : await result.json()};
  }
  return {db, env, call, handle, origin, get now() {return now;}, set now(value) {now = value;}, get cookie() {return cookie;}, set cookie(value) {cookie = value;},
    async admin() {return call('/development-admin-login', {body: {}});},
    async challenge() {return (await call('/development-challenge?action=like_team')).json.token;},
    async create(value = submission()) {return call('/admin/teams', {body: value});}, close() {db.close();}};
}
