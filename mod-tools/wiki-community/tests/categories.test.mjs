import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {context, submission, fixtureCatalog} from './helpers.mjs';
import {TEAM_CATEGORIES, validateSubmission, fingerprint, nextCursor} from '../model.mjs';
import {openDatabase} from '../sqlite-adapter.mjs';

test('new recommendations require one supported category; only legacy editing may keep the empty category', () => {
  for (const category of TEAM_CATEGORIES) assert.equal(validateSubmission({...submission(), category},fixtureCatalog).category,category);
  for (const category of [undefined, null, '', '未分类', 'uncategorized', '其他', ['萌新启航']])
    assert.throws(() => validateSubmission({...submission(),category},fixtureCatalog),{code:'invalid_category'});
  assert.equal(validateSubmission({...submission(),category:''},fixtureCatalog,{allowUncategorized:true}).category,'');
});

test('category is persisted and filters combine with element/damage/status on real SQLite', async (t) => {
  const app = context(); t.after(() => app.close()); await app.admin();
  const specs = [
    ['萌新启航','火',['skill','direct']], ['萌新启航','水',['skill','direct']],
    ['萌新启航','火',['ability']], ['MOD毕业队','火',['skill','direct']], ['玩具盘','universal',['direct']],
  ];
  const ids = [];
  for (const [index,[category,element,damageTypes]] of specs.entries()) {
    const value = {...submission(),category,element,damageTypes}; value.team.unison[2] = `c${5+index}`;
    const created = await app.create(value); assert.equal(created.status,201); ids.push(created.json.team.id);
    assert.equal(app.db.raw.prepare('SELECT category FROM community_teams WHERE id=?').get(ids.at(-1)).category,category);
  }
  const result = await app.call(`/teams?category=${encodeURIComponent('萌新启航')}&element=${encodeURIComponent('火')}&damage=skill,direct`);
  assert.deepEqual(result.json.items.map((item) => item.id),[ids[0]]);
  assert.equal(result.json.items[0].category,'萌新启航');
  app.db.raw.prepare('UPDATE community_teams SET category=? WHERE id=?').run('',ids[2]);
  assert.deepEqual((await app.call('/teams?category=uncategorized')).json.items.map((item) => item.id),[ids[2]]);
  assert.equal((await app.call('/teams')).json.items.length,5);
  assert.equal((await app.call('/teams?category=invalid')).json.error,'invalid_category');
  const hidden = await app.call(`/admin/teams/${ids[0]}`,{method:'PATCH',body:{expectedRevision:1,status:'hidden'}});
  assert.equal(hidden.status,200);
  assert.equal((await app.call(`/teams?category=${encodeURIComponent('萌新启航')}&element=${encodeURIComponent('火')}&damage=skill,direct`)).json.items.length,0);
  assert.equal((await app.call(`/admin/teams?category=${encodeURIComponent('萌新启航')}&status=hidden`)).json.items[0].id,ids[0]);
});

test('changing a category is audited, keeps a game code active, and cannot bypass duplicate checks', async (t) => {
  const app = context(); t.after(() => app.close()); await app.admin();
  const first = (await app.create()).json.team;
  const code = await app.call(`/admin/teams/${first.id}/game-code`,{body:{expectedRevision:1}});
  assert.equal(code.status,200);
  const duplicate = await app.create({...submission(),category:'最新最潮盘'});
  assert.equal(duplicate.status,409); assert.equal(duplicate.json.existingId,first.id);
  const changed = await app.call(`/admin/teams/${first.id}`,{method:'PATCH',body:{expectedRevision:1,category:'最新最潮盘'}});
  assert.equal(changed.status,200); assert.equal(changed.json.team.category,'最新最潮盘');
  assert.equal(changed.json.team.gameCode,code.json.gameCode);
  assert.equal((await app.call(`/game-codes/${code.json.gameCode}`)).status,200);
  const audit = app.db.raw.prepare("SELECT after_json FROM community_audit WHERE team_id=? AND action='update'").get(first.id);
  assert.equal(JSON.parse(audit.after_json).category,'最新最潮盘');
  const invalid = await app.call(`/admin/teams/${first.id}`,{method:'PATCH',body:{expectedRevision:2,category:''}});
  assert.equal(invalid.json.error,'invalid_category');
  app.db.raw.prepare('UPDATE community_teams SET category=? WHERE id=?').run('',first.id);
  assert.equal((await app.call(`/admin/teams/${first.id}`,{method:'PATCH',body:{expectedRevision:2,notes:'历史盘保留未分类'}})).status,200);
  assert.equal((await app.call(`/admin/teams/${first.id}`,{method:'PATCH',body:{expectedRevision:3,category:'原版毕业队'}})).json.team.category,'原版毕业队');
});

