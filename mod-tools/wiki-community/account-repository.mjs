import {fail} from './model.mjs';

export const findUser = (db, id) => db.prepare('SELECT * FROM community_users WHERE id=?').bind(id).first();
export const findEmail = (db, email) => db.prepare('SELECT * FROM community_users WHERE email=?').bind(email).first();
function audit(db, actor, target, action, now) {
  return db.prepare(`INSERT INTO community_auth_audit(id,actor_id,actor_email,target_id,action,created_at)
    SELECT ?,?,?,?,?,? WHERE changes()>0`).bind(crypto.randomUUID(), actor.id, actor.email, target, action, now);
}
const liveSession = `EXISTS(SELECT 1 FROM community_users a JOIN community_sessions s ON s.user_id=a.id
  WHERE a.id=? AND a.enabled=1 AND a.password_version=s.password_version AND s.token_hash=? AND s.expires_at>?)`;
export async function bootstrapOwner(db, email, passwordHash, now) {
  const id = crypto.randomUUID(), actor = {id, email};
  const result = await db.batch([
    db.prepare(`INSERT INTO community_users(id,email,role,password_hash,must_change_password,created_at,updated_at)
      SELECT ?,?,'owner',?,0,?,? WHERE NOT EXISTS(SELECT 1 FROM community_users WHERE role='owner')`)
      .bind(id, email, passwordHash, now, now), audit(db, actor, id, 'owner_bootstrap', now)
  ]);
  if (!result[0].meta.changes) fail(409, 'setup_complete', '站长账号已经设置，请直接登录。');
  return findUser(db, id);
}
export async function createEditor(db, actor, email, passwordHash, now, role = 'editor') {
  const id = crypto.randomUUID();
  let result;
  try {
    result = await db.batch([
      db.prepare(`INSERT INTO community_users(id,email,role,password_hash,must_change_password,created_at,updated_at)
        SELECT ?,?,?,?,1,?,? WHERE (SELECT count(*) FROM community_users)<50 AND ${liveSession}
        AND EXISTS(SELECT 1 FROM community_users WHERE id=? AND (role='owner' OR (role='deputy' AND ?='editor')))`)
        .bind(id, email, role, passwordHash, now, now, actor.id, actor.session_hash, now, actor.id, role),
      audit(db, actor, id, 'user_create', now)
    ]);
  } catch (error) {
    if (await findEmail(db, email)) fail(409, 'email_exists', '该邮箱登录名已经存在。');
    throw error;
  }
  if (!result[0].meta.changes) {
    if ((await db.prepare('SELECT count(*) AS count FROM community_users').first()).count >= 50)
      fail(409, 'user_limit', '最多创建 50 个管理员账号。');
    fail(401, 'admin_auth_required', '登录已过期，请重新登录。');
  }
  return findUser(db, id);
}
export async function updateEditor(db, actor, row, enabled, passwordHash, now) {
  const revision = row.revision + 1, version = row.password_version + 1;
  const result = await db.batch([
    db.prepare(`UPDATE community_users SET enabled=?,password_hash=?,must_change_password=?,password_version=?,revision=?,updated_at=?
      WHERE id=? AND role<>'owner' AND revision=? AND ${liveSession}
      AND EXISTS(SELECT 1 FROM community_users a WHERE a.id=? AND (a.role='owner' OR (a.role='deputy' AND community_users.role='editor')))`)
      .bind(Number(enabled), passwordHash || row.password_hash, passwordHash ? 1 : row.must_change_password,
        version, revision, now, row.id, row.revision, actor.id, actor.session_hash, now, actor.id),
    audit(db, actor, row.id, passwordHash ? 'password_reset' : enabled ? 'user_enable' : 'user_disable', now),
    db.prepare('DELETE FROM community_sessions WHERE user_id=? AND changes()>0').bind(row.id)
  ]);
  if (!result[0].meta.changes) fail(409, 'edit_conflict', '账号已被修改或登录已过期，请重新加载。');
  return findUser(db, row.id);
}
export async function changeOwnPassword(db, actor, passwordHash, now) {
  const result = await db.batch([
    db.prepare(`UPDATE community_users SET password_hash=?,password_version=password_version+1,must_change_password=0,
      revision=revision+1,updated_at=? WHERE id=? AND enabled=1 AND password_version=? AND revision=? AND ${liveSession}`)
      .bind(passwordHash, now, actor.id, actor.password_version, actor.revision, actor.id, actor.session_hash, now),
    audit(db, actor, actor.id, 'password_change', now),
    db.prepare('DELETE FROM community_sessions WHERE user_id=? AND changes()>0').bind(actor.id)
  ]);
  if (!result[0].meta.changes) fail(409, 'edit_conflict', '账号已被修改或登录已过期，请重新登录。');
  // Return only the exact version we verified and wrote, never a newer concurrent reset.
  return {...actor, password_hash: passwordHash, password_version: actor.password_version + 1,
    revision: actor.revision + 1, must_change_password: 0, updated_at: now};
}
export async function recordLogin(db, actor, now) {
  await db.prepare(`INSERT INTO community_auth_audit(id,actor_id,actor_email,target_id,action,created_at) VALUES(?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), actor.id, actor.email, actor.id, 'login', now).run();
}
