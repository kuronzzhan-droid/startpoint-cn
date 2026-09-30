import {fail} from './model.mjs';
import {requireDungeon, requireEditor, IMAGE_QUOTAS, imageMetadata, managesImages, audit} from './dungeon-model.mjs';
import {inspectImage} from './dungeon-image-format.mjs';

const REFERENCED = `EXISTS(SELECT 1 FROM community_dungeon_guides g,json_each(g.image_ids_json) j
  WHERE g.id=community_dungeon_images.dungeon_id AND j.value=community_dungeon_images.id)`;
function imageAccess(actor) {
  return {sql: `(${REFERENCED} OR created_by=? OR ?=1)`, values: [actor?.id || '', Number(managesImages(actor))]};
}
export async function readImage(db, catalog, imageId, actor = null, dungeonId = null) {
  if (actor) requireEditor(actor);
  const access = imageAccess(actor);
  const row = await db.prepare(`SELECT * FROM community_dungeon_images WHERE id=? AND ${actor ? access.sql : REFERENCED}
    ${dungeonId ? 'AND dungeon_id=?' : ''}`).bind(imageId, ...(actor ? access.values : []), ...(dungeonId ? [dungeonId] : [])).first();
  if (!row) fail(404, 'not_found', '图片不存在或尚未公开。');
  requireDungeon(catalog, row.dungeon_id);
  // D1 returns a BLOB as an array; node:sqlite returns Uint8Array. Both are normalized here.
  const bytes = new Uint8Array(row.data);
  return new Response(bytes, {headers: {'Content-Type': row.mime, 'Content-Length': String(bytes.length),
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline',
    'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'same-origin'}});
}
export async function uploadImage(db, catalog, id, bytes, mime, actor, now) {
  requireEditor(actor); requireDungeon(catalog, id);
  const info = inspectImage(bytes, mime), imageId = crypto.randomUUID();
  const metadata = {id: imageId, dungeon_id: id, ...info};
  const data = new Uint8Array(bytes).buffer;
  const statements = [db.prepare(`INSERT INTO community_dungeon_images(id,dungeon_id,mime,data,bytes,width,height,created_by,created_at)
    SELECT ?,?,?,?,?,?,?,?,? WHERE
      (SELECT COALESCE(SUM(bytes),0) FROM community_dungeon_images)+?<=? AND
      (SELECT COALESCE(SUM(bytes),0) FROM community_dungeon_images WHERE created_by=?)+?<=? AND
      (SELECT COALESCE(SUM(bytes),0) FROM community_dungeon_images WHERE dungeon_id=?)+?<=? AND
      (SELECT COUNT(*) FROM community_dungeon_audit WHERE actor_id=? AND action='image_upload' AND created_at>?)<20`)
    .bind(imageId, id, info.mime, data, info.bytes, info.width, info.height, actor.id, now,
      info.bytes, IMAGE_QUOTAS.site, actor.id, info.bytes, IMAGE_QUOTAS.actor, id, info.bytes, IMAGE_QUOTAS.dungeon, actor.id, now - 3600_000),
    audit(db, id, actor, 'image_upload', null, imageMetadata(metadata), now,
      'EXISTS(SELECT 1 FROM community_dungeon_images WHERE id=?)', [imageId])];
  const results = await db.batch(statements);
  if (!results[0].meta.changes) {
    const uploads = await db.prepare("SELECT COUNT(*) n FROM community_dungeon_audit WHERE actor_id=? AND action='image_upload' AND created_at>?")
      .bind(actor.id, now - 3600_000).first();
    if (uploads.n >= 20) fail(429, 'upload_rate_limited', '每位管理员每小时最多上传 20 张图片，请稍后再试。', {retryAfter: 3600});
    fail(409, 'image_storage_full', '攻略图片存储配额已满，请联系站长清理未引用图片后重试。');
  }
  return {image: imageMetadata(metadata, true)};
}
export async function deleteImage(db, catalog, id, imageId, actor, now) {
  requireEditor(actor); requireDungeon(catalog, id);
  const row = await db.prepare(`SELECT id,dungeon_id,bytes,width,height,${REFERENCED} AS referenced
    FROM community_dungeon_images WHERE id=? AND dungeon_id=? AND (created_by=? OR ?=1)`)
    .bind(imageId, id, actor.id, Number(managesImages(actor))).first();
  if (!row) fail(404, 'not_found', '图片不存在或无权删除。');
  if (row.referenced) fail(409, 'image_in_use', '图片仍在攻略中使用，请先编辑攻略移除图片并保存。');
  const results = await db.batch([
    db.prepare(`DELETE FROM community_dungeon_images WHERE id=? AND dungeon_id=? AND (created_by=? OR ?=1) AND NOT ${REFERENCED}`)
      .bind(imageId, id, actor.id, Number(managesImages(actor))),
    audit(db, id, actor, 'image_delete', imageMetadata(row), null, now, '1=1', [])
  ]);
  if (!results[0].meta.changes) fail(409, 'image_in_use', '图片已被其他管理员引用或移除，请重新加载。');
  return {deleted: true, id: imageId};
}
