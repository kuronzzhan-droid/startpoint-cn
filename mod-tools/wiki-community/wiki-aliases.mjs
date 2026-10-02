import {cleanText, fail} from './model.mjs';
import {readJSON} from './security.mjs';

function requireTarget(catalog, kind, id) {
  const source = kind === 'character' ? catalog.characters : kind === 'weapon' ? catalog.equipment : null;
  if (!source || typeof id !== 'string' || !Object.hasOwn(source, id)) fail(404, 'not_found', '角色或武器未收录。');
}
function record(kind, id, row) {
  return {kind, id, aliases: row ? JSON.parse(row.aliases_json) : [], revision: row?.revision || 0};
}
export function normalizeAliases(value) {
  if (!Array.isArray(value) || value.length > 12) fail(400, 'invalid_aliases', '黑话最多填写 12 项。');
  const seen = new Set(), aliases = [];
  for (const raw of value) {
    const alias = cleanText(raw, '黑话', 32, true, true), key = alias.toLowerCase();
    if (!seen.has(key)) {seen.add(key); aliases.push(alias);}
  }
  return aliases;
}
export async function readAlias(db, catalog, kind, id) {
  requireTarget(catalog, kind, id);
  const row = await db.prepare('SELECT aliases_json,revision FROM community_aliases WHERE kind=? AND entity_id=?').bind(kind, id).first();
  return record(kind, id, row);
}
export async function listAliases(db, catalog) {
  const rows = (await db.prepare("SELECT kind,entity_id,aliases_json,revision FROM community_aliases WHERE aliases_json<>'[]' ORDER BY kind,entity_id").all()).results;
  return {items: rows.filter((row) => Object.hasOwn(row.kind === 'character' ? catalog.characters : catalog.equipment, row.entity_id))
    .map((row) => record(row.kind, row.entity_id, row))};
}
export async function updateAlias(db, catalog, kind, id, body, actor, now) {
  if (!actor?.id || !actor?.email) fail(401, 'admin_auth_required', '请先使用管理员账号登录。');
  requireTarget(catalog, kind, id);
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0)
    fail(400, 'invalid_revision', '黑话版本无效，请重新加载。');
  if (Object.keys(body).some((key) => !['aliases', 'expectedRevision'].includes(key)))
    fail(400, 'invalid_fields', '提交内容包含不支持的黑话字段。');
  const aliases = normalizeAliases(body.aliases), before = await readAlias(db, catalog, kind, id);
  if (before.revision !== body.expectedRevision) fail(409, 'edit_conflict', '其他管理员已修改黑话，请重新加载后编辑。');
  const after = {kind, id, aliases, revision: before.revision + 1};
  const write = before.revision === 0 ? db.prepare(`INSERT INTO community_aliases(kind,entity_id,aliases_json,revision,updated_at)
    VALUES(?,?,?,?,?) ON CONFLICT(kind,entity_id) DO NOTHING`).bind(kind, id, JSON.stringify(aliases), after.revision, now) :
    db.prepare('UPDATE community_aliases SET aliases_json=?,revision=?,updated_at=? WHERE kind=? AND entity_id=? AND revision=?')
      .bind(JSON.stringify(aliases), after.revision, now, kind, id, before.revision);
  const results = await db.batch([write,
    db.prepare(`INSERT INTO community_alias_audit(id,kind,entity_id,actor_id,actor_email,before_json,after_json,created_at)
      SELECT ?,kind,entity_id,?,?,?,?,? FROM community_aliases WHERE kind=? AND entity_id=? AND revision=? AND changes()=1`)
      .bind(crypto.randomUUID(), actor.id, actor.email, JSON.stringify(before), JSON.stringify(after), now, kind, id, after.revision)
  ]);
  if (!results[0].meta.changes) fail(409, 'edit_conflict', '其他管理员已修改黑话，请重新加载后编辑。');
  return after;
}
export async function adminAliasesRoute(path, request, db, catalog, actor, now) {
  const match = path.match(/^\/admin\/aliases\/(character|weapon)\/([a-zA-Z0-9_-]{1,40})$/);
  if (!match) fail(404, 'not_found', '没有这个黑话管理接口。');
  if (request.method === 'GET') return readAlias(db, catalog, match[1], match[2]);
  if (request.method === 'PATCH') return updateAlias(db, catalog, match[1], match[2], await readJSON(request), actor, now);
  fail(405, 'method_not_allowed', '黑话编辑必须使用 PATCH。');
}
