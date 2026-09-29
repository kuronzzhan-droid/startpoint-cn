// Imported only by the loopback server/tests, never by the Pages Functions entry.
import {cookieValue, readJSON} from './security.mjs';
import {sign, verify} from './codecs.mjs';
import {fail} from './model.mjs';
export function developmentTools(secret, now = Date.now) {
  const challenges = new Map();
  return {
    consume(token, action) {
      const item = challenges.get(token); challenges.delete(token);
      return Boolean(item && item.action === action && item.expires > now());
    },
    async admin(request) {
      const [expiry, signature] = cookieValue(request, 'wf_community_dev_admin').split('.');
      if (!expiry || !signature || Number(expiry) <= now() || !await verify(secret, `dev-admin:${expiry}`, signature))
        fail(401, 'admin_auth_required', '请先点击本地测试管理员登录。');
      return {id: 'development-admin', email: 'dev-admin@example.test'};
    },
    async route(path, request, mode = 'access') {
      if (path === '/development-challenge' && request.method === 'GET') {
        const action = new URL(request.url).searchParams.get('action');
        if (!['like_team', 'admin_login', 'rate_character'].includes(action)) fail(400, 'invalid_action', '本地验证动作无效。');
        for (const [key, item] of challenges) if (item.expires < now()) challenges.delete(key);
        if (challenges.size > 1000) fail(429, 'rate_limited', '本地测试验证过多。', {retryAfter: 300});
        const token = `development-only-${crypto.randomUUID()}`;
        challenges.set(token, {action, expires: now() + 300_000});
        return Response.json({token, development: true}, {headers: {'Cache-Control': 'no-store'}});
      }
      if (path === '/development-admin-login' && request.method === 'POST' && mode === 'access') {
        await readJSON(request);
        const expiry = now() + 3600_000;
        const value = `${expiry}.${await sign(secret, `dev-admin:${expiry}`)}`;
        return Response.json({id: 'development-admin', email: 'dev-admin@example.test', development: true},
          {headers: {'Set-Cookie': `wf_community_dev_admin=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600`, 'Cache-Control': 'no-store'}});
      }
      return null;
    }
  };
}
