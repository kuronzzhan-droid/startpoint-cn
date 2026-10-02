import {cleanText, fail} from './model.mjs';
import {readJSON} from './security.mjs';

const fields = ['enabled','title','description','imageUrl','targetUrl','expectedRevision'];
const localImage = /^\/?media\/[a-f0-9]{64}\.(?:png|webp|jpe?g)$/;
const rasterImage = /\.(?:png|webp|jpe?g)$/i;
const privateSuffixes = ['localhost','local','localdomain','internal','intranet','lan','home','test','invalid','onion'];
const record = row => ({enabled:row?.enabled === 1,title:row?.title || '',description:row?.description || '',
  imageUrl:row?.image_url || '',targetUrl:row?.target_url || '',revision:row?.revision || 0,updatedAt:row?.updated_at ?? null});
const readDraft = async db => record(await db.prepare('SELECT * FROM community_sponsorship WHERE id=1').first());

function manager(actor) {
  if (!actor?.id || !actor?.email) fail(401,'admin_auth_required','请先使用管理员账号登录。');
  if (!['owner','deputy'].includes(actor.role)) fail(403,'owner_required','只有站长或副站长可以管理赞助位。');
}
function link(value, image = false) {
  const invalid = () => fail(400,'invalid_url',image ? '图片请使用 HTTPS 公网 PNG、JPG、WebP 地址或本站媒体路径。' : '跳转链接请使用 HTTPS 公网地址。');
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001F\u007F]/u.test(value)) invalid();
  value = value.trim();
  if (!value) return '';
  if (image && localImage.test(value)) return value.startsWith('/') ? value : `/${value}`;
  if (/[\\\s]/u.test(value)) invalid();
  let url, pathname;
  try {url = new URL(value); pathname = decodeURIComponent(url.pathname);} catch {invalid();}
  const host = url.hostname.toLowerCase(), labels = host.split('.');
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.href.length > 2048
    || labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    || !/^[a-z]/.test(labels.at(-1)) || privateSuffixes.some(suffix => host === suffix || host.endsWith(`.${suffix}`))
    || /[\u0000-\u001F\u007F]/u.test(pathname) || (image && !rasterImage.test(pathname))) invalid();
  // URL validation is syntactic. The Worker never fetches a sponsor's external destination.
  return url.href;
}
function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Number.isSafeInteger(body.expectedRevision)
    || body.expectedRevision < 0 || body.expectedRevision >= Number.MAX_SAFE_INTEGER)
    fail(400,'invalid_revision','赞助位版本无效，请重新加载。');
  if (Object.keys(body).some(key => !fields.includes(key))) fail(400,'invalid_fields','赞助位包含不支持的字段。');
  if (typeof body.enabled !== 'boolean') fail(400,'invalid_input','请选择赞助位是否启用。');
  const value = {enabled:body.enabled,title:cleanText(body.title,'赞助标题',60,body.enabled,true),
    description:cleanText(body.description,'赞助说明',160,false,true),imageUrl:link(body.imageUrl,true),targetUrl:link(body.targetUrl)};
  if (value.enabled && !value.targetUrl) fail(400,'invalid_input','启用赞助位前请填写跳转链接。');
  return value;
}

export async function readSponsorship(db) {
  const value = await readDraft(db);
  return value.enabled ? value : {...value,title:'',description:'',imageUrl:'',targetUrl:''};
}
export async function updateSponsorship(db, body, actor, now) {
  manager(actor);
  const value = validate(body), before = await readDraft(db);
  if (before.revision !== body.expectedRevision) fail(409,'edit_conflict','赞助位已被修改，请重新加载后编辑。');
  const after = {...value,revision:before.revision + 1,updatedAt:now};
  const parameters = [Number(value.enabled),value.title,value.description,value.imageUrl,value.targetUrl,after.revision,now];
  const write = before.revision === 0
    ? db.prepare(`INSERT INTO community_sponsorship(id,enabled,title,description,image_url,target_url,revision,updated_at)
        VALUES(1,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`).bind(...parameters)
    : db.prepare(`UPDATE community_sponsorship SET enabled=?,title=?,description=?,image_url=?,target_url=?,revision=?,updated_at=?
        WHERE id=1 AND revision=?`).bind(...parameters,before.revision);
  const results = await db.batch([write,
    db.prepare(`INSERT INTO community_sponsorship_audit(id,actor_id,actor_email,before_json,after_json,created_at)
      SELECT ?,?,?,?,?,? FROM community_sponsorship WHERE id=1 AND revision=? AND changes()=1`)
      .bind(crypto.randomUUID(),actor.id,actor.email,JSON.stringify(before),JSON.stringify(after),now,after.revision)
  ]);
  if (!results[0].meta.changes) fail(409,'edit_conflict','赞助位已被修改，请重新加载后编辑。');
  return after;
}
export async function adminSponsorshipRoute(request, db, actor, now) {
  manager(actor);
  if (request.method === 'GET') return readDraft(db);
  if (request.method === 'PATCH') return updateSponsorship(db,await readJSON(request,8192),actor,now);
  fail(405,'method_not_allowed','赞助位编辑必须使用 PATCH。');
}
