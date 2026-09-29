import {encodeJSON, decodeJSON} from './codecs.mjs';
export const DAMAGE_TYPES = ['skill', 'ability', 'powerflip', 'direct'];
export const TEAM_CATEGORIES = ['萌新启航', '原版毕业队', 'MOD毕业队', '最新最潮盘', '玩具盘'];
export const TEAM_SECTIONS = [{value: '', label: '通用 / 其他'}, {value: 'abyss', label: '深渊连战'},
  {value: 'fantasy', label: '幻想连战'}, {value: 'five-boss', label: '五重决战'}];
export const GROUPS = ['main', 'unison', 'weapon', 'soul'];
export const PAGE_SIZE = 24;
export class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message); this.status = status; this.code = code; this.extra = extra;
  }
}
export const fail = (status, code, message, extra) => { throw new ApiError(status, code, message, extra); };
export function cleanText(value, name, max, required = false, singleLine = false) {
  if (typeof value !== 'string') fail(400, 'invalid_input', `${name}必须是文字。`);
  const text = value.trim().normalize('NFC');
  if ([...text].length > max || (required && !text) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text) ||
      (singleLine && /[\t\r\n]/u.test(text)))
    fail(400, 'invalid_input', `${name}不能为空或超过 ${max} 字符，且不能包含控制字符。`);
  return text;
}
export function damageMask(value) {
  if (!Array.isArray(value) || !value.length || value.length > 4 || value.some((v) => !DAMAGE_TYPES.includes(v)))
    fail(400, 'invalid_damage', '至少选择一种有效伤害类型。');
  return [...new Set(value)].reduce((mask, type) => mask | (1 << DAMAGE_TYPES.indexOf(type)), 0);
}
export function validateSubmission(body, catalog, {allowUncategorized = false} = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'invalid_input', '投稿内容格式错误。');
  if (!TEAM_CATEGORIES.includes(body.category) && !(allowUncategorized && body.category === ''))
    fail(400, 'invalid_category', '请选择一个有效的配队分类。');
  const section = body.section === undefined ? '' : body.section;
  if (!TEAM_SECTIONS.some((item) => item.value === section)) fail(400, 'invalid_section', '请选择一个有效的玩法分区。');
  const visibility = body.visibility === undefined ? 'public' : body.visibility;
  if (!['public', 'private'].includes(visibility)) fail(400, 'invalid_visibility', '请选择配队大全或个人空间。');
  const team = {}, seen = new Set();
  for (const group of GROUPS) {
    const values = body.team?.[group];
    if (!Array.isArray(values) || values.length !== 3) fail(400, 'invalid_team', '队伍必须包含四组、每组三个槽位。');
    team[group] = values.map((id) => {
      if (typeof id !== 'string' || id.length > 40) fail(400, 'invalid_team', '角色或武器标识无效。');
      if (!id && group !== 'main') return '';
      const isCharacter = group === 'main' || group === 'unison';
      const source = isCharacter ? catalog.characters : catalog.equipment;
      if (!Object.hasOwn(source, id)) fail(400, 'invalid_team', '队伍包含未收录的角色或武器，或缺少主位角色。');
      if (isCharacter) {
        if (seen.has(id)) fail(400, 'invalid_team', '同一个角色不能重复编入队伍。');
        seen.add(id);
      }
      if (group === 'soul' && source[id].soul !== true) fail(400, 'invalid_team', '此武器不能作为魂珠。');
      return id;
    });
  }
  const element = body.element === 'auto' ? catalog.characters[team.main[0]].element : body.element;
  if (element !== 'universal' && !catalog.elements.includes(element)) fail(400, 'invalid_element', '请选择有效属性或宇宙。');
  return {title: cleanText(body.title, '标题', 80, true, true), notes: cleanText(body.notes ?? '', '备注', 2000),
    author: cleanText(body.author ?? '', '署名', 40, false, true), team, element, category: body.category, section, visibility,
    damageMask: damageMask(body.damageTypes)};
}
export async function fingerprint(team) {
  const columns = [0, 1, 2].map((index) => GROUPS.map((group) => team[group][index]));
  const canonical = JSON.stringify([columns[0], ...columns.slice(1).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)]);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function chinaDay(now) {
  const date = new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
  const next = Date.parse(`${date}T00:00:00+08:00`) + 86400_000;
  return {date, nextLikeAt: new Date(next).toISOString()};
}
export function teamRecord(row, admin = false) {
  const item = {id: row.id, title: row.title, notes: row.notes, author: row.author, team: JSON.parse(row.team_json),
    element: row.element, category: row.category || '', section: row.section || '', damageTypes: DAMAGE_TYPES.filter((_, i) => row.damage_mask & (1 << i)),
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), likes: row.likes,
    gameCode: row.status === 'approved' ? row.game_code || null : null};
  if (admin) Object.assign(item, {status: row.status, revision: row.revision, visibility: row.visibility, createdBy: row.created_by});
  return item;
}
export function listQuery(url, catalog, admin = false, actor = null) {
  if (admin && !actor?.id) fail(401, 'admin_auth_required', '请先使用管理员账号登录。');
  const scope = admin ? (url.searchParams.get('scope') || 'all') : '';
  if (admin && !['all', 'public', 'mine', 'private'].includes(scope)) fail(400, 'invalid_scope', '队伍范围筛选无效。');
  if (scope === 'private' && !['owner', 'deputy'].includes(actor?.role)) fail(403, 'manager_required', '只有站长或副站长可以查看全部个人空间。');
  const code = url.searchParams.get('code') || '';
  if (code && !['has', 'none'].includes(code)) fail(400, 'invalid_code_filter', '队伍码筛选无效。');
  const accessKey = admin ? `${actor.id}:${actor.role || 'editor'}` : '';
  const element = url.searchParams.get('element') || '';
  if (element && element !== 'universal' && !catalog.elements.includes(element)) fail(400, 'invalid_element', '属性筛选无效。');
  const category = url.searchParams.get('category') || '';
  if (category && category !== 'uncategorized' && !TEAM_CATEGORIES.includes(category)) fail(400, 'invalid_category', '配队分类筛选无效。');
  const section = url.searchParams.get('section') || '';
  if (section !== 'general' && !TEAM_SECTIONS.some((item) => item.value === section)) fail(400, 'invalid_section', '玩法分区筛选无效。');
  const damage = url.searchParams.get('damage');
  const sort = url.searchParams.get('sort') || 'latest';
  if (!['latest', 'popular'].includes(sort)) fail(400, 'invalid_sort', '排序方式无效。');
  const status = admin ? (url.searchParams.get('status') || '') : 'approved';
  if (status && !['approved', 'hidden', 'pending'].includes(status)) fail(400, 'invalid_status', '状态筛选无效。');
  let cursor = null;
  const encoded = url.searchParams.get('cursor');
  if (encoded) {
    try {
      if (encoded.length > 800) throw new Error();
      cursor = decodeJSON(encoded);
      if (cursor.sort !== sort || cursor.element !== element || (cursor.category || '') !== category || (cursor.section || '') !== section ||
          cursor.damage !== (damage || '') || cursor.status !== status ||
          (cursor.scope || '') !== scope || (cursor.code || '') !== code || (cursor.accessKey || '') !== accessKey ||
          !Number.isSafeInteger(cursor.createdAt) || !Number.isSafeInteger(cursor.likes) || cursor.likes < 0 ||
          !/^[a-f0-9-]{36}$/.test(cursor.id)) throw new Error();
    } catch { fail(400, 'invalid_cursor', '分页位置无效，请重新打开列表。'); }
  }
  return {element, category, section, scope, code, accessKey, damage: damage || '', mask: damage ? damageMask(damage.split(',')) : 0, sort, status, cursor};
}
export function nextCursor(query, row) {
  return encodeJSON({sort: query.sort, element: query.element, category: query.category || '', section: query.section || '', damage: query.damage, status: query.status,
    scope: query.scope || '', code: query.code || '', accessKey: query.accessKey || '',
    createdAt: row.created_at, likes: row.likes, id: row.id});
}
