import test from 'node:test';
import assert from 'node:assert/strict';
import {privacyContext, privateSubmission} from './privacy-helpers.mjs';
import {fixtureCatalog} from './helpers.mjs';
import {listQuery, nextCursor} from '../model.mjs';

function plate(index = 0, extra = {}) {
  const value = privateSubmission(0, {visibility:'public', ...extra});
  for (let slot = 0; slot < 3; slot++) {
    const variant = Math.floor(index / (3 ** slot)) % 3;
    value.team.weapon[slot] = variant === 0 ? '' : `w${variant - 1}`;
  }
  return value;
}
const ids = result => result.json.items.map(item => item.id).sort();
const query = (app, character, extra = {}, admin = false) => app.call(`/${admin ? 'admin/' : ''}teams?${new URLSearchParams({character,...extra})}`);

test('character filtering matches whole IDs only in main or unison, never substrings or other fields', async t => {
  const app = await privacyContext(t); app.as('owner');
  const main = plate(0); main.team = {...main.team,main:['c0','c2','c3'],unison:['c4','c5','c6']};
  const unison = plate(1); unison.team = {...unison.team,main:['c7','c2','c3'],unison:['c0','c5','c6']};
  const prefix = plate(2, {title:'c0',notes:'c0',author:'c0'}); prefix.team = {...prefix.team,main:['c10','c2','c3'],unison:['c4','c5','c6']};
  const a = (await app.create(main)).json.team, b = (await app.create(unison)).json.team, c = (await app.create(prefix)).json.team;
  // Character and equipment identifiers are separate namespaces; an overlapping gear ID is not a character slot.
  prefix.team.weapon[0] = 'c0'; app.db.raw.prepare('UPDATE community_teams SET team_json=? WHERE id=?').run(JSON.stringify(prefix.team), c.id);
  app.as('guest');
  assert.deepEqual(ids(await query(app,'c0')), [a.id,b.id].sort());
  assert.deepEqual(ids(await query(app,'c10')), [c.id]);
  assert.equal((await query(app,'c0')).headers.get('set-cookie'), null);
  assert.equal((await query(app,'')).json.items.length, 3);
});

test('character matches are selected before pagination and cursors cannot cross characters', async t => {
  const app = await privacyContext(t); app.as('owner');
  for (let i = 0; i < 27; i++) {
    app.now += 1000; assert.equal((await app.create(plate(i, {title:`目标盘${i}`, section:'five-boss'}))).status, 201);
  }
  for (let i = 0; i < 27; i++) {
    const value = plate(i,{title:`非目标盘${i}`}); value.team.main[0] = 'c10'; app.now += 1000;
    assert.equal((await app.create(value)).status, 201);
  }
  app.as('guest');
  assert.ok((await app.call('/teams')).json.items.every(item => item.team.main[0] === 'c10'));
  for (const sort of ['latest','popular']) {
    const filters = {sort,section:'five-boss',category:'萌新启航',element:'火',damage:'skill'};
    const first = await query(app,'c0',filters); assert.equal(first.status, 200); assert.equal(first.json.items.length, 24);
    assert.ok(first.json.nextCursor);
    const second = await query(app,'c0',{...filters,cursor:first.json.nextCursor});
    assert.equal(second.json.items.length, 3); assert.equal(second.json.nextCursor, null);
    assert.equal(new Set([...ids(first),...ids(second)]).size, 27);
    assert.equal((await query(app,'c1',{...filters,cursor:first.json.nextCursor})).json.error, 'invalid_cursor');
    assert.equal((await query(app,'',{...filters,cursor:first.json.nextCursor})).json.error, 'invalid_cursor');
  }
  assert.deepEqual(ids(await query(app,'c0',{section:'abyss'})), []);
});

test('private published codes, hidden and pending teams remain absent from related public teams', async t => {
  const app = await privacyContext(t); app.as('editor-a');
  const visible = (await app.create(plate(0))).json.team;
  const personal = (await app.create(plate(1,{visibility:'private'}))).json.team;
  const hidden = (await app.create(plate(2))).json.team;
  const pending = (await app.create(plate(3))).json.team;
  const code = await app.call(`/admin/teams/${personal.id}/game-code`,{body:{expectedRevision:1}}); assert.equal(code.status, 200);
  await app.call(`/admin/teams/${hidden.id}`,{method:'DELETE',body:{expectedRevision:1}});
  app.db.raw.prepare("UPDATE community_teams SET status='pending' WHERE id=?").run(pending.id);
  app.as('guest');
  assert.deepEqual(ids(await query(app,'c0',{scope:'private',status:'hidden'})), [visible.id]);
  assert.deepEqual(ids(await query(app,'c0',{code:'has'})), []);
  const publicData = JSON.stringify((await query(app,'c0')).json);
  for (const id of [personal.id,hidden.id,pending.id]) assert.ok(!publicData.includes(id));
  app.as('editor-b');
  assert.deepEqual(ids(await query(app,'c0',{status:'approved'},true)), [visible.id]);
  app.as('editor-a');
  assert.deepEqual(ids(await query(app,'c0',{status:'approved'},true)), [visible.id,personal.id].sort());
  app.as('owner');
  assert.deepEqual(ids(await query(app,'c0',{},true)), [visible.id,personal.id,hidden.id,pending.id].sort());
});

test('uncollected, inherited, oversized and SQL-like character IDs are rejected before querying', async t => {
  const app = await privacyContext(t); app.as('guest');
  for (const id of ['not-public','__proto__','constructor','w0','a'.repeat(41),"c0' OR 1=1--",' c0']) {
    const result = await query(app,id); assert.equal(result.status, 400); assert.equal(result.json.error, 'invalid_character');
    assert.equal(result.headers.get('set-cookie'), null);
  }
});

test('maximum character IDs round-trip with every admin filter and Unicode search', () => {
  const character = 'c'.repeat(40), catalog = {...fixtureCatalog,characters:{...fixtureCatalog.characters,[character]:{element:'火'}}};
  const actor = {id:crypto.randomUUID(),role:'deputy'};
  const params = new URLSearchParams({character,q:'🔥'.repeat(80),category:'MOD毕业队',element:'universal',damage:'skill,ability,powerflip,direct',
    section:'five-boss',scope:'private',code:'has',sort:'popular',status:'approved'});
  const url = new URL(`https://wiki.example/admin/teams?${params}`), first = listQuery(url,catalog,true,actor);
  url.searchParams.set('cursor', nextCursor(first,{id:crypto.randomUUID(),likes:1234567890,created_at:1790700000000}));
  assert.equal(listQuery(url,catalog,true,actor).character,character);
  url.searchParams.delete('character'); assert.throws(() => listQuery(url,catalog,true,actor), error => error.code === 'invalid_cursor');
});
