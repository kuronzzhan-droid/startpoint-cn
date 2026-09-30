import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../sqlite-adapter.mjs';
import {fixtureCatalog} from './helpers.mjs';
import {ROW_SCORES, validateTierRows, tierRankingContext, readTierRanking, recordTierRanking,
  listTierPlacements} from '../tier-ranking-store.mjs';

const now = Date.parse('2026-09-29T15:59:59.999Z');
const rows = (value = {}) => validateTierRows(value, fixtureCatalog);
function database(t) {const db = openDatabase(); t.after(() => db.close()); return db;}
async function ctx(ip = '192.0.2.1', time = now) {
  return tierRankingContext(new Request('https://wiki.example', {headers: {'CF-Connecting-IP': ip}}),
    {COMMUNITY_IP_SALT: 'i'.repeat(40)}, time, null);
}
const record = (db, visitor, context, value, time = now) => recordTierRanking(db, fixtureCatalog, visitor, context, value, time);

test('nine tiers include boundary scores; only unique known character IDs can be submitted', () => {
  assert.deepEqual(Object.values(ROW_SCORES), [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1]);
  assert.deepEqual(rows({tier0: ['c1', 'c0']}).tier0, ['c1', 'c0']);
  for (const value of [null, [], false, {pool: ['c0']}, {tier0: 'c0'}])
    assert.throws(() => rows(value), {code: 'invalid_rows'});
  for (const id of ['unknown', 'w0', '__proto__', null, 1, {id: 'c0'}])
    assert.throws(() => rows({tier0: [id]}), {code: 'invalid_character'});
  for (const value of [{tier0: ['c0', 'c0']}, {tier0: ['c0'], between0: ['c0']}])
    assert.throws(() => rows(value), {code: 'duplicate_character'});
  assert.throws(() => rows({tier0: Array(13).fill('c0')}), {code: 'invalid_rows'});
});

test('one board contributes one vote only to placed characters and preserves ordering and gaps', async (t) => {
  const db = database(t), context = await ctx(), initial = await readTierRanking(db, fixtureCatalog, 'a', context);
  assert.equal(initial.submittedToday, false); assert.equal(initial.rankedCharacters, 0); assert.equal(initial.updatedAt, null);
  const result = await record(db, 'a', context, {tier0: ['c0', 'c1'], between2: ['c2']});
  assert.equal(result.submittedToday, true); assert.equal(result.rankedCharacters, 3); assert.equal(result.nextVoteAt, now + 1);
  assert.deepEqual(result.rows.tier0, ['c0', 'c1']); assert.deepEqual(result.rows.between2, ['c2']);
  assert.deepEqual(await listTierPlacements(db, fixtureCatalog), [
    {id: 'c0', average: 5, voters: 1}, {id: 'c1', average: 5, voters: 1}, {id: 'c2', average: 2.5, voters: 1}]);
  assert.equal(db.raw.prepare('SELECT count(*) n FROM community_character_ratings').get().n, 0);
  assert.ok(!/visitor|claim|192\.0\./.test(JSON.stringify(result)));
});

test('same visitor cannot change IP and same IP cannot reset its cookie to submit another board', async (t) => {
  const db = database(t), context = await ctx(); await record(db, 'a', context, {tier0: ['c0']});
  await assert.rejects(record(db, 'a', await ctx('192.0.2.2'), {tier1: ['c1']}),
    (error) => error.code === 'already_ranked' && error.extra.rows.tier0[0] === 'c0');
  await assert.rejects(record(db, 'b', context, {tier1: ['c1']}),
    (error) => error.code === 'already_ranked' && error.extra.rankedCharacters === 0 && error.extra.submittedToday);
  await record(db, 'b', await ctx('192.0.2.2'), {tier4: ['c0']});
  assert.deepEqual(await listTierPlacements(db, fixtureCatalog), [{id: 'c0', average: 3, voters: 2}]);
  assert.ok(!JSON.stringify(db.raw.prepare('SELECT * FROM community_tier_ranking_claims').all()).includes('192.0.2.'));
});

