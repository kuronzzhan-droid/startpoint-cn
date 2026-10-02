import {ROW_SCORES} from './tier-ranking-store.mjs';
import {readParticipationSnapshot} from './community-stats-snapshot.mjs';

export {PARTICIPATION_CACHE_MS} from './community-stats-snapshot.mjs';

async function countParticipants(db, characters) {
  // Expanding the entire catalogue with json_each costs D1 row reads even when
  // nobody has voted. Read each stored vote once and validate IDs in memory.
  const [ratings, rankings] = await Promise.all([
    Promise.resolve().then(() => db.prepare('SELECT character_id,visitor_id,score FROM community_character_ratings').all()),
    Promise.resolve().then(() => db.prepare('SELECT visitor_id,rows_json FROM community_tier_rankings').all())
  ]);
  const ratingVisitors = new Set(), tierVisitors = new Set();
  for (const row of ratings.results) {
    if (typeof row.character_id === 'string' && characters.has(row.character_id)
      && Number.isInteger(row.score) && row.score >= 0 && row.score <= 5)
      ratingVisitors.add(row.visitor_id);
  }
  for (const ranking of rankings.results) {
    let rows;
    try { rows = JSON.parse(ranking.rows_json); } catch { continue; }
    if (!rows || typeof rows !== 'object' || Array.isArray(rows)) continue;
    const hasVote = Object.keys(ROW_SCORES).some((key) => Object.hasOwn(rows, key) && Array.isArray(rows[key])
      && rows[key].some((id) => typeof id === 'string' && characters.has(id)));
    if (hasVote) tierVisitors.add(ranking.visitor_id);
  }
  return {ratingVoters: ratingVisitors.size, tierVoters: tierVisitors.size,
    totalVoters: new Set([...ratingVisitors, ...tierVisitors]).size};
}

export function createParticipationCounter() {
  // Only merge concurrent work here. The persisted snapshot is shared by Workers
  // and remains valid indefinitely until a vote or the catalogue changes.
  const databases = new WeakMap();
  return async (db, catalog, now) => {
    const characters = new Set(Object.keys(catalog.characters));
    const identity = JSON.stringify({version:1, characters:[...characters].sort(), rows:Object.keys(ROW_SCORES).sort()});
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
    const key = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    let pending = databases.get(db);
    if (!pending) {pending = new Map(); databases.set(db, pending);}
    if (!pending.has(key)) {
      const task = readParticipationSnapshot(db, key, now, () => countParticipants(db, characters));
      pending.set(key, task);
      task.then(() => pending.delete(key), () => pending.delete(key));
    }
    return pending.get(key);
  };
}
