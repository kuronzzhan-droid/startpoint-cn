import {fail} from './model.mjs';

export const PARTICIPATION_CACHE_MS = 60_000;
const LEASE_MS = 30_000;

function savedCounts(row, stale = row?.revision !== row?.current_revision) {
  if (!row || !Number.isSafeInteger(row.computed_at) || row.computed_at < 0
    || !Number.isFinite(new Date(row.computed_at).valueOf())) return null;
  const values = [row.rating_voters, row.tier_voters, row.total_voters];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)
    || row.total_voters < Math.max(row.rating_voters, row.tier_voters)
    || row.total_voters > row.rating_voters + row.tier_voters) return null;
  return {ratingVoters:row.rating_voters, tierVoters:row.tier_voters, totalVoters:row.total_voters,
    participationAsOf:new Date(row.computed_at).toISOString(), participationStale:Boolean(stale)};
}

async function readSnapshot(db, key) {
  return db.prepare(`SELECT snapshot.*, version.revision AS current_revision
    FROM community_participation_revision AS version
    LEFT JOIN community_participation_snapshots AS snapshot ON snapshot.catalog_hash=?
    WHERE version.id=1`).bind(key).first();
}

function available(row, now) {
  const saved = savedCounts(row);
  if (saved) return saved;
  fail(503, 'stats_refreshing', '参与人数正在更新，请稍后重试。',
    {retryAfter:Math.max(1, Math.min(60, Math.ceil(((row?.refresh_after || now + 1000) - now) / 1000)))});
}

export async function readParticipationSnapshot(db, key, now, compute) {
  const initial = await readSnapshot(db, key), previous = savedCounts(initial);
  if (previous && !previous.participationStale) return previous;
  if (initial?.refresh_after > now || initial?.lease_until > now) return available(initial, now);
  const owner = crypto.randomUUID(), started = Date.now();
  const claimed = await db.prepare(`INSERT INTO community_participation_snapshots
    (catalog_hash,revision,refresh_after,lease_until,lease_owner) VALUES(?,-1,?,?,?)
    ON CONFLICT(catalog_hash) DO UPDATE SET refresh_after=excluded.refresh_after,
      lease_until=excluded.lease_until,lease_owner=excluded.lease_owner
    WHERE community_participation_snapshots.refresh_after<=?
      AND community_participation_snapshots.lease_until<=?
      AND (?=1 OR community_participation_snapshots.computed_at IS NULL OR
        community_participation_snapshots.revision<>(SELECT revision FROM community_participation_revision WHERE id=1))
    RETURNING (SELECT revision FROM community_participation_revision WHERE id=1) AS claimed_revision`)
    .bind(key, now + PARTICIPATION_CACHE_MS, now + LEASE_MS, owner, now, now, previous ? 0 : 1).first();
  if (!claimed) return available(await readSnapshot(db, key), now);
  let published = false;
  try {
    const counts = await compute();
    const finished = now + Math.max(0, Date.now() - started);
    const committed = await db.prepare(`UPDATE community_participation_snapshots SET
      rating_voters=?,tier_voters=?,total_voters=?,revision=?,computed_at=?,lease_until=0,lease_owner=NULL
      WHERE catalog_hash=? AND lease_owner=? AND lease_until>?
        AND (SELECT revision FROM community_participation_revision WHERE id=1)=?
      RETURNING rating_voters,tier_voters,total_voters,computed_at`)
      .bind(counts.ratingVoters, counts.tierVoters, counts.totalVoters, claimed.claimed_revision, now,
        key, owner, finished, claimed.claimed_revision).first();
    if (committed) {published = true; return savedCounts(committed, false);}
    // A vote changed or a successor took the lease. Never publish a mixed scan.
  } catch (error) {
    if (!previous) throw error;
    return {...previous, participationStale:true};
  } finally {
    // Keep refresh_after even after failure, so cold requests cannot scan in a loop.
    if (!published) await Promise.resolve().then(() => db.prepare(`UPDATE community_participation_snapshots SET lease_until=0,lease_owner=NULL
      WHERE catalog_hash=? AND lease_owner=?`).bind(key, owner).run()).catch(() => {});
  }
  return available(await readSnapshot(db, key), now);
}
