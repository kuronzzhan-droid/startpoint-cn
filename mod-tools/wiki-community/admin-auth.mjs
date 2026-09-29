import {decodeJSON, unbase64, utf8} from './codecs.mjs';
import {fail} from './model.mjs';
import {csv} from './security.mjs';
const keyCache = new Map();
function settings(env) {
  const domain = String(env.ACCESS_TEAM_DOMAIN || '').replace(/^https:\/\//, '').replace(/\/$/, '');
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain) || !env.ACCESS_AUD || !csv(env.ADMIN_EMAILS).length)
    fail(503, 'admin_not_configured', '管理员登录尚未配置。');
  return {issuer: `https://${domain}`, audience: env.ACCESS_AUD, emails: csv(env.ADMIN_EMAILS).map((email) => email.toLowerCase())};
}
async function getKeys(issuer, fetchImpl, now) {
  const cacheKey = `${issuer}`;
  const cached = keyCache.get(cacheKey);
  if (cached && cached.expires > now && cached.fetchImpl === fetchImpl) return cached.keys;
  let result;
  try {
    const response = await fetchImpl(`${issuer}/cdn-cgi/access/certs`, {redirect: 'error', signal: AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error(); result = await response.json();
    if (!Array.isArray(result.keys) || result.keys.length > 20) throw new Error();
  } catch { fail(503, 'admin_auth_unavailable', '管理员身份验证暂时不可用。'); }
  keyCache.set(cacheKey, {keys: result.keys, expires: now + 300_000, fetchImpl});
  return result.keys;
}
export async function authenticateAdmin(request, env, fetchImpl, now, development) {
  if (development) return development.admin(request);
  const config = settings(env);
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || '';
  if (!token || token.length > 16384) fail(401, 'admin_auth_required', '请先使用管理员账号登录。');
  let header, payload, parts;
  try {
    parts = token.split('.'); if (parts.length !== 3) throw new Error();
    header = decodeJSON(parts[0]); payload = decodeJSON(parts[1]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length > 200) throw new Error();
  } catch { fail(401, 'admin_auth_required', '管理员身份令牌无效。'); }
  const keys = await getKeys(config.issuer, fetchImpl, now);
  const jwk = keys.find((key) => key.kid === header.kid && key.kty === 'RSA' && (!key.alg || key.alg === 'RS256') && (!key.use || key.use === 'sig'));
  let valid = false;
  try {
    if (jwk) {
      const key = await crypto.subtle.importKey('jwk', jwk, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['verify']);
      valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unbase64(parts[2]), utf8.encode(`${parts[0]}.${parts[1]}`));
    }
  } catch { valid = false; }
  const seconds = Math.floor(now / 1000);
  if (!valid || payload.type !== 'app' || payload.iss !== config.issuer || !Array.isArray(payload.aud) || !payload.aud.includes(config.audience) ||
      !Number.isSafeInteger(payload.exp) || payload.exp <= seconds ||
      (payload.nbf !== undefined && (!Number.isSafeInteger(payload.nbf) || payload.nbf > seconds)) ||
      typeof payload.email !== 'string' || typeof payload.sub !== 'string' || !payload.sub || !config.emails.includes(payload.email.toLowerCase()))
    fail(403, 'admin_forbidden', '此登录身份无管理员权限或已过期。');
  return {id: payload.sub, email: payload.email.toLowerCase()};
}
