// Only anonymous aggregate data may enter the edge cache. Identity, moderation,
// team visibility and revocable game codes must always read current state.
const PATHS = new Set(['/api/community/stats', '/api/community/ratings/characters', '/api/community/tier-rankings']);
export async function publicSummary(request, load, cache = globalThis.caches?.default) {
  const url = new URL(request.url), path = url.pathname.replace(/\/$/, '');
  if (!cache || request.method !== 'GET' || url.protocol !== 'https:' || !PATHS.has(path)) return load();
  const key = new Request(`${url.origin}/__wiki_summary_cache/v1${path}`);
  try {
    const found = await cache.match(key);
    if (found?.ok) return await found.json();
  } catch { /* Cache availability must not decide database availability. */ }
  const value = await load();
  try {await cache.put(key, Response.json(value, {headers:{'Cache-Control':'public, max-age=30'}}));}
  catch { /* Read still succeeds when the optional cache cannot be written. */ }
  return value;
}
