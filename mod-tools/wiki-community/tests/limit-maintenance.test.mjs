import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {context} from './helpers.mjs';
import {rateLimit} from '../security.mjs';
import {createLimitMaintenance, LIMIT_CLEANUP_ROWS, LIMIT_MAINTENANCE_MS} from '../limit-maintenance.mjs';

function tracked(db) {
  const calls = [];
  return {calls, prepare(sql) {calls.push(sql); return db.prepare(sql);}};
}
const count = (app, pattern) => app.db.raw.prepare('SELECT COUNT(*) n FROM community_limits WHERE key LIKE ?').get(pattern).n;

test('thirty-minute maintenance is bounded, indexed and shared across cold instances', async t => {
  const app = context(); t.after(() => app.close());
  const now = Math.floor(app.now / LIMIT_MAINTENANCE_MS) * LIMIT_MAINTENANCE_MS + 1000;
  const insert = app.db.raw.prepare('INSERT INTO community_limits VALUES(?,?,?)');
  for (let i = 0; i < LIMIT_CLEANUP_ROWS + 75; i++) insert.run(`old-${i}`, 1, now - 1);
  for (let i = 0; i < 3000; i++) insert.run(`future-${i}`, 1, now + LIMIT_MAINTENANCE_MS * 2);
  const db = tracked(app.db), workers = Array.from({length:12}, () => createLimitMaintenance());
  await Promise.all(workers.map(maintain => maintain(db,now)));
  assert.equal(count(app,'old-%'),75);
  assert.equal(count(app,'future-%'),3000);
  assert.equal(db.calls.filter(sql => sql.startsWith('DELETE')).length,1);
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_maintenance').get().n,1);
  const before = db.calls.length;
  await Promise.all(workers.flatMap(maintain => Array.from({length:10}, () => maintain(db,now + 1))));
  assert.equal(db.calls.length,before,'warm requests perform no maintenance SQL');
  await createLimitMaintenance()(db,now + 2);
  assert.equal(count(app,'old-%'),75,'a new Worker cannot clean a second batch in the same interval');
  const nextRun = app.db.raw.prepare('SELECT next_run FROM community_maintenance').get().next_run;
  await Promise.all(workers.map(maintain => maintain(db,nextRun)));
  assert.equal(count(app,'old-%'),0);
  assert.equal(count(app,'future-%'),3000);
  assert.equal(db.calls.filter(sql => sql.startsWith('DELETE')).length,2);
  const plan = app.db.raw.prepare('EXPLAIN QUERY PLAN SELECT key FROM community_limits WHERE expires_at<=? ORDER BY expires_at LIMIT ?')
    .all(now,LIMIT_CLEANUP_ROWS);
  assert.ok(plan.some(row => /COVERING INDEX community_limits_expiry/.test(row.detail)),JSON.stringify(plan));
});

test('maintenance coalesces simultaneous requests in one instance and retries database failures', async t => {
  const app = context(); t.after(() => app.close());
  const db = tracked(app.db), maintain = createLimitMaintenance();
  await Promise.all(Array.from({length:50}, () => maintain(db,app.now)));
  assert.equal(db.calls.length,2,'one atomic lease and one bounded cleanup');
  let broken = true, attempts = 0;
  const recovering = {prepare(sql) {attempts++; if (broken) throw new Error('fixture unavailable'); return app.db.prepare(sql);}};
  await assert.rejects(maintain(recovering,app.now),/fixture unavailable/);
  broken = false;
  await maintain(recovering,app.now);
  assert.equal(attempts,2,'failed maintenance must not install a false successful cooldown');
});

test('live rate windows and thresholds still count every request during the maintenance cooldown', async t => {
  const app = context({production:true}); t.after(() => app.close());
  const request = new Request('https://wiki.example/api/community/presence',{headers:{'CF-Connecting-IP':'192.0.2.3'}});
  for (const [action,max,windowMs] of [['presence',120,3600_000],['game_lookup',120,3600_000],['character_view',120,3600_000],['like',120,3600_000],['dungeon_upload',20,3600_000]]) {
    const now = app.now, expires = Math.floor(now / windowMs) * windowMs + windowMs;
    await Promise.all(Array.from({length:max}, () => rateLimit(app.db,request,app.env,action,now)));
    await assert.rejects(rateLimit(app.db,request,app.env,action,now),error =>
      error.status === 429 && error.extra.retryAfter === Math.ceil((expires - now) / 1000));
    assert.equal(app.db.raw.prepare('SELECT count FROM community_limits WHERE key LIKE ? AND expires_at=?').get(`${action}:%`,expires).count,max);
    await rateLimit(app.db,request,app.env,action,expires);
    assert.equal(app.db.raw.prepare('SELECT count FROM community_limits WHERE key LIKE ? AND expires_at=?').get(`${action}:%`,expires + windowMs).count,1);
  }
});

test('rejected floods leave a full bucket untouched and spend no D1 row writes', async t => {
  const app = context({production:true}); t.after(() => app.close());
  const changes = () => app.db.raw.prepare('SELECT total_changes() n').get().n;
  for (let i = 0; i < 120; i++) assert.equal((await app.call('/game-codes/ABCDEFGHJKLM')).status, 404);
  const before = changes();
  for (let i = 0; i < 50; i++) assert.equal((await app.call('/game-codes/ABCDEFGHJKLM')).status, 429);
  assert.equal(changes() - before, 0);
  assert.equal(app.db.raw.prepare("SELECT count FROM community_limits WHERE key LIKE 'game_lookup:%'").get().count, 120);
});

test('rejected rate-limit requests still perform due maintenance', async t => {
  const app = context({production:true}); t.after(() => app.close());
  const request = new Request('https://wiki.example/api/community/presence',{headers:{'CF-Connecting-IP':'192.0.2.3'}});
  await rateLimit(app.db,request,app.env,'presence',app.now);
  app.db.raw.prepare('UPDATE community_limits SET count=300').run();
  app.db.raw.prepare('INSERT INTO community_limits VALUES(?,?,?)').run('expired-only',1,app.now - 1);
  app.db.raw.prepare('UPDATE community_maintenance SET next_run=0').run();
  // A separate database facade represents a fresh Worker, without the first Worker's memory cache.
  await assert.rejects(rateLimit(tracked(app.db),request,app.env,'presence',app.now),error => error.status === 429);
  assert.equal(count(app,'expired-only'),0);
});

test('additive maintenance migration preserves counters, is idempotent and matches the schema', t => {
  const app = context(); t.after(() => app.close());
  app.db.raw.prepare('INSERT INTO community_limits VALUES(?,?,?)').run('existing-hmac',42,app.now + 60000);
  const before = app.db.raw.prepare('SELECT * FROM community_limits').all();
  app.db.raw.exec('DROP TABLE community_maintenance; DROP INDEX community_limits_expiry;');
  const migration = readFileSync(new URL('../migrations/0014-limit-maintenance.sql',import.meta.url),'utf8');
  app.db.raw.exec(migration); app.db.raw.exec(migration);
  assert.deepEqual(app.db.raw.prepare('SELECT * FROM community_limits').all(),before);
  const schema = readFileSync(new URL('../schema.sql',import.meta.url),'utf8');
  assert.ok(schema.includes(migration.slice(migration.indexOf('CREATE TABLE')).trim()));
});
