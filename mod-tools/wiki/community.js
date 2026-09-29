/* Server-published recommendations with compact, directly linked team plates. */
(() => {
  'use strict';
  const C = window.WFCommunity;
  const groupNames = {main: '主位', unison: '合击', weapon: '装备', soul: '魂珠'};
  C.board = (input, data, ui) => {
    const {el, picture} = ui, team = C.teamCopy(input);
    const characters = new Map((data.characters || []).map((item) => [item.id, item]));
    const equipment = new Map((data.equipment || []).map((item) => [item.id, item]));
    const board = el('div', 'community-board'); board.setAttribute('aria-label', '队伍阵容');
    for (let index = 0; index < 3; index++) {
      const column = el('div', 'community-board-column');
      for (const group of ['main', 'weapon', 'soul', 'unison']) {
        const character = group === 'main' || group === 'unison';
        const item = (character ? characters : equipment).get(team[group][index]);
        const slot = el(item ? 'a' : 'span', `community-slot community-slot-${group}`);
        slot.setAttribute('aria-label', `${index + 1}号${groupNames[group]}：${item?.name || (team[group][index] ? '当前图鉴未收录' : '空位')}`);
        if (item) {
          slot.href = `#${character ? 'character' : 'weapon'}/${encodeURIComponent(item.id)}`; slot.title = `${groupNames[group]} · ${item.name}`;
          slot.append(picture(item.icon, item.name, 'community-slot-image'));
          if (character) window.WFCharacterFrame?.apply(slot, item);
        } else slot.append(el('span', '', team[group][index] ? '?' : '—'));
        slot.append(el('span', 'community-slot-label', index === 0 && group === 'main' ? '队长' : groupNames[group])); column.append(slot);
      }
      board.append(column);
    }
    return board;
  };
  C.source = (ui) => {
    const line = ui.el('p', 'community-source', '资料参考：');
    const link = ui.el('a', 'text-button', '腾讯文档《配队大全》（原表）'); link.href = C.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
    line.append(link); return line;
  };
  window.renderWikiCommunity = async (host, data, ui, options = {}) => {
    const {el} = ui, startingHash = location.hash;
    let revision = 0, nextCursor = '', config;
    const filters = {element: '', damageTypes: [], sort: 'latest'};
    const intro = el('p', 'section-intro', '由管理员维护的推荐队伍。点击头像查资料，装入编成后按需调整，也可以为实用的盘子点赞。');
    const toolbar = el('div', 'community-toolbar');
    const element = el('select'); element.setAttribute('aria-label', '推荐队伍属性');
    const all = el('option', '', '全部属性'); all.value = ''; element.append(all);
    const sort = el('select'); sort.setAttribute('aria-label', '推荐队伍排序');
    [['latest', '最新收录'], ['popular', '最多点赞']].forEach(([value, label]) => {const option = el('option', '', label); option.value = value; sort.append(option);});
    const edit = el('a', 'primary-button', '本地配队模拟'); edit.href = '#team';
    const admin = el('a', 'text-button', '管理员入口'); admin.href = '#community/admin';
    toolbar.append(element, sort, edit, admin);
    const damage = el('fieldset', 'community-damage-options'); damage.append(el('legend', '', '伤害类型（多选时同时满足）'));
    Object.entries(C.damageTypes).forEach(([value, label]) => {
      const wrap = el('label', 'community-check'), input = el('input'); input.type = 'checkbox'; input.value = value;
      input.addEventListener('change', () => {filters.damageTypes = [...damage.querySelectorAll('input:checked')].map((node) => node.value); load();});
      wrap.append(input, el('span', '', label)); damage.append(wrap);
    });
    const status = el('p', 'community-status'); status.setAttribute('role', 'status');
    const cards = el('div', 'community-grid');
    const more = el('button', 'secondary-button community-more', '加载更多'); more.type = 'button'; more.hidden = true;
    const retry = el('button', 'secondary-button', '重试连接'); retry.type = 'button'; retry.hidden = true;
    host.replaceChildren(el('h1', '', options.id ? '推荐队伍' : '配队大全'), intro, toolbar, damage, status, cards, more, retry, C.source(ui));
    if (options.id) {toolbar.hidden = true; damage.hidden = true; const back = el('a', 'back-button', '‹ 返回配队大全'); back.href = '#community'; host.prepend(back);}
    const current = (ticket) => cards.isConnected && revision === ticket && location.hash === startingHash;
    function card(item) {
      const node = el('article', 'community-card');
      const heading = el('h2'); const link = el('a', '', item.title); link.href = `#community/${encodeURIComponent(item.id)}`; heading.append(link);
      const badges = el('div', 'community-tags'); badges.append(el('span', 'badge', C.elementLabel(item.element)));
      (item.damageTypes || []).filter((key) => C.damageTypes[key]).forEach((key) => badges.append(el('span', 'badge', C.damageTypes[key])));
      const date = new Date(item.createdAt), time = el('time', 'muted', Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN', {timeZone: 'Asia/Shanghai'}));
      if (!Number.isNaN(date.getTime())) time.dateTime = date.toISOString();
      node.append(heading, badges, C.board(item.team, data, ui), el('p', 'community-author', `作者：${item.author}`), time);
      if (item.notes) {const notes = el('details', 'community-notes'); notes.open = Boolean(options.id); notes.append(el('summary', '', '用途与操作说明'), el('p', '', item.notes)); node.append(notes);}
      const actions = el('div', 'community-actions');
      const use = el('button', 'primary-button', '装入编成'); use.type = 'button';
      use.addEventListener('click', () => {
        if (!window.WFTeamImport?.load) {status.textContent = '编成编辑器暂未准备好，请刷新后重试。'; return;}
        window.WFTeamImport.load(C.teamCopy(item.team), item.title); location.hash = '#team';
      });
      const like = el('button', 'secondary-button'); like.type = 'button';
      const showLikes = (result) => {
        if (Number.isFinite(Number(result.likes))) item.likes = Math.max(0, Number(result.likes));
        if (result.likedToday !== undefined) item.likedToday = result.likedToday;
        like.textContent = `${item.likedToday ? '今日已赞' : '点赞'} · ${item.likes || 0}`; like.disabled = Boolean(item.likedToday);
        like.setAttribute('aria-label', `${item.likedToday ? '今天已点赞' : '为此队伍点赞'}，${item.likes || 0} 赞`);
      };
      showLikes(item); like.addEventListener('click', () => C.openLike(item, ui, showLikes));
      actions.append(use, like); node.append(actions); return node;
    }
    async function load(append = false) {
      const ticket = ++revision; more.disabled = true; retry.hidden = true; status.textContent = '正在载入推荐队伍…';
      if (!append) {cards.replaceChildren(); nextCursor = ''; more.hidden = true;}
      try {
        const result = await C.client.request(options.id ? `/teams/${encodeURIComponent(options.id)}` : `/teams?${C.query(filters, append ? nextCursor : '')}`);
        if (!current(ticket)) return;
        const items = options.id ? [result.team || result] : result.items || [];
        // Public API is authoritative; never surface explicitly non-public records.
        const publicItems = items.filter((item) => item && item.id && (!item.status || item.status === 'approved'));
        publicItems.forEach((item) => cards.append(card(item)));
        nextCursor = result.nextCursor || ''; more.hidden = !nextCursor || Boolean(options.id);
        status.textContent = cards.children.length ? `已显示 ${cards.children.length} 支推荐队伍` : '暂时没有符合条件的推荐队伍。';
      } catch (error) {
        if (current(ticket)) {status.textContent = C.message(error); retry.hidden = false;}
      } finally {if (current(ticket)) more.disabled = false;}
    }
    async function connect() {
      const ticket = ++revision; status.textContent = '正在连接配队社区…'; retry.hidden = true;
      try {
        config = await C.client.config(); if (!current(ticket)) return;
        element.replaceChildren(all);
        (config.elements || []).forEach((value) => {const option = el('option', '', C.elementLabel(value)); option.value = value; element.append(option);});
        element.value = filters.element; load();
      } catch (error) {if (current(ticket)) {status.textContent = C.message(error); retry.hidden = false;}}
    }
    element.addEventListener('change', () => {filters.element = element.value; load();});
    sort.addEventListener('change', () => {filters.sort = sort.value; load();});
    more.addEventListener('click', () => load(true)); retry.addEventListener('click', () => config ? load() : connect());
    await connect();
  };
})();
