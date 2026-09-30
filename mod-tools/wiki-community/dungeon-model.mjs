import {cleanText, fail} from './model.mjs';

export const DUNGEON_ID = '[a-zA-Z0-9_-]{1,80}';
export const IMAGE_ID = '[a-f0-9-]{36}';
export const IMAGE_BYTES = 512 * 1024;
export const GUIDE_BYTES = 128 * 1024;
export const IMAGE_QUOTAS = {site: 256 * 1024 * 1024, actor: 64 * 1024 * 1024, dungeon: 8 * 1024 * 1024};
export const managesImages = (actor) => ['owner', 'deputy'].includes(actor?.role);
export function requireDungeon(catalog, id) {
  const items = Array.isArray(catalog) ? catalog : catalog?.items;
  if (!new RegExp(`^${DUNGEON_ID}$`).test(id) || !Array.isArray(items) || !items.some((item) => item?.id === id))
    fail(404, 'not_found', '副本未收录。');
}
export function requireEditor(actor) {
  if (!actor?.id || !actor?.email) fail(401, 'admin_auth_required', '请先使用管理员账号登录。');
}
function ids(value, name, max) {
  if (!Array.isArray(value) || value.length > max || value.some((id) => typeof id !== 'string' || !new RegExp(`^${IMAGE_ID}$`).test(id)) ||
      new Set(value).size !== value.length)
    fail(400, 'invalid_references', `${name}最多 ${max} 项，不能重复或包含无效标识。`);
  return value;
}
export function guideInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some((key) => !['expectedRevision', 'text', 'teamIds', 'imageIds'].includes(key)))
    fail(400, 'invalid_fields', '攻略内容包含不支持的字段。');
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0)
    fail(400, 'invalid_revision', '攻略版本无效，请重新加载。');
  return {text: cleanText(body.text, '攻略', 30000), teamIds: ids(body.teamIds, '推荐队伍', 30),
    imageIds: ids(body.imageIds, '攻略图片', 12), expectedRevision: body.expectedRevision};
}
export const placeholders = (items) => items.map(() => '?').join(',');
export const imageMetadata = (row, admin = false) => ({id: row.id,
  url: `/api/community/dungeon-images/${row.id}`,
  ...(admin ? {previewUrl: `/api/community/admin/dungeons/${row.dungeon_id}/images/${row.id}`} : {}),
  width: row.width, height: row.height, bytes: row.bytes});
export const rawGuide = (id, row) => ({id, text: row?.text || '', revision: row?.revision || 0,
  teamIds: row ? JSON.parse(row.team_ids_json) : [], imageIds: row ? JSON.parse(row.image_ids_json) : [],
  updatedAt: row ? new Date(row.updated_at).toISOString() : null});
export function audit(db, id, actor, action, before, after, now, guard, values) {
  return db.prepare(`INSERT INTO community_dungeon_audit(id,dungeon_id,actor_id,actor_email,action,before_json,after_json,created_at)
    SELECT ?,?,?,?,?,?,?,? WHERE changes()=1 AND ${guard}`)
    .bind(crypto.randomUUID(), id, actor.id, actor.email, action, JSON.stringify(before), JSON.stringify(after), now, ...values);
}
