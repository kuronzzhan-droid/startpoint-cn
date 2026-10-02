import {chinaDay, fail} from './model.mjs';
import {listTierRankings} from './tier-rankings.mjs';
import rankingScore from '../wiki/rating-score.js';
import {ROW_SCORES} from './tier-ranking-store.mjs';

const LEASE_MS = 30_000, RETRY_MS = 60_000;
const validRows = new Set([...Object.keys(ROW_SCORES), 'provisional']);

function savedSnapshot(row, today) {
  if (!row || !Number.isSafeInteger(row.computed_at) || row.computed_at < 0
    || !Number.isFinite(new Date(row.computed_at).valueOf()) || typeof row.payload_json !== 'string'
    || row.payload_json.length > 1_000_000 || chinaDay(row.computed_at).date !== row.refresh_day) return null;
  try {
    const payload = JSON.parse(row.payload_json);
    if (Object.entries(rankingScore.FORMULA).some(([key, value]) => payload.formula?.[key] !== value)) return null;
    for (const source of ['placement', 'rating']) {
      if (!Array.isArray(payload.rankings?.[source])) return null;
      const seen = new Set();
      for (const item of payload.rankings[source]) {
        if (!item || typeof item.id !== 'string' || seen.has(item.id) || !validRows.has(item.row)
          || !Number.isSafeInteger(item.voters) || item.voters < 1 || !Number.isFinite(item.average)
          || item.average < (source === 'placement' ? 1 : 0) || item.average > 5
          || !Number.isFinite(item.rankScore) || item.rankScore < 0 || item.rankScore > 5) return null;
        seen.add(item.id);
      }
    }
    return {...payload, asOf:new Date(row.computed_at).toISOString(),
      nextRefreshAt:chinaDay(row.computed_at).nextLikeAt, refreshDay:row.refresh_day, stale:row.refresh_day !== today};
  } catch {return null;}
}

const read = (db, key) => db.prepare('SELECT * FROM community_daily_ranking_snapshots WHERE catalog_hash=?').bind(key).first();
function available(row, today, now) {
  const saved = savedSnapshot(row, today);
  if (saved) return saved;
  fail(503, 'rankings_refreshing', '今日排行正在汇总，请稍后重试。',
    {retryAfter:Math.max(1, Math.min(60, Math.ceil(((row?.refresh_after || now + 1000) - now) / 1000)))});
}

export async function readDailyRankingSnapshot(db, key, now, compute) {
  const today = chinaDay(now).date, initial = await read(db, key), previous = savedSnapshot(initial, today);
  if (previous && !previous.stale) return previous;
  if (initial?.refresh_after > now || initial?.lease_until > now) return available(initial, today, now);
  const owner = crypto.randomUUID(), started = Date.now();
  const claimed = await db.prepare(`INSERT INTO community_daily_ranking_snapshots
    (catalog_hash,refresh_after,lease_until,lease_owner) VALUES(?,?,?,?)
    ON CONFLICT(catalog_hash) DO UPDATE SET refresh_after=excluded.refresh_after,
      lease_until=excluded.lease_until,lease_owner=excluded.lease_owner
    WHERE community_daily_ranking_snapshots.refresh_after<=? AND community_daily_ranking_snapshots.lease_until<=?
      AND (?=1 OR community_daily_ranking_snapshots.refresh_day<>?)
    RETURNING catalog_hash`).bind(key, now + RETRY_MS, now + LEASE_MS, owner, now, now, previous ? 0 : 1, today).first();
  if (!claimed) return available(await read(db, key), today, now);
  let published = false;
  try {
    const payload = await compute(), json = JSON.stringify(payload), finished = now + Math.max(0, Date.now() - started);
    if (!savedSnapshot({payload_json:json, computed_at:now, refresh_day:today}, today)) throw new Error('Invalid daily ranking snapshot');
    const committed = await db.prepare(`UPDATE community_daily_ranking_snapshots SET
      payload_json=?,refresh_day=?,computed_at=?,lease_until=0,lease_owner=NULL
      WHERE catalog_hash=? AND lease_owner=? AND lease_until>?
      RETURNING payload_json,refresh_day,computed_at`).bind(json, today, now, key, owner, finished).first();
    if (committed) {published = true; return savedSnapshot(committed, today);}
  } catch (error) {
    if (!previous) throw error;
    return {...previous, stale:true};
  } finally {
    // A failed or expired scan cannot erase a successor's lease. The cooldown
    // persists across isolates so a database incident cannot cause scan storms.
    if (!published) await Promise.resolve().then(() => db.prepare(`UPDATE community_daily_ranking_snapshots
      SET lease_until=0,lease_owner=NULL WHERE catalog_hash=? AND lease_owner=?`).bind(key, owner).run()).catch(() => {});
  }
  return available(await read(db, key), today, now);
}

export function createDailyRankingReader({compute = listTierRankings} = {}) {
  const databases = new WeakMap(), keys = new WeakMap();
  async function catalogKey(catalog) {
    if (!keys.has(catalog)) keys.set(catalog, (async () => {
      const identity = JSON.stringify({version:1, characters:Object.keys(catalog.characters).sort(),
        formula:rankingScore.FORMULA, rows:ROW_SCORES});
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
      return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    })());
    return keys.get(catalog);
  }
  const reader = async (db, catalog, now) => {
    const key = await catalogKey(catalog), requestKey = `${key}:${chinaDay(now).date}`;
    let pending = databases.get(db);
    if (!pending) {pending = new Map(); databases.set(db, pending);}
    if (!pending.has(requestKey)) {
      const task = readDailyRankingSnapshot(db, key, now, () => compute(db, catalog));
      pending.set(requestKey, task);
      task.then(() => pending.delete(requestKey), () => pending.delete(requestKey));
    }
    return pending.get(requestKey);
  };
  // The edge cache must use the same catalogue/formula identity as D1; a
  // same-day release can remove characters or change ranking rules.
  reader.cacheKey = catalogKey;
  return reader;
}
