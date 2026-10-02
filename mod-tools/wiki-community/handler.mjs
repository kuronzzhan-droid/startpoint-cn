import catalog from './catalog.mjs';
import {ApiError, DAMAGE_TYPES, TEAM_SECTIONS, fail, validateSubmission, fingerprint, chinaDay, teamRecord, listQuery} from './model.mjs';
import {productionReady, sameOrigin, readJSON, visitor, challenge, rateLimit, csv, LOOPBACK} from './security.mjs';
import {listTeams, insertTeam, findTeam, findAdminTeam, likeTeam, editTeam, deleteTeam} from './repository.mjs';
import {isPublicTeam} from './team-access.mjs';
import {authenticateAdmin} from './admin-auth.mjs';
import {GAME_CODE_PATTERN, resolveGameCode, gameCodeInfo, createGameCode, revokeGameCode} from './game-codes.mjs';
import {authMode, passwordConfig, authenticatePassword, publicUser} from './password-auth.mjs';
import {authRoute, accountsRoute} from './auth-routes.mjs';
import {listAliases, adminAliasesRoute} from './wiki-aliases.mjs';
import {characterRatingsRoute} from './character-ratings.mjs';
import {tierRankingsRoute} from './tier-rankings.mjs';
import {createDailyRankingReader} from './daily-ranking-snapshot.mjs';
import {communityStats, presenceRoute} from './community-stats.mjs';
import {characterViewsRoute} from './character-views.mjs';
import dungeonCatalog from './dungeon-catalog.mjs';
import {dungeonRoute} from './dungeon-routes.mjs';
import {publicSummary} from './public-summary-cache.mjs';
import {quotaFailure} from './database-availability.mjs';
import {createStatisticsAvailability} from './statistics-availability.mjs';
import {readAnnouncement, adminAnnouncementRoute} from './announcement.mjs';
import {readSponsorship, adminSponsorshipRoute} from './sponsorship.mjs';

