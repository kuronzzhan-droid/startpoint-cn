/* Administrator-maintained recommendations; visitors can browse and like. */
(() => {
  'use strict';
  const C = window.WFCommunity;
  C.openSubmit = async ({team: input, title: initialTitle = '', data, ui}) => {
    const {el} = ui, team = C.teamCopy(input);
    const modal = C.dialog('管理员收录队伍', ui), host = modal.element;
    let closed = false;
    modal.cleanup(() => {closed = true;});
    const gate = el('p', 'community-status', '正在检查管理员登录…'); gate.setAttribute('role', 'status'); host.append(gate);
    const loginLink = (target) => {const link = el('a', 'text-button', '前往管理员登录'); link.href = '#community/admin'; target.append(link);};
    try {
      const me = await C.client.request('/admin/me');
      if (closed) return;
      if (!me.id) {gate.textContent = '配队大全由管理员维护，登录后可以收录和修改队伍。'; loginLink(gate); return;}
    } catch (error) {if (!closed) {gate.textContent = C.message(error); loginLink(gate);} return;}
    gate.remove();
    if (C.board) host.append(C.board(team, data, ui));
    const form = el('form', 'community-form'), status = el('p', 'community-status'); status.setAttribute('role', 'status');
    const field = (label, tag, maxLength, value = '') => {
      const wrap = el('label', 'community-field', label), control = el(tag);
      control.maxLength = maxLength; control.value = value; wrap.append(control); form.append(wrap); return control;
    };
    const title = field('队伍名称', 'input', 80, initialTitle.slice(0, 80)); title.required = true;
    const author = field('作者署名', 'input', 40); author.required = true;
    const notes = field('用途、操作要点与替换建议（选填）', 'textarea', 2000); notes.rows = 4;
    const leader = (data.characters || []).find((item) => item.id === team.main[0]);
    const element = field('队伍属性', 'select', 0);
    const auto = el('option', '', `自动：队长${leader ? ` ${leader.name} · ${leader.element}` : '尚未选择'}`); auto.value = 'auto'; element.append(auto);
    const damage = el('fieldset', 'community-damage-options'); damage.append(el('legend', '', '伤害类型（至少选一项，可多选）'));
    const checks = Object.entries(C.damageTypes).map(([value, label]) => {
      const wrap = el('label', 'community-check'), input = el('input'); input.type = 'checkbox'; input.value = value;
      wrap.append(input, el('span', '', label)); damage.append(wrap); return input;
    });
    const submit = el('button', 'primary-button', '收录到配队大全'); submit.type = 'submit'; submit.disabled = true;
    const retry = el('button', 'secondary-button', '重新连接社区'); retry.type = 'button'; retry.hidden = true;
    form.append(damage, el('p', 'muted', '收录后公开展示，作者署名用于注明队伍来源。相同阵容只收录一次。'), status, submit, retry);
    host.append(form);
    let busy = false, ready = false;
    const update = (valid) => {ready = valid; submit.disabled = !ready || busy;};
    async function connect() {
      retry.hidden = true; status.textContent = '正在连接配队社区…';
      try {
        const config = await C.client.config(); if (closed) return;
        element.replaceChildren(auto);
        (config.elements || []).forEach((value) => {const option = el('option', '', C.elementLabel(value)); option.value = value; element.append(option);});
        status.textContent = C.teamError(team, data);
        update(true);
      } catch (error) {if (!closed) {status.textContent = C.message(error); retry.hidden = false;}}
    }
    retry.addEventListener('click', connect);
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); if (busy) return;
      const damageTypes = checks.filter((check) => check.checked).map((check) => check.value);
      const invalid = C.teamError(team, data) || (!title.value.trim() ? '请填写队伍名称。' : '')
        || (!author.value.trim() ? '请填写作者署名。' : '') || (!damageTypes.length ? '请至少选择一种伤害类型。' : '');
      if (invalid) {status.textContent = invalid; return;}
      if (!ready) {status.textContent = '请先连接配队社区。'; return;}
      busy = true; update(false); status.textContent = '正在提交…';
      try {
        const result = await C.client.request('/admin/teams', {team, title: title.value.trim(), author: author.value.trim(),
          notes: notes.value.trim(), element: element.value, damageTypes});
        if (closed) return;
        const item = result.team;
        if (item?.status === 'approved') {
          status.replaceChildren(el('span', '', '收录成功，已公开。 '));
          const link = el('a', 'text-button', '查看推荐盘'); link.href = `#community/${encodeURIComponent(item.id)}`; status.append(link);
        } else status.textContent = '队伍已保存，公开后可在配队大全查看。';
      } catch (error) {
        if (closed) return;
        status.textContent = C.message(error);
        if (error.code === 'duplicate' && error.data?.status === 'approved' && error.data.existingId) {
          const link = el('a', 'text-button', ' 查看已收录的盘子'); link.href = `#community/${encodeURIComponent(error.data.existingId)}`; status.append(link);
        } else if (error.code === 'duplicate') status.textContent = '相同阵容已保存，暂不公开；不需要重复收录。';
        if (error.status === 401 || error.status === 403) loginLink(status);
      } finally {busy = false; if (!closed) update(true);}
    });
    connect();
  };
  C.openLike = async (item, ui, onLiked) => {
    const {el} = ui, modal = C.dialog(`为「${item.title}」点赞`, ui), host = modal.element;
    const notice = el('p', 'community-status', '同一盘、同一访客每天可点赞一次，以北京时间换日。'); notice.setAttribute('role', 'status');
    const verification = el('div', 'community-verification');
    const button = el('button', 'primary-button', '确认点赞'); button.type = 'button'; button.disabled = true;
    const retry = el('button', 'secondary-button', '重新连接社区'); retry.type = 'button'; retry.hidden = true;
    host.append(notice, verification, button, retry);
    let challenge, busy = false, closed = false, completed = false;
    modal.cleanup(() => {closed = true; challenge?.destroy();});
    async function connect() {
      retry.hidden = true;
      try {
        const config = await C.client.config(); if (closed) return;
        challenge?.destroy(); verification.replaceChildren();
        challenge = C.challenge(verification, config, 'like_team', ui, (valid) => {button.disabled = !valid || busy || completed;});
      } catch (error) {if (!closed) {notice.textContent = C.message(error); retry.hidden = false;}}
    }
    retry.addEventListener('click', connect);
    button.addEventListener('click', async () => {
      if (busy || completed) return;
      const turnstileToken = challenge?.take(); if (!turnstileToken) return;
      busy = true; button.disabled = true;
      try {
        const result = await C.client.request(`/teams/${encodeURIComponent(item.id)}/like`, {turnstileToken});
        completed = true; onLiked(result); if (!closed) notice.textContent = '点赞成功，谢谢你的推荐。';
      } catch (error) {
        if (error.code === 'already_liked') {completed = true; onLiked(error.data);}
        if (!closed) notice.textContent = C.message(error);
      } finally {
        busy = false; if (!closed) {challenge?.reset(); button.disabled = true; if (completed) verification.hidden = true;}
      }
    });
    connect();
  };
})();
