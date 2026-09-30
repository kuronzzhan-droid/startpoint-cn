import {fail} from './model.mjs';
import {readJSON, challenge, rateLimit} from './security.mjs';
import {listCharacterRatings} from './character-ratings.mjs';
import rankingScore from '../wiki/rating-score.js';
import {TIER_CHALLENGE, validateTierRows, tierRankingContext, readTierRanking,
  recordTierRanking, listTierPlacements} from './tier-ranking-store.mjs';

export async function listTierRankings(db, catalog) {
  const [placements, ratings] = await Promise.all([
    listTierPlacements(db, catalog, {includeRankScore: true, includeTierRow: true}),
    listCharacterRatings(db, catalog, {includeTierRow: true}),
  ]);
  const board = items => items.sort((a, b) => rankingScore.compare(a, b));
  return {rankings: {placement: board(placements), rating: board(ratings.items)}, formula: rankingScore.FORMULA};
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
