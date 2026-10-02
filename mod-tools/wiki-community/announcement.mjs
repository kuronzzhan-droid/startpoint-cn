import {cleanText, fail} from './model.mjs';
import {readJSON} from './security.mjs';

const record = (row) => ({text: row?.text || '', revision: row?.revision || 0, updatedAt: row?.updated_at ?? null});

export async function readAnnouncement(db) {
  return record(await db.prepare('SELECT text,revision,updated_at FROM community_announcement WHERE id=1').first());
}

export async function updateAnnouncement(db, body, actor, now) {
  if (!actor?.id || !actor?.email) fail(401, 'admin_auth_required', '请先使用管理员账号登录。');
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0)
    fail(400, 'invalid_revision', '公告版本无效，请重新加载。');
  if (Object.keys(body).some((key) => !['text', 'expectedRevision'].includes(key)))
    fail(400, 'invalid_fields', '公告只支持正文和当前版本。');
  if (typeof body.text !== 'string' || /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/u.test(body.text))
    fail(400, 'invalid_input', '公告必须是文字，不能包含控制字符。');
  const text = cleanText(body.text.replace(/\r\n?/g, '\n'), '公告', 500);
  const before = await readAnnouncement(db);
  if (before.revision !== body.expectedRevision) fail(409, 'edit_conflict', '公告已被修改，请重新加载后编辑。');
  const after = {text, revision: before.revision + 1, updatedAt: now};
  const write = before.revision === 0
    ? db.prepare(`INSERT INTO community_announcement(id,text,revision,updated_at) VALUES(1,?,?,?)
        ON CONFLICT(id) DO NOTHING`).bind(text, after.revision, now)
    : db.prepare('UPDATE community_announcement SET text=?,revision=?,updated_at=? WHERE id=1 AND revision=?')
        .bind(text, after.revision, now, before.revision);
  const results = await db.batch([write,
    db.prepare(`INSERT INTO community_announcement_audit(id,actor_id,actor_email,before_json,after_json,created_at)
      SELECT ?,?,?,?,?,? FROM community_announcement WHERE id=1 AND revision=? AND changes()=1`)
      .bind(crypto.randomUUID(), actor.id, actor.email, JSON.stringify(before), JSON.stringify(after), now, after.revision)
  ]);
  if (!results[0].meta.changes) fail(409, 'edit_conflict', '公告已被修改，请重新加载后编辑。');
  return after;
}

export async function adminAnnouncementRoute(request, db, actor, now) {
  if (request.method === 'GET') return readAnnouncement(db);
  if (request.method === 'PATCH') return updateAnnouncement(db, await readJSON(request), actor, now);
  fail(405, 'method_not_allowed', '公告编辑必须使用 PATCH。');
}