function response(value, status = 200, headers = {}) {
  return Response.json(value, {status, headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers}});
}
export function createCommunityHandler(trustedCatalog = catalog, options = {}) {
  const nowFn = options.now || Date.now, fetchImpl = options.fetch || fetch;
  const dungeons = options.dungeons || trustedCatalog.dungeons || dungeonCatalog;
  const statistics = createStatisticsAvailability();
  const dailyRankings = createDailyRankingReader();
  return async function handle(request, env) {
    let identity;
    try {
      const url = new URL(request.url), now = nowFn();
      const development = options.development && LOOPBACK.has(url.hostname) ? options.development : null;
      if (options.development && !development) fail(403, 'development_loopback_only', '本地开发接口仅允许回环地址。');
      if (!productionReady(env)) fail(503, 'not_configured', '社区服务尚未配置，请稍后再试。', {enabled: false, siteKey: ''});
      if (!development && (url.protocol !== 'https:' || !csv(env.COMMUNITY_ALLOWED_HOSTNAMES).includes(url.hostname)))
        fail(403, 'invalid_host', '此站点未获社区服务授权。');
      const path = url.pathname.replace(/^\/api\/community/, '').replace(/\/$/, '') || '/';
      const mode = authMode(env);
      if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(request.method)) sameOrigin(request);
      if (development && path.startsWith('/development-')) {
        const result = await development.route(path, request, mode);
        if (result) return result;
      }
      // Auth responses own their session cookie; do not overwrite it with a visitor cookie.
      if (path.startsWith('/auth/') && mode === 'password')
        return await authRoute(path, request, env, now, development, fetchImpl);
      if (path === '/announcement') {
        if (request.method !== 'GET') fail(405, 'method_not_allowed', '公告只支持 GET 查询。');
        return response(await publicSummary(request, () => readAnnouncement(env.COMMUNITY_DB)));
      }
      if (path === '/sponsorship') {
        if (request.method !== 'GET') fail(405, 'method_not_allowed', '赞助广告只支持 GET 查询。');
        return response(await publicSummary(request, () => readSponsorship(env.COMMUNITY_DB), undefined, now));
      }
      if (path === '/stats') {
        if (request.method !== 'GET') fail(405, 'method_not_allowed', '参与及在线人数只支持 GET 查询。');
        return response(await publicSummary(request, () => statistics(request, env.COMMUNITY_DB, now,
          () => communityStats(env.COMMUNITY_DB, trustedCatalog, now), env.COMMUNITY_STATS_CACHE_NAMESPACE), undefined, now));
      }
      if (path === '/presence') return response(await statistics(request, env.COMMUNITY_DB, now,
        () => presenceRoute(request, env, trustedCatalog, now, development), env.COMMUNITY_STATS_CACHE_NAMESPACE));
      if (path.startsWith('/characters/')) return response(await characterViewsRoute(path, request, env, trustedCatalog, now, development));
      // Anonymous summaries must not mint a late cookie that replaces a rating visitor's identity.
      if (request.method === 'GET' && path === '/ratings/characters')
        return response(await publicSummary(request, async () => {
          const value = await dailyRankings(env.COMMUNITY_DB, trustedCatalog, now);
          return {items:value.rankings.rating.map(({row, ...item}) => item).sort((a,b) => a.id.localeCompare(b.id)), asOf:value.asOf, nextRefreshAt:value.nextRefreshAt,
            refreshDay:value.refreshDay, stale:value.stale};
        }, undefined, now, await dailyRankings.cacheKey(trustedCatalog)));
      if (request.method === 'GET' && path === '/tier-rankings')
        return response(await publicSummary(request, () => dailyRankings(env.COMMUNITY_DB, trustedCatalog, now), undefined, now,
          await dailyRankings.cacheKey(trustedCatalog)));
      // Only identity-dependent endpoints may initialize a visitor. A late public read must not
      // replace a cookie established by a concurrent rating/like request or sign unrelated reads.
      const visitorHeaders = async () => {
        identity ||= await visitor(request, env, now, development);
        return identity.cookie ? {'Set-Cookie': identity.cookie} : {};
      };
      if (request.method === 'GET' && path === '/config') {
        const headers = await visitorHeaders();
        await env.COMMUNITY_DB.prepare('SELECT id FROM community_teams LIMIT 1').first();
        return response({enabled: true, siteKey: development ? '' : env.TURNSTILE_SITE_KEY,
          moderation: 'approved', canSubmit: false, publishing: 'admin',
          ...(mode === 'password' ? await passwordConfig(env, development) : {authMode: mode, needsSetup: false, bootstrapAvailable: false}),
          elements: [...trustedCatalog.elements, 'universal'], damageTypes: DAMAGE_TYPES, sections: TEAM_SECTIONS,
          ...(development ? {development: true} : {})}, 200, headers);
      }
      if (path.startsWith('/admin/')) {
        const actor = mode === 'password' ? await authenticatePassword(request, env, now, development) :
          await authenticateAdmin(request, env, fetchImpl, now, development);
        if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(request.method)) await rateLimit(env.COMMUNITY_DB, request, env, 'admin', now, development);
        if (mode === 'password' && (path === '/admin/users' || path.startsWith('/admin/users/')))
          return await accountsRoute(path, request, env, now, development);
        if (path.startsWith('/admin/dungeons/')) return await dungeonRoute(path, request, env, dungeons,
          mode === 'password' ? publicUser(actor) : actor, now, development);
        return await adminRoute(path, request, env.COMMUNITY_DB, trustedCatalog, mode === 'password' ? publicUser(actor) : actor, now);
      }
      if (path.startsWith('/dungeons/') || path.startsWith('/dungeon-images/'))
        return await dungeonRoute(path, request, env, dungeons, null, now, development);
      if (path.startsWith('/game-codes/') && request.method === 'GET') {
        const code = path.slice('/game-codes/'.length);
        if (!GAME_CODE_PATTERN.test(code)) fail(404, 'not_found', '队伍码不存在或已失效。');
        await rateLimit(env.COMMUNITY_DB, request, env, 'game_lookup', now, development);
        return response(await resolveGameCode(env.COMMUNITY_DB, code));
      }
      if (path === '/teams' && request.method === 'GET')
        return response(await listTeams(env.COMMUNITY_DB, listQuery(url, trustedCatalog)));
      if (path === '/aliases' && request.method === 'GET')
        return response(await listAliases(env.COMMUNITY_DB, trustedCatalog));
      if (path === '/ratings/characters' || path.startsWith('/ratings/characters/')) {
        const headers = await visitorHeaders();
        return response(await characterRatingsRoute(path, request, env, trustedCatalog, identity, now, development, fetchImpl), 200, headers);
      }
      if (path === '/tier-rankings' || path.startsWith('/tier-rankings/')) {
        const headers = await visitorHeaders();
        return response(await tierRankingsRoute(path, request, env, trustedCatalog, identity, now, development, fetchImpl), 200, headers);
      }
      if (path === '/teams' && request.method === 'POST') {
        fail(403, 'submission_disabled', '队伍由管理员收录，游客可以浏览和点赞。');
      }
      const match = path.match(/^\/teams\/([a-f0-9-]{36})(\/like)?$/);
      if (match && !match[2] && request.method === 'GET') {
        const row = await findTeam(env.COMMUNITY_DB, match[1]);
        if (!isPublicTeam(row)) fail(404, 'not_found', '队伍不存在或暂不展示。');
        const headers = await visitorHeaders();
        const liked = await env.COMMUNITY_DB.prepare('SELECT 1 AS liked FROM community_likes WHERE team_id=? AND visitor_id=? AND day=?')
          .bind(row.id, identity.id, chinaDay(now).date).first();
        return response({team: {...teamRecord(row), likedToday: Boolean(liked)}}, 200, headers);
      }
      if (match?.[2] && request.method === 'POST') {
        const body = await readJSON(request);
        await challenge(request, env, body.turnstileToken, 'like_team', fetchImpl, development);
        await rateLimit(env.COMMUNITY_DB, request, env, 'like', now, development);
        const headers = await visitorHeaders();
        return response(await likeTeam(env.COMMUNITY_DB, match[1], identity.id, chinaDay(now), now), 200, headers);
      }
      fail(404, 'not_found', '没有这个社区接口。');
    } catch (error) {
      if (error instanceof ApiError) return response({error: error.code, message: error.message, ...error.extra}, error.status,
        {...(identity?.cookie ? {'Set-Cookie': identity.cookie} : {}),
          ...([429,503].includes(error.status) && error.extra.retryAfter ? {'Retry-After': String(error.extra.retryAfter)} : {})});
      // Do not return SQLite statements, secrets, or raw exception text to visitors.
      const quota = quotaFailure(error, nowFn());
      if (quota) return response(quota, 503, {'Retry-After':String(quota.retryAfter)});
      return response({error: 'service_unavailable', message: '社区服务暂时不可用，请稍后重试。'}, 503);
    }
  };
}
async function adminRoute(path, request, db, trustedCatalog, actor, now) {
  if (path === '/admin/sponsorship') return response(await adminSponsorshipRoute(request, db, actor, now));
  if (path === '/admin/announcement') return response(await adminAnnouncementRoute(request, db, actor, now));
  if (path === '/admin/me' && request.method === 'GET') return response(actor);
  if (path === '/admin/login' && request.method === 'GET')
    return new Response(null, {status: 302, headers: {Location: '/#community/admin', 'Cache-Control': 'no-store'}});
  if (path.startsWith('/admin/aliases/')) return response(await adminAliasesRoute(path, request, db, trustedCatalog, actor, now));
  if (path === '/admin/teams' && request.method === 'GET')
    return response(await listTeams(db, listQuery(new URL(request.url), trustedCatalog, true, actor), true, actor));
  if (path === '/admin/teams' && request.method === 'POST') {
    const value = validateSubmission(await readJSON(request), trustedCatalog);
    return response({team: await insertTeam(db, value, await fingerprint(value.team), now, 'approved', actor)}, 201);
  }
  const gameCodeMatch = path.match(/^\/admin\/teams\/([a-f0-9-]{36})\/game-code(\/revoke)?$/);
  if (gameCodeMatch && ['GET', 'POST'].includes(request.method)) {
    const row = await findAdminTeam(db, gameCodeMatch[1], actor); if (!row) fail(404, 'not_found', '队伍不存在。');
    if (request.method === 'GET' && !gameCodeMatch[2]) return response(await gameCodeInfo(db, row, actor));
    if (request.method !== 'POST') fail(405, 'method_not_allowed', '此操作必须使用 POST。');
    const body = await readJSON(request);
    if (body.expectedRevision !== row.revision) fail(409, 'edit_conflict', '队伍已被修改，请重新加载。');
    return response(await (gameCodeMatch[2] ? revokeGameCode(db, row, actor, now) : createGameCode(db, row, actor, now)));
  }
  const match = path.match(/^\/admin\/teams\/([a-f0-9-]{36})$/);
  if (match && request.method === 'GET') {
    const row = await findAdminTeam(db, match[1], actor);
    if (!row) fail(404, 'not_found', '队伍不存在。');
    return response({team: teamRecord(row, true)});
  }
  if (match && request.method === 'DELETE') {
    const body = await readJSON(request), row = await findAdminTeam(db, match[1], actor);
    if (!row) fail(404, 'not_found', '队伍不存在。');
    if (Object.keys(body).some((key) => key !== 'expectedRevision'))
      fail(400, 'invalid_fields', '删除队伍只需提交当前版本。');
    if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision !== row.revision)
      fail(409, 'edit_conflict', '队伍已被修改，请重新加载后再删除。');
    return response({team: await deleteTeam(db, row, actor, now)});
  }
  if (match && request.method === 'PATCH') {
    const body = await readJSON(request), row = await findAdminTeam(db, match[1], actor);
    if (!row) fail(404, 'not_found', '队伍不存在。');
    if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision !== row.revision)
      fail(409, 'edit_conflict', '其他管理员已修改该盘，请重新加载后再编辑。');
    const value = validateSubmission({...teamRecord(row, true), ...body}, trustedCatalog, {allowUncategorized: !row.category});
    const status = body.status ?? row.status;
    if (!['approved', 'hidden'].includes(status)) fail(400, 'invalid_status', '请选择公开或隐藏。');
    return response({team: await editTeam(db, row, value, await fingerprint(value.team), status, actor, now)});
  }
  fail(404, 'not_found', '没有这个管理接口。');
}
export const handleCommunity = createCommunityHandler();
