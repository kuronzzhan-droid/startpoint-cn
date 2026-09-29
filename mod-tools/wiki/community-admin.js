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
    const {el} = ui, C = window.WFCommunity, initialTarget = C.adminTarget; delete C.adminTarget;
    const fallback = createApi(window.fetch.bind(window), window.location.protocol);
    const request = (path, body, method = body ? 'PATCH' : 'GET') => C.client ? C.client.request(path, body, method) : fallback(path, body, method);
    const page = el('section', 'community-admin'), header = el('header', 'admin-header');
    const home = el('a', 'back-button', '‹ 返回配队社区'); home.href = '#community';
    const create = el('a', 'primary-button', '在编队模拟创建'); create.href = '#team';
    header.append(el('h1', '', '推荐配队管理'), home, create);
    const notice = el('p', 'admin-notice', '正在验证管理员身份…'); notice.setAttribute('role', 'status');
    const account = el('p', 'admin-account'), authHost = el('div', 'admin-auth'), controls = el('div', 'admin-controls');
    const layout = el('div', 'admin-layout'), listHost = el('div', 'admin-list'), editorHost = el('div', 'admin-editor');
    editorHost.hidden = true; layout.append(listHost, editorHost); page.append(header, account, authHost, notice, controls, layout);
    host.replaceChildren(page);
    let config, identity, serial = 0, nextCursor = '', statusFilter, categoryFilter, sectionFilter, scopeFilter, codeFilter, more;
    const characters = new Map((data.characters || []).map((c) => [c.id, c]));
    const statusNames = {approved:'正常', hidden:'已隐藏 / 停用', pending:'未启用'};
    function button(label, action, cls = 'secondary-button') {
      const node = el('button', cls, label); node.type = 'button'; node.addEventListener('click', action); return node;
    }
    function field(label, input) {
      input.setAttribute('aria-label', label);
      const node = el('label', 'admin-field'); node.append(el('span', '', label), input); return node;
    }
    function select(values, current) {
      const node = el('select');
      values.forEach(([value, label]) => {const option = el('option', '', label); option.value = value; node.append(option);});
      node.value = current; return node;
    }
    function edit(item) {
      if (!window.WFCommunityAdminEditor) {notice.textContent = '编辑模块未加载，请刷新页面。'; return;}
      const form = window.WFCommunityAdminEditor.create({item, identity, config, data, ui, request,
        onClose: () => {editorHost.replaceChildren(); editorHost.hidden = true;}, onReload: () => load(false),
        onSaved: async (saved) => {await load(false); if (!page.isConnected) return;
          edit(saved); notice.textContent = `已保存「${saved.title}」，当前版本 ${saved.revision}。`;}});
      editorHost.replaceChildren(form); editorHost.hidden = false;
    }
    function row(item) {
      const node = el('article', 'admin-team-row');
      node.append(el('h2', '', item.title), el('p', 'admin-team-meta',
        `${item.visibility === 'private' ? '私有' : '配队大全'} · ${statusNames[item.status] || item.status} · ${C.sectionLabel(item.section)} · ${C.categoryLabel(item.category)} · 版本 ${item.revision} · ${item.author || '未署名'} · ${C.elementLabel(item.element)}`),
      el('p', 'admin-team-main', (item.team?.main || []).map((id) => characters.get(id)?.name || '未收录角色').join(' / ')),
      el('p', 'admin-team-meta', item.gameCode && item.status === 'approved' ? '已有队伍码' : '暂无队伍码'),
      button('编辑 / 管理队伍码', () => edit(item)));
      return node;
    }
    async function load(append) {
      const ticket = ++serial; more.disabled = true;
      if (!append) {editorHost.replaceChildren(); editorHost.hidden = true; listHost.replaceChildren(); nextCursor = '';}
      notice.textContent = '正在载入推荐盘…';
      const params = new URLSearchParams({status:statusFilter.value, sort:'latest'});
      if (categoryFilter.value) params.set('category', categoryFilter.value);
      if (sectionFilter.value) params.set('section', sectionFilter.value);
      params.set('scope', scopeFilter.value);
      if (codeFilter.value) params.set('code', codeFilter.value);
      if (append && nextCursor) params.set('cursor', nextCursor);
      try {
        const result = await request(`/admin/teams?${params}`);
        if (!page.isConnected || ticket !== serial) return;
        if (!Array.isArray(result.items)) throw new Error('管理员列表格式无效，请重试。');
        result.items.forEach((item) => listHost.append(row(item)));
        nextCursor = result.nextCursor || ''; more.hidden = !nextCursor;
        notice.textContent = listHost.childElementCount ? '选择队伍编辑，保存后可单独公开队伍码。私有队伍仅本人及站长、副站长可见。' : '当前筛选下没有队伍。';
      } catch (error) {
        if (page.isConnected && ticket === serial) {notice.textContent = C.message(error); more.hidden = false;}
      } finally {if (ticket === serial) more.disabled = false;}
    }
    async function start() {
      serial++; account.textContent = ''; controls.replaceChildren(); listHost.replaceChildren(); editorHost.replaceChildren();
      create.hidden = true; controls.hidden = true; layout.hidden = true; notice.textContent = '正在验证管理员身份…';
      try {
        config = await request('/config');
        if (!config.enabled) throw new Error('此站暂未启用社区，管理员功能不可用。');
        if (!page.isConnected) return;
        if (config.authMode === 'password' && !window.WFCommunityAuth) throw new Error('登录模块未加载，请刷新页面后重试。');
        identity = config.authMode === 'password' ? await window.WFCommunityAuth.ensure(authHost, config, ui, start) : await request('/admin/me');
        if (!page.isConnected) return;
        if (!identity) {notice.textContent = ''; return;}
        if (!identity.id || !identity.email) throw new Error('未取得有效管理员身份，请重新登录。');
        const prefix = config.authMode === 'password' ? (config.development ? '本机账号' : '已登录') : (config.development ? '本机测试身份' : '已验证管理员');
        account.textContent = `${prefix} · ${identity.email}${identity.role === 'owner' ? ' · 站长' : identity.role === 'deputy' ? ' · 副站长' : ''}`;
        if (config.authMode === 'password') window.WFCommunityAuth.controls(authHost, identity, ui, start);
        await window.WFWikiData?.loadEquipment();
        if (!page.isConnected) return;
        create.hidden = false; controls.hidden = false; layout.hidden = false;
        statusFilter = select([['approved','正常'],['hidden','已隐藏 / 停用'],['','全部']], 'approved');
        statusFilter.addEventListener('change', () => load(false));
        categoryFilter = select([['','全部分类'], ...C.teamCategories.map((value) => [value,value]), ['uncategorized','未分类']], '');
        categoryFilter.addEventListener('change', () => load(false));
        sectionFilter = select([['','全部玩法'], ...Object.entries(C.teamSections).filter(([value]) => value), ['general',C.sectionLabel('')]], '');
        sectionFilter.addEventListener('change', () => load(false));
        scopeFilter = select([['all','全部可见队伍'],['public','配队大全'],['mine','我的空间'],
          ...(['owner','deputy'].includes(identity.role) ? [['private','全部私有队伍']] : [])], initialTarget?.scope === 'mine' ? 'mine' : 'all');
        scopeFilter.addEventListener('change', () => load(false));
        codeFilter = select([['','全部队伍码状态'],['has','已有队伍码'],['none','暂无队伍码']], '');
        codeFilter.addEventListener('change', () => load(false));
        more = button('继续加载 / 重试', () => load(true)); more.hidden = true;
        controls.replaceChildren(field('查看空间', scopeFilter), field('队伍码状态', codeFilter), field('查看状态', statusFilter),
          field('查看玩法分区', sectionFilter), field('查看配队分类', categoryFilter), button('刷新列表', () => load(false)), more);
        await load(false);
        if (initialTarget?.id && page.isConnected) {
          const result = await request(`/admin/teams/${encodeURIComponent(initialTarget.id)}`);
          if (page.isConnected && result.team) edit(result.team);
        }
      } catch (error) {
        if (!page.isConnected) return;
        notice.textContent = error.code === 'admin_auth_required' ? '请使用获授权的管理员账号登录。' : C.message(error);
        controls.replaceChildren(); controls.hidden = false;
        if (error.code === 'admin_auth_required' && config?.authMode !== 'password') {
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
