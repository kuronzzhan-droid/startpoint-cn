import {context, submission} from './helpers.mjs';
import {issueSession} from '../password-auth.mjs';

export async function privacyContext(t, options = {}) {
  const app = context({...options, env: {COMMUNITY_AUTH_MODE: 'password', COMMUNITY_OWNER_EMAIL: 'owner@example.test',
    COMMUNITY_PASSWORD_PEPPER: 'p'.repeat(40)}});
  t.after(() => app.close());
  const actors = {}, cookies = {};
  for (const [id, role] of [['owner', 'owner'], ['deputy', 'deputy'], ['editor-a', 'editor'], ['editor-b', 'editor']]) {
    app.db.raw.prepare(`INSERT INTO community_users(id,email,role,password_hash,must_change_password,created_at,updated_at)
      VALUES(?,?,?,'fixture-hash',0,?,?)`).run(id, `${id}@example.test`, role, app.now, app.now);
    const row = app.db.raw.prepare('SELECT * FROM community_users WHERE id=?').get(id);
    actors[id] = row;
    cookies[id] = (await issueSession(app.db, row, app.now, true)).cookie.split(';')[0];
  }
  return Object.assign(app, {actors, as(id) {app.cookie = cookies[id] || ''; return app;}});
}
export function privateSubmission(index = 0, extra = {}) {
  const value = {...submission(), visibility: 'private', ...extra};
  value.team.unison[2] = `c${5 + index}`;
  return value;
}
