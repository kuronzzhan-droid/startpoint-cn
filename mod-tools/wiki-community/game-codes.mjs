import {fail} from './model.mjs';
import {findAdminTeam} from './repository.mjs';
import {adminTeamScope} from './team-access.mjs';
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const GAME_CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/;
function randomCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => ALPHABET[byte & 31]).join('');
}
export async function gameCodeInfo(db, row, actor) {
  const current = await findAdminTeam(db, row.id, actor);
  if (!current) fail(404, 'not_found', '队伍不存在。');
  if (current.revision !== row.revision) fail(409, 'edit_conflict', '队伍已被修改，请重新加载。');
  const active = current.status === 'approved' && Boolean(current.game_code);
  return {gameCode: active ? current.game_code : null, active, teamRevision: current.revision};
}
export async function resolveGameCode(db, code) {
  if (!GAME_CODE_PATTERN.test(code)) fail(404, 'not_found', '队伍码不存在或已失效。');
  const row = await db.prepare(`SELECT t.title,t.team_json FROM community_game_codes AS c JOIN community_teams AS t ON t.id=c.team_id
    WHERE c.code=? AND c.revoked_at IS NULL AND t.status='approved' AND t.fingerprint=c.fingerprint`).bind(code).first();
  if (!row) fail(404, 'not_found', '队伍码不存在或已失效。');
  return {title: row.title, active: true, team: JSON.parse(row.team_json)};
}
export async function createGameCode(db, row, actor, now) {
  const current = await gameCodeInfo(db, row, actor); if (current.active) return current;
  if (row.status !== 'approved') fail(409, 'team_not_public', '此队伍已被隐藏停用，请先恢复可用状态再生成游戏队伍码。');
  const access = adminTeamScope(actor);
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = randomCode();
    const results = await db.batch([
      db.prepare(`INSERT INTO community_game_codes(code,team_id,fingerprint,created_at)
        SELECT ?,id,fingerprint,? FROM community_teams WHERE id=? AND revision=? AND status='approved' AND ${access.sql} ON CONFLICT DO NOTHING`)
        .bind(code, now, row.id, row.revision, ...access.values),
      db.prepare(`INSERT INTO community_audit(id,team_id,actor_id,actor_email,action,before_json,after_json,created_at)
        SELECT ?,team_id,?,?,?,?,?,? FROM community_game_codes WHERE code=? AND changes()=1`)
        .bind(crypto.randomUUID(), actor.id, actor.email, 'game_code_create', 'null', JSON.stringify({code}), now, code)
    ]);
    if (results[0].meta.changes) return {gameCode: code, active: true, teamRevision: row.revision};
    const latest = await findAdminTeam(db, row.id, actor);
    if (!latest) fail(404, 'not_found', '队伍不存在。');
    if (latest.revision !== row.revision) fail(409, 'edit_conflict', '队伍已被修改，请重新加载。');
    const duplicate = await gameCodeInfo(db, latest, actor); if (duplicate.active) return duplicate;
  }
  fail(503, 'code_unavailable', '暂时无法生成队伍码，请稍后重试。');
}
export async function revokeGameCode(db, row, actor, now) {
  const access = adminTeamScope(actor);
  const results = await db.batch([
    db.prepare(`UPDATE community_game_codes SET revoked_at=? WHERE team_id=? AND revoked_at IS NULL
      AND EXISTS(SELECT 1 FROM community_teams WHERE id=? AND revision=? AND ${access.sql})`)
      .bind(now, row.id, row.id, row.revision, ...access.values),
    db.prepare(`INSERT INTO community_audit(id,team_id,actor_id,actor_email,action,before_json,after_json,created_at)
      SELECT ?,id,?,?,?,?,?,? FROM community_teams WHERE id=? AND revision=? AND changes()>0`)
      .bind(crypto.randomUUID(), actor.id, actor.email, 'game_code_revoke', JSON.stringify({code: row.game_code || null}),
        JSON.stringify({active: false}), now, row.id, row.revision)
  ]);
  const latest = await findAdminTeam(db, row.id, actor);
  if (!latest) fail(404, 'not_found', '队伍不存在。');
  if (!results[0].meta.changes && latest.revision !== row.revision) fail(409, 'edit_conflict', '队伍已被修改，请重新加载。');
  return {gameCode: null, active: false, teamRevision: row.revision};
}
