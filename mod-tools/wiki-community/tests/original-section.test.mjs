import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../sqlite-adapter.mjs';
import {context, submission} from './helpers.mjs';

test('original section is independent from other and survives edits without invalidating a code', async t => {
  const app=context();t.after(()=>app.close());await app.admin();
  const created=await app.create({...submission(), section:'original'});assert.equal(created.status,201);
  const item=created.json.team;
  const code=(await app.call(`/admin/teams/${item.id}/game-code`,{body:{expectedRevision:1}})).json.gameCode;
  assert.equal((await app.call('/teams?section=original')).json.items.length,1);
  assert.equal((await app.call('/teams?section=general')).json.items.length,0);
  assert.equal((await app.call(`/admin/teams/${item.id}`,{method:'PATCH',body:{expectedRevision:1,section:''}})).status,200);
  assert.equal((await app.call('/teams?section=general')).json.items.length,1);
  assert.equal((await app.call(`/game-codes/${code}`)).status,200);
});
test('expanding section constraint retains team rows, children, indexes, likes trigger and foreign keys', t => {
  const dir=mkdtempSync(path.join(tmpdir(),'wiki-original-'));let db;
  t.after(()=>{db?.close();rmSync(dir,{recursive:true,force:true});});
  const file=path.join(dir,'old.sqlite'),old=new DatabaseSync(file);
  old.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8').replace(",'original'",''));
  old.prepare(`INSERT INTO community_teams(id,fingerprint,title,notes,author,team_json,element,damage_mask,status,created_at,updated_at,visibility,created_by)
    VALUES('t','hash','旧盘','保留备注','作者','{}','火',1,'approved',1,2,'private','owner')`).run();
  old.prepare("INSERT INTO community_likes VALUES('t','visitor','2026-09-29',1)").run();
  old.prepare("INSERT INTO community_audit VALUES('a','t','owner','owner@example.test','create','null','{}',1)").run();
  old.prepare("INSERT INTO community_game_codes VALUES('ABCDEFGH2345','t','hash',1,NULL)").run();
  const tables=['community_teams','community_likes','community_audit','community_game_codes'];
  const before=tables.map(table=>old.prepare(`SELECT * FROM ${table}`).all().map(row=>({...row})));
  old.close();db=openDatabase(file);
  tables.forEach((table,i)=>assert.deepEqual(db.raw.prepare(`SELECT * FROM ${table}`).all().map(row=>({...row})),before[i]));
  assert.deepEqual(db.raw.prepare('PRAGMA foreign_key_check').all(),[]);
  db.raw.prepare("UPDATE community_teams SET section='original'").run();
  db.raw.prepare("INSERT INTO community_likes VALUES('t','visitor2','2026-09-30',2)").run();
  assert.equal(db.raw.prepare('SELECT likes FROM community_teams').get().likes,2);
  assert.throws(()=>db.raw.prepare("INSERT INTO community_likes VALUES('missing','v','x',1)").run(),/FOREIGN KEY/);
  assert.equal(db.raw.prepare("SELECT count(*) n FROM sqlite_master WHERE type='index' AND name LIKE 'community_teams_%'").get().n,7);
  db.close();db=openDatabase(file);assert.equal(db.raw.prepare('SELECT section FROM community_teams').get().section,'original');
});
