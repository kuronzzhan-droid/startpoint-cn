import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../sqlite-adapter.mjs';
import {submission} from './helpers.mjs';
import {fingerprint} from '../model.mjs';

test('visibility migration preserves old public/hidden teams and never infers private ownership', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'wiki-privacy-migration-'));
  let db;
  t.after(() => {db?.close(); rmSync(directory, {recursive: true, force: true});});
  const filename = path.join(directory, 'legacy.sqlite'), legacy = new DatabaseSync(filename);
  // Reconstruct only the legacy team table; unrelated new tables may also have creator columns.
  const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
    .replace(/CREATE TABLE IF NOT EXISTS community_teams \([\s\S]*?\n\);/, (sql) => sql.split('\n')
      .filter((line) => !['visibility TEXT', 'created_by TEXT'].some((text) => line.includes(text))).join('\n'));
  legacy.exec(schema.split('\n').filter((line) =>
    !['community_teams_visibility', 'community_teams_creator'].some((text) => line.includes(text))).join('\n'));
  for (const [index, status] of ['approved', 'hidden'].entries()) {
    const id = crypto.randomUUID(), value = submission(); value.team.unison[2] = `c${5 + index}`;
    const hash = await fingerprint(value.team);
    legacy.prepare(`INSERT INTO community_teams(id,fingerprint,title,notes,author,team_json,element,category,section,damage_mask,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, hash, '旧盘', '原备注', 'owner@example.test', JSON.stringify(value.team), '火', '原版毕业队', 'abyss', 1, status, 1, 1);
    legacy.prepare('INSERT INTO community_likes VALUES(?,?,?,?)').run(id, 'visitor', '2026-09-29', 1);
    legacy.prepare('INSERT INTO community_game_codes VALUES(?,?,?,?,?)').run(`ABCDEFGH234${index}`, id, hash, 1, index ? 1 : null);
    legacy.prepare('INSERT INTO community_audit VALUES(?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), id, 'legacy-owner', 'owner@example.test', 'create', 'null', '{}', 1);
  }
  legacy.prepare(`INSERT INTO community_users(id,email,role,password_hash,must_change_password,created_at,updated_at)
    VALUES('owner','owner@example.test','owner','fixture-hash',0,1,1)`).run();
  const rows = legacy.prepare('SELECT * FROM community_teams ORDER BY id').all();
  const tables = ['community_likes', 'community_game_codes', 'community_users', 'community_audit'];
  const snapshots = tables.map((table) => legacy.prepare(`SELECT * FROM ${table}`).all()); legacy.close();
  db = openDatabase(filename);
  assert.deepEqual(db.raw.prepare('SELECT * FROM community_teams ORDER BY id').all().map((row) => ({...row})),
    rows.map((row) => ({...row, visibility: 'public', created_by: ''})));
  tables.forEach((table, index) => assert.deepEqual(db.raw.prepare(`SELECT * FROM ${table}`).all(), snapshots[index]));
  assert.throws(() => db.raw.prepare('UPDATE community_teams SET visibility=?').run('hidden'), /CHECK constraint/);
  db.raw.prepare("UPDATE community_teams SET visibility='private',created_by='owner' WHERE id=?").run(rows[0].id);
  db.close(); db = openDatabase(filename);
  assert.equal(db.raw.prepare('SELECT visibility FROM community_teams WHERE id=?').get(rows[0].id).visibility, 'private');
  assert.equal(db.raw.prepare('SELECT count(*) n FROM pragma_table_info(?) WHERE name=?').get('community_teams', 'visibility').n, 1);
  assert.equal(db.raw.prepare('SELECT count(*) n FROM pragma_table_info(?) WHERE name=?').get('community_teams', 'created_by').n, 1);
});
