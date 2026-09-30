import {PAGE_SIZE, DAMAGE_TYPES, fail, nextCursor, teamRecord} from './model.mjs';
import {adminTeamScope, isPublicTeam, requireVisibilityChange, duplicateTeam, managesPrivateTeams} from './team-access.mjs';
const SELECT_TEAM = `SELECT community_teams.*,(SELECT code FROM community_game_codes
  WHERE team_id=community_teams.id AND fingerprint=community_teams.fingerprint AND revoked_at IS NULL) AS game_code FROM community_teams`;
export const findTeam = (db, id) => db.prepare(`${SELECT_TEAM} WHERE id=?`).bind(id).first();
export function findAdminTeam(db, id, actor) {
  const access = adminTeamScope(actor);
  return db.prepare(`${SELECT_TEAM} WHERE id=? AND ${access.sql}`).bind(id, ...access.values).first();
}
export async function listTeams(db, query, admin = false, actor = null) {
  const clauses = [], values = [];
  if (admin) {
    const access = adminTeamScope(actor); clauses.push(access.sql); values.push(...access.values);
    if (query.scope === 'public') clauses.push("visibility='public'");
    if (query.scope === 'mine') {clauses.push("visibility='private' AND created_by=?"); values.push(actor.id);}
    if (query.scope === 'private') {
      if (!managesPrivateTeams(actor)) fail(403, 'manager_required', '只有站长或副站长可以查看全部个人空间。');
      clauses.push("visibility='private'");
    }
  } else clauses.push("visibility='public' AND status='approved'");
  if (query.status) { clauses.push('status=?'); values.push(query.status); }
  if (query.element) { clauses.push('element=?'); values.push(query.element); }
  if (query.category) { clauses.push('category=?'); values.push(query.category === 'uncategorized' ? '' : query.category); }
  if (query.section) { clauses.push('section=?'); values.push(query.section === 'general' ? '' : query.section); }
  if (query.character) {
    clauses.push(`(EXISTS(SELECT 1 FROM json_each(community_teams.team_json,'$.main') AS slot WHERE slot.type='text' AND slot.value=?)
      OR EXISTS(SELECT 1 FROM json_each(community_teams.team_json,'$.unison') AS slot WHERE slot.type='text' AND slot.value=?))`);
    values.push(query.character, query.character);
  }
  if (query.mask) { clauses.push('(damage_mask & ?) = ?'); values.push(query.mask, query.mask); }
  if (query.code) clauses.push(`${query.code === 'none' ? 'NOT ' : ''}(status='approved' AND EXISTS(SELECT 1 FROM community_game_codes c
    WHERE c.team_id=community_teams.id AND c.fingerprint=community_teams.fingerprint AND c.revoked_at IS NULL))`);
  if (admin && query.q) {
    const term = `%${query.q.replace(/[\\%_]/g, '\\$&')}%`;
    clauses.push(`(title LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\' OR (status='approved' AND EXISTS(
      SELECT 1 FROM community_game_codes c WHERE c.team_id=community_teams.id AND c.fingerprint=community_teams.fingerprint
      AND c.revoked_at IS NULL AND c.code LIKE ? ESCAPE '\\')))`);
    values.push(term, term, term);
  }
  if (query.cursor) {
    const c = query.cursor;
    const time = '(created_at < ? OR (created_at = ? AND id < ?))';
    if (query.sort === 'popular') {
      clauses.push(`(likes < ? OR (likes = ? AND ${time}))`);
      values.push(c.likes, c.likes, c.createdAt, c.createdAt, c.id);
    } else { clauses.push(time); values.push(c.createdAt, c.createdAt, c.id); }
  }
  const order = query.sort === 'popular' ? 'likes DESC,created_at DESC,id DESC' : 'created_at DESC,id DESC';
  const rows = (await db.prepare(`${SELECT_TEAM} ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY ${order} LIMIT ?`).bind(...values, PAGE_SIZE + 1).all()).results;
  const visible = rows.slice(0, PAGE_SIZE);
  return {items: visible.map((row) => teamRecord(row, admin)), nextCursor: rows.length > PAGE_SIZE ? nextCursor(query, visible.at(-1)) : null};
}
export async function insertTeam(db, value, fingerprint, now, status, actor) {
  const id = crypto.randomUUID();
  const results = await db.batch([db.prepare(`INSERT INTO community_teams
    (id,fingerprint,title,notes,author,team_json,element,category,section,visibility,created_by,damage_mask,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(fingerprint) DO NOTHING`).bind(id, fingerprint,
    value.title, value.notes, value.author, JSON.stringify(value.team), value.element, value.category, value.section,
    value.visibility, actor.id, value.damageMask, status, now, now),
    db.prepare(`INSERT INTO community_audit(id,team_id,actor_id,actor_email,action,before_json,after_json,created_at)
      SELECT ?,id,?,?,?,?,?,? FROM community_teams WHERE id=? AND changes()=1`)
      .bind(crypto.randomUUID(), actor.id, actor.email, 'create', 'null', JSON.stringify({...value, status, createdBy: actor.id}), now, id)]);
  if (!results[0].meta.changes) {
    const existing = await db.prepare('SELECT id,status,visibility,created_by FROM community_teams WHERE fingerprint=?').bind(fingerprint).first();
    duplicateTeam(existing, actor);
  }
  return teamRecord(await findTeam(db, id), true);
}
export async function likeTeam(db, id, visitorId, day, now) {
  const result = await db.prepare(`INSERT INTO community_likes(team_id,visitor_id,day,created_at)
    SELECT id,?,?,? FROM community_teams WHERE id=? AND status='approved' AND visibility='public'
    ON CONFLICT(team_id,visitor_id,day) DO NOTHING`).bind(visitorId, day.date, now, id).run();
  const team = await findTeam(db, id);
  if (!isPublicTeam(team)) fail(404, 'not_found', '队伍不存在或暂不展示。');
  const response = {id, likes: team.likes, likedToday: true, nextLikeAt: day.nextLikeAt};
  if (!result.meta.changes) fail(409, 'already_liked', '今天已经为这个盘子点过赞。', response);
  return response;
}
export async function editTeam(db, row, value, fingerprint, status, actor, now, action = 'update') {
  requireVisibilityChange(row, value.visibility, actor);
  const access = adminTeamScope(actor);
  const revision = row.revision + 1;
  const after = {...teamRecord(row, true), ...value, damageTypes: DAMAGE_TYPES.filter((_, i) => value.damageMask & (1 << i)),
    status, revision, gameCode: fingerprint === row.fingerprint && status === 'approved' ? row.game_code || null : null,
    updatedAt: new Date(now).toISOString()};
  const statements = [
    db.prepare(`UPDATE community_teams SET fingerprint=?,title=?,notes=?,author=?,team_json=?,element=?,category=?,section=?,visibility=?,damage_mask=?,status=?,updated_at=?,revision=?
      WHERE id=? AND revision=? AND ${access.sql} AND (?='public' OR created_by=? OR ?=1)`)
      .bind(fingerprint, value.title, value.notes, value.author, JSON.stringify(value.team), value.element,
        value.category, value.section, value.visibility, value.damageMask, status, now, revision, row.id, row.revision,
        ...access.values, value.visibility, actor.id, Number(managesPrivateTeams(actor))),
    db.prepare(`INSERT INTO community_audit(id,team_id,actor_id,actor_email,action,before_json,after_json,created_at)
      SELECT ?,id,?,?,?,?,?,? FROM community_teams WHERE id=? AND revision=? AND changes()=1`)
      .bind(crypto.randomUUID(), actor.id, actor.email, action, JSON.stringify(teamRecord(row, true)), JSON.stringify(after), now, row.id, revision),
    db.prepare(`UPDATE community_game_codes SET revoked_at=? WHERE team_id=? AND (fingerprint<>? OR ?='hidden') AND revoked_at IS NULL AND changes()>0
      AND EXISTS(SELECT 1 FROM community_teams WHERE id=? AND revision=?)`).bind(now, row.id, fingerprint, status, row.id, revision)
  ];
  let results;
  try { results = await db.batch(statements); }
  catch (error) {
    if (!String(error.message).includes('UNIQUE constraint')) throw error;
    const existing = await db.prepare('SELECT id,status,visibility,created_by FROM community_teams WHERE fingerprint=?').bind(fingerprint).first();
    if (existing) duplicateTeam(existing, actor);
    throw error;
  }
  const latest = await findAdminTeam(db, row.id, actor);
  if (!latest) fail(404, 'not_found', '队伍不存在。');
  if (!results[0].meta.changes) fail(409, 'edit_conflict', '其他管理员已修改该盘，请重新加载后再编辑。');
  return teamRecord(latest, true);
}
export function deleteTeam(db, row, actor, now) {
  // Retain the record and audit history; the existing hidden transition revokes every active code atomically.
  // Do not revalidate an old roster against today's catalog just to remove it from circulation.
  const value = {...teamRecord(row, true), damageMask: row.damage_mask};
  return editTeam(db, row, value, row.fingerprint, 'hidden', actor, now, 'delete');
}
