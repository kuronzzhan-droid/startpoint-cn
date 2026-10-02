import {fail} from './model.mjs';

export const CHARACTER_VIEWS_CACHE_MS = 30 * 60_000;
const LEASE_MS = 30_000, RETRY_MS = 60_000;
const bucketAt = now => Math.floor(now / CHARACTER_VIEWS_CACHE_MS);

function savedSnapshot(row, ids) {
  if (!row || !Number.isSafeInteger(row.computed_at) || row.computed_at < 0
    || !Number.isFinite(new Date(row.computed_at).valueOf())
    || row.refresh_day !== String(bucketAt(row.computed_at)) || typeof row.payload_json !== 'string'
    || row.payload_json.length > 1_000_000) return null;
  try {
    const {items} = JSON.parse(row.payload_json);
    if (!Array.isArray(items) || items.length !== ids.length || items.some((item, index) =>
      item?.id !== ids[index] || !Number.isSafeInteger(item.views) || item.views < 0)) return null;
    return {items:items.map(({id, views}) => ({id, views})), asOf:new Date(row.computed_at).toISOString(),
      nextRefreshAt:new Date((bucketAt(row.computed_at) + 1) * CHARACTER_VIEWS_CACHE_MS).toISOString()};
  } catch {return null;}
}

const read = (db, key) => db.prepare('SELECT * FROM community_daily_ranking_snapshots WHERE catalog_hash=?').bind(key).first();
function available(row, ids, now) {
  const saved = savedSnapshot(row, ids);
  if (saved && row.refresh_day === String(bucketAt(now))) return saved;
  fail(503, 'views_refreshing', '角色查看次数正在更新，请稍后重试。',
    {retryAfter:Math.max(1, Math.min(60, Math.ceil(((row?.refresh_after || now + 1000) - now) / 1000)))});
}

async function readSnapshot(db, key, ids, now) {
  const bucket = String(bucketAt(now)), initial = await read(db, key), previous = savedSnapshot(initial, ids);
  if (previous && initial.refresh_day === bucket) return previous;
  if (initial?.refresh_after > now || initial?.lease_until > now) return available(initial, ids, now);
  const owner = crypto.randomUUID(), started = Date.now();
  // Reuse the existing JSON snapshot/lease store under a disjoint key. No vote,
  // view-counter or deduplication record is changed by this anonymous read.
  const claimed = await db.prepare(`INSERT INTO community_daily_ranking_snapshots
    (catalog_hash,refresh_after,lease_until,lease_owner) VALUES(?,?,?,?)
    ON CONFLICT(catalog_hash) DO UPDATE SET refresh_after=excluded.refresh_after,
      lease_until=excluded.lease_until,lease_owner=excluded.lease_owner
    WHERE community_daily_ranking_snapshots.refresh_after<=? AND community_daily_ranking_snapshots.lease_until<=?
      AND (community_daily_ranking_snapshots.computed_at IS NULL OR community_daily_ranking_snapshots.computed_at<=?)
      AND (?=1 OR community_daily_ranking_snapshots.refresh_day<>?)
    RETURNING catalog_hash`).bind(key, now + RETRY_MS, now + LEASE_MS, owner, now, now, now, previous ? 0 : 1, bucket).first();
  if (!claimed) return available(await read(db, key), ids, now);
  let published = false;
  try {
    const rows = await db.prepare('SELECT character_id,views FROM community_character_views').all();
    const counts = new Map(rows.results.map(row => [row.character_id, row.views]));
    const items = ids.map(id => ({id, views:counts.get(id) ?? 0}));
    const json = JSON.stringify({items}), finished = now + Math.max(0, Date.now() - started);
    if (!savedSnapshot({payload_json:json, computed_at:now, refresh_day:bucket}, ids)) throw new Error('Invalid character view totals');
    const committed = await db.prepare(`UPDATE community_daily_ranking_snapshots SET
      payload_json=?,refresh_day=?,computed_at=?,refresh_after=0,lease_until=0,lease_owner=NULL
      WHERE catalog_hash=? AND lease_owner=? AND lease_until>?
      RETURNING payload_json,refresh_day,computed_at`).bind(json, bucket, now, key, owner, finished).first();
    if (committed) {published = true; return savedSnapshot(committed, ids);}
  } finally {
    // Persist failure cooldown across isolates; an expired scan may not erase
    // a successor's lease or make another full scan on every request.
    if (!published) await Promise.resolve().then(() => db.prepare(`UPDATE community_daily_ranking_snapshots
      SET lease_until=0,lease_owner=NULL WHERE catalog_hash=? AND lease_owner=?`).bind(key, owner).run()).catch(() => {});
  }
  return available(await read(db, key), ids, now);
}

export function createCharacterViewsReader() {
  const databases = new WeakMap(), identities = new WeakMap();
  function identity(catalog) {
    if (!identities.has(catalog)) identities.set(catalog, (async () => {
      const ids = Object.keys(catalog.characters).sort();
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(ids)));
      const key = `character-views:v1:${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
      return {ids, key};
    })());
    return identities.get(catalog);
  }
  const reader = async (db, catalog, now) => {
    const {ids, key} = await identity(catalog), requestKey = `${key}:${bucketAt(now)}`;
    let pending = databases.get(db);
    if (!pending) {pending = new Map(); databases.set(db, pending);}
    if (!pending.has(requestKey)) {
      const task = readSnapshot(db, key, ids, now);
      pending.set(requestKey, task);
      task.then(() => pending.delete(requestKey), () => pending.delete(requestKey));
    }
    return pending.get(requestKey);
  };
  reader.cacheKey = async catalog => (await identity(catalog)).key;
  return reader;
}
