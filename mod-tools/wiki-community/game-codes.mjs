import {fail} from './model.mjs';
import {findTeam} from './repository.mjs';
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const GAME_CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/;
function randomCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => ALPHABET[byte & 31]).join('');
}
export async function gameCodeInfo(db, row) {
  const found = await db.prepare('SELECT code FROM community_game_codes WHERE team_id=? AND fingerprint=? AND revoked_at IS NULL')
    .bind(row.id, row.fingerprint).first();
  const active = row.status === 'approved' && Boolean(found);
  return {gameCode: active ? found.code : null, active, teamRevision: row.revision};
}
export async function resolveGameCode(db, code) {
  if (!GAME_CODE_PATTERN.test(code)) fail(404, 'not_found', '队伍码不存在或已失效。');
  const row = await db.prepare(`SELECT t.title,t.team_json FROM community_game_codes AS c JOIN community_teams AS t ON t.id=c.team_id
    WHERE c.code=? AND c.revoked_at IS NULL AND t.status='approved' AND t.fingerprint=c.fingerprint`).bind(code).first();
  if (!row) fail(404, 'not_found', '队伍码不存在或已失效。');
  return {title: row.title, active: true, team: JSON.parse(row.team_json)};
}
export async function createGameCode(db, row, actor, now) {
  if (row.status !== 'approved') fail(409, 'team_not_public', '请先公开此队伍，再生成游戏队伍码。');
  const current = await gameCodeInfo(db, row); if (current.active) return current;
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = randomCode();
    const results = await db.batch([
      db.prepare(`INSERT INTO community_game_codes(code,team_id,fingerprint,created_at)
        SELECT ?,id,fingerprint,? FROM community_teams WHERE id=? AND revision=? AND status='approved' ON CONFLICT DO NOTHING`)
        .bind(code, now, row.id, row.revision),
      db.prepare(`INSERT INTO community_audit(id,team_id,actor_id,actor_email,action,before_json,after_json,created_at)
        SELECT ?,team_id,?,?,?,?,?,? FROM community_game_codes WHERE code=? AND changes()=1`)
        .bind(crypto.randomUUID(), actor.id, actor.email, 'game_code_create', 'null', JSON.stringify({code}), now, code)
    ]);
    if (results[0].meta.changes) return {gameCode: code, active: true, teamRevision: row.revision};
    const latest = await findTeam(db, row.id);
    if (!latest || latest.revision !== row.revision) fail(409, 'edit_conflict', '队伍已被修改，请重新加载。');
    const duplicate = await gameCodeInfo(db, latest); if (duplicate.active) return duplicate;
  }
  fail(503, 'code_unavailable', '暂时无法生成队伍码，请稍后重试。');
}
export async function revokeGameCode(db, row, actor, now) {
  const results = await db.batch([
    db.prepare(`UPDATE community_game_codes SET revoked_at=? WHERE team_id=? AND revoked_at IS NULL
      AND EXISTS(SELECT 1 FROM community_teams WHERE id=? AND revision=?)`).bind(now, row.id, row.id, row.revision),
    db.prepare(`INSERT INTO community_audit(id,team_id,actor_id,actor_email,action,before_json,after_json,created_at)
      SELECT ?,id,?,?,?,?,?,? FROM community_teams WHERE id=? AND revision=? AND changes()>0`)
      .bind(crypto.randomUUID(), actor.id, actor.email, 'game_code_revoke', JSON.stringify({code: row.game_code || null}),
        JSON.stringify({active: false}), now, row.id, row.revision)
  ]);
  const latest = await findTeam(db, row.id);
  if (!results[0].meta.changes && latest?.revision !== row.revision) fail(409, 'edit_conflict', '队伍已被修改，请重新加载。');
  return {gameCode: null, active: false, teamRevision: row.revision};
}
