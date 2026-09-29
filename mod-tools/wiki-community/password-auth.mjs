import {fail} from './model.mjs';
import {cookieValue} from './security.mjs';
import {normalizeEmail, randomSession, tokenHash} from './password-crypto.mjs';

export const SESSION_MS = 8 * 3600_000;
export function authMode(env) {
  const mode = env.COMMUNITY_AUTH_MODE || 'access';
  if (!['access', 'password'].includes(mode)) fail(503, 'auth_not_configured', '管理员登录方式配置无效。');
  return mode;
}
export function passwordSettings(env, development) {
  if (typeof env.COMMUNITY_PASSWORD_PEPPER !== 'string' || env.COMMUNITY_PASSWORD_PEPPER.length < 32)
    fail(503, 'auth_not_configured', '管理员密码登录尚未配置。');
  let ownerEmail;
  try {ownerEmail = normalizeEmail(env.COMMUNITY_OWNER_EMAIL);} catch {fail(503, 'auth_not_configured', '站长登录名尚未配置。');}
  return {ownerEmail, pepper: env.COMMUNITY_PASSWORD_PEPPER,
    bootstrapAvailable: Boolean(development || typeof env.COMMUNITY_OWNER_BOOTSTRAP_TOKEN === 'string' && env.COMMUNITY_OWNER_BOOTSTRAP_TOKEN.length >= 32)};
}
export function publicUser(row) {
  return {id: row.id, email: row.email, role: row.role, enabled: Boolean(row.enabled), revision: row.revision,
    mustChangePassword: Boolean(row.must_change_password)};
}
export const sessionName = (development) => development ? 'wf_community_admin_dev' : '__Host-wf_community_admin';
export function sessionCookie(token, development, expires = SESSION_MS / 1000) {
  return `${sessionName(development)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${expires}${development ? '' : '; Secure'}`;
}
export async function passwordConfig(env, development) {
  const config = passwordSettings(env, development);
  const owner = await env.COMMUNITY_DB.prepare("SELECT id FROM community_users WHERE role='owner' LIMIT 1").first();
  return {authMode: 'password', needsSetup: !owner, bootstrapAvailable: !owner && config.bootstrapAvailable};
}
export async function authenticatePassword(request, env, now, development, restricted = false) {
  passwordSettings(env, development);
  const token = cookieValue(request, sessionName(development));
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fail(401, 'admin_auth_required', '请先使用管理员账号登录。');
  const hash = await tokenHash(token);
  const row = await env.COMMUNITY_DB.prepare(`SELECT u.* FROM community_users u JOIN community_sessions s ON s.user_id=u.id
    WHERE s.token_hash=? AND s.expires_at>? AND s.password_version=u.password_version AND u.enabled=1`).bind(hash, now).first();
  if (!row) fail(401, 'admin_auth_required', '登录已过期，请重新登录。');
  if (!restricted && row.must_change_password) fail(403, 'password_change_required', '请先修改管理员为你设置的临时密码。');
  return {...row, session_hash: hash};
}
export async function issueSession(db, row, now, development) {
  const token = randomSession(), hash = await tokenHash(token);
  // An async password check cannot authorize a login after a concurrent password reset/disable.
  const inserted = await db.prepare(`INSERT INTO community_sessions(token_hash,user_id,password_version,created_at,expires_at)
    SELECT ?,id,password_version,?,? FROM community_users WHERE id=? AND enabled=1 AND password_version=? AND password_hash=?`)
    .bind(hash, now, now + SESSION_MS, row.id, row.password_version, row.password_hash).run();
  if (!inserted.meta.changes) fail(401, 'login_failed', '邮箱或密码错误，或账号暂不可用。');
  await db.prepare('DELETE FROM community_sessions WHERE expires_at<=?').bind(now).run();
  return {cookie: sessionCookie(token, development), user: publicUser(row)};
}
export async function requireAccountManager(request, env, now, development) {
  const actor = await authenticatePassword(request, env, now, development);
  if (!['owner', 'deputy'].includes(actor.role)) fail(403, 'owner_required', '只有站长或副站长可以管理管理员账号。');
  return actor;
}
