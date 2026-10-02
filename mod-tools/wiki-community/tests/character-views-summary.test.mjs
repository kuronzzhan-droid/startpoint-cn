import test from 'node:test';
import assert from 'node:assert/strict';
import {context, fixtureCatalog} from './helpers.mjs';
import {openDatabase} from '../sqlite-adapter.mjs';
import {createCharacterViewsReader, CHARACTER_VIEWS_CACHE_MS} from '../character-views-summary.mjs';
import {createDailyRankingReader} from '../daily-ranking-snapshot.mjs';
import {publicSummary} from '../public-summary-cache.mjs';

const start = Date.parse('2026-10-02T04:00:00Z'), next = start + CHARACTER_VIEWS_CACHE_MS;
const source = 'SELECT character_id,views FROM community_character_views';
function database(t) {const db = openDatabase(); t.after(() => db.close()); return db;}
function seed(db, id = 'c0', views = 7) {db.raw.prepare('INSERT OR REPLACE INTO community_character_views VALUES(?,?)').run(id, views);}
function tracked(db) {
  const queries = [];
  return {queries, prepare(sql) {queries.push(sql); return db.prepare(sql);}};
}
function gated(db) {
  let enter, release, scans = 0;
  const entered = new Promise(resolve => {enter = resolve;}), gate = new Promise(resolve => {release = resolve;});
  return {entered, release, get scans() {return scans;}, prepare(sql) {
    const statement = db.prepare(sql);
    return sql !== source ? statement : {...statement, async all() {scans++; enter(); await gate; return statement.all();}};
  }};
}
function edgeCache() {
  const values = new Map(), writes = [];
  return {values, writes, async match(key) {return values.get(key.url)?.clone();},
    async put(key, response) {writes.push({key:key.url, ttl:response.headers.get('Cache-Control')}); values.set(key.url, response.clone());}};
}

test('anonymous batch returns every public id, zero for missing totals and excludes unknown ids without counting', async t => {
  const db = database(t), trace = tracked(db), app = context({db:{...db, prepare:trace.prepare}, production:true});
  app.now = start; seed(db); seed(db, 'not-public', 99);
  db.raw.prepare('INSERT INTO community_character_view_visitors VALUES(?,?,?)').run('c0','expired',0);
  const counters = () => ['community_character_views','community_character_view_visitors','community_limits','community_presence']
    .map(table => db.raw.prepare(`SELECT * FROM ${table}`).all());
  const before = counters(), response = await app.call('/views/characters?ids=not-public', {headers:{Cookie:'forged','CF-Connecting-IP':''}});
  assert.equal(response.status, 200); assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(response.json, {items:Object.keys(fixtureCatalog.characters).sort().map(id => ({id,views:id === 'c0' ? 7 : 0})),
    asOf:'2026-10-02T04:00:00.000Z',nextRefreshAt:'2026-10-02T04:30:00.000Z'});
  assert.deepEqual(counters(), before);
  assert.equal(trace.queries.filter(sql => sql === source).length, 1);
  assert.ok(trace.queries.every(sql => !/community_character_view_visitors|community_limits|community_presence/.test(sql)));
  for (const method of ['POST','PUT','PATCH','DELETE','OPTIONS']) assert.equal((await app.call('/views/characters', {method})).status, 405);
  assert.deepEqual(counters(), before);
});

test('fresh readers reuse one persisted row with no writes or totals scan, and refresh at the shared boundary', async t => {
  const db = database(t), trace = tracked(db); seed(db);
  const first = await createCharacterViewsReader()(trace, fixtureCatalog, next - 1);
  seed(db, 'c0', 8); trace.queries.length = 0;
  const before = db.raw.prepare('SELECT total_changes() n').get().n;
  assert.deepEqual(await createCharacterViewsReader()(trace, fixtureCatalog, next - 1), first);
  assert.equal(trace.queries.length, 1); assert.match(trace.queries[0], /^SELECT \* FROM community_daily_ranking_snapshots/);
  assert.equal(db.raw.prepare('SELECT total_changes() n').get().n, before);
  const refreshed = await createCharacterViewsReader()(trace, fixtureCatalog, next);
  assert.equal(refreshed.items.find(item => item.id === 'c0').views, 8);
  assert.equal(refreshed.asOf, new Date(next).toISOString()); assert.equal(refreshed.nextRefreshAt, new Date(next + CHARACTER_VIEWS_CACHE_MS).toISOString());
  assert.equal(trace.queries.filter(sql => sql === source).length, 1);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM community_daily_ranking_snapshots').get().n, 1);
});

