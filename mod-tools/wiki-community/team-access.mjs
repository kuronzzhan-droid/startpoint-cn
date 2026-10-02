import {fail} from './model.mjs';

export const managesPrivateTeams = (actor) => ['owner', 'deputy'].includes(actor?.role);
export const isPublicTeam = (row) => row?.visibility === 'public' && row.status === 'approved';
export const canAccessTeam = (row, actor) => Boolean(row && actor?.id &&
  (row.visibility === 'public' || row.created_by === actor.id || managesPrivateTeams(actor)));
export function requireTeamAccess(row, actor) {
  if (!canAccessTeam(row, actor)) fail(404, 'not_found', '队伍不存在。');
}
export function adminTeamScope(actor, prefix = '') {
  if (!actor?.id) fail(401, 'admin_auth_required', '请先使用管理员账号登录。');
  return {sql: `(${prefix}visibility='public' OR ${prefix}created_by=? OR ?=1)`,
    values: [actor.id, Number(managesPrivateTeams(actor))]};
}
export function requireVisibilityChange(row, visibility, actor) {
  requireTeamAccess(row, actor);
  if (visibility === 'private' && row.created_by !== actor.id && !managesPrivateTeams(actor))
    fail(403, 'team_owner_required', '只有创建者、站长或副站长可以把队伍移入个人空间。');
}
export function duplicateTeam(existing, actor) {
  if (!canAccessTeam(existing, actor)) fail(409, 'duplicate', '这个阵容无法重复保存。');
  fail(409, 'duplicate', existing.status === 'approved' ? '这个阵容已经保存。' : '这个阵容已保存，暂不展示。',
    {existingId: existing.id, status: existing.status});
}
