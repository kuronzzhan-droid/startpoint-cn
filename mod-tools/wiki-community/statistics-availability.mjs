import {ApiError, fail} from './model.mjs';
import {quotaFailure} from './database-availability.mjs';

const PAUSE_MS = 300_000;
const PAUSED_MESSAGE = '在线与参与人数统计暂时暂停，稍后自动恢复；已加载的图鉴资料仍可浏览。';

function validPause(value, now) {
  return value && Number.isSafeInteger(value.until) && value.until > now && value.until <= now + 86400_000
    && ['statistics_paused', 'database_quota_exceeded'].includes(value.error)
    && (value.error !== 'database_quota_exceeded' || value.resetAt === new Date(value.until).toISOString());
}
function rejectPaused(value, now) {
  fail(503, value.error, value.error === 'database_quota_exceeded'
    ? '今日数据库额度已用完，统计已暂停，待额度重置后恢复。' : PAUSED_MESSAGE,
  {retryAfter:Math.max(1, Math.ceil((value.until - now) / 1000)), ...(value.resetAt ? {resetAt:value.resetAt} : {})});
}

// This is a statistics-only failure circuit, not an account spending cap.
// Its memory and edge-cache checks never depend on an already failing D1 database.
export function createStatisticsAvailability({cache = () => globalThis.caches?.default} = {}) {
  const databases = new WeakMap();
  return async (request, db, now, load, namespace = 'v1') => {
    // The binding has no stable database ID. Operators must change this public
    // namespace when replacing a database on the same host, to discard old pauses.
    const url = new URL(request.url), scope = `${url.origin}/${encodeURIComponent(namespace)}`;
    const key = new Request(`${url.origin}/__wiki_statistics_pause/${encodeURIComponent(namespace)}`);
    let origins = databases.get(db);
    if (!origins) {origins = new Map(); databases.set(db, origins);}
    let state = origins.get(scope), edge;
    if (!state) {state = {pause:null, checked:false, probe:null}; origins.set(scope, state);}
    let paused = state.pause;
    try {edge = url.protocol === 'https:' ? cache() : null;} catch { /* Memory remains usable. */ }
    if (!validPause(paused, now)) {
      state.pause = null; paused = null;
      try {
        const saved = await edge?.match(key);
        const candidate = saved?.ok ? await saved.json() : null;
        if (validPause(candidate, now)) {paused = candidate; state.pause = paused; state.checked = false;}
      } catch { /* A cache failure must not prevent a recovered database read. */ }
    }
    if (paused) rejectPaused(paused, now);
    // Only one initial/recovery probe per instance reaches D1. Each successful
    // follower still performs its own identity-dependent heartbeat afterward.
    while (state.probe) {
      try {await state.probe;} catch { /* Request-level errors belong only to their own caller. */ }
      if (validPause(state.pause, now)) rejectPaused(state.pause, now);
      // Another waiter may have taken over after a caller-specific error.
    }
    if (validPause(state.pause, now)) rejectPaused(state.pause, now);
    const run = async () => {
      try {const result = await load(); state.checked = true; return result;}
      catch (error) {
      // Bad input, identity, per-IP limits and a busy snapshot lease must never
      // let one visitor disable statistics for everyone.
      if (error instanceof ApiError) throw error;
      const quota = quotaFailure(error, now);
      paused = quota ? {error:quota.error, resetAt:quota.resetAt, until:Date.parse(quota.resetAt)}
        : {error:'statistics_paused', until:now + PAUSE_MS};
      state.pause = paused; state.checked = false;
      try {await edge?.put(key, Response.json(paused, {headers:{'Cache-Control':`public, max-age=${Math.ceil((paused.until - now) / 1000)}`}}));}
      catch { /* Local circuit still prevents repeated D1 attempts. */ }
      rejectPaused(paused, now);
      }
    };
    if (state.checked) return run();
    const probe = run(); state.probe = probe;
    try {return await probe;} finally {if (state.probe === probe) state.probe = null;}
  };
}
