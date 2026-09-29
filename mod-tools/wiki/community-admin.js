/* Management uses verified server identity and revision checks, never a user-entered email. */
(() => {
  'use strict';
  function createApi(fetcher, protocol) {
    return async function request(path, body, method = body ? 'PATCH' : 'GET') {
      if (!/^https?:$/.test(protocol)) throw new Error('离线版不能登录管理员；请在已启用社区的公开网站管理推荐盘。');
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetcher(`/api/community${path}`, {method, credentials:'same-origin', signal:controller.signal,
          headers:{Accept:'application/json', ...(body ? {'Content-Type':'application/json'} : {})},
          ...(body ? {body:JSON.stringify(body)} : {})});
        let result;
        try {result = await response.json();} catch {throw new Error('此站尚未提供管理员服务，请确认社区已配置。');}
        if (!response.ok) throw Object.assign(new Error(result.message || '管理员操作暂时失败。'),
          {status:response.status, code:result.error});
        return result;
      } catch (error) {
        if (error.name === 'AbortError') throw new Error('连接超时，请重试；表单内容仍保留。');
        if (error instanceof TypeError) throw new Error('网络连接失败，请重试；表单内容仍保留。');
        throw error;
      } finally {clearTimeout(timer);}
    };
  }
  window.WFCommunityAdmin = {createApi};
  window.renderWikiCommunityAdmin = async function renderWikiCommunityAdmin(host, data, ui) {
    const {el} = ui, C = window.WFCommunity;
    const request = createApi(window.fetch.bind(window), window.location.protocol);
    const page = el('section', 'community-admin'), header = el('header', 'admin-header');
    const home = el('a', 'back-button', '‹ 返回配队社区'); home.href = '#community';
    const create = el('a', 'primary-button', '在编队模拟创建'); create.href = '#team';
    header.append(el('h1', '', '推荐配队管理'), home, create);
    const notice = el('p', 'admin-notice', '正在验证管理员身份…'); notice.setAttribute('role', 'status');
    const account = el('p', 'admin-account'), controls = el('div', 'admin-controls');
    const layout = el('div', 'admin-layout'), listHost = el('div', 'admin-list'), editorHost = el('div', 'admin-editor');
    editorHost.hidden = true; layout.append(listHost, editorHost); page.append(header, account, notice, controls, layout);
    host.replaceChildren(page);
    let config, serial = 0, nextCursor = '', statusFilter, more;
    const characters = new Map((data.characters || []).map((c) => [c.id, c]));
    const statusNames = {approved:'公开', hidden:'已隐藏', pending:'未公开'};
    function button(label, action, cls = 'secondary-button') {
      const node = el('button', cls, label); node.type = 'button'; node.addEventListener('click', action); return node;
    }
    function field(label, input) {
      const node = el('label', 'admin-field'); node.append(el('span', '', label), input); return node;
    }
    function select(values, current) {
      const node = el('select');
      values.forEach(([value, label]) => {const option = el('option', '', label); option.value = value; node.append(option);});
      node.value = current; return node;
    }
    function input(value, limit, multiline = false) {
      const node = el(multiline ? 'textarea' : 'input'); node.value = String(value || ''); node.maxLength = limit;
      if (multiline) node.rows = 5; else node.type = 'text'; return node;
    }
    function edit(item) {
      const team = C.teamCopy(item.team), form = el('form', 'admin-edit-form');
      const revision = Number(item.revision), warning = el('p', 'admin-edit-status'); warning.setAttribute('role', 'status');
      const title = input(item.title, 80), author = input(item.author, 40), notes = input(item.notes, 2000, true);
      title.required = true;
      const element = select([['auto','根据主位自动判断'],['universal','宇宙'], ...['火','水','雷','风','光','暗'].map((v) => [v,v])], item.element || 'auto');
      const status = select([['approved','公开'],['hidden','隐藏']], item.status === 'hidden' ? 'hidden' : 'approved');
      const heading = el('div', 'admin-edit-heading'); heading.append(el('h2', '', `编辑：${item.title}`),
        button('关闭编辑', () => {editorHost.replaceChildren(); editorHost.hidden = true;}));
      form.append(heading, el('p', 'admin-version', `当前版本 ${revision} · 保存时检查是否被其他管理员修改`),
        field('队伍标题', title), field('投稿者署名', author), field('队伍说明', notes));
      const meta = el('div', 'admin-edit-meta'); meta.append(field('属性分类', element), field('展示状态', status)); form.append(meta);
      const damages = el('fieldset', 'admin-damage'); damages.append(el('legend', '', '伤害分类（至少一项）'));
      const checks = Object.entries(C.damageTypes).map(([value,label]) => {
        const check = el('input'); check.type = 'checkbox'; check.value = value;
        check.checked = (item.damageTypes || []).includes(value); damages.append(field(label, check)); return check;
      });
      form.append(damages);
      const slots = el('div', 'admin-slots');
      for (const [group, label] of [['main','主位'],['unison','合击'],['weapon','武器'],['soul','魂珠']]) {
        const source = (group === 'main' || group === 'unison') ? data.characters : (data.equipment || []).filter((w) => group !== 'soul' || w.soul?.available);
        for (let index = 0; index < 3; index++) {
          const box = el('fieldset', 'admin-slot'); box.append(el('legend', '', `${label} ${index + 1}`));
          const search = input('', 100); search.type = 'search'; search.placeholder = '输入名称、主题或别名';
          search.setAttribute('aria-label', `搜索${label} ${index + 1}`);
          const choice = el('select'); choice.setAttribute('aria-label', `${label} ${index + 1}`);
          const hint = el('small', 'admin-slot-hint');
          const name = (entry) => [entry.name, entry.theme || entry.title, entry.element, entry.rarity && `${entry.rarity}星`].filter(Boolean).join(' · ');
          function choices() {
            const term = search.value.trim().toLocaleLowerCase();
            const matches = (source || []).filter((entry) => `${name(entry)} ${(entry.aliases || []).join(' ')}`.toLocaleLowerCase().includes(term));
            const shown = matches.slice(0, 60), id = team[group][index], current = (source || []).find((entry) => entry.id === id);
            if (current && !shown.includes(current)) shown.unshift(current);
            choice.replaceChildren(); const empty = el('option', '', '未选择'); empty.value = ''; choice.append(empty);
            shown.forEach((entry) => {const option = el('option', '', name(entry)); option.value = entry.id; choice.append(option);});
            if (id && !current) {const missing = el('option', '', '原条目不在当前图鉴，请重新选择'); missing.value = id; choice.append(missing);}
            choice.value = id; hint.textContent = matches.length > 60 ? `匹配 ${matches.length} 项，显示前 60 项；可继续输入缩小范围。` : `匹配 ${matches.length} 项`;
          }
          search.addEventListener('input', choices); choice.addEventListener('change', () => {team[group][index] = choice.value;});
          choices(); box.append(search, choice, hint); slots.append(box);
        }
      }
      form.append(slots, warning);
      const save = el('button', 'primary-button', '保存修改'); save.type = 'submit';
      const reload = button('重新加载列表', () => load(false)); reload.hidden = true; form.append(save, reload);
      let busy = false, conflict = false;
      form.addEventListener('submit', async (event) => {
        event.preventDefault(); if (busy || conflict) return;
        const damageTypes = checks.filter((check) => check.checked).map((check) => check.value);
        const invalid = !title.value.trim() ? '请填写队伍标题。' : !damageTypes.length ? '请至少选择一种伤害分类。' : C.teamError(team, data);
        if (invalid) {warning.textContent = invalid; return;}
        busy = true; save.disabled = true; warning.textContent = '正在保存…';
        try {
          const result = await request(`/admin/teams/${encodeURIComponent(item.id)}`, {expectedRevision:revision,
            title:title.value.trim(), author:author.value.trim(), notes:notes.value.trim(), team:C.teamCopy(team),
            element:element.value, damageTypes, status:status.value});
          if (!result.team || Number(result.team.revision) <= revision) throw new Error('服务端未返回更新版本，请重新加载列表核实。');
          if (!page.isConnected) return;
          await load(false); notice.textContent = `已保存「${result.team.title}」，当前版本 ${result.team.revision}。`;
        } catch (error) {
          if (error.code === 'edit_conflict') {
            conflict = true; reload.hidden = false;
            warning.textContent = '这张盘已被其他管理员修改。你的输入仍保留，保存已暂停；请重新加载列表后再编辑，避免覆盖他人的修改。';
          } else warning.textContent = C.message(error);
        } finally {busy = false; save.disabled = conflict;}
      });
      editorHost.replaceChildren(form); editorHost.hidden = false;
    }
    function row(item) {
      const node = el('article', 'admin-team-row');
      node.append(el('h2', '', item.title), el('p', 'admin-team-meta',
        `${statusNames[item.status] || item.status} · 版本 ${item.revision} · ${item.author || '未署名'} · ${C.elementLabel(item.element)}`),
      el('p', 'admin-team-main', (item.team?.main || []).map((id) => characters.get(id)?.name || '未收录角色').join(' / ')),
      button(item.status === 'hidden' ? '编辑 / 恢复公开' : '编辑 / 隐藏', () => edit(item)));
      if (window.WFCommunityGameCodes) node.append(window.WFCommunityGameCodes.controls(item, ui, request));
      return node;
    }
    async function load(append) {
      const ticket = ++serial; more.disabled = true;
      if (!append) {editorHost.replaceChildren(); editorHost.hidden = true; listHost.replaceChildren(); nextCursor = '';}
      notice.textContent = '正在载入推荐盘…';
      const params = new URLSearchParams({status:statusFilter.value, sort:'latest'});
      if (append && nextCursor) params.set('cursor', nextCursor);
      try {
        const result = await request(`/admin/teams?${params}`);
        if (!page.isConnected || ticket !== serial) return;
        if (!Array.isArray(result.items)) throw new Error('管理员列表格式无效，请重试。');
        result.items.forEach((item) => listHost.append(row(item)));
        nextCursor = result.nextCursor || ''; more.hidden = !nextCursor;
        notice.textContent = listHost.childElementCount ? '选择推荐盘进行修改；公开盘的修改保存后立即生效。' : '当前分类没有推荐盘。';
      } catch (error) {
        if (page.isConnected && ticket === serial) {notice.textContent = C.message(error); more.hidden = false;}
      } finally {if (ticket === serial) more.disabled = false;}
    }
    async function start() {
      try {
        config = await request('/config');
        if (!config.enabled) throw new Error('此站暂未启用社区，管理员功能不可用。');
        const identity = await request('/admin/me');
        if (!page.isConnected) return;
        if (!identity.id || !identity.email) throw new Error('未取得有效管理员身份，请重新登录。');
        account.textContent = `${config.development === true ? '本机测试身份 · ' : '已验证管理员 · '}${identity.email}`;
        await window.WFWikiData?.loadEquipment();
        if (!page.isConnected) return;
        statusFilter = select([['approved','公开'],['hidden','已隐藏'],['','全部']], 'approved');
        statusFilter.addEventListener('change', () => load(false));
        more = button('继续加载 / 重试', () => load(true)); more.hidden = true;
        controls.replaceChildren(field('查看状态', statusFilter), button('刷新列表', () => load(false)), more);
        await load(false);
      } catch (error) {
        if (!page.isConnected) return;
        notice.textContent = error.code === 'admin_auth_required' ? '请使用获授权的管理员账号登录。' : C.message(error);
        controls.replaceChildren();
        if (error.code === 'admin_auth_required') {
          const login = el('a', 'primary-button', '登录管理员'); login.href = '/api/community/admin/login'; controls.append(login);
          if (config?.development === true && ['localhost','127.0.0.1','[::1]'].includes(window.location.hostname)) {
            const dev = button('本机测试：登录测试管理员', async () => {
              dev.disabled = true;
              try {await request('/development-admin-login', {}, 'POST'); await start();}
              catch (failure) {notice.textContent = C.message(failure); dev.disabled = false;}
            }); controls.append(dev);
          }
        } else controls.append(button('重新检查服务', start));
      }
    }
    await start();
  };
})();