test('same-isolate requests coalesce while a persisted lease blocks cold-isolate repeated scans', async t => {
  const db = gated(database(t)), reader = createCharacterViewsReader(), first = reader(db, fixtureCatalog, start);
  await db.entered;
  const joined = Array.from({length:10}, () => reader(db, fixtureCatalog, start));
  const cold = await Promise.allSettled(Array.from({length:4}, () => createCharacterViewsReader()(db, fixtureCatalog, start)));
  assert.ok(cold.every(result => result.status === 'rejected' && result.reason.code === 'views_refreshing'));
  db.release(); const result = await first;
  assert.ok((await Promise.all(joined)).every(item => item === result)); assert.equal(db.scans, 1);
});

test('slow previous-bucket scans cannot populate the next bucket or block it after publishing', async t => {
  const raw = database(t), db = gated(raw), reader = createCharacterViewsReader(); seed(raw);
  const previous = reader(db, fixtureCatalog, next - 1); await db.entered;
  await assert.rejects(reader(db, fixtureCatalog, next), error => error.code === 'views_refreshing');
  db.release(); const old = await previous; assert.equal(old.nextRefreshAt, new Date(next).toISOString());
  seed(raw, 'c0', 10);
  const current = await reader(db, fixtureCatalog, next);
  assert.equal(current.items.find(item => item.id === 'c0').views, 10);
  assert.equal(current.nextRefreshAt, new Date(next + CHARACTER_VIEWS_CACHE_MS).toISOString()); assert.equal(db.scans, 2);
});

test('failed source reads keep persisted backoff and never turn unavailable counts into zero', async t => {
  const raw = database(t); seed(raw);
  let scans = 0;
  const db = {prepare(sql) {
    if (sql !== source) return raw.prepare(sql);
    return {all:async () => {scans++; throw new Error('read unavailable');}};
  }};
  await assert.rejects(createCharacterViewsReader()(db, fixtureCatalog, start), /read unavailable/);
  await assert.rejects(createCharacterViewsReader()(db, fixtureCatalog, start + 59_999), error => error.code === 'views_refreshing');
  assert.equal(scans, 1);
  const resumed = await createCharacterViewsReader()(raw, fixtureCatalog, start + 60_000);
  assert.equal(resumed.items.find(item => item.id === 'c0').views, 7);
});

test('an older request reaching the database late cannot replace a newer bucket snapshot', async t => {
  const db = database(t), reader = createCharacterViewsReader(); seed(db);
  const current = await reader(db, fixtureCatalog, next), trace = tracked(db);
  const before = db.raw.prepare('SELECT * FROM community_daily_ranking_snapshots').all();
  await assert.rejects(createCharacterViewsReader()(trace, fixtureCatalog, next - 1), error => error.code === 'views_refreshing');
  assert.ok(!trace.queries.includes(source));
  assert.deepEqual(db.raw.prepare('SELECT * FROM community_daily_ranking_snapshots').all(),before);
  assert.deepEqual(await reader(db, fixtureCatalog, next),current);
});

test('expired and replaced leases cannot publish late results or release the successor', async t => {
  const raw = database(t), db = gated(raw), reader = createCharacterViewsReader();
  const key = await reader.cacheKey(fixtureCatalog), pending = reader(db, fixtureCatalog, start); await db.entered;
  raw.raw.prepare('UPDATE community_daily_ranking_snapshots SET lease_owner=?,lease_until=? WHERE catalog_hash=?').run('successor',start+30_000,key);
  db.release(); await assert.rejects(pending, error => error.code === 'views_refreshing');
  const row = raw.raw.prepare('SELECT * FROM community_daily_ranking_snapshots WHERE catalog_hash=?').get(key);
  assert.equal(row.payload_json, null); assert.equal(row.lease_owner, 'successor');
});

