import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const runtimePath = process.env.WF_WIKI_MINIFLARE;
test('workerd D1 persistent participation snapshots bound cross-instance reads for ten and one thousand votes', {skip: !runtimePath}, async (t) => {
  const {Miniflare, convertV4MiniflareOptions} = await import(pathToFileURL(runtimePath).href);
  const root = path.resolve(import.meta.dirname, '..');
  const modules = [];
  for (const name of ['tests/community-stats-runtime-fixture.mjs','community-stats-counts.mjs',
    'community-stats-snapshot.mjs','tier-ranking-store.mjs','model.mjs','codecs.mjs'])
    modules.push({type:'ESModule', path:path.join(root,name), contents:await readFile(path.join(root,name),'utf8')});
  const scorePath = path.resolve(root, '../wiki/rating-score.js');
  modules.push({type:'CommonJS', path:scorePath, contents:await readFile(scorePath,'utf8')});
  const options = {modules, modulesRoot:path.dirname(root), compatibilityDate:'2026-09-29', d1Databases:{DB:'stats-cost-fixture'},
    outboundService:async () => {throw new Error('Network is disabled in the D1 cost fixture');}};
  const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
  t.after(() => mf.dispose());
  const sql = await readFile(path.join(root,'migrations/0011-participation-snapshots.sql'),'utf8');
  const migration = sql.replace(/^--.*$/gm,'').trim().split(/;\s*(?=CREATE|INSERT|$)/).map(value => value.trim()).filter(Boolean);
  const response = await mf.dispatchFetch('https://wiki.example/fixture', {method:'POST', body:JSON.stringify({migration})});
  assert.equal(response.status, 200);
  const metrics = await response.json();
  for (const count of [10, 1000]) {
    const item = name => metrics.find(value => value.name === name && value.votesPerSource === count);
    const cold = item('cold');
    assert.equal(cold.results.totalVoters, count); assert.equal(cold.results.ratingVoters, count); assert.equal(cold.results.tierVoters, count);
    assert.equal(cold.voteScans, 2); assert.ok(cold.read <= count * 2 + 30); assert.ok(cold.written <= 10);
    for (const name of ['new-counter-warm','dirty-before-sixty-seconds','eight-new-counter-warm']) {
      const result = item(name), requests = name.startsWith('eight') ? 8 : 1;
      assert.equal(result.voteScans, 0); assert.equal(result.written, 0);
      assert.ok(result.read <= requests * 5, `${name} reads only the indexed revision and snapshot`);
    }
    assert.equal(item('dirty-before-sixty-seconds').results.participationStale, true);
    assert.equal(item('dirty-before-sixty-seconds').results.totalVoters, count);
    const rebuilt = item('eight-dirty-contenders');
    assert.equal(rebuilt.voteScans, 2); assert.ok(rebuilt.read < count * 2 + 200);
    assert.ok(rebuilt.results.some(value => !value.participationStale && value.totalVoters === count + 1));
    assert.ok(rebuilt.results.every(value => value.totalVoters === count + (value.participationStale ? 0 : 1)));
    const coldParallel = item('eight-cold-contenders');
    assert.equal(coldParallel.voteScans, 2); assert.ok(coldParallel.read < count * 2 + 200);
    assert.ok(coldParallel.results.some(value => value.value?.totalVoters === count + 1));
    assert.ok(coldParallel.results.every(value => value.value?.totalVoters === count + 1 || value.error === 'stats_refreshing'));
  }
  assert.equal(metrics.find(value => value.name === 'new-counter-warm' && value.votesPerSource === 10).read,
    metrics.find(value => value.name === 'new-counter-warm' && value.votesPerSource === 1000).read);
  const summary = metrics.map(({results, ...item}) => item);
  console.log('D1 persistent statistics fixture cost:', JSON.stringify(summary));
  if (process.env.WF_WIKI_STATS_COST_REPORT)
    await writeFile(process.env.WF_WIKI_STATS_COST_REPORT, JSON.stringify({localWorkerd:true, productionUsed:false, metrics:summary}, null, 2)+'\n');
});
