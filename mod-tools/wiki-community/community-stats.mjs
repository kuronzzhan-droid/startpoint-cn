import {fail} from './model.mjs';
import {sign} from './codecs.mjs';
import {readJSON, rateLimit, visitor} from './security.mjs';
import {ROW_SCORES} from './tier-ranking-store.mjs';

export const PRESENCE_WINDOW_SECONDS = 120;
export const PRESENCE_INTERVAL_MS = 30_000;
const CLEANUP_LIMIT = 100;

export async function communityStats(db, catalog, now) {
  // Bind the catalogue as one JSON value: its size must not exceed D1's parameter count.
  // Count people with at least one current vote, never the sum of per-character votes.
  const result = await db.prepare(`WITH characters AS (SELECT value AS id FROM json_each(?)),
    rating_visitors AS (SELECT DISTINCT visitor_id FROM community_character_ratings
      WHERE character_id IN (SELECT id FROM characters)
        AND typeof(score)='integer' AND score BETWEEN 0 AND 5),
    tier_visitors AS (SELECT DISTINCT ranking.visitor_id FROM community_tier_rankings AS ranking
      WHERE EXISTS(SELECT 1
        FROM json_each(CASE WHEN json_valid(ranking.rows_json) THEN ranking.rows_json ELSE '{}' END) AS tier,
          json_each(CASE WHEN tier.type='array' THEN tier.value ELSE '[]' END) AS item
        WHERE tier.key IN (${Object.keys(ROW_SCORES).map((key) => `'${key}'`).join(',')})
          AND item.type='text' AND item.value IN (SELECT id FROM characters)))
    SELECT
      (SELECT COUNT(*) FROM rating_visitors) AS ratingVoters,
      (SELECT COUNT(*) FROM tier_visitors) AS tierVoters,
      (SELECT COUNT(*) FROM (SELECT visitor_id FROM rating_visitors UNION SELECT visitor_id FROM tier_visitors)) AS totalVoters,
      (SELECT COUNT(*) FROM community_presence WHERE last_seen>? AND last_seen<=?) AS onlineVisitors`)
    .bind(JSON.stringify(Object.keys(catalog.characters)), now - PRESENCE_WINDOW_SECONDS * 1000, now).first();
  return {ratingVoters:Number(result.ratingVoters), tierVoters:Number(result.tierVoters), totalVoters:Number(result.totalVoters),
    onlineVisitors:Number(result.onlineVisitors), asOf:new Date(now).toISOString(), presenceWindowSeconds:PRESENCE_WINDOW_SECONDS};
}

export async function recordPresence(db, visitorHash, now) {
  return db.batch([
    db.prepare(`INSERT INTO community_presence(visitor_hash,last_seen) VALUES(?,?)
      ON CONFLICT(visitor_hash) DO UPDATE SET last_seen=excluded.last_seen
      WHERE community_presence.last_seen<=excluded.last_seen-?`).bind(visitorHash, now, PRESENCE_INTERVAL_MS),
    // Duplicate tabs do not refresh the timestamp or trigger cleanup. Each accepted heartbeat
    // removes at most 100 expired rows; reads and quiet sites never cause background writes.
    db.prepare(`DELETE FROM community_presence WHERE changes()>0 AND visitor_hash IN (
      SELECT visitor_hash FROM community_presence WHERE last_seen<=? ORDER BY last_seen LIMIT ?)`)
      .bind(now - PRESENCE_WINDOW_SECONDS * 1000, CLEANUP_LIMIT)
  ]);
}

export async function presenceRoute(request, env, catalog, now, development) {
  if (request.method !== 'POST') fail(405, 'method_not_allowed', '在线状态请使用 POST 更新。');
  const body = await readJSON(request, 128);
  if (Object.keys(body).length) fail(400, 'invalid_fields', '在线状态不接受额外字段。');
  const identity = await visitor(request, env, now, development);
  // Configuration establishes the browser identity. A delayed heartbeat must never mint a
  // competing cookie or overwrite an identity created by a rating/like request.
  if (identity.cookie) fail(428, 'visitor_required', '请先重新加载社区配置，再更新在线状态。');
  await rateLimit(env.COMMUNITY_DB, request, env, 'presence', now, development);
  const visitorHash = await sign(env.COMMUNITY_COOKIE_SECRET, `wiki-presence:${identity.id}`);
  await recordPresence(env.COMMUNITY_DB, visitorHash, now);
  return communityStats(env.COMMUNITY_DB, catalog, now);
}
