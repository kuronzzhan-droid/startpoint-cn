import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm, readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startLocalServer} from '../local-server.mjs';
import {openDatabase} from '../sqlite-adapter.mjs';
import {fixtureCatalog} from './helpers.mjs';
import {dungeons, guide, pixel} from './dungeon-helpers.mjs';

test('loopback HTTP accepts bounded long guides and raw image data without increasing unrelated JSON limits', async (t) => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'wf-wiki-dungeons-'));
  assert.equal(path.dirname(folder), path.resolve(os.tmpdir())); assert.ok(path.basename(folder).startsWith('wf-wiki-dungeons-'));
  await writeFile(path.join(folder, 'index.html'), '<title>Isolated dungeon test</title>');
  const app = await startLocalServer({site: folder, db: ':memory:', authMode: 'access', trustedCatalog: {...fixtureCatalog, dungeons}});
  t.after(async () => {await app.close(); await rm(folder, {recursive: true, force: true});});
  const route = `${app.origin}/api/community/admin/dungeons/boss-fire`;
  const headers = {Origin: app.origin, 'Content-Type': 'application/json'};
  const login = await fetch(`${app.origin}/api/community/development-admin-login`, {method: 'POST', headers, body: '{}'});
  headers.Cookie = login.headers.get('set-cookie').split(';')[0];
  const text = '详细攻略'.repeat(7000);
  const result = await fetch(route, {method: 'PATCH', headers, body: JSON.stringify(guide({text}))});
  assert.equal(result.status, 200); assert.equal((await result.json()).guide.text, text);
  const image = await fetch(`${route}/images`, {method: 'POST', headers: {...headers, 'Content-Type': 'image/png'}, body: pixel});
  assert.equal(image.status, 201); const uploaded = (await image.json()).image;
  assert.equal((await fetch(`${app.origin}${uploaded.url}`)).status, 404);
  assert.equal((await fetch(route, {method: 'PATCH', headers, body: JSON.stringify(guide({expectedRevision: 1, text, imageIds: [uploaded.id]}))})).status, 200);
  const displayed = await fetch(`${app.origin}${uploaded.url}`);
  assert.equal(displayed.status, 200); assert.deepEqual(new Uint8Array(await displayed.arrayBuffer()), pixel);
  assert.equal((await fetch(`${route}/images`, {method: 'POST', headers: {...headers, 'Content-Type': 'image/png'}, body: new Uint8Array(524289)})).status, 413);
  assert.equal((await fetch(`${app.origin}/api/community/admin/teams`, {method: 'POST', headers, body: JSON.stringify({notes: text})})).status, 413);
});

test('additive dungeon migration is idempotent and preserves existing users, teams, votes and codes', async (t) => {
  const db = openDatabase(); t.after(() => db.close());
  db.raw.exec(`INSERT INTO community_users VALUES('owner','owner@example.test','owner',1,'fixture-hash',1,0,1,1,1);
    INSERT INTO community_teams(id,fingerprint,title,notes,author,team_json,element,damage_mask,status,created_at,updated_at)
      VALUES('team','fingerprint','Existing','Notes','Author','{}','火',1,'approved',1,1);
    INSERT INTO community_likes VALUES('team','visitor','2026-09-30',1);
    INSERT INTO community_game_codes VALUES('23456789ABCD','team','fingerprint',1,NULL);
    DROP TABLE community_dungeon_guides; DROP TABLE community_dungeon_images; DROP TABLE community_dungeon_audit;`);
  const names = ['community_users', 'community_teams', 'community_likes', 'community_game_codes'];
  const before = names.map((name) => db.raw.prepare(`SELECT * FROM ${name}`).all());
  const migration = await readFile(new URL('../migrations/0007-dungeon-guides.sql', import.meta.url), 'utf8');
  db.raw.exec(migration); db.raw.exec(migration);
  assert.deepEqual(names.map((name) => db.raw.prepare(`SELECT * FROM ${name}`).all()), before);
  for (const name of ['community_dungeon_guides', 'community_dungeon_images', 'community_dungeon_audit'])
    assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM ${name}`).get().n, 0);
  const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
  const dungeonSchema = migration.slice(migration.indexOf('CREATE TABLE')).trim();
  const start = schema.indexOf('CREATE TABLE IF NOT EXISTS community_dungeon_guides');
  assert.notEqual(start, -1);
  assert.equal(schema.slice(start, start + dungeonSchema.length), dungeonSchema);
});
