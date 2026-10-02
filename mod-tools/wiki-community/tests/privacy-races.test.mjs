import test from 'node:test';
import assert from 'node:assert/strict';
import {privacyContext, privateSubmission} from './privacy-helpers.mjs';
import {findAdminTeam, editTeam} from '../repository.mjs';
import {createGameCode, revokeGameCode, gameCodeInfo} from '../game-codes.mjs';
import {validateSubmission, fingerprint} from '../model.mjs';
import {fixtureCatalog} from './helpers.mjs';

for (const operation of ['edit', 'create-code', 'revoke-code', 'read-existing-code']) {
  test(`SQL access checks survive another administrator privatizing a pre-read team: ${operation}`, async (t) => {
    const app = await privacyContext(t); app.as('editor-a');
    const value = privateSubmission(0, {visibility: 'public'}), item = (await app.create(value)).json.team;
    if (['revoke-code', 'read-existing-code'].includes(operation))
      await app.call(`/admin/teams/${item.id}/game-code`, {body: {expectedRevision: 1}});
    const actor = app.actors['editor-b'], stale = await findAdminTeam(app.db, item.id, actor);
    const beforeAudit = app.db.raw.prepare('SELECT count(*) n FROM community_audit').get().n;
    const beforeCodes = app.db.raw.prepare('SELECT * FROM community_game_codes').all();
    const makePrivate = () => app.db.raw.prepare("UPDATE community_teams SET visibility='private' WHERE id=?").run(item.id);
    // Keep revision unchanged to prove access predicates, not merely revision checks, reject the stale view.
    const db = {...app.db, async batch(statements) {makePrivate(); return app.db.batch(statements);}};
    let promise;
    if (operation === 'edit') promise = editTeam(db, stale, validateSubmission({...value, title: '不可写入'}, fixtureCatalog),
      await fingerprint(value.team), 'approved', actor, app.now);
    if (operation === 'create-code') promise = createGameCode(db, stale, actor, app.now);
    if (operation === 'revoke-code') promise = revokeGameCode(db, stale, actor, app.now);
    if (operation === 'read-existing-code') {makePrivate(); promise = gameCodeInfo(db, stale, actor);}
    await assert.rejects(promise, {status: 404, code: 'not_found'});
    assert.equal(app.db.raw.prepare('SELECT title FROM community_teams WHERE id=?').get(item.id).title, value.title);
    assert.equal(app.db.raw.prepare('SELECT count(*) n FROM community_audit').get().n, beforeAudit);
    assert.deepEqual(app.db.raw.prepare('SELECT * FROM community_game_codes').all(), beforeCodes);
    if (operation === 'read-existing-code') await assert.rejects(createGameCode(db, stale, actor, app.now), {status: 404});
  });
}