test('next-day replacement removes omitted old votes; an empty board withdraws every old placement', async (t) => {
  const db = database(t); await record(db, 'a', await ctx(), {tier0: ['c0', 'c1']});
  const next = await ctx('192.0.2.1', now + 1);
  assert.equal((await readTierRanking(db, fixtureCatalog, 'a', next)).submittedToday, false);
  await record(db, 'a', next, {between0: ['c1'], tier4: ['c2']}, now + 1);
  assert.deepEqual(await listTierPlacements(db, fixtureCatalog), [
    {id: 'c1', average: 4.5, voters: 1}, {id: 'c2', average: 1, voters: 1}]);
  assert.equal(db.raw.prepare('SELECT count(*) n FROM community_tier_rankings').get().n, 1);
  await assert.rejects(record(db, 'a', await ctx('192.0.2.3'), {tier0: ['c0']}), {code: 'already_ranked'});
  const later = await ctx('192.0.2.1', now + 1 + 86400_000);
  const removed = await record(db, 'a', later, {}, now + 1 + 86400_000);
  assert.equal(removed.rankedCharacters, 0); assert.equal(removed.submittedToday, true);
  assert.deepEqual(await listTierPlacements(db, fixtureCatalog), []);
  assert.equal(db.raw.prepare('SELECT count(*) n FROM community_tier_ranking_claims WHERE vote_day<?').get(next.day).n, 0);
});

for (const mode of ['same-visitor', 'same-ip', 'next-day-replace']) {
  test(`concurrent whole-board writes have one winner: ${mode}`, async (t) => {
    const db = database(t), time = mode === 'next-day-replace' ? now + 1 : now;
    if (mode === 'next-day-replace') await record(db, 'a', await ctx(), {tier4: ['c0']});
    const requests = await Promise.all(Array.from({length: 10}, async (_, index) => ({
      visitor: mode === 'same-ip' ? `v${index}` : 'a', context: await ctx(mode === 'same-ip' ? '192.0.2.1' : `192.0.2.${index + 1}`, time),
      board: {tier0: [`c${index}`]}})));
    const results = await Promise.allSettled(requests.map(({visitor, context, board}) => record(db, visitor, context, board, time)));
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.ok(results.filter((result) => result.status === 'rejected').every((result) => result.reason.code === 'already_ranked'));
    assert.equal(db.raw.prepare('SELECT count(*) n FROM community_tier_rankings').get().n, 1);
    assert.equal((await listTierPlacements(db, fixtureCatalog)).length, 1);
  });
}

test('a failed board write rolls back its network claim; additive migration preserves every existing rating', async (t) => {
  const db = database(t), context = await ctx();
  db.raw.prepare('INSERT INTO community_character_ratings VALUES(?,?,?,?,?)').run('c0', 'a', 3, context.day, now);
  db.raw.exec("CREATE TRIGGER reject_board BEFORE INSERT ON community_tier_rankings BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  await assert.rejects(record(db, 'a', context, {tier0: ['c0']}), /fixture failure/);
  assert.equal(db.raw.prepare('SELECT count(*) n FROM community_tier_ranking_claims').get().n, 0);
  db.raw.exec('DROP TRIGGER reject_board'); const before = await record(db, 'a', context, {tier0: ['c0']});
  db.raw.exec(readFileSync(new URL('../migrations/0008-tier-rankings.sql', import.meta.url), 'utf8'));
  assert.deepEqual(await readTierRanking(db, fixtureCatalog, 'a', context), before);
  assert.equal(db.raw.prepare('SELECT score FROM community_character_ratings').get().score, 3);
  assert.throws(() => db.raw.prepare('UPDATE community_tier_rankings SET rows_json=?').run('null'), /CHECK constraint/);
});

test('previously removed catalog IDs are excluded from own board and aggregates', async (t) => {
  const db = database(t), context = await ctx(); await record(db, 'a', context, {tier0: ['c0', 'c1']});
  const current = {...fixtureCatalog, characters: {c1: fixtureCatalog.characters.c1}};
  assert.deepEqual(await listTierPlacements(db, current), [{id: 'c1', average: 5, voters: 1}]);
  const own = await readTierRanking(db, current, 'a', context);
  assert.deepEqual(own.rows.tier0, ['c1']); assert.equal(own.rankedCharacters, 1);
});
