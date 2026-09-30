import {ROW_SCORES} from './tier-ranking-store.mjs';

export const PARTICIPATION_CACHE_MS = 60_000;

async function countParticipants(db, catalog) {
  // Expanding the entire catalogue with json_each costs D1 row reads even when
  // nobody has voted. Read each stored vote once and validate IDs in memory.
  const [ratings, rankings] = await Promise.all([
    Promise.resolve().then(() => db.prepare('SELECT character_id,visitor_id,score FROM community_character_ratings').all()),
    Promise.resolve().then(() => db.prepare('SELECT visitor_id,rows_json FROM community_tier_rankings').all())
  ]);
  const ratingVisitors = new Set(), tierVisitors = new Set();
  for (const row of ratings.results) {
    if (typeof row.character_id === 'string' && Object.hasOwn(catalog.characters, row.character_id)
      && Number.isInteger(row.score) && row.score >= 0 && row.score <= 5)
      ratingVisitors.add(row.visitor_id);
  }
  for (const ranking of rankings.results) {
    let rows;
    try { rows = JSON.parse(ranking.rows_json); } catch { continue; }
    if (!rows || typeof rows !== 'object' || Array.isArray(rows)) continue;
    const hasVote = Object.keys(ROW_SCORES).some((key) => Object.hasOwn(rows, key) && Array.isArray(rows[key])
      && rows[key].some((id) => typeof id === 'string' && Object.hasOwn(catalog.characters, id)));
    if (hasVote) tierVisitors.add(ranking.visitor_id);
  }
  return {ratingVoters: ratingVisitors.size, tierVoters: tierVisitors.size,
    totalVoters: new Set([...ratingVisitors, ...tierVisitors]).size};
}

export function createParticipationCounter() {
  // Binding/catalogue identities isolate databases and catalogue revisions. Weak
  // keys avoid retaining old bindings; only counts, never visitor IDs, are cached.
  const databases = new WeakMap();
  return async (db, catalog, now) => {
    let catalogues = databases.get(db);
    if (!catalogues) { catalogues = new WeakMap(); databases.set(db, catalogues); }
    let state = catalogues.get(catalog);
    if (!state) { state = {}; catalogues.set(catalog, state); }
    if (state.value && now >= state.startedAt && now < state.startedAt + PARTICIPATION_CACHE_MS)
      return state.value;
    if (!state.pending) {
      state.pending = countParticipants(db, catalog).then((value) => {
        state.value = value; state.startedAt = now;
        return value;
      }).finally(() => { state.pending = null; });
    }
    // Expired counts are not passed off as current after a database failure.
    return state.pending;
  };
}
