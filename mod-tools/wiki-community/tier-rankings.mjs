import {fail} from './model.mjs';
import {readJSON, challenge, rateLimit} from './security.mjs';
import {listCharacterRatings} from './character-ratings.mjs';
import {ROW_SCORES, TIER_CHALLENGE, validateTierRows, tierRankingContext, readTierRanking,
  recordTierRanking, listTierPlacements} from './tier-ranking-store.mjs';

export async function listTierRankings(db, catalog) {
  const [placements, ratings] = await Promise.all([listTierPlacements(db, catalog), listCharacterRatings(db, catalog)]);
  const placed = new Map(placements.map((item) => [item.id, item]));
  const rated = new Map(ratings.items.map((item) => [item.id, item]));
  const ids = new Set([...placed.keys(), ...rated.keys()]), rowKeys = Object.keys(ROW_SCORES);
  const items = [...ids].map((id) => {
    const placement = placed.get(id), rating = rated.get(id);
    const score = placement && rating ? placement.average * 0.7 + rating.average * 0.3 : (placement || rating).average;
    const compositeScore = Math.round(score * 100) / 100;
    return {id, compositeScore, row: rowKeys[Math.max(0, Math.min(8, Math.round((5 - compositeScore) * 2)))],
      placementAverage: placement?.average ?? null, placementVoters: placement?.voters ?? 0,
      ratingAverage: rating?.average ?? null, ratingVoters: rating?.voters ?? 0,
      missingSources: [...(!placement ? ['placement'] : []), ...(!rating ? ['rating'] : [])]};
  });
  items.sort((a, b) => b.compositeScore - a.compositeScore || b.placementVoters - a.placementVoters
    || b.ratingVoters - a.ratingVoters || a.id.localeCompare(b.id));
  return {items, formula: {placementWeight: 0.7, ratingWeight: 0.3}};
}
export async function tierRankingsRoute(path, request, env, catalog, identity, now, development, fetchImpl) {
  if (path === '/tier-rankings' && request.method === 'GET') return listTierRankings(env.COMMUNITY_DB, catalog);
  if (path !== '/tier-rankings' && path !== '/tier-rankings/me') fail(404, 'not_found', '没有这个角色排行接口。');
  if ((path.endsWith('/me') && request.method !== 'GET') || (path === '/tier-rankings' && request.method !== 'POST'))
    fail(405, 'method_not_allowed', '个人排行使用 GET 查看，使用 POST 提交。');
  const context = await tierRankingContext(request, env, now, development);
  if (request.method === 'GET') return readTierRanking(env.COMMUNITY_DB, catalog, identity.id, context);
  const body = await readJSON(request, 32768);
  if (Object.keys(body).some((key) => !['rows', 'turnstileToken'].includes(key))) fail(400, 'invalid_fields', '提交内容包含不支持的排行字段。');
  const rows = validateTierRows(body.rows, catalog);
  await challenge(request, env, body.turnstileToken, TIER_CHALLENGE, fetchImpl, development);
  await rateLimit(env.COMMUNITY_DB, request, env, 'tier_ranking', now, development);
  return recordTierRanking(env.COMMUNITY_DB, catalog, identity.id, context, rows, now);
}
