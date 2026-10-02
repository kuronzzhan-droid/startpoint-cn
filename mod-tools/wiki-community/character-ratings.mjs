import {chinaDay, fail} from './model.mjs';
import {sign} from './codecs.mjs';
import {readJSON, challenge, rateLimit} from './security.mjs';
import rankingScore from '../wiki/rating-score.js';

function requireCharacter(catalog, id) {
  if (!Object.hasOwn(catalog.characters, id)) fail(404, 'not_found', '角色未收录。');
}
export function validateScore(score) {
  if (!Number.isInteger(score) || score < 0 || score > 5) fail(400, 'invalid_score', '评分必须是 0 到 5 的整数。');
  return score;
}
export async function ratingContext(request, env, id, now, development) {
  const ip = development ? 'loopback' : request.headers.get('CF-Connecting-IP');
  if (!ip || ip.length > 100) fail(503, 'client_address_unavailable', '暂时无法验证请求来源。');
  const {date, nextLikeAt} = chinaDay(now);
  return {day: date, nextVoteAt: Date.parse(nextLikeAt),
    claimKey: await sign(env.COMMUNITY_IP_SALT, `character-rating:${id}:${date}:${ip}`)};
}
export async function readRating(db, id, visitorId, context) {
  const row = await db.prepare(`SELECT AVG(score) AS average,COUNT(*) AS voters,
    (SELECT score FROM community_character_ratings WHERE character_id=? AND visitor_id=?) AS my_score,
    (SELECT vote_day FROM community_character_ratings WHERE character_id=? AND visitor_id=?) AS my_day,
    EXISTS(SELECT 1 FROM community_character_rating_claims WHERE claim_key=?) AS ip_claimed
    FROM community_character_ratings WHERE character_id=?`)
    .bind(id, visitorId, id, visitorId, context.claimKey, id).first();
  return {average: row.voters ? Math.round(row.average * 100) / 100 : null, voters: row.voters,
    rankScore: rankingScore.score(row.average, row.voters),
    myScore: row.my_score ?? null, ratedToday: Boolean(row.my_day >= context.day || row.ip_claimed), nextVoteAt: context.nextVoteAt};
}
export async function listCharacterRatings(db, catalog, {includeTierRow = false} = {}) {
  const rows = (await db.prepare(`SELECT character_id AS id,AVG(score) AS average,COUNT(*) AS voters
    FROM community_character_ratings WHERE typeof(score)='integer' AND score BETWEEN 0 AND 5
    GROUP BY character_id ORDER BY character_id`).all()).results;
  return {items: rows.filter((row) => Object.hasOwn(catalog.characters, row.id))
    .map((row) => ({id: row.id, average: Math.round(row.average * 100) / 100, voters: row.voters,
      rankScore: rankingScore.score(row.average, row.voters),
      ...(includeTierRow ? {row: rankingScore.tierRow(row.average, row.voters)} : {})}))};
}
export async function recordRating(db, id, visitorId, context, score, now) {
  validateScore(score);
  const results = await db.batch([
    db.prepare(`INSERT INTO community_character_rating_claims(claim_key,character_id,visitor_id,vote_day,created_at)
      SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM community_character_ratings WHERE character_id=? AND visitor_id=? AND vote_day>=?)
      ON CONFLICT(claim_key) DO NOTHING`).bind(context.claimKey, id, visitorId, context.day, now, id, visitorId, context.day),
    db.prepare(`INSERT INTO community_character_ratings(character_id,visitor_id,score,vote_day,updated_at)
      SELECT ?,?,?,?,? WHERE changes()=1
      ON CONFLICT(character_id,visitor_id) DO UPDATE SET score=excluded.score,vote_day=excluded.vote_day,updated_at=excluded.updated_at
      WHERE community_character_ratings.vote_day<excluded.vote_day`).bind(id, visitorId, score, context.day, now),
    // Keep yesterday's claims for requests that began just before Beijing midnight.
    db.prepare('DELETE FROM community_character_rating_claims WHERE vote_day<?').bind(chinaDay(now - 86400_000).date)
  ]);
  const result = await readRating(db, id, visitorId, context);
  if (!results[1].meta.changes) fail(409, 'already_rated', '今天你或同一网络已为此角色评分，请明天再来。', result);
  return result;
}
export async function characterRatingsRoute(path, request, env, catalog, identity, now, development, fetchImpl) {
  if (path === '/ratings/characters') {
    if (request.method !== 'GET') fail(405, 'method_not_allowed', '评分汇总只支持 GET。');
    return listCharacterRatings(env.COMMUNITY_DB, catalog);
  }
  const match = path.match(/^\/ratings\/characters\/([a-zA-Z0-9_-]{1,40})$/);
  if (!match) fail(404, 'not_found', '没有这个角色评分接口。');
  const id = match[1]; requireCharacter(catalog, id);
  const context = await ratingContext(request, env, id, now, development);
  if (request.method === 'GET') return readRating(env.COMMUNITY_DB, id, identity.id, context);
  if (request.method !== 'POST') fail(405, 'method_not_allowed', '评分必须使用 POST。');
  const body = await readJSON(request);
  if (Object.keys(body).some((key) => !['score', 'turnstileToken'].includes(key)))
    fail(400, 'invalid_fields', '提交内容包含不支持的评分字段。');
  validateScore(body.score);
  await challenge(request, env, body.turnstileToken, 'rate_character', fetchImpl, development);
  await rateLimit(env.COMMUNITY_DB, request, env, 'rating', now, development);
  return recordRating(env.COMMUNITY_DB, id, identity.id, context, body.score, now);
}
