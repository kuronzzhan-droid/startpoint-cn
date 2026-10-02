import {fail} from './model.mjs';
import {sign} from './codecs.mjs';
import {readJSON, rateLimit, visitor} from './security.mjs';
import {createParticipationCounter} from './community-stats-counts.mjs';

export const PRESENCE_WINDOW_SECONDS = 1800;
export const PRESENCE_INTERVAL_MS = 30 * 60_000;
const CLEANUP_LIMIT = 100;
const participationCounts = createParticipationCounter();

export async function communityStats(db, catalog, now) {
  const [counts, online] = await Promise.all([
    participationCounts(db, catalog, now),
    Promise.resolve().then(() => db.prepare('SELECT COUNT(*) AS onlineVisitors FROM community_presence WHERE last_seen>? AND last_seen<=?')
      .bind(now - PRESENCE_WINDOW_SECONDS * 1000, now).first())
  ]);
  return {...counts, onlineVisitors:Number(online.onlineVisitors),
    asOf:new Date(now).toISOString(), presenceWindowSeconds:PRESENCE_WINDOW_SECONDS};
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
