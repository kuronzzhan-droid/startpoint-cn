import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// Exact pre-fix query, retained solely to catch D1 virtual-table read amplification.
const previousQuery = `WITH characters AS (SELECT value AS id FROM json_each(?)),
  rating_visitors AS (SELECT DISTINCT visitor_id FROM community_character_ratings
    WHERE character_id IN (SELECT id FROM characters) AND typeof(score)='integer' AND score BETWEEN 0 AND 5),
  tier_visitors AS (SELECT DISTINCT ranking.visitor_id FROM community_tier_rankings AS ranking
    WHERE EXISTS(SELECT 1
      FROM json_each(CASE WHEN json_valid(ranking.rows_json) THEN ranking.rows_json ELSE '{}' END) AS tier,
        json_each(CASE WHEN tier.type='array' THEN tier.value ELSE '[]' END) AS item
      WHERE tier.key IN ('tier0','between0','tier1','between1','tier2','between2','tier3','between3','tier4')
        AND item.type='text' AND item.value IN (SELECT id FROM characters)))
  SELECT (SELECT COUNT(*) FROM rating_visitors) AS ratingVoters,
    (SELECT COUNT(*) FROM tier_visitors) AS tierVoters,
    (SELECT COUNT(*) FROM (SELECT visitor_id FROM rating_visitors UNION SELECT visitor_id FROM tier_visitors)) AS totalVoters,
    (SELECT COUNT(*) FROM community_presence WHERE last_seen>? AND last_seen<=?) AS onlineVisitors`;

const runtimePath = process.env.WF_WIKI_MINIFLARE;
test('workerd D1 reads stored votes once instead of expanding all 568 catalogue IDs per heartbeat', {skip: !runtimePath}, async (t) => {
  const {Miniflare, convertV4MiniflareOptions} = await import(pathToFileURL(runtimePath).href);
  const root = path.resolve(import.meta.dirname, '..');
  const entry = `import {communityStats} from './community-stats.mjs';
    export default {async fetch(request, env) {
      const db = env.DB, legacy = (await request.json()).query;
      await db.exec('CREATE TABLE community_character_ratings(character_id TEXT,visitor_id TEXT,score INTEGER,PRIMARY KEY(character_id,visitor_id)); CREATE TABLE community_tier_rankings(visitor_id TEXT PRIMARY KEY,rows_json TEXT); CREATE TABLE community_presence(visitor_hash TEXT PRIMARY KEY,last_seen INTEGER); CREATE INDEX community_presence_seen ON community_presence(last_seen);');
      const characters = Object.fromEntries(Array.from({length:568}, (_,i) => ['c'+i, {}]));
      const catalog = {characters}, metrics = [];
      let calls = [];
      function instrument(sql, statement = db.prepare(sql)) {
        async function read() {const result = await statement.all(); calls.push({sql, read:result.meta.rows_read}); return result;}
        return {bind(...args) {return instrument(sql, statement.bind(...args));}, all:read,
          async first() {return (await read()).results[0] || null;}};
      }
      const measured = {prepare:instrument};
      for (const [name, now] of [['empty',1000000], ['one-vote-each',1060000]]) {
        if (name === 'one-vote-each') {
          await db.prepare('INSERT INTO community_character_ratings VALUES (?,?,?)').bind('c0','visitor1',5).run();
          await db.prepare('INSERT INTO community_tier_rankings VALUES (?,?)').bind('visitor1','{"tier0":["c0"]}').run();
        }
        const before = await db.prepare(legacy).bind(JSON.stringify(Object.keys(characters)),now-120000,now).all();
        calls = []; const counts = await communityStats(measured,catalog,now);
        metrics.push({name, before:before.meta.rows_read, after:calls.reduce((sum,item) => sum+item.read,0), counts});
      }
      calls = []; await communityStats(measured,catalog,1090000);
      metrics.push({name:'warm', after:calls.reduce((sum,item) => sum+item.read,0), queries:calls.length});
      calls = []; await Promise.all(Array.from({length:8}, () => communityStats(measured,catalog,1120000)));
      metrics.push({name:'eight-concurrent-expired', after:calls.reduce((sum,item) => sum+item.read,0),
        voteQueries:calls.filter((item) => !item.sql.includes('community_presence')).length});
      return Response.json(metrics);
    }};`;
  const modules = [{type:'ESModule', path:path.join(root, '__stats_cost_test.mjs'), contents:entry}];
  for (const name of ['community-stats.mjs','community-stats-counts.mjs','tier-ranking-store.mjs','security.mjs','model.mjs','codecs.mjs'])
    modules.push({type:'ESModule', path:path.join(root,name), contents:await readFile(path.join(root,name),'utf8')});
  const options = {modules, modulesRoot:root, compatibilityDate:'2026-09-29', d1Databases:{DB:'stats-cost-fixture'},
    outboundService:async () => {throw new Error('Network is disabled in the D1 cost fixture');}};
  const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
  t.after(() => mf.dispose());
  const result = await mf.dispatchFetch('https://wiki.example/fixture', {method:'POST', body:JSON.stringify({query:previousQuery})});
  assert.equal(result.status, 200);
  const metrics = await result.json();
  for (const item of metrics.slice(0,2)) {
    assert.ok(item.before > 1000, 'legacy catalogue expansion must be visible in actual D1 row metrics');
    assert.ok(item.after <= 3, 'cold aggregation reads only the two vote rows and indexed presence count');
  }
  assert.equal(metrics[1].counts.totalVoters, 1);
  assert.equal(metrics[1].counts.ratingVoters, 1); assert.equal(metrics[1].counts.tierVoters, 1);
  assert.equal(metrics[2].queries, 1); assert.ok(metrics[2].after <= 1);
  assert.equal(metrics[3].voteQueries, 2); assert.ok(metrics[3].after <= 10);
  console.log('D1 statistics fixture row reads:', JSON.stringify(metrics));
});
