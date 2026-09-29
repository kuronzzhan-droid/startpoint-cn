import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {context, submission, fixtureCatalog} from './helpers.mjs';
import {TEAM_SECTIONS, validateSubmission, fingerprint, nextCursor} from '../model.mjs';
import {openDatabase} from '../sqlite-adapter.mjs';

test('sections are independent metadata and omitted submissions remain backward compatible', async (t) => {
  assert.equal(validateSubmission(submission(), fixtureCatalog).section, '');
  for (const {value: section} of TEAM_SECTIONS)
    assert.equal(validateSubmission({...submission(), section}, fixtureCatalog).section, section);
  for (const section of [null, 'general', '深渊连战', 'unknown', ['abyss'], 0])
    assert.throws(() => validateSubmission({...submission(), section}, fixtureCatalog), {code: 'invalid_section'});
  const app = context(); t.after(() => app.close());
  assert.deepEqual((await app.call('/config')).json.sections, TEAM_SECTIONS);
});

test('public and admin lists combine sections with category, element, damage and visibility', async (t) => {
  const app = context(); t.after(() => app.close()); await app.admin();
  const specs = [
    ['abyss', '萌新启航', '火', ['skill', 'direct']], ['fantasy', '萌新启航', '火', ['skill', 'direct']],
    ['five-boss', '萌新启航', '火', ['skill', 'direct']], ['', '萌新启航', '火', ['skill', 'direct']],
    ['abyss', 'MOD毕业队', '火', ['skill', 'direct']], ['abyss', '萌新启航', '水', ['skill', 'direct']],
    ['abyss', '萌新启航', '火', ['ability']],
  ];
  const ids = [];
  for (const [index, [section, category, element, damageTypes]] of specs.entries()) {
    const value = {...submission(), section, category, element, damageTypes}; value.team.unison[2] = `c${5 + index}`;
    const created = await app.create(value); assert.equal(created.status, 201);
    ids.push(created.json.team.id); assert.equal(created.json.team.section, section);
  }
  const query = `/teams?section=abyss&category=${encodeURIComponent('萌新启航')}&element=${encodeURIComponent('火')}&damage=skill,direct`;
  assert.deepEqual((await app.call(query)).json.items.map((item) => item.id), [ids[0]]);
  for (const [section, index] of [['fantasy', 1], ['five-boss', 2], ['general', 3]])
    assert.deepEqual((await app.call(`/teams?section=${section}`)).json.items.map((item) => item.id), [ids[index]]);
  for (const query of ['/teams', '/teams?section=']) assert.equal((await app.call(query)).json.items.length, 7);
  assert.equal((await app.call('/teams?section=unknown')).json.error, 'invalid_section');
  assert.equal((await app.call('/admin/teams?section=unknown')).json.error, 'invalid_section');
  assert.equal((await app.call(`/admin/teams/${ids[0]}`, {method: 'PATCH', body: {expectedRevision: 1, status: 'hidden'}})).status, 200);
  assert.equal((await app.call(query)).json.items.length, 0);
  const hidden = (await app.call('/admin/teams?section=abyss&status=hidden')).json.items;
  assert.equal(hidden.length, 1); assert.equal(hidden[0].id, ids[0]); assert.equal(hidden[0].section, 'abyss');
});

test('section edits preserve game codes, duplicate rules and omitted metadata while auditing changes', async (t) => {
  const app = context(); t.after(() => app.close()); await app.admin();
  const first = (await app.create({...submission(), section: 'abyss'})).json.team;
  const code = await app.call(`/admin/teams/${first.id}/game-code`, {body: {expectedRevision: 1}});
  assert.equal(code.status, 200);
  const duplicate = await app.create({...submission(), section: 'fantasy'});
  assert.equal(duplicate.status, 409); assert.equal(duplicate.json.existingId, first.id);
  const edited = await app.call(`/admin/teams/${first.id}`, {method: 'PATCH', body: {expectedRevision: 1, section: 'five-boss'}});
  assert.equal(edited.status, 200); assert.equal(edited.json.team.section, 'five-boss');
  assert.equal(edited.json.team.category, '萌新启航'); assert.equal(edited.json.team.gameCode, code.json.gameCode);
  assert.equal((await app.call(`/game-codes/${code.json.gameCode}`)).status, 200);
  const audit = app.db.raw.prepare("SELECT before_json,after_json FROM community_audit WHERE team_id=? AND action='update'").get(first.id);
  assert.equal(JSON.parse(audit.before_json).section, 'abyss'); assert.equal(JSON.parse(audit.after_json).section, 'five-boss');
  const stale = await app.call(`/admin/teams/${first.id}`, {method: 'PATCH', body: {expectedRevision: 1, section: 'fantasy'}});
  assert.equal(stale.json.error, 'edit_conflict');
  const preserved = await app.call(`/admin/teams/${first.id}`, {method: 'PATCH', body: {expectedRevision: 2, notes: '旧版编辑请求'}});
  assert.equal(preserved.json.team.section, 'five-boss');
  const general = await app.call(`/admin/teams/${first.id}`, {method: 'PATCH', body: {expectedRevision: 3, section: ''}});
  assert.equal(general.status, 200); assert.equal(general.json.team.section, '');
  assert.equal(general.json.team.gameCode, code.json.gameCode);
  const invalid = await app.call(`/admin/teams/${first.id}`, {method: 'PATCH', body: {expectedRevision: 4, section: 'general'}});
  assert.equal(invalid.json.error, 'invalid_section');
  assert.equal(app.db.raw.prepare("SELECT count(*) n FROM community_audit WHERE team_id=? AND action='update'").get(first.id).n, 3);
});

