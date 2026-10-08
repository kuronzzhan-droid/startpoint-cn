import {fail} from './model.mjs';
import {maintainLimits} from './limit-maintenance.mjs';
import {readJSON, challenge, cookieValue} from './security.mjs';
import {sign, verify} from './codecs.mjs';
import {normalizeEmail, validatePassword, hashPassword, checkPassword, tokenHash} from './password-crypto.mjs';
import {authenticatePassword, passwordSettings, publicUser, requireAccountManager, issueSession, sessionName, sessionCookie} from './password-auth.mjs';
import {findEmail, findUser, bootstrapOwner, createEditor, updateEditor, changeOwnPassword, recordLogin} from './account-repository.mjs';

const reply = (value, status = 200, cookie) => Response.json(value, {status,
  headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(cookie ? {'Set-Cookie': cookie} : {})}});
const failure = () => fail(401, 'login_failed', '邮箱或密码错误，或账号暂不可用。');
async function limitLogin(request, env, email, now, development, bucket = 'both') {
  const ip = development ? 'loopback' : request.headers.get('CF-Connecting-IP');
  if (!ip || ip.length > 100) fail(503, 'client_address_unavailable', '暂时无法验证请求来源。');
  const expires = Math.floor(now / 900_000) * 900_000 + 900_000;
  const keys = await Promise.all([sign(env.COMMUNITY_IP_SALT, `${expires}:ip:${ip}`), sign(env.COMMUNITY_IP_SALT, `${expires}:email:${email}`)]);
  // Both buckets run before hashing. Login requires a valid challenge before charging the email bucket.
  // A full bucket is left untouched, so rejected attempts cost no D1 row writes.
  for (let i = 0; i < keys.length; i++) {
    if (bucket === 'ip' && i !== 0 || bucket === 'email' && i !== 1) continue;
    const row = await env.COMMUNITY_DB.prepare(`INSERT INTO community_limits(key,count,expires_at) VALUES(?,1,?)
      ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE community_limits.count<? RETURNING count`)
      .bind(`auth:${keys[i]}`, expires, [20, 8][i]).first();
    if (!row) fail(429, 'rate_limited', '登录尝试过于频繁，请稍后再试。', {retryAfter: Math.ceil((expires - now) / 1000)});
  }
  await maintainLimits(env.COMMUNITY_DB, now);
}
function onlyFields(body, allowed) {
  if (Object.keys(body).some((key) => !allowed.includes(key))) fail(400, 'invalid_fields', '提交内容包含不支持的账号字段。');
}
export async function authRoute(path, request, env, now, development, fetchImpl) {
  const db = env.COMMUNITY_DB, config = passwordSettings(env, development);
  if (path === '/auth/me' && request.method === 'GET')
    return reply(publicUser(await authenticatePassword(request, env, now, development, true)));
  if (path === '/auth/logout' && request.method === 'POST') {
    await readJSON(request);
    const token = cookieValue(request, sessionName(development));
    if (/^[A-Za-z0-9_-]{43}$/.test(token)) await db.prepare('DELETE FROM community_sessions WHERE token_hash=?').bind(await tokenHash(token)).run();
    return reply({ok: true}, 200, sessionCookie('', development, 0));
  }
  if (path === '/auth/bootstrap' && request.method === 'POST') {
    const body = await readJSON(request); onlyFields(body, ['email', 'password', 'bootstrapToken']);
    const email = normalizeEmail(body.email);
    await limitLogin(request, env, email, now, development, 'ip');
    if (!config.bootstrapAvailable || email !== config.ownerEmail) fail(403, 'bootstrap_forbidden', '站长初始化信息不匹配或尚未开放。');
    if (!development && (typeof body.bootstrapToken !== 'string' || body.bootstrapToken.length < 32 || body.bootstrapToken.length > 512 ||
      !await verify(env.COMMUNITY_OWNER_BOOTSTRAP_TOKEN, 'wiki-owner-bootstrap', await sign(body.bootstrapToken, 'wiki-owner-bootstrap'))))
      fail(403, 'bootstrap_forbidden', '站长初始化信息不匹配或尚未开放。');
    if (await db.prepare("SELECT id FROM community_users WHERE role='owner'").first()) fail(409, 'setup_complete', '站长账号已经设置，请直接登录。');
    await limitLogin(request, env, email, now, development, 'email');
    const row = await bootstrapOwner(db, email, await hashPassword(body.password, config.pepper), now);
    const session = await issueSession(db, row, now, development);
    return reply(session.user, 201, session.cookie);
  }
  if (path === '/auth/login' && request.method === 'POST') {
    const body = await readJSON(request); onlyFields(body, ['email', 'password', 'turnstileToken']);
    let email;
    try {email = normalizeEmail(body.email);} catch {email = 'invalid-email';}
    await limitLogin(request, env, email, now, development, 'ip');
    await challenge(request, env, body.turnstileToken, 'admin_login', fetchImpl, development);
    await limitLogin(request, env, email, now, development, 'email');
    const row = await findEmail(db, email);
    if (!await checkPassword(body.password, row?.password_hash, config.pepper) || !row?.enabled) failure();
    const session = await issueSession(db, row, now, development);
    await recordLogin(db, row, now);
    return reply(session.user, 200, session.cookie);
  }
  if (path === '/auth/password' && request.method === 'POST') {
    const actor = await authenticatePassword(request, env, now, development, true);
    const body = await readJSON(request); onlyFields(body, ['currentPassword', 'newPassword']);
    await limitLogin(request, env, actor.email, now, development);
    validatePassword(body.newPassword);
    if (!await checkPassword(body.currentPassword, actor.password_hash, config.pepper)) failure();
    if (body.currentPassword === body.newPassword) fail(400, 'password_unchanged', '新密码必须与当前密码不同。');
    const row = await changeOwnPassword(db, actor, await hashPassword(body.newPassword, config.pepper), now);
    const session = await issueSession(db, row, now, development);
    return reply(session.user, 200, session.cookie);
  }
  fail(404, 'not_found', '没有这个登录接口。');
}
export async function accountsRoute(path, request, env, now, development) {
  const actor = await requireAccountManager(request, env, now, development), db = env.COMMUNITY_DB;
  if (path === '/admin/users' && request.method === 'GET') {
    const rows = await db.prepare("SELECT * FROM community_users WHERE ?='owner' OR role='editor' OR id=? ORDER BY role DESC,created_at,id")
      .bind(actor.role, actor.id).all();
    let deputySuggestion;
    if (actor.role === 'owner' && env.COMMUNITY_INITIAL_DEPUTY_EMAIL) {
      let email;
      try {email = normalizeEmail(env.COMMUNITY_INITIAL_DEPUTY_EMAIL);} catch {fail(503, 'auth_not_configured', '预留副站长登录名配置无效。');}
      if (!await findEmail(db, email)) deputySuggestion = {email};
    }
    return reply({items: rows.results.map(publicUser), ...(deputySuggestion ? {deputySuggestion} : {})});
  }
  if (path === '/admin/users' && request.method === 'POST') {
    const body = await readJSON(request); onlyFields(body, ['email', 'password', 'role']);
    const role = body.role ?? 'editor';
    if (!['editor', 'deputy'].includes(role) || role === 'deputy' && actor.role !== 'owner')
      fail(403, 'role_forbidden', '只有站长可以创建副站长，不能通过此接口创建站长。');
    const email = normalizeEmail(body.email), passwordHash = await hashPassword(body.password, passwordSettings(env, development).pepper);
    return reply(publicUser(await createEditor(db, actor, email, passwordHash, now, role)), 201);
  }
  const match = path.match(/^\/admin\/users\/([a-f0-9-]{36})$/);
  if (match && request.method === 'PATCH') {
    const body = await readJSON(request); onlyFields(body, ['expectedRevision', 'enabled', 'password']);
    const row = await findUser(db, match[1]);
    if (!row) fail(404, 'not_found', '账号不存在。');
    if (row.role === 'owner' || row.id === actor.id) fail(403, 'owner_immutable', '站长账号不能通过管理员列表停用或重置，请使用修改自己的密码。');
    if (actor.role === 'deputy' && row.role !== 'editor') fail(403, 'role_forbidden', '副站长只能管理普通管理员账号。');
    if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision !== row.revision)
      fail(409, 'edit_conflict', '账号已被修改，请重新加载。');
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean' || body.enabled === undefined && body.password === undefined)
      fail(400, 'invalid_fields', '请选择启停账号或设置新临时密码。');
    const passwordHash = body.password === undefined ? null : await hashPassword(body.password, passwordSettings(env, development).pepper);
    return reply(publicUser(await updateEditor(db, actor, row, body.enabled ?? Boolean(row.enabled), passwordHash, now)));
  }
  fail(404, 'not_found', '没有这个账号管理接口。');
}