test('a scan whose lease expired cannot publish even when no successor has claimed it', async t => {
  const raw = database(t), db = gated(raw), reader = createCharacterViewsReader();
  const key = await reader.cacheKey(fixtureCatalog), pending = reader(db, fixtureCatalog, start); await db.entered;
  raw.raw.prepare('UPDATE community_daily_ranking_snapshots SET lease_until=? WHERE catalog_hash=?').run(start,key);
  db.release(); await assert.rejects(pending, error => error.code === 'views_refreshing');
  const row = raw.raw.prepare('SELECT * FROM community_daily_ranking_snapshots WHERE catalog_hash=?').get(key);
  assert.equal(row.payload_json,null); assert.equal(row.lease_owner,null); assert.equal(row.refresh_after,start+60_000);
});

test('catalogue changes get separate snapshots and damaged payloads cannot leak unknown characters', async t => {
  const db = database(t), reader = createCharacterViewsReader(); seed(db, 'not-public', 90);
  await reader(db, fixtureCatalog, start);
  const key = await reader.cacheKey(fixtureCatalog);
  db.raw.prepare('UPDATE community_daily_ranking_snapshots SET payload_json=? WHERE catalog_hash=?')
    .run(JSON.stringify({items:[{id:'not-public',views:90}]}),key);
  const repaired = await reader(db, fixtureCatalog, start);
  assert.equal(repaired.items.length, 12); assert.ok(repaired.items.every(item => item.views === 0));
  const changed = {...fixtureCatalog,characters:{c0:fixtureCatalog.characters.c0,'not-public':{element:'火'}}};
  const nextCatalog = await reader(db, changed, start);
  assert.deepEqual(nextCatalog.items,[{id:'c0',views:0},{id:'not-public',views:90}]);
  assert.notEqual(await reader.cacheKey(changed),key);
});

test('view snapshots leave ranking snapshots unchanged and database bindings isolated', async t => {
  const db = database(t), other = database(t), reader = createCharacterViewsReader(); seed(db); seed(other,'c0',80);
  await createDailyRankingReader()(db, fixtureCatalog, start);
  const original = db.raw.prepare('SELECT * FROM community_daily_ranking_snapshots').all();
  assert.equal((await reader(db, fixtureCatalog, start)).items.find(item=>item.id==='c0').views, 7);
  assert.equal((await reader(other, fixtureCatalog, start)).items.find(item=>item.id==='c0').views, 80);
  assert.deepEqual(db.raw.prepare("SELECT * FROM community_daily_ranking_snapshots WHERE catalog_hash NOT LIKE 'character-views:%'").all(),original);
});

test('edge cache coalesces anonymous reads, ignores cookies and query noise, and expires at the half-hour', async () => {
  const cache = edgeCache(); let loads = 0;
  const load = async () => ({items:[{id:'c0',views:++loads}],asOf:new Date(start).toISOString(),nextRefreshAt:new Date(next).toISOString()});
  const url = 'https://wiki.example/api/community/views/characters';
  const responses = await Promise.all(Array.from({length:8}, (_,i) => publicSummary(new Request(`${url}?noise=${i}`, {headers:{Cookie:'private'}}),load,cache,next-1000,'catalog-one')));
  assert.equal(loads,1); assert.ok(responses.every(value=>value.items[0].views===1));
  assert.equal(cache.writes[0].ttl,'public, max-age=1');
  assert.equal((await publicSummary(new Request(url),load,cache,next-1,'catalog-one')).items[0].views,1);
  assert.equal((await publicSummary(new Request(url),load,cache,next,'catalog-one')).items[0].views,2);
  assert.equal(cache.writes[1].ttl,'public, max-age=1800');
  assert.equal((await publicSummary(new Request(url),load,cache,next,'catalog-two')).items[0].views,3);
  assert.ok(cache.writes.every(item=>!item.key.includes('private')&&!item.key.includes('noise')));
});

test('edge failures and non-GET requests are not cached', async () => {
  const cache = edgeCache(), request = new Request('https://wiki.example/api/community/views/characters');
  await assert.rejects(publicSummary(request,async()=>{throw new Error('unavailable');},cache,start),/unavailable/);
  assert.equal(cache.writes.length,0);
  await publicSummary(new Request(request,{method:'POST'}),async()=>({ignored:true}),cache,start);
  assert.equal(cache.writes.length,0);
});
