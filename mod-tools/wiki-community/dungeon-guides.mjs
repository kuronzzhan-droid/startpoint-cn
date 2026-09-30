import {fail, teamRecord} from './model.mjs';
import {requireDungeon, requireEditor, guideInput, rawGuide, placeholders, imageMetadata, managesImages, audit} from './dungeon-model.mjs';

const findGuide = (db, id) => db.prepare('SELECT * FROM community_dungeon_guides WHERE id=?').bind(id).first();
async function linkedTeams(db, ids) {
  if (!ids.length) return [];
  const rows = (await db.prepare(`SELECT t.*,(SELECT code FROM community_game_codes c WHERE c.team_id=t.id
    AND c.fingerprint=t.fingerprint AND c.revoked_at IS NULL) AS game_code FROM community_teams t
    WHERE t.id IN (${placeholders(ids)}) AND t.visibility='public' AND t.status='approved'`).bind(...ids).all()).results;
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.filter((id) => byId.has(id)).map((id) => teamRecord(byId.get(id)));
}
export async function readGuide(db, catalog, id, actor = null) {
  requireDungeon(catalog, id);
  const guide = rawGuide(id, await findGuide(db, id));
  const teams = await linkedTeams(db, guide.teamIds);
  // Never expose references, codes, notes or character data of a team made private/hidden after linking.
  guide.teamIds = teams.map((team) => team.id);
  let rows = [];
  if (guide.imageIds.length) rows = (await db.prepare(`SELECT id,dungeon_id,width,height,bytes FROM community_dungeon_images
    WHERE dungeon_id=? AND id IN (${placeholders(guide.imageIds)})`).bind(id, ...guide.imageIds).all()).results;
  const byId = new Map(rows.map((row) => [row.id, row]));
  guide.imageIds = guide.imageIds.filter((imageId) => byId.has(imageId));
  guide.images = guide.imageIds.map((imageId) => imageMetadata(byId.get(imageId), Boolean(actor)));
  const result = {guide, teams};
  if (actor) {
    const available = (await db.prepare(`SELECT id,dungeon_id,width,height,bytes FROM community_dungeon_images i WHERE dungeon_id=?
      AND (created_by=? OR ?=1 OR EXISTS(SELECT 1 FROM community_dungeon_guides g,json_each(g.image_ids_json) j
        WHERE g.id=i.dungeon_id AND j.value=i.id)) ORDER BY created_at,id`)
      .bind(id, actor.id, Number(managesImages(actor))).all()).results;
    result.availableImages = available.map((row) => imageMetadata(row, true));
  }
  return result;
}
function referenceChecks(value, id, actor) {
  const team = value.teamIds.length ? `(SELECT COUNT(*) FROM community_teams WHERE id IN (${placeholders(value.teamIds)})
    AND visibility='public' AND status='approved')=${value.teamIds.length}` : '1=1';
  const images = value.imageIds.length ? `(SELECT COUNT(*) FROM community_dungeon_images i WHERE i.dungeon_id=?
    AND i.id IN (${placeholders(value.imageIds)}) AND (i.created_by=? OR ?=1 OR EXISTS(
      SELECT 1 FROM community_dungeon_guides g,json_each(g.image_ids_json) j WHERE g.id=i.dungeon_id AND j.value=i.id)))=${value.imageIds.length}` : '1=1';
  return {sql: `${team} AND ${images}`,
    values: [...value.teamIds, ...(value.imageIds.length ? [id, ...value.imageIds, actor.id, Number(managesImages(actor))] : [])]};
}
export async function writeGuide(db, catalog, id, body, actor, now) {
  requireEditor(actor); requireDungeon(catalog, id);
  const value = guideInput(body), row = await findGuide(db, id), before = rawGuide(id, row);
  if (before.revision !== value.expectedRevision) fail(409, 'edit_conflict', '攻略已被其他管理员修改，请重新加载后编辑。');
  const revision = before.revision + 1, refs = referenceChecks(value, id, actor);
  const contents = [value.text, JSON.stringify(value.teamIds), JSON.stringify(value.imageIds)];
  const write = before.revision === 0 ? db.prepare(`INSERT INTO community_dungeon_guides(id,text,team_ids_json,image_ids_json,revision,updated_at)
    SELECT ?,?,?,?,?,? WHERE ${refs.sql} ON CONFLICT(id) DO NOTHING`).bind(id, ...contents, revision, now, ...refs.values) :
    db.prepare(`UPDATE community_dungeon_guides SET text=?,team_ids_json=?,image_ids_json=?,revision=?,updated_at=?
      WHERE id=? AND revision=? AND ${refs.sql}`).bind(...contents, revision, now, id, before.revision, ...refs.values);
  const after = {id, text: value.text, teamIds: value.teamIds, imageIds: value.imageIds, revision, updatedAt: new Date(now).toISOString()};
  const results = await db.batch([write, audit(db, id, actor, 'guide_update', before, after, now,
    'EXISTS(SELECT 1 FROM community_dungeon_guides WHERE id=? AND revision=?)', [id, revision])]);
  if (!results[0].meta.changes) {
    const latest = await findGuide(db, id);
    if ((latest?.revision || 0) !== before.revision) fail(409, 'edit_conflict', '攻略已被其他管理员修改，请重新加载后编辑。');
    fail(409, 'references_unavailable', '队伍已隐藏、移入个人空间，或图片已移除、无权使用；请重新选择后保存。');
  }
  return readGuide(db, catalog, id, actor);
}
