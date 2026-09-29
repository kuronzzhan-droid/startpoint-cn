/* Administrator-maintained nicknames are stored separately from exported game data. */
(() => {
  'use strict';
  const records = new Map(), listeners = new Map();
  let pending, loadedAt = 0, editVersion = 0;
  const key = (kind, id) => `${kind}:${id}`;
  const request = (...args) => window.WFCommunity.client.request(...args);
  const valid = (item) => item && ['character', 'weapon'].includes(item.kind) && typeof item.id === 'string'
    && Array.isArray(item.aliases) && item.aliases.every(alias => typeof alias === 'string');
  function announce() {
    for (const [host, callback] of listeners) {
      if (host.isConnected) callback(); else listeners.delete(host);
    }
  }
  async function load(force = false) {
    if (pending) return pending;
    if (!force && loadedAt && Date.now() - loadedAt < 60000) return;
    const version = editVersion;
    pending = request('/aliases').then(value => {
      if (!Array.isArray(value.items)) throw new Error('黑话资料暂时无法载入。');
      if (version !== editVersion) return;
      records.clear(); value.items.filter(valid).forEach(item => records.set(key(item.kind, item.id), item));
      loadedAt = Date.now(); announce();
    }).finally(() => {pending = null;});
    return pending;
  }
  const values = (kind, id) => records.get(key(kind, id))?.aliases || [];
  function watch(host, callback) {
    for (const item of listeners.keys()) if (!item.isConnected) listeners.delete(item);
    listeners.set(host, callback);
    load().then(() => {if (host.isConnected) callback();}).catch(() => {});
  }
  function mount(host, kind, id, ui) {
    const {el} = ui, panel = el('section', 'wiki-aliases');
    const heading = el('div', 'wiki-aliases-heading'), label = el('strong', '', '黑话');
    const edit = el('button', 'text-button', '编辑黑话'); edit.type = 'button'; edit.hidden = true;
    heading.append(label, edit);
    const shown = el('p', 'wiki-aliases-values', '正在载入…');
    const status = el('p', 'wiki-aliases-status'); status.setAttribute('role', 'status');
    const retry = el('button', 'text-button', '重新载入'); retry.type = 'button'; retry.hidden = true;
    const holder = el('div');
    panel.append(heading, shown, status, retry, holder); host.append(panel);
    const paint = () => {shown.textContent = values(kind, id).join(' / ') || '暂未填写';};
    const refresh = async () => {
      try {await load(true); paint(); status.textContent = ''; retry.hidden = true;}
      catch {shown.textContent = '暂未载入'; status.textContent = '黑话资料暂时无法载入。'; retry.hidden = false;}
    };
    retry.addEventListener('click', refresh);
    watch(panel, paint);
    load().then(paint).catch(() => {shown.textContent = '暂未载入'; retry.hidden = false;});
    request('/admin/me').then(actor => {edit.hidden = !(actor?.id && actor?.email);}).catch(() => {});
    edit.addEventListener('click', async () => {
      edit.disabled = true; status.textContent = '正在载入可编辑资料…';
      const path = `/admin/aliases/${kind}/${encodeURIComponent(id)}`;
      try {
        const current = await request(path);
        const form = el('form', 'wiki-aliases-form');
        const field = el('label', '', '黑话（每行一个，也可用逗号分隔）');
        const input = el('textarea'); input.rows = 3; input.maxLength = 500;
        input.setAttribute('aria-label', '编辑黑话内容'); input.value = current.aliases.join('\n'); field.append(input);
        const help = el('small', '', '最多 12 个，每个最多 32 字；留空保存可清除。');
        const actions = el('div', 'wiki-aliases-actions');
        const save = el('button', 'primary-button', '保存黑话'); save.type = 'submit';
        const cancel = el('button', 'secondary-button', '取消'); cancel.type = 'button';
        cancel.addEventListener('click', () => {holder.replaceChildren(); edit.disabled = false; status.textContent = '';});
        actions.append(save, cancel); form.append(field, help, actions); holder.replaceChildren(form);
        status.textContent = ''; input.focus();
        let conflict = false, busy = false;
        form.addEventListener('submit', async event => {
          event.preventDefault(); if (busy || conflict) return;
          busy = true; save.disabled = true; cancel.disabled = true;
          const aliases = input.value.split(/[\n,，、]/).map(value => value.trim()).filter(Boolean);
          try {
            const updated = await request(path, {aliases, expectedRevision: current.revision}, 'PATCH');
            if (!valid(updated)) throw new Error('返回资料异常，请重新载入确认。');
            editVersion++; records.set(key(kind, id), updated); announce(); paint();
            holder.replaceChildren(); edit.disabled = false; status.textContent = '黑话已保存。';
          } catch (error) {
            conflict = error.status === 409;
            status.textContent = conflict ? '其他管理员已修改黑话，请取消并重新编辑。当前输入仍保留。'
              : window.WFCommunity.message(error);
            save.disabled = conflict;
          } finally {busy = false; cancel.disabled = false;}
        });
      } catch (error) {status.textContent = window.WFCommunity.message(error); edit.disabled = false;}
    });
    return panel;
  }
  window.WFWikiAliases = {load, values, watch, mount};
})();