test('pagination cursors cannot be reused across categories', async (t) => {
  const app = context(); t.after(() => app.close()); await app.admin();
  const created = (await app.create()).json.team;
  const row = app.db.raw.prepare('SELECT * FROM community_teams WHERE id=?').get(created.id);
  const cursor = nextCursor({sort:'latest',element:'',category:'萌新启航',damage:'',status:'approved'},row);
  assert.equal((await app.call(`/teams?category=${encodeURIComponent('萌新启航')}&cursor=${cursor}`)).status,200);
  assert.equal((await app.call(`/teams?category=${encodeURIComponent('MOD毕业队')}&cursor=${cursor}`)).json.error,'invalid_cursor');
  assert.equal((await app.call(`/teams?cursor=${cursor}`)).json.error,'invalid_cursor');
});

test('legacy migration preserves teams, likes, game codes and accounts and remains safe on reopen', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(),'wiki-category-migration-'));
  let reopened;
  t.after(() => {reopened?.close(); rmSync(directory,{recursive:true,force:true});});
  const filename = path.join(directory,'legacy.sqlite'), legacy = new DatabaseSync(filename);
  const schema = readFileSync(new URL('../schema.sql',import.meta.url),'utf8')
    .split('\n').filter((line) => !line.includes('category TEXT') && !line.includes('community_teams_category')).join('\n');
  legacy.exec(schema);
  const id = crypto.randomUUID(), value = submission(), hash = await fingerprint(value.team);
  legacy.prepare(`INSERT INTO community_teams(id,fingerprint,title,notes,author,team_json,element,damage_mask,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id,hash,'旧盘','原备注','原作者',JSON.stringify(value.team),'火',1,'approved',1,1);
  legacy.prepare('INSERT INTO community_likes VALUES(?,?,?,?)').run(id,'visitor','2026-09-29',1);
  legacy.prepare('INSERT INTO community_game_codes VALUES(?,?,?,?,?)').run('81234567',id,hash,1,null);
  legacy.prepare(`INSERT INTO community_users(id,email,role,password_hash,must_change_password,created_at,updated_at)
    VALUES('owner','owner@example.test','owner','fixture-hash',0,1,1)`).run();
  const before = legacy.prepare('SELECT * FROM community_teams').get(); legacy.close();
  const migrated = openDatabase(filename);
  assert.deepEqual({...migrated.raw.prepare('SELECT * FROM community_teams').get()},{...before,category:''});
  assert.equal(migrated.raw.prepare('SELECT password_hash FROM community_users').get().password_hash,'fixture-hash');
  assert.equal(migrated.raw.prepare('SELECT revoked_at FROM community_game_codes').get().revoked_at,null);
  assert.equal(migrated.raw.prepare('SELECT count(*) n FROM community_likes').get().n,1);
  assert.throws(() => migrated.raw.prepare('UPDATE community_teams SET category=?').run('非法分类'),/CHECK constraint/);
  migrated.raw.prepare('UPDATE community_teams SET category=?').run('MOD毕业队'); migrated.close();
  reopened = openDatabase(filename);
  assert.equal(reopened.raw.prepare('SELECT category FROM community_teams').get().category,'MOD毕业队');
  assert.equal(reopened.raw.prepare('SELECT count(*) n FROM pragma_table_info(?) WHERE name=?').get('community_teams','category').n,1);
});
