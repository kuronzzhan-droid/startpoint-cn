import {fail} from './model.mjs';
import {sign} from './codecs.mjs';
import {readJSON, rateLimit, visitor} from './security.mjs';

export const VIEW_WINDOW_SECONDS = 1800;

export async function readCharacterViews(db, id) {
  const row = await db.prepare('SELECT views FROM community_character_views WHERE character_id=?').bind(id).first();
  return {characterId:id, views:Number(row?.views || 0), windowSeconds:VIEW_WINDOW_SECONDS};
}

export async function recordCharacterView(db, id, visitorHash, now) {
  await db.batch([
    // One transaction claims the rolling window and increments only for its winner.
    // Repeated views do not slide last_counted_at forward and delay the next eligible view.
    db.prepare(`INSERT INTO community_character_view_visitors(character_id,visitor_hash,last_counted_at) VALUES(?,?,?)
      ON CONFLICT(character_id,visitor_hash) DO UPDATE SET last_counted_at=excluded.last_counted_at
      WHERE community_character_view_visitors.last_counted_at<=excluded.last_counted_at-?`)
      .bind(id, visitorHash, now, VIEW_WINDOW_SECONDS * 1000),
    db.prepare(`INSERT INTO community_character_views(character_id,views) SELECT ?,1 WHERE changes()=1
      ON CONFLICT(character_id) DO UPDATE SET views=views+1`).bind(id),
    // Expire only the deduplication records, never cumulative totals. Bound each counted
    // request's cleanup, and skip it entirely for duplicates and all read-only requests.
    db.prepare(`DELETE FROM community_character_view_visitors WHERE changes()>0 AND (character_id,visitor_hash) IN (
      SELECT character_id,visitor_hash FROM community_character_view_visitors
      WHERE last_counted_at<=? ORDER BY last_counted_at LIMIT 100)`).bind(now - VIEW_WINDOW_SECONDS * 1000)
  ]);
  return readCharacterViews(db, id);
}

export async function characterViewsRoute(path, request, env, catalog, now, development) {
  const match = path.match(/^\/characters\/([a-zA-Z0-9_-]{1,40})\/views$/), id = match?.[1];
  if (!id || !Object.hasOwn(catalog.characters, id)) fail(404, 'not_found', '角色未收录。');
  if (request.method === 'GET') return readCharacterViews(env.COMMUNITY_DB, id);
  if (request.method !== 'POST') fail(405, 'method_not_allowed', '查看次数使用 GET 查询、POST 记录。');
  const body = await readJSON(request, 128);
  if (Object.keys(body).length) fail(400, 'invalid_fields', '查看记录不接受额外字段。');
  const identity = await visitor(request, env, now, development);
  if (identity.cookie) fail(428, 'visitor_required', '请先重新加载社区配置，再记录查看次数。');
  await rateLimit(env.COMMUNITY_DB, request, env, 'character_view', now, development);
  const visitorHash = await sign(env.COMMUNITY_COOKIE_SECRET, `character-view:${id}:${identity.id}`);
  return recordCharacterView(env.COMMUNITY_DB, id, visitorHash, now);
}
