// Only anonymous aggregate data and the public announcement may enter the edge cache. Identity, moderation,
// team visibility and revocable game codes must always read current state.
const PATHS = new Set(['/api/community/stats', '/api/community/ratings/characters', '/api/community/tier-rankings', '/api/community/announcement']);
const pendingByCache = new WeakMap();
export async function publicSummary(request, load, cache = globalThis.caches?.default, now = Date.now(), namespace = 'default') {
  const url = new URL(request.url), path = url.pathname.replace(/\/$/, '');
  if (!cache || request.method !== 'GET' || url.protocol !== 'https:' || !PATHS.has(path)) return load();
  const daily = path.endsWith('/tier-rankings') || path.endsWith('/ratings/characters');
  const day = Math.floor((now + 28_800_000) / 86_400_000);
  // Date-scoped keys cannot carry yesterday's board across the Beijing midnight boundary.
  const key = new Request(`${url.origin}/__wiki_summary_cache/v4/${encodeURIComponent(namespace)}${path}${daily ? `/${day}` : ''}`);
  try {
    const found = await cache.match(key);
    if (found?.ok) return await found.json();
  } catch { /* Cache availability must not decide database availability. */ }
  let pending = pendingByCache.get(cache);
  if (!pending) {pending = new Map(); pendingByCache.set(cache, pending);}
  let job = pending.get(key.url);
  if (!job) {
    // Coalesce a cold-cache burst within this Worker instance, before querying D1.
    job = Promise.resolve().then(async () => {
      const value = await load();
      const remaining = Math.max(1, Math.floor(((day + 1) * 86_400_000 - 28_800_000 - now) / 1000));
      const ttl = daily ? (value?.stale ? Math.min(60, remaining) : remaining) : path.endsWith('/stats') ? 1800 : 30;
      try {await cache.put(key, Response.json(value, {headers:{'Cache-Control':`public, max-age=${ttl}`}}));}
      catch { /* Read still succeeds when the optional cache cannot be written. */ }
      return value;
    });
    pending.set(key.url, job);
  }
  try {return await job;}
  finally {if (pending.get(key.url) === job) pending.delete(key.url);}
}
