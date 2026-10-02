import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const runtimePath = process.env.WF_WIKI_MINIFLARE;
test('workerd D1 daily rankings persist across runtime restarts with constant-cost warm reads', {skip:!runtimePath}, async t => {
  const {Miniflare, convertV4MiniflareOptions} = await import(pathToFileURL(runtimePath).href);
  const root = path.resolve(import.meta.dirname, '..'), temporaryRoot = path.resolve(tmpdir());
  const persisted = await mkdtemp(path.join(temporaryRoot, 'wf-daily-workerd-'));
  const entry = `import {createDailyRankingReader} from './daily-ranking-snapshot.mjs';
    const catalog={characters:Object.fromEntries(Array.from({length:568},(_,i)=>['c'+i,{}]))};
    export default {async fetch(request,env) {
      const raw=env.DB,input=await request.json();
      if(input.action==='seed') {
        await raw.exec('CREATE TABLE community_character_ratings(character_id TEXT,visitor_id TEXT,score INTEGER,vote_day TEXT,updated_at INTEGER,PRIMARY KEY(character_id,visitor_id)); CREATE TABLE community_tier_rankings(visitor_id TEXT PRIMARY KEY,rows_json TEXT,vote_day TEXT,updated_at INTEGER);');
        await raw.prepare(input.migration).run();
        await raw.prepare("WITH RECURSIVE numbers(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM numbers WHERE n<999) INSERT INTO community_character_ratings SELECT 'c'||(n%568),'private-visitor-'||n,5,'2026-10-02',1 FROM numbers").run();
        await raw.exec("INSERT INTO community_tier_rankings SELECT visitor_id,json_object('tier0',json_array(character_id)),'2026-10-02',1 FROM community_character_ratings;");
        return Response.json({seeded:1000});
      }
      if(input.action==='vote') {
        await raw.exec("INSERT INTO community_character_ratings VALUES('c0','private-additional',0,'2026-10-02',1); INSERT INTO community_tier_rankings VALUES('private-additional','{\\"tier4\\":[\\"c0\\"]}','2026-10-02',1);");
        return Response.json({saved:true});
      }
      const calls=[];
      function prepare(sql,statement=raw.prepare(sql)) {
        async function run() {
          const result=await statement.all();
          calls.push({sql,read:result.meta.rows_read,written:result.meta.rows_written});
          return result;
        }
        return {bind(...values){return prepare(sql,statement.bind(...values));},all:run,run,
          async first(){return (await run()).results[0]||null;}};
      }
      const result=await createDailyRankingReader()({prepare},catalog,input.now);
      return Response.json({result,cost:{read:calls.reduce((n,c)=>n+c.read,0),written:calls.reduce((n,c)=>n+c.written,0),
        queries:calls.length,voteScans:calls.filter(c=>/GROUP BY/.test(c.sql)).length}});
    }};`;
  const modules = [{type:'ESModule', path:path.join(root, '__daily_cost_fixture.mjs'), contents:entry}];
  for (const name of ['daily-ranking-snapshot.mjs', 'tier-rankings.mjs', 'character-ratings.mjs',
    'tier-ranking-store.mjs', 'security.mjs', 'limit-maintenance.mjs', 'model.mjs', 'codecs.mjs'])
    modules.push({type:'ESModule', path:path.join(root, name), contents:await readFile(path.join(root, name), 'utf8')});
  const scorePath = path.resolve(root, '../wiki/rating-score.js');
  modules.push({type:'CommonJS', path:scorePath, contents:await readFile(scorePath, 'utf8')});
  const options = {modules, modulesRoot:path.dirname(root), compatibilityDate:'2026-09-29',
    d1Databases:{DB:'daily-ranking-cost'},
    ...(convertV4MiniflareOptions ? {resourcePersistencePath:persisted} : {d1Persist:persisted}),
    outboundService:async () => {throw new Error('Network is disabled in the daily D1 fixture');}};
  let runtime;
  async function restart() {
    await runtime?.dispose();
    runtime = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
  }
  t.after(async () => {
    await runtime?.dispose();
    assert.equal(path.dirname(path.resolve(persisted)), temporaryRoot);
    assert.ok(path.basename(persisted).startsWith('wf-daily-workerd-'));
    await rm(persisted, {recursive:true, force:true});
  });
  async function call(input) {
    const response = await runtime.dispatchFetch('https://wiki.example/fixture', {method:'POST', body:JSON.stringify(input)});
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get('set-cookie'), null);
    return response.json();
  }
  const now = Date.parse('2026-10-02T04:00:00Z'), tomorrow = Date.parse('2026-10-02T16:00:00Z');
  const metrics = [];
  const countVotes = source => source.reduce((sum, item) => sum + item.voters, 0);
  function collect(name, value) {
    const {result, cost} = value;
    assert.deepEqual(Object.keys(result).sort(), ['asOf','formula','nextRefreshAt','rankings','refreshDay','stale']);
    assert.deepEqual(Object.keys(result.rankings).sort(), ['placement','rating']);
    assert.ok(!/visitor|myScore|claim|submittedToday|vote_day|private-/.test(JSON.stringify(result)));
    assert.equal(result.stale, false);
    metrics.push({name, ...cost, ratingVotes:countVotes(result.rankings.rating), placementVotes:countVotes(result.rankings.placement),
      asOf:result.asOf, nextRefreshAt:result.nextRefreshAt});
    return result;
  }
  await restart();
  const migration = (await readFile(path.join(root, 'migrations/0013-daily-ranking-snapshot.sql'), 'utf8')).replace(/^--.*$/gm, '').trim();
  assert.deepEqual(await call({action:'seed', migration}), {seeded:1000});
  const cold = collect('cold-1000-per-source', await call({now}));
  assert.equal(metrics[0].voteScans, 2); assert.ok(metrics[0].written > 0);
  assert.equal(metrics[0].ratingVotes, 1000); assert.equal(metrics[0].placementVotes, 1000);
  assert.equal(cold.nextRefreshAt, new Date(tomorrow).toISOString());
  await restart();
  assert.deepEqual(collect('new-runtime-warm', await call({now:now + 1000})), cold);
  assert.deepEqual(await call({action:'vote'}), {saved:true});
  await restart();
  assert.deepEqual(collect('new-runtime-same-day-new-votes', await call({now:tomorrow - 1})), cold);
  for (const item of metrics.slice(1)) {
    assert.equal(item.voteScans, 0); assert.equal(item.written, 0); assert.ok(item.read <= 2);
    assert.equal(item.queries, 1);
  }
  await restart();
  const refreshed = collect('new-runtime-next-day', await call({now:tomorrow}));
  const next = metrics.at(-1);
  assert.equal(next.voteScans, 2); assert.ok(next.written > 0);
  assert.equal(next.ratingVotes, 1001); assert.equal(next.placementVotes, 1001);
  assert.equal(refreshed.refreshDay, '2026-10-03'); assert.notDeepEqual(refreshed.rankings, cold.rankings);
  console.log('Daily ranking real D1 costs:', JSON.stringify(metrics));
  if (process.env.WF_WIKI_DAILY_COST_REPORT)
    await writeFile(process.env.WF_WIKI_DAILY_COST_REPORT, JSON.stringify({localWorkerd:true, productionUsed:false,
      runtimeRestarts:3, sourceVotes:1000, metrics}, null, 2) + '\n');
});
