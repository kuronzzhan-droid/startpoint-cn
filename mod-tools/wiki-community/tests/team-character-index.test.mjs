import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../sqlite-adapter.mjs';

test('character membership migration backfills once, preserves teams and follows edits/deletion atomically',t=>{
  const db=openDatabase(); t.after(()=>db.close()); const raw=db.raw;
  raw.exec('DROP TRIGGER community_team_characters_insert; DROP TRIGGER community_team_characters_update; DROP TABLE community_team_characters');
  const first=JSON.stringify({main:['c0','c1','c2'],unison:['c3','','c0'],weapon:['c9'],soul:['c8']});
  raw.prepare(`INSERT INTO community_teams(id,fingerprint,title,notes,author,team_json,element,damage_mask,status,created_at,updated_at)
    VALUES('t1','fingerprint','标题','攻略','署名',?,'火',1,'approved',1,1)`).run(first);
  const before=raw.prepare('SELECT * FROM community_teams').all();
  const migration=readFileSync(new URL('../migrations/0015-team-character-index.sql',import.meta.url),'utf8');
  raw.exec(migration);raw.exec(migration);
  assert.deepEqual(raw.prepare('SELECT * FROM community_teams').all(),before);
  const members=()=>raw.prepare('SELECT character_id FROM community_team_characters ORDER BY character_id').all().map(r=>r.character_id);
  assert.deepEqual(members(),['c0','c1','c2','c3']);
  raw.exec('BEGIN');
  raw.prepare('UPDATE community_teams SET team_json=? WHERE id=?').run(JSON.stringify({main:['c4'],unison:['c5']}),'t1');
  assert.deepEqual(members(),['c4','c5']);raw.exec('ROLLBACK');assert.deepEqual(members(),['c0','c1','c2','c3']);
  raw.prepare('UPDATE community_teams SET team_json=? WHERE id=?').run(JSON.stringify({main:['c4'],unison:['c5']}),'t1');
  assert.deepEqual(members(),['c4','c5']);
  const plan=raw.prepare('EXPLAIN QUERY PLAN SELECT team_id FROM community_team_characters WHERE character_id=?').all('c4');
  assert.match(plan.map(r=>r.detail).join('\n'),/SEARCH .*COVERING INDEX.*character_id/);
  raw.exec("DELETE FROM community_teams WHERE id='t1'");assert.deepEqual(members(),[]);
  assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(),[]);
});
