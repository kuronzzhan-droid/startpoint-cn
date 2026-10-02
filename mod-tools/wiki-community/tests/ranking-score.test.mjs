import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ranking = require('../../wiki/rating-score.js');

test('source-specific priors temper small samples while retaining raw precision and real zero scores', () => {
  assert.equal(ranking.PRIOR_VOTERS, 5);
  assert.deepEqual(ranking.PRIORS, {rating: 2.5, placement: 3});
  assert.equal(ranking.score(null, 0), null);
  assert.equal(ranking.score(0, 0, 'placement'), null);
  assert.equal(ranking.score(5, 1), 17.5 / 6);
  assert.equal(ranking.score(5, 1, 'placement'), 20 / 6);
  assert.equal(ranking.score(0, 1), 12.5 / 6);
  assert.equal(ranking.score(5 / 3, 3), 17.5 / 8);
  assert.ok(ranking.score(4.5, 100) > ranking.score(5, 1));
  assert.ok(ranking.score(1, 100) < ranking.score(0, 1));
  assert.ok(ranking.score(4.5, 100, 'placement') > ranking.score(5, 1, 'placement'));
});

test('sorting uses unrounded adjusted score, then more voters and stable ID in both directions', () => {
  const items = [
    {id: 'c0', rankScore: 3.751, voters: 999},
    {id: 'c1', rankScore: 3.752, voters: 1},
    {id: 'c3', rankScore: 2.5, voters: 2},
    {id: 'c2', rankScore: 2.5, voters: 2},
    {id: 'c4', rankScore: 2.5, voters: 10}
  ];
  assert.deepEqual([...items].sort(ranking.compare).map((item) => item.id), ['c1', 'c0', 'c4', 'c2', 'c3']);
  assert.deepEqual([...items].sort((a, b) => ranking.compare(a, b, 'asc')).map((item) => item.id), ['c4', 'c2', 'c3', 'c0', 'c1']);
});

test('the same scoring helper loads as a browser script without CommonJS', async () => {
  const context = vm.createContext({});
  vm.runInContext(await readFile(new URL('../../wiki/rating-score.js', import.meta.url), 'utf8'), context);
  const exported = Object.values(context).find((value) => value && typeof value.score === 'function' && typeof value.compare === 'function');
  assert.ok(exported, 'browser scoring helper must be exposed');
  assert.equal(exported.score(5, 1), ranking.score(5, 1));
  assert.equal(exported.score(5, 1, 'placement'), ranking.score(5, 1, 'placement'));
  assert.equal(exported.tierRow(5, 3), 'tier0');
  assert.equal(exported.tierRow(5, 2), 'provisional');
});

test('tiers use real averages only after three votes, without forcing a populated top or bottom', () => {
  for (const voters of [1, 2]) for (const average of [0, 1, 2.5, 3, 5]) {
    assert.equal(ranking.tierRow(average, voters), 'provisional');
  }
  assert.equal(ranking.tierRow(5, 0), null);
  assert.equal(ranking.tierRow(null, 3), null);
  assert.equal(ranking.tierRow(5, 3), 'tier0');
  assert.equal(ranking.tierRow(1, 3), 'tier4');
  assert.equal(ranking.tierRow(0, 3), 'tier4');
  ranking.ROW_KEYS.forEach((row, index) => assert.equal(ranking.tierRow(5 - index / 2, 3), row));
  assert.equal(ranking.tierRow(4.751, 3), 'tier0');
  assert.equal(ranking.tierRow(4.75, 3), 'between0');
  assert.equal(ranking.tierRow(4.749, 3), 'between0');
  assert.equal(ranking.tierRow(1.251, 3), 'between3');
  assert.equal(ranking.tierRow(1.25, 3), 'tier4');
  assert.equal(ranking.tierRow(1.249, 3), 'tier4');
  assert.equal(ranking.tierRow(3, 999), 'tier2');
});
