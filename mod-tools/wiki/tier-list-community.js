/* Public tiers are server-owned; editing a local board never submits a vote. */
(() => {
  'use strict';
  const rowKeys = ['tier0', 'between0', 'tier1', 'between1', 'tier2', 'between2', 'tier3', 'between3', 'tier4'];
  const labels = ['夯', '夯 ↔ 顶级', '顶级', '顶级 ↔ 人上人', '人上人', '人上人 ↔ NPC', 'NPC', 'NPC ↔ 拉完了', '拉完了'];
  const score = (value) => Number.isFinite(value) && value >= 0 && value <= 5;
  const votes = (value) => Number.isSafeInteger(value) && value >= 0;
  function publicRecord(value) {
    if (!value || !Array.isArray(value.items) || value.formula?.placementWeight !== 0.7 || value.formula?.ratingWeight !== 0.3)
      throw new Error('综合排行资料异常，请重新载入。');
    const seen = new Set();
    for (const item of value.items) {
      if (!item || typeof item.id !== 'string' || seen.has(item.id) || !rowKeys.includes(item.row) || !score(item.compositeScore)
        || !votes(item.placementVoters) || !votes(item.ratingVoters)
        || (item.placementVoters ? !score(item.placementAverage) : item.placementAverage !== null)
        || (item.ratingVoters ? !score(item.ratingAverage) : item.ratingAverage !== null)
        || !Array.isArray(item.missingSources) || item.missingSources.some(source => !['placement', 'rating'].includes(source))
        || item.missingSources.includes('placement') !== (item.placementVoters === 0)
        || item.missingSources.includes('rating') !== (item.ratingVoters === 0)
        || (!item.placementVoters && !item.ratingVoters)) throw new Error('综合排行资料异常，请重新载入。');
      seen.add(item.id);
    }
    return value;
  }
  function personalRecord(value) {
    if (!value || typeof value.submittedToday !== 'boolean' || !Number.isFinite(value.nextVoteAt) || value.nextVoteAt <= 0
      || !votes(value.rankedCharacters) || value.challengeAction !== 'submit_tier_ranking'
      || !value.rows || rowKeys.some(row => !Array.isArray(value.rows[row]) || value.rows[row].some(id => typeof id !== 'string')))
      throw new Error('无法确认今天的提交状态，请重新连接。');
    return value;
  }
  const nextTime = (value) => `北京时间 ${new Date(value.nextVoteAt).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })} 后可再次提交。`;
  function create({host, data, ui, state, onViewChange = () => {}}) {
    const {el, nativeIcon} = ui, C = window.WFCommunity;
    const characters = data.characters || [], byId = new Map(characters.map(character => [String(character.id), character]));
    const element = el('section', 'tier-community'), tabs = el('div', 'tier-community-tabs');
    tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '选择个人或大家排行');
    const mineHost = el('div', 'tier-personal-view'), dynamicHost = el('div', 'tier-public-view');
    mineHost.id = 'tier-personal-view'; dynamicHost.id = 'tier-public-view';
    mineHost.setAttribute('role', 'tabpanel'); dynamicHost.setAttribute('role', 'tabpanel');
    const mineTab = el('button', '', '我的排行'), publicTab = el('button', '', '大家排行');
    [mineTab, publicTab].forEach((button, index) => {
      button.type = 'button'; button.id = index ? 'tier-public-tab' : 'tier-personal-tab'; button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', index ? dynamicHost.id : mineHost.id); tabs.append(button);
      button.addEventListener('click', () => setView(index ? 'community' : 'mine'));
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
        setView(next ? 'community' : 'mine'); [mineTab, publicTab][next].focus();
      });
    });
    mineHost.setAttribute('aria-labelledby', mineTab.id); dynamicHost.setAttribute('aria-labelledby', publicTab.id);
    const submitBar = el('div', 'tier-submit-bar'), submit = el('button', 'primary-button', '提交我的排行'); submit.type = 'button';
    const mineStatus = el('span', 'tier-submit-status'); mineStatus.setAttribute('role', 'status');
    submitBar.append(submit, mineStatus);
    const publicToolbar = el('div', 'tier-public-toolbar'), avatarHost = el('div');
    const refresh = el('button', 'secondary-button', '刷新大家排行'); refresh.type = 'button';
    publicToolbar.append(avatarHost, refresh);
    const description = el('p', 'tier-public-formula', '综合得分 = 玩家手排均分 × 70% + 角色评分 × 30%。缺一项时暂按已有一项显示；两项都没有的角色暂不入榜。');
    const publicStatus = el('p', 'tier-public-status'); publicStatus.setAttribute('role', 'status');
    const elementFilters = el('div', 'tier-public-elements'); elementFilters.setAttribute('role', 'group'); elementFilters.setAttribute('aria-label', '综合排行属性');
    const results = el('div', 'tier-public-results'), elementButtons = [];
    dynamicHost.append(publicToolbar, description, elementFilters, publicStatus, results);
    element.append(tabs, submitBar, mineHost, dynamicHost); host.append(element);
    let view = 'mine', revision = 0, portraits, dialogOpen = false, submitted, cached, elementFilter = '';
    ['', '火', '水', '雷', '风', '光', '暗'].forEach(value => {
      const button = el('button', 'tier-public-element'); button.type = 'button';
      button.setAttribute('aria-label', value ? `${value}属性排行` : '全体角色总榜');
      if (value) button.append(nativeIcon('elements', value, value)); button.append(el('span', '', value || '总榜'));
      button.setAttribute('aria-pressed', String(value === elementFilter));
      button.addEventListener('click', () => {
        elementFilter = value; elementButtons.forEach(entry => entry.button.setAttribute('aria-pressed', String(entry.value === value)));
        if (cached) renderPublic(cached);
      });
      elementButtons.push({button, value}); elementFilters.append(button);
    });
    const online = () => Boolean(C?.client && C?.dialog && C?.challenge && /^https?:$/.test(window.location?.protocol));
    const message = error => error?.status === 401 ? '无法确认访客身份，请刷新页面后重试。'
      : C?.message?.(error) || error?.message || '排行服务暂时不可用，请重试。';
    function refreshState() {
      const count = Object.values(state.getRows()).reduce((total, ids) => total + ids.length, 0);
      submit.disabled = dialogOpen || !online();
      mineStatus.textContent = !online() ? '离线版可以自由排行；请到在线网站提交。'
        : submitted?.submittedToday ? `今天已提交 ${submitted.rankedCharacters} 位角色。${nextTime(submitted)}`
        : count ? `本地已排 ${count} 位角色；点击提交才计入大家排行。` : '尚未放置角色；提交空榜可撤回自己之前的手排票。';
    }
    function renderPublic(value) {
      const items = value.items.filter(item => byId.has(item.id) && (!elementFilter || byId.get(item.id).element === elementFilter));
      const board = el('div', 'tier-board tier-public-board');
      rowKeys.forEach((key, index) => {
        const between = key.startsWith('between'), row = el('section', `tier-zone ${between ? 'tier-boundary' : `tier-row tier-row-${index / 2}`}`);
        const slots = el('div', 'tier-slots'); row.append(el(between ? 'span' : 'h2', 'tier-label', labels[index]), slots);
        items.filter(item => item.row === key).forEach(item => {
          const character = byId.get(item.id), card = el('a', 'tier-public-card'); card.href = `#character/${encodeURIComponent(item.id)}`;
          const portrait = el('span', 'tier-avatar'); portrait.append(portraits.picture(character, '', ''), nativeIcon('elements', character.element, character.element, 'tier-avatar-element'));
          window.WFCharacterFrame?.apply(portrait, character);
          const title = `${character.name}${character.theme ? `（${character.theme}）` : ''}`;
          const counts = `手排 ${item.placementVoters} 人 · 评分 ${item.ratingVoters} 人`;
          const missing = item.missingSources.includes('placement') ? '仅评分 · 暂无手排' : item.missingSources.includes('rating') ? '仅手排 · 暂无评分' : '';
          const averages = `手排均分 ${item.placementAverage === null ? '暂无' : item.placementAverage.toFixed(2)}；角色评分 ${item.ratingAverage === null ? '暂无' : item.ratingAverage.toFixed(2)}`;
          card.title = `${title} · 综合 ${item.compositeScore.toFixed(2)} / 5 · ${counts} · ${averages}${missing ? ` · ${missing}` : ''}`;
          card.setAttribute('aria-label', card.title);
          const text = el('span', 'tier-public-card-text'); text.append(el('strong', 'tier-public-score', item.compositeScore.toFixed(2)),
            el('span', 'tier-public-name', title), el('small', 'tier-public-counts', counts));
          if (missing) text.append(el('small', 'tier-public-missing', missing));
          card.append(portrait, text); slots.append(card);
        });
        if (!slots.children.length) slots.append(el('span', 'tier-placeholder', '暂无角色'));
        board.append(row);
      });
      results.replaceChildren(board);
      publicStatus.textContent = items.length ? `${elementFilter ? `${elementFilter}属性榜 · ` : '总榜 · '}${items.length} 位角色已有玩家评价；点击头像可查看角色详情。`
        : `${elementFilter ? `${elementFilter}属性暂时` : '目前'}还没有玩家提交手排或角色评分。你可以先完成自己的排行并提交。`;
    }
    async function loadPublic() {
      const ticket = ++revision; cached = undefined; refresh.disabled = true; results.replaceChildren(); publicStatus.textContent = '正在载入大家排行…';
      if (!C?.client || !/^https?:$/.test(window.location?.protocol)) {
        publicStatus.textContent = '离线版无法读取大家排行，请前往在线网站查看。'; refresh.disabled = true; return;
      }
      try {
        const value = publicRecord(await C.client.request('/tier-rankings'));
        if (ticket === revision && view === 'community' && element.isConnected) {cached = value; renderPublic(value);}
      } catch (error) {
        if (ticket === revision && view === 'community' && element.isConnected) publicStatus.textContent = `${message(error)} 点击“刷新大家排行”重试。`;
      } finally {if (ticket === revision) refresh.disabled = false;}
    }
    function setView(next) {
      const changed = view !== next; view = next === 'community' ? 'community' : 'mine';
      const mine = view === 'mine'; mineHost.hidden = !mine; submitBar.hidden = !mine; dynamicHost.hidden = mine;
      [mineTab, publicTab].forEach((tab, index) => {tab.setAttribute('aria-selected', String(mine === !index)); tab.tabIndex = mine === !index ? 0 : -1;});
      onViewChange(view);
      if (mine) {revision++; refreshState(); return;}
      if (!portraits) portraits = window.WFCatalogAvatars.create({host: avatarHost, catalog: dynamicHost, characters, ui, label: '大家排行角色头像'});
      if (changed || !results.children.length) loadPublic();
    }
    async function openSubmit() {
      if (dialogOpen || !online()) return;
      const rows = state.getRows(), count = Object.values(rows).reduce((total, ids) => total + ids.length, 0);
      const modal = C.dialog(count ? '提交我的排行' : '撤回自己的手排票', ui), dialog = modal.element;
      dialogOpen = true; refreshState();
      dialog.append(el('p', 'tier-submit-preview', count ? `将提交当前 ${count} 位角色的位置。未摆放的角色不计票。` : '当前排行为空，提交后会撤回你之前全部手排票。'),
        el('p', 'tier-submit-policy', '每天可提交一次（北京时间换日）。本次提交会替换自己的整份旧排行，每位玩家对每个角色只占一票。'));
      const notice = el('p', 'tier-submit-notice', '正在确认今日提交状态…'); notice.setAttribute('role', 'status');
      const verification = el('div', 'community-verification'), confirm = el('button', 'primary-button', count ? '验证后确认提交' : '验证后确认撤回'); confirm.type = 'button';
      const retry = el('button', 'secondary-button', '重新连接排行服务'); retry.type = 'button'; retry.hidden = true;
      dialog.append(notice, verification, confirm, retry);
      let closed = false, busy = false, completed = false, ready = false, challenge, personal;
      const sync = () => {confirm.disabled = !ready || busy || completed || Boolean(personal?.submittedToday);};
      sync(); modal.cleanup(() => {closed = true; challenge?.destroy(); dialogOpen = false; refreshState();});
      async function connect() {
        challenge?.destroy(); challenge = undefined; verification.replaceChildren();
        ready = false; sync(); retry.hidden = true; notice.textContent = '正在确认今日提交状态…';
        try {
          personal = personalRecord(await C.client.request('/tier-rankings/me')); if (closed) return;
          submitted = personal; refreshState();
          if (personal.submittedToday) {notice.textContent = `今天已提交过排行。${nextTime(personal)}`; completed = true; sync(); return;}
          const config = await C.client.config(); if (closed) return;
          challenge?.destroy(); verification.replaceChildren();
          challenge = C.challenge(verification, config, personal.challengeAction, ui, valid => {ready = valid; sync();});
          notice.textContent = '请完成验证，再确认提交。';
        } catch (error) {if (!closed) {notice.textContent = message(error); retry.hidden = false;}}
      }
      retry.addEventListener('click', connect);
      confirm.addEventListener('click', async () => {
        if (closed || busy || completed || personal?.submittedToday) return;
        const turnstileToken = challenge?.take(); if (!turnstileToken) return;
        busy = true; sync(); notice.textContent = '正在提交排行…';
        try {
          const value = personalRecord(await C.client.request('/tier-rankings', {rows, turnstileToken}));
          if (!value.submittedToday || value.rankedCharacters !== count) throw new Error('服务端尚未确认本次排行，请重新连接核实。');
          submitted = value; completed = true;
          if (!closed) {notice.textContent = `${count ? '排行已提交，大家排行已更新。' : '已撤回之前的手排票。'}${nextTime(value)}`; verification.hidden = true;}
          if (element.isConnected && view === 'community') loadPublic();
        } catch (error) {
          if (error?.code === 'already_ranked' || error?.code === 'daily_limit') {
            completed = true;
            try {submitted = personalRecord(error.data);} catch { /* Reopening checks the authoritative daily state. */ }
            if (!closed) {notice.textContent = `今天已提交过排行。${submitted ? nextTime(submitted) : '请明天（北京时间）再试。'}`; verification.hidden = true;}
          } else if (!closed) {notice.textContent = message(error); retry.hidden = false;}
        } finally {busy = false; refreshState(); if (!closed) {challenge?.reset(); ready = false; sync();}}
      });
      connect();
    }
    submit.addEventListener('click', openSubmit); refresh.addEventListener('click', loadPublic); setView('mine');
    return {element, mineHost, refreshState, setView};
  }
  window.WFTierListCommunity = {create};
})();
