import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {context, submission} from './helpers.mjs';
import {fingerprint} from '../model.mjs';
import {openDatabase} from '../sqlite-adapter.mjs';

test('EX is an independent public and admin filter, with concise config labels in display order', async t => {
  const app=context();t.after(()=>app.close());await app.admin();
  assert.deepEqual((await app.call('/config')).json.sections,[
    {value:'original',label:'原版'},{value:'abyss',label:'深渊'},{value:'fantasy',label:'幻想'},
    {value:'abyss-ex',label:'深渊EX'},{value:'five-boss',label:'五重'},{value:'',label:'其他'},
  ]);
  const normal=(await app.create({...submission(),section:'abyss',title:'旧深渊EX标题也不推断分区'})).json.team;
  const value={...submission(),section:'abyss-ex',title:'独立EX推荐'};value.team.unison[2]='c6';
  const created=await app.create(value);assert.equal(created.status,201);const ex=created.json.team;
  const query='/teams?section=abyss-ex&sort=popular&damage=skill&element='+encodeURIComponent('火');
  assert.deepEqual((await app.call(query)).json.items.map(x=>x.id),[ex.id]);
  assert.deepEqual((await app.call('/teams?section=abyss')).json.items.map(x=>x.id),[normal.id]);
  assert.deepEqual((await app.call('/admin/teams?section=abyss-ex')).json.items.map(x=>x.id),[ex.id]);
  assert.equal((await app.call(`/admin/teams/${ex.id}`,{method:'PATCH',body:{expectedRevision:1,status:'hidden'}})).status,200);
  assert.deepEqual((await app.call(query)).json.items,[]);
  assert.deepEqual((await app.call('/admin/teams?section=abyss-ex&status=hidden')).json.items.map(x=>x.id),[ex.id]);
});

test('an explicit EX reclassification preserves the team code and produces a revision audit',async t=>{
  const app=context();t.after(()=>app.close());await app.admin();
  const team=(await app.create({...submission(),section:'abyss'})).json.team;
  const code=(await app.call(`/admin/teams/${team.id}/game-code`,{body:{expectedRevision:1}})).json.gameCode;
  const edited=await app.call(`/admin/teams/${team.id}`,{method:'PATCH',body:{expectedRevision:1,section:'abyss-ex'}});
  assert.equal(edited.status,200);assert.equal(edited.json.team.section,'abyss-ex');
  assert.equal(edited.json.team.gameCode,code);assert.equal((await app.call(`/game-codes/${code}`)).status,200);
  const audit=app.db.raw.prepare("SELECT before_json,after_json FROM community_audit WHERE team_id=? AND action='update'").get(team.id);
  assert.equal(JSON.parse(audit.before_json).section,'abyss');assert.equal(JSON.parse(audit.after_json).section,'abyss-ex');
  const stale=await app.call(`/admin/teams/${team.id}`,{method:'PATCH',body:{expectedRevision:1,section:'abyss'}});
  assert.equal(stale.status,409);assert.equal((await app.call(`/teams/${team.id}`)).json.team.section,'abyss-ex');
});

const schema=readFileSync(new URL('../schema.sql',import.meta.url),'utf8');
const migration=readFileSync(new URL('../migrations/0017-abyss-ex-section.sql',import.meta.url),'utf8');
function snapshot(db){
  return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[
    name,db.prepare(`SELECT * FROM "${name}"`).all().map(row=>JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))))).sort(),
  ]));
}
async function seedOldDatabase(db){
  db.exec(schema.replace("'abyss','abyss-ex'","'abyss'"));
  db.prepare(`INSERT INTO community_users(id,email,role,password_hash,must_change_password,created_at,updated_at)
    VALUES('owner','fixture@example.test','owner','fixture-hash',0,1,1)`).run();
  for(const [index,section] of ['abyss','fantasy','five-boss','original',''].entries()){
    const value=submission();value.team.unison[2]=`c${5+index}`;const hash=await fingerprint(value.team);
    const id=`20261002-0000-4000-8000-${String(index+1).padStart(12,'0')}`;
    db.prepare(`INSERT INTO community_teams(id,fingerprint,title,notes,author,team_json,element,category,section,visibility,created_by,damage_mask,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,hash,'旧深渊EX标题','原备注','原作者',JSON.stringify(value.team),'火','萌新启航',section,
        index===4?'private':'public','owner',1,index===3?'hidden':'approved',1,1);
    db.prepare('INSERT INTO community_likes VALUES(?,?,?,?)').run(id,'fixture-visitor','2026-10-01',1);
    db.prepare('INSERT INTO community_game_codes VALUES(?,?,?,?,?)').run(`DEM22222222${index+2}`,id,hash,1,index===3?1:null);
    db.prepare('INSERT INTO community_audit VALUES(?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),id,'owner','fixture@example.test','create','null','{}',1);
  }
  db.prepare('INSERT INTO community_announcement VALUES(1,?,?,?)').run('保留公告',1,1);
}

test('0017 preserves all old rows, references, indexes and triggers, and is repeatable',async t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());await seedOldDatabase(db);
  const before=snapshot(db);
  const objects=()=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('index','trigger') ORDER BY type,name").all();
  const beforeObjects=objects();
  for(let i=0;i<2;i++){
    db.exec('BEGIN IMMEDIATE');try{db.exec(migration);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
    assert.deepEqual(snapshot(db),before);assert.deepEqual(objects(),beforeObjects);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  }
  const first=db.prepare('SELECT * FROM community_teams WHERE section=?').get('abyss');
  assert.equal(first.title,'旧深渊EX标题');
  db.prepare('UPDATE community_teams SET section=? WHERE id=?').run('abyss-ex',first.id);
  assert.throws(()=>db.prepare('UPDATE community_teams SET section=? WHERE id=?').run('invalid',first.id),/CHECK constraint/);
  db.prepare('INSERT INTO community_likes VALUES(?,?,?,?)').run(first.id,'second-visitor','2026-10-02',2);
  assert.equal(db.prepare('SELECT likes FROM community_teams WHERE id=?').get(first.id).likes,2);
  const team=JSON.parse(first.team_json);team.unison[2]='c11';
  db.prepare('UPDATE community_teams SET team_json=? WHERE id=?').run(JSON.stringify(team),first.id);
  assert.deepEqual(db.prepare('SELECT character_id FROM community_team_characters WHERE team_id=? ORDER BY character_id').all(first.id).map(x=>x.character_id),[...team.main,...team.unison].sort());
});

test('local adapter migrates an old section constraint and repeated reopen keeps EX',async t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'wiki-ex-migration-')),filename=path.join(dir,'preview.sqlite');let db;
  t.after(()=>{db?.close();rmSync(dir,{recursive:true,force:true});});
  const legacy=new DatabaseSync(filename);await seedOldDatabase(legacy);const before=snapshot(legacy);legacy.close();
  db=openDatabase(filename);assert.deepEqual(snapshot(db.raw),before);
  const first=db.raw.prepare('SELECT id FROM community_teams WHERE section=?').get('abyss');
  db.raw.prepare('UPDATE community_teams SET section=? WHERE id=?').run('abyss-ex',first.id);
  db.close();db=openDatabase(filename);
  assert.equal(db.raw.prepare('SELECT section FROM community_teams WHERE id=?').get(first.id).section,'abyss-ex');
  assert.equal(db.raw.prepare("SELECT count(*) n FROM pragma_table_info('community_teams') WHERE name='section_previous'").get().n,0);
});
