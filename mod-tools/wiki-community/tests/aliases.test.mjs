import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../sqlite-adapter.mjs';
import {fixtureCatalog} from './helpers.mjs';
import {normalizeAliases, readAlias, listAliases, updateAlias} from '../wiki-aliases.mjs';

const actor = {id: 'editor-a', email: 'editor-a@example.test', role: 'editor'};
const migration = readFileSync(new URL('../migrations/0004-wiki-aliases.sql', import.meta.url), 'utf8');
function database(t) {const db = openDatabase(); db.raw.exec(migration); t.after(() => db.close()); return db;}

test('black-language aliases start empty, normalize text and deduplicate without automatic examples', async (t) => {
  const db = database(t);
  assert.deepEqual(await listAliases(db, fixtureCatalog), {items: []});
  assert.deepEqual(await readAlias(db, fixtureCatalog, 'character', 'c0'), {kind: 'character', id: 'c0', aliases: [], revision: 0});
  assert.deepEqual(normalizeAliases(['  团长  ', '团长', 'PF', 'pf', 'e\u0301', 'é']), ['团长', 'PF', 'é']);
  for (const aliases of [null, '团长', [''], ['  '], [42], ['两\n行'], ['含\t制表'], ['a'.repeat(33)], Array(13).fill('同名')])
    assert.throws(() => normalizeAliases(aliases));
  assert.deepEqual(normalizeAliases(Array.from({length: 12}, (_, i) => `黑话${i}`)).length, 12);
});

test('admins edit both catalog types with CAS, publish only aliases and can clear without resetting revision', async (t) => {
  const db = database(t);
  const first = await updateAlias(db, fixtureCatalog, 'character', 'c0', {aliases: ['团长'], expectedRevision: 0}, actor, 1);
  assert.deepEqual(first, {kind: 'character', id: 'c0', aliases: ['团长'], revision: 1});
  await updateAlias(db, fixtureCatalog, 'weapon', 'w0', {aliases: ['老朋友'], expectedRevision: 0}, {...actor, role: 'deputy'}, 2);
  const listed = await listAliases(db, fixtureCatalog);
  assert.equal(listed.items.length, 2); assert.ok(!/actor|email|editor-a|updated_at/.test(JSON.stringify(listed)));
  await assert.rejects(updateAlias(db, fixtureCatalog, 'character', 'c0', {aliases: ['覆盖'], expectedRevision: 0}, actor, 3), {code: 'edit_conflict'});
  const empty = await updateAlias(db, fixtureCatalog, 'character', 'c0', {aliases: [], expectedRevision: 1}, actor, 4);
  assert.deepEqual(empty.aliases, []); assert.equal(empty.revision, 2);
  assert.deepEqual((await listAliases(db, fixtureCatalog)).items.map((item) => item.id), ['w0']);
  assert.equal((await readAlias(db, fixtureCatalog, 'character', 'c0')).revision, 2);
  const audit = db.raw.prepare('SELECT * FROM community_alias_audit WHERE entity_id=? ORDER BY created_at').all('c0');
  assert.equal(audit.length, 2); assert.equal(audit[0].actor_id, actor.id);
  assert.deepEqual(JSON.parse(audit[1].before_json).aliases, ['团长']); assert.deepEqual(JSON.parse(audit[1].after_json).aliases, []);
});

test('unknown catalog targets, bad revisions and extra account fields cannot be written', async (t) => {
  const db = database(t), body = {aliases: ['例子'], expectedRevision: 0};
  for (const [kind, id] of [['character', 'missing'], ['character', 'w0'], ['weapon', 'c0'], ['other', 'c0']]) {
    await assert.rejects(readAlias(db, fixtureCatalog, kind, id), {status: 404});
    await assert.rejects(updateAlias(db, fixtureCatalog, kind, id, body, actor, 1), {status: 404});
  }
  await assert.rejects(updateAlias(db, fixtureCatalog, 'character', 'c0', body, null, 1), {status: 401});
  for (const expectedRevision of [-1, null, '0', 0.5])
    await assert.rejects(updateAlias(db, fixtureCatalog, 'character', 'c0', {...body, expectedRevision}, actor, 1), {status: 400});
  await assert.rejects(updateAlias(db, fixtureCatalog, 'character', 'c0', {...body, role: 'owner'}, actor, 1), {code: 'invalid_fields'});
  assert.equal(db.raw.prepare('SELECT count(*) n FROM community_aliases').get().n, 0);
});

test('concurrent create and update each have one winner and one audit, and additive migration preserves data', async (t) => {
  const db = database(t);
  for (const expectedRevision of [0, 1]) {
    const results = await Promise.allSettled(['甲', '乙'].map((alias) => updateAlias(db, fixtureCatalog, 'character', 'c0',
      {aliases: [alias], expectedRevision}, actor, expectedRevision + 1)));
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'edit_conflict');
  }
  const before = await readAlias(db, fixtureCatalog, 'character', 'c0'); db.raw.exec(migration);
  assert.deepEqual(await readAlias(db, fixtureCatalog, 'character', 'c0'), before);
  assert.equal(db.raw.prepare('SELECT count(*) n FROM community_alias_audit').get().n, 2);
  assert.deepEqual(await listAliases(db, {...fixtureCatalog, characters: {}}), {items: []});
});
