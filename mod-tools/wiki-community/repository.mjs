import {PAGE_SIZE, DAMAGE_TYPES, fail, nextCursor, teamRecord} from './model.mjs';
const SELECT_TEAM = `SELECT community_teams.*,(SELECT code FROM community_game_codes
  WHERE team_id=community_teams.id AND fingerprint=community_teams.fingerprint AND revoked_at IS NULL) AS game_code FROM community_teams`;
export const findTeam = (db, id) => db.prepare(`${SELECT_TEAM} WHERE id=?`).bind(id).first();
export async function listTeams(db, query, admin = false) {
  const clauses = [], values = [];
  if (query.status) { clauses.push('status=?'); values.push(query.status); }
  if (query.element) { clauses.push('element=?'); values.push(query.element); }
  if (query.category) { clauses.push('category=?'); values.push(query.category === 'uncategorized' ? '' : query.category); }
  if (query.section) { clauses.push('section=?'); values.push(query.section === 'general' ? '' : query.section); }
  if (query.mask) { clauses.push('(damage_mask & ?) = ?'); values.push(query.mask, query.mask); }
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
    (id,fingerprint,title,notes,author,team_json,element,category,section,damage_mask,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(fingerprint) DO NOTHING`).bind(id, fingerprint,
    value.title, value.notes, value.author, JSON.stringify(value.team), value.element, value.category, value.section, value.damageMask, status, now, now),
    db.prepare(`INSERT INTO community_audit(id,team_id,actor_id,actor_email,action,before_json,after_json,created_at)
      SELECT ?,id,?,?,?,?,?,? FROM community_teams WHERE id=? AND changes()=1`)
      .bind(crypto.randomUUID(), actor.id, actor.email, 'create', 'null', JSON.stringify({...value, status}), now, id)]);
  if (!results[0].meta.changes) {
    const existing = await db.prepare('SELECT id,status FROM community_teams WHERE fingerprint=?').bind(fingerprint).first();
    fail(409, 'duplicate', existing.status === 'approved' ? '这个阵容已经收录。' : '这个阵容已收录，暂不展示。', {existingId: existing.id, status: existing.status});
  }
  return teamRecord(await findTeam(db, id), true);
}
export async function likeTeam(db, id, visitorId, day, now) {
  const result = await db.prepare(`INSERT INTO community_likes(team_id,visitor_id,day,created_at)
    SELECT id,?,?,? FROM community_teams WHERE id=? AND status='approved'
    ON CONFLICT(team_id,visitor_id,day) DO NOTHING`).bind(visitorId, day.date, now, id).run();
  const team = await findTeam(db, id);
  if (!team || team.status !== 'approved') fail(404, 'not_found', '队伍不存在或暂不展示。');
  const response = {id, likes: team.likes, likedToday: true, nextLikeAt: day.nextLikeAt};
  if (!result.meta.changes) fail(409, 'already_liked', '今天已经为这个盘子点过赞。', response);
  return response;
}
export async function editTeam(db, row, value, fingerprint, status, actor, now) {
  const revision = row.revision + 1;
  const after = {...teamRecord(row, true), ...value, damageTypes: DAMAGE_TYPES.filter((_, i) => value.damageMask & (1 << i)),
    status, revision, gameCode: fingerprint === row.fingerprint && status === 'approved' ? row.game_code || null : null,
    updatedAt: new Date(now).toISOString()};
  const statements = [
    db.prepare(`UPDATE community_teams SET fingerprint=?,title=?,notes=?,author=?,team_json=?,element=?,category=?,section=?,damage_mask=?,status=?,updated_at=?,revision=?
      WHERE id=? AND revision=?`).bind(fingerprint, value.title, value.notes, value.author, JSON.stringify(value.team), value.element,
      value.category, value.section, value.damageMask, status, now, revision, row.id, row.revision),
    db.prepare(`INSERT INTO community_audit(id,team_id,actor_id,actor_email,action,before_json,after_json,created_at)
      SELECT ?,id,?,?,?,?,?,? FROM community_teams WHERE id=? AND revision=? AND changes()=1`)
      .bind(crypto.randomUUID(), actor.id, actor.email, 'update', JSON.stringify(teamRecord(row, true)), JSON.stringify(after), now, row.id, revision),
    db.prepare(`UPDATE community_game_codes SET revoked_at=? WHERE team_id=? AND (fingerprint<>? OR ?='hidden') AND revoked_at IS NULL AND changes()>0
      AND EXISTS(SELECT 1 FROM community_teams WHERE id=? AND revision=?)`).bind(now, row.id, fingerprint, status, row.id, revision)
  ];
  let results;
  try { results = await db.batch(statements); }
  catch (error) {
    if (!String(error.message).includes('UNIQUE constraint')) throw error;
    const existing = await db.prepare('SELECT id,status FROM community_teams WHERE fingerprint=?').bind(fingerprint).first();
    if (existing) fail(409, 'duplicate', '修改后的阵容已收录，请保留原盘。', {existingId: existing.id, status: existing.status});
    throw error;
  }
  if (!results[0].meta.changes) fail(409, 'edit_conflict', '其他管理员已修改该盘，请重新加载后再编辑。');
  return teamRecord(await findTeam(db, row.id), true);
}
