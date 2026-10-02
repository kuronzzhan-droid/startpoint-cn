// Loaded only by the opt-in local workerd cost test, never by the production Worker.
import {createParticipationCounter} from '../community-stats-counts.mjs';

export default {async fetch(request, env) {
  const raw = env.DB, input = await request.json();
  await raw.exec('CREATE TABLE community_character_ratings(character_id TEXT,visitor_id TEXT,score INTEGER,vote_day TEXT,updated_at INTEGER,PRIMARY KEY(character_id,visitor_id)); CREATE TABLE community_tier_rankings(visitor_id TEXT PRIMARY KEY,rows_json TEXT,vote_day TEXT,updated_at INTEGER); CREATE TABLE community_presence(visitor_hash TEXT PRIMARY KEY,last_seen INTEGER); CREATE INDEX community_presence_seen ON community_presence(last_seen);');
  for (const sql of input.migration) await raw.prepare(sql).run();
  const catalog = {characters:Object.fromEntries(Array.from({length:568}, (_,i) => ['c'+i, {}]))};
  let calls = [];
  function instrument(sql, statement = raw.prepare(sql)) {
    async function read() {
      const result = await statement.all();
      calls.push({sql, read:result.meta.rows_read, written:result.meta.rows_written});
      return result;
    }
    return {bind(...args) {return instrument(sql, statement.bind(...args));}, all:read,
      run:read, async first() {return (await read()).results[0] || null;}};
  }
  const db = {prepare:instrument}, metrics = [];
  function measure(name, count, results) {
    metrics.push({name, votesPerSource:count, read:calls.reduce((sum,item) => sum+item.read,0),
      written:calls.reduce((sum,item) => sum+item.written,0), queries:calls.length,
      voteScans:calls.filter(item => /^SELECT (?:character_id,visitor_id,score|visitor_id,rows_json) FROM/.test(item.sql)).length,
      results});
    calls = [];
  }
  for (const count of [10, 1000]) {
    await raw.exec('DELETE FROM community_character_ratings; DELETE FROM community_tier_rankings; DELETE FROM community_participation_snapshots;');
    await raw.prepare(`WITH RECURSIVE numbers(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM numbers WHERE n+1<?)
      INSERT INTO community_character_ratings SELECT 'c'||(n%568),'visitor-'||n,5,'day',1 FROM numbers`).bind(count).run();
    await raw.exec("INSERT INTO community_tier_rankings SELECT visitor_id,json_object('tier0',json_array(character_id)),'day',1 FROM community_character_ratings;");
    const now = 1_000_000 + count * 1_000;
    calls = [];
    const cold = await createParticipationCounter()(db,catalog,now);
    measure('cold', count, cold);
    const warm = await createParticipationCounter()(db,{characters:{...catalog.characters}},now + 86400_000);
    measure('new-counter-warm', count, warm);
    const concurrent = await Promise.all(Array.from({length:8}, () => createParticipationCounter()(db,catalog,now + 86400_000)));
    measure('eight-new-counter-warm', count, concurrent);
    await raw.prepare("INSERT INTO community_character_ratings VALUES('c0','additional',5,'day',1)").run();
    const dirty = await createParticipationCounter()(db,catalog,now + 59_999);
    measure('dirty-before-sixty-seconds', count, dirty);
    const refreshed = await Promise.all(Array.from({length:8}, () => createParticipationCounter()(db,catalog,now + 60_000)));
    measure('eight-dirty-contenders', count, refreshed);
    await raw.exec('DELETE FROM community_participation_snapshots;');
    const coldParallel = await Promise.allSettled(Array.from({length:8}, () => createParticipationCounter()(db,catalog,now + 120_000)));
    measure('eight-cold-contenders', count, coldParallel.map(result => result.status === 'fulfilled'
      ? {value:result.value} : {error:result.reason.code, retryAfter:result.reason.extra?.retryAfter}));
  }
  return Response.json(metrics);
}};
