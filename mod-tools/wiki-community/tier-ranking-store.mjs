import {chinaDay, fail} from './model.mjs';
import {sign} from './codecs.mjs';

export const ROW_SCORES = Object.freeze({tier0: 5, between0: 4.5, tier1: 4, between1: 3.5,
  tier2: 3, between2: 2.5, tier3: 2, between3: 1.5, tier4: 1});
export const TIER_CHALLENGE = 'submit_tier_ranking';
const emptyRows = () => Object.fromEntries(Object.keys(ROW_SCORES).map((row) => [row, []]));
export function validateTierRows(value, catalog) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'invalid_rows', '请选择要提交的角色排行。');
  if (Object.keys(value).some((key) => !Object.hasOwn(ROW_SCORES, key))) fail(400, 'invalid_rows', '排行包含不支持的档位。');
  const rows = emptyRows(), seen = new Set(), limit = Object.keys(catalog.characters).length;
  for (const row of Object.keys(ROW_SCORES)) {
    if (!Object.hasOwn(value, row)) continue;
    if (!Array.isArray(value[row]) || value[row].length > limit) fail(400, 'invalid_rows', '排行中的角色列表无效。');
    for (const id of value[row]) {
      if (typeof id !== 'string' || !Object.hasOwn(catalog.characters, id)) fail(400, 'invalid_character', '排行包含未收录的角色。');
      if (seen.has(id)) fail(400, 'duplicate_character', '每个角色只能放在一个位置。');
      seen.add(id); rows[row].push(id);
    }
  }
  return rows;
}
export async function tierRankingContext(request, env, now, development) {
  const ip = development ? 'loopback' : request.headers.get('CF-Connecting-IP');
  if (!ip || ip.length > 100) fail(503, 'client_address_unavailable', '暂时无法验证请求来源。');
  const {date, nextLikeAt} = chinaDay(now);
  return {day: date, nextVoteAt: Date.parse(nextLikeAt),
    claimKey: await sign(env.COMMUNITY_IP_SALT, `tier-ranking:${date}:${ip}`)};
}
export async function readTierRanking(db, catalog, visitorId, context) {
  const result = await db.prepare(`SELECT
    (SELECT rows_json FROM community_tier_rankings WHERE visitor_id=?) AS rows_json,
    (SELECT vote_day FROM community_tier_rankings WHERE visitor_id=?) AS vote_day,
    (SELECT updated_at FROM community_tier_rankings WHERE visitor_id=?) AS updated_at,
    EXISTS(SELECT 1 FROM community_tier_ranking_claims WHERE claim_key=?) AS ip_claimed`)
    .bind(visitorId, visitorId, visitorId, context.claimKey).first();
  const rows = emptyRows(), seen = new Set();
  const saved = result.rows_json ? JSON.parse(result.rows_json) : {};
  for (const row of Object.keys(ROW_SCORES)) {
    for (const id of Array.isArray(saved[row]) ? saved[row] : []) {
      if (typeof id !== 'string' || !Object.hasOwn(catalog.characters, id) || seen.has(id)) continue;
      seen.add(id); rows[row].push(id);
    }
  }
  return {rows, rankedCharacters: seen.size, submittedToday: Boolean(result.vote_day >= context.day || result.ip_claimed),
    nextVoteAt: context.nextVoteAt, updatedAt: result.updated_at ?? null, challengeAction: TIER_CHALLENGE};
}
export async function recordTierRanking(db, catalog, visitorId, context, value, now) {
  const rows = validateTierRows(value, catalog);
  const results = await db.batch([
    db.prepare(`INSERT INTO community_tier_ranking_claims(claim_key,visitor_id,vote_day,created_at)
      SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM community_tier_rankings WHERE visitor_id=? AND vote_day>=?)
      ON CONFLICT(claim_key) DO NOTHING`).bind(context.claimKey, visitorId, context.day, now, visitorId, context.day),
    db.prepare(`INSERT INTO community_tier_rankings(visitor_id,rows_json,vote_day,updated_at)
      SELECT ?,?,?,? WHERE changes()=1
      ON CONFLICT(visitor_id) DO UPDATE SET rows_json=excluded.rows_json,vote_day=excluded.vote_day,updated_at=excluded.updated_at
      WHERE community_tier_rankings.vote_day<excluded.vote_day`).bind(visitorId, JSON.stringify(rows), context.day, now),
    // Yesterday's claims still protect requests that started just before Beijing midnight.
    db.prepare('DELETE FROM community_tier_ranking_claims WHERE vote_day<?').bind(chinaDay(now - 86400_000).date)
  ]);
  const result = await readTierRanking(db, catalog, visitorId, context);
  if (!results[1].meta.changes) fail(409, 'already_ranked', '今天你或同一网络已提交排行，请明天再来。', result);
  return result;
}
export async function listTierPlacements(db, catalog) {
  // Store one replaceable document per visitor so a full-board update is one atomic write.
  const score = `CASE tier.key ${Object.entries(ROW_SCORES).map(([key, value]) => `WHEN '${key}' THEN ${value}`).join(' ')} END`;
  const results = (await db.prepare(`SELECT id,AVG(score) AS average,COUNT(*) AS voters FROM (
    SELECT ranking.visitor_id,item.value AS id,MAX(${score}) AS score
    FROM community_tier_rankings AS ranking,json_each(ranking.rows_json) AS tier,
      json_each(CASE WHEN tier.type='array' THEN tier.value ELSE '[]' END) AS item
    WHERE tier.key IN (${Object.keys(ROW_SCORES).map((key) => `'${key}'`).join(',')}) AND item.type='text'
    GROUP BY ranking.visitor_id,item.value
    ) GROUP BY id`).all()).results;
  return results.filter((item) => Object.hasOwn(catalog.characters, item.id))
    .map((item) => ({id: item.id, average: Math.round(item.average * 100) / 100, voters: item.voters}));
}
