import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../sqlite-adapter.mjs';
import {ratingContext, readRating, recordRating, validateScore} from '../character-ratings.mjs';

const now = Date.parse('2026-09-29T15:59:59.999Z');
function database(t) {const db = openDatabase(); t.after(() => db.close()); return db;}
async function ctx(id = 'c0', ip = '192.0.2.1', time = now) {
  return ratingContext(new Request('https://wiki.example', {headers: {'CF-Connecting-IP': ip}}),
    {COMMUNITY_IP_SALT: 'i'.repeat(40)}, id, time, null);
}

test('rating score includes zero, counts one current vote and never exposes visitor or IP identifiers', async (t) => {
  const db = database(t), context = await ctx();
  assert.deepEqual(await readRating(db, 'c0', 'visitor-a', context),
    {average: null, voters: 0, myScore: null, ratedToday: false, nextVoteAt: now + 1});
  const zero = await recordRating(db, 'c0', 'visitor-a', context, 0, now);
  assert.deepEqual(zero, {average: 0, voters: 1, myScore: 0, ratedToday: true, nextVoteAt: now + 1});
  const five = await recordRating(db, 'c0', 'visitor-b', await ctx('c0', '192.0.2.2'), 5, now);
  assert.equal(five.average, 2.5); assert.equal(five.voters, 2); assert.equal(five.myScore, 5);
  const claims = db.raw.prepare('SELECT * FROM community_character_rating_claims').all();
  assert.ok(!JSON.stringify(claims).includes('192.0.2.')); assert.equal(claims.length, 2);
  for (const score of [-1, 6, 0.5, '0', null, true, NaN, Infinity]) assert.throws(() => validateScore(score), {code: 'invalid_score'});
  assert.throws(() => db.raw.prepare('UPDATE community_character_ratings SET score=?').run(2.5), /CHECK constraint/);
});

test('same visitor cannot switch IP and same IP cannot reset cookie to vote again, but each character is independent', async (t) => {
  const db = database(t), first = await ctx();
  await recordRating(db, 'c0', 'visitor-a', first, 2, now);
  await assert.rejects(recordRating(db, 'c0', 'visitor-a', await ctx('c0', '192.0.2.2'), 5, now),
    (error) => error.code === 'already_rated' && error.extra.myScore === 2 && error.extra.ratedToday);
  await assert.rejects(recordRating(db, 'c0', 'visitor-new-cookie', first, 5, now),
    (error) => error.code === 'already_rated' && error.extra.myScore === null && error.extra.voters === 1 && error.extra.ratedToday);
  assert.deepEqual(await readRating(db, 'c0', 'visitor-new-cookie', first),
    {average: 2, voters: 1, myScore: null, ratedToday: true, nextVoteAt: now + 1});
  assert.equal((await recordRating(db, 'c1', 'visitor-a', await ctx('c1'), 5, now)).voters, 1);
  // Rejected cross-IP retry did not consume another network's allowance.
  assert.equal((await recordRating(db, 'c0', 'visitor-b', await ctx('c0', '192.0.2.2'), 4, now)).voters, 2);
});

test('Beijing midnight replaces score without adding voters and retains recent claims against boundary races', async (t) => {
  const db = database(t); await recordRating(db, 'c0', 'visitor-a', await ctx(), 0, now);
  await recordRating(db, 'c0', 'visitor-b', await ctx('c0', '192.0.2.2'), 5, now);
  const next = await ctx('c0', '192.0.2.1', now + 1);
  assert.equal(next.day, '2026-09-30');
  const before = await readRating(db, 'c0', 'visitor-a', next);
  assert.equal(before.ratedToday, false); assert.equal(before.myScore, 0);
  const updated = await recordRating(db, 'c0', 'visitor-a', next, 4, now + 1);
  assert.deepEqual(updated, {average: 4.5, voters: 2, myScore: 4, ratedToday: true, nextVoteAt: now + 1 + 86400_000});
  assert.equal(db.raw.prepare('SELECT count(*) n FROM community_character_ratings').get().n, 2);
  assert.equal(db.raw.prepare('SELECT count(*) n FROM community_character_rating_claims WHERE vote_day<?').get(next.day).n, 2);
  await assert.rejects(recordRating(db, 'c0', 'late-old-day-cookie', await ctx(), 1, now), {code: 'already_rated'});
  assert.equal((await readRating(db, 'c0', 'visitor-a', next)).voters, 2);
  const later = await ctx('c0', '192.0.2.1', now + 1 + 86400_000);
  await recordRating(db, 'c0', 'visitor-a', later, 3, now + 1 + 86400_000);
  assert.equal(db.raw.prepare('SELECT count(*) n FROM community_character_rating_claims WHERE vote_day<?').get(next.day).n, 0);
});

for (const mode of ['same-visitor', 'same-ip', 'next-day-replace']) {
  test(`concurrent score requests produce only one winning vote: ${mode}`, async (t) => {
    const db = database(t), time = mode === 'next-day-replace' ? now + 1 : now;
    if (mode === 'next-day-replace') await recordRating(db, 'c0', 'visitor-a', await ctx(), 0, now);
    const requests = await Promise.all(Array.from({length: 12}, async (_, index) => {
      const visitor = mode === 'same-ip' ? `visitor-${index}` : 'visitor-a';
      const ip = mode === 'same-ip' ? '192.0.2.1' : `192.0.2.${index + 1}`;
      return {visitor, context: await ctx('c0', ip, time), score: index % 6};
    }));
    const results = await Promise.allSettled(requests.map(({visitor, context, score}) => recordRating(db, 'c0', visitor, context, score, time)));
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.ok(results.filter((result) => result.status === 'rejected').every((result) => result.reason.code === 'already_rated'));
    assert.equal(db.raw.prepare('SELECT count(*) n FROM community_character_ratings').get().n, 1);
    assert.equal(db.raw.prepare('SELECT count(*) n FROM community_character_rating_claims WHERE vote_day=?').get(requests[0].context.day).n, 1);
  });
}

test('failed score write rolls back IP claim and the additive migration never resets existing ratings', async (t) => {
  const db = database(t), context = await ctx();
  db.raw.exec("CREATE TRIGGER reject_rating BEFORE INSERT ON community_character_ratings BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  await assert.rejects(recordRating(db, 'c0', 'visitor-a', context, 3, now), /fixture failure/);
  assert.equal(db.raw.prepare('SELECT count(*) n FROM community_character_rating_claims').get().n, 0);
  db.raw.exec('DROP TRIGGER reject_rating');
  const before = await recordRating(db, 'c0', 'visitor-a', context, 3, now);
  db.raw.exec(readFileSync(new URL('../migrations/0005-character-ratings.sql', import.meta.url), 'utf8'));
  assert.deepEqual(await readRating(db, 'c0', 'visitor-a', context), before);
});