test('latest and popular cursors cannot cross gameplay sections', async (t) => {
  const app = context(); t.after(() => app.close()); await app.admin();
  const created = (await app.create()).json.team;
  const row = app.db.raw.prepare('SELECT * FROM community_teams WHERE id=?').get(created.id);
  for (const sort of ['latest', 'popular']) {
    const cursor = nextCursor({sort, element: '', category: '', section: 'abyss', damage: '', status: 'approved'}, row);
    assert.equal((await app.call(`/teams?section=abyss&sort=${sort}&cursor=${cursor}`)).status, 200);
    for (const section of ['', 'fantasy', 'five-boss', 'general'])
      assert.equal((await app.call(`/teams?section=${section}&sort=${sort}&cursor=${cursor}`)).json.error, 'invalid_cursor');
  }
});

for (const legacyCategory of [false, true]) {
  test(`section migration preserves legacy data and is safe on reopen (category already present: ${legacyCategory})`, async (t) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'wiki-section-migration-'));
    let database;
    t.after(() => {database?.close(); rmSync(directory, {recursive: true, force: true});});
    const filename = path.join(directory, 'legacy.sqlite'), legacy = new DatabaseSync(filename);
    const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').split('\n').filter((line) =>
      !line.includes('section TEXT') && !line.includes('community_teams_section') &&
      (legacyCategory || (!line.includes('category TEXT') && !line.includes('community_teams_category')))).join('\n');
    legacy.exec(schema);
    const id = crypto.randomUUID(), value = submission(), hash = await fingerprint(value.team);
    legacy.prepare(`INSERT INTO community_teams(id,fingerprint,title,notes,author,team_json,element,damage_mask,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id, hash, '旧盘', '原备注', '原作者', JSON.stringify(value.team), '火', 1, 'approved', 1, 1);
    if (legacyCategory) legacy.prepare('UPDATE community_teams SET category=?').run('原版毕业队');
    legacy.prepare('INSERT INTO community_likes VALUES(?,?,?,?)').run(id, 'visitor', '2026-09-29', 1);
    legacy.prepare('INSERT INTO community_game_codes VALUES(?,?,?,?,?)').run('ABCDEFGH2345', id, hash, 1, null);
    legacy.prepare(`INSERT INTO community_users(id,email,role,password_hash,must_change_password,created_at,updated_at)
      VALUES('owner','owner@example.test','owner','fixture-hash',0,1,1)`).run();
    legacy.prepare('INSERT INTO community_audit VALUES(?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), id, 'owner', 'owner@example.test', 'create', 'null', '{}', 1);
    const before = legacy.prepare('SELECT * FROM community_teams').get();
    const tables = ['community_likes', 'community_game_codes', 'community_users', 'community_audit'];
    const snapshots = tables.map((table) => legacy.prepare(`SELECT * FROM ${table}`).all()); legacy.close();
    database = openDatabase(filename);
    assert.deepEqual({...database.raw.prepare('SELECT * FROM community_teams').get()}, {...before, category: before.category || '', section: ''});
    tables.forEach((table, index) => assert.deepEqual(database.raw.prepare(`SELECT * FROM ${table}`).all(), snapshots[index]));
    assert.throws(() => database.raw.prepare('UPDATE community_teams SET section=?').run('general'), /CHECK constraint/);
    database.raw.prepare('UPDATE community_teams SET section=?').run('abyss'); database.close(); database = openDatabase(filename);
    assert.equal(database.raw.prepare('SELECT section FROM community_teams').get().section, 'abyss');
    assert.equal(database.raw.prepare('SELECT count(*) n FROM pragma_table_info(?) WHERE name=?').get('community_teams', 'section').n, 1);
  });
}
