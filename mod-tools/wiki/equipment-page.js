/* Shared weapon panels for the catalogue and an individual equipment page. */
(() => {
  'use strict';
  window.renderWikiWeaponPage = function (host, data, ui, entryId = '') {
    const {el} = ui;
    const categoryOrder = ['深渊武器', '诅咒武器', '悖论武器', '羁绊武器', '五重决战武器',
      '幻想武器', '女帝武器', '普莉莉艾武器', '机兵武器', '领主掉落与兑换',
      '临境域武器', '深层域武器', '装备扭蛋武器', '主线武器', '活动武器', '世界弹射器宝珠', '其他武器'];
    const categoryRank = (category) => {const rank = categoryOrder.indexOf(category); return rank < 0 ? categoryOrder.length : rank;};
    const equipmentCompare = window.WFEquipmentOrder.createCompare(data.equipment || []);
    const elementOrder = ['火', '水', '雷', '风', '光', '暗'];
    const elementRank = (entry) => {const rank = elementOrder.indexOf(entry.element); return rank < 0 ? elementOrder.length : rank;};
    const catalogueCompare = (a, b) => Number(Boolean(b.enhancement)) - Number(Boolean(a.enhancement))
      || (a.enhancement && b.enhancement ? elementRank(a) - elementRank(b) : 0) || equipmentCompare(a, b);
    const entries = [...(data.equipment || [])].filter((entry) => !entryId || entry.id === entryId)
      .sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || catalogueCompare(a, b));
    const enhancedStates = new Map(), cards = new Map(), sections = new Map();
    const searchText = new Map(entries.map((entry) => [entry, JSON.stringify(entry).toLowerCase()]));
    const search = el('input'); search.type = 'search'; search.placeholder = '搜索武器、效果或关键词'; search.setAttribute('aria-label', '搜索武器');
    const filter = el('select'); filter.setAttribute('aria-label', '武器分类');
    const rarityFilter = el('select'); rarityFilter.setAttribute('aria-label', '武器星级');
    const rarities = [...new Set(entries.map((entry) => entry.rarity))].sort((a, b) => b - a);
    ['', ...rarities].forEach((rarity) => {
      const total = rarity === '' ? entries.length : entries.filter((entry) => entry.rarity === rarity).length;
      const option = el('option', '', `${rarity === '' ? '全部星级' : `${rarity}★`}（${total}）`);
      option.value = String(rarity); rarityFilter.append(option);
    });
    const enhancementFilter = el('select'); enhancementFilter.setAttribute('aria-label', '武器强化筛选');
    [['', '全部强化类型'], ['yes', '仅可强化武器'], ['no', '无强化武器']].forEach(([value, label]) => {const option = el('option', '', label); option.value = value; enhancementFilter.append(option);});
    const count = el('p', 'muted');
    const groups = el('div', 'equipment-groups');
    ['全部武器', ...new Set(entries.map((entry) => entry.category))].forEach((label, i) => {
      const total = i ? entries.filter((entry) => entry.category === label).length : entries.length;
      const option = el('option', '', `${label}（${total}）`); option.value = i ? label : ''; filter.append(option);
    });
    const weaponCard = (entry) => window.WFEquipmentCard.create(entry, ui, {enhancedStates});
    let attributeFilter;
    function groupFor(category) {
      if (sections.has(category)) return sections.get(category);
      const section = el('details', 'equipment-group'), heading = el('summary', 'equipment-group-heading');
      const total = el('span', 'equipment-group-count'), content = el('div', 'equipment-group-body');
      section.open = false; heading.title = '点击展开或收起此分类';
      heading.append(el('h2', '', category), total); section.append(heading, content);
      const group = {section, total, members: [], mounted: []};
      group.mount = () => {
        const members = section.open ? group.members : [];
        if (members.length === group.mounted.length && members.every((entry, i) => entry === group.mounted[i])) return;
        const tiers = [];
        for (const enhanced of [true, false]) {
          const items = members.filter((entry) => Boolean(entry.enhancement) === enhanced);
          if (!items.length) continue;
          const tier = el('section', `equipment-tier ${enhanced ? 'equipment-tier-enhanceable' : 'equipment-tier-regular'}`);
          tier.append(el('h3', 'equipment-tier-heading', `${enhanced ? '可强化武器' : '普通武器'} · ${items.length} 件`));
          const grid = el('div', 'equipment-grid');
          grid.append(...items.map((entry) => {
            if (!cards.has(entry)) cards.set(entry, weaponCard(entry));
            return cards.get(entry);
          }));
          tier.append(grid); tiers.push(tier);
        }
        content.replaceChildren(...tiers);
        group.mounted = members;
      };
      section.addEventListener('toggle', group.mount);
      sections.set(category, group); return group;
    }
    function paint() {
      const q = search.value.trim().toLowerCase();
      const items = entries.filter((entry) => (!attributeFilter || attributeFilter.matches(entry)) && (!filter.value || entry.category === filter.value) &&
        (!rarityFilter.value || String(entry.rarity) === rarityFilter.value) &&
        (!enhancementFilter.value || Boolean(entry.enhancement) === (enhancementFilter.value === 'yes')) &&
        `${searchText.get(entry)} ${(window.WFWikiAliases?.values('weapon', entry.id) || []).join(' ').toLowerCase()}`.includes(q));
      count.textContent = `共 ${items.length} 件武器 · ${items.filter((entry) => entry.enhancement).length} 件可强化`;
      const grouped = new Map();
      items.forEach((entry) => {if (!grouped.has(entry.category)) grouped.set(entry.category, []); grouped.get(entry.category).push(entry);});
      sections.forEach((group, category) => {if (!grouped.has(category)) {group.members = []; group.mount();}});
      const shown = [];
      grouped.forEach((members, category) => {
        const group = groupFor(category), enhanced = members.filter((entry) => entry.enhancement).length;
        group.members = members; group.total.textContent = `${members.length} 件${enhanced ? ` · ${enhanced} 件可强化` : ''}`;
        group.mount(); shown.push(group.section);
      });
      if (!items.length) shown.push(el('p', 'equipment-empty', '没有符合条件的武器，请调整分类或搜索词。'));
      groups.replaceChildren(...shown);
    }
    search.addEventListener('input', paint); filter.addEventListener('change', paint); rarityFilter.addEventListener('change', paint); enhancementFilter.addEventListener('change', paint);
    if (entryId) {
      const back = el('a', 'back-button', '‹ 返回武器图鉴'); back.href = '#weapons';
      host.replaceChildren(back);
      if (!entries.length) {host.append(el('p', 'note-box', '未找到这件武器。')); return;}
      const entry = entries[0], card = weaponCard(entry); card.open = true;
      document.title = `${entry.name} · 星见图鉴`;
      host.append(el('h1', '', entry.name)); window.WFWikiAliases?.mount(host, 'weapon', entry.id, ui); host.append(card); return;
    }
    const toolbar = el('div', 'team-controls equipment-toolbar'); attributeFilter = window.WFEquipmentAttributeFilter.create(ui, paint);
    toolbar.append(search, attributeFilter.button, filter, rarityFilter, enhancementFilter);
    const groupControls = el('div', 'team-controls equipment-group-controls');
    [[true, '全部展开'], [false, '全部收起']].forEach(([open, label]) => {
      const button = el('button', 'secondary-button', label); button.type = 'button';
      button.addEventListener('click', () => {
        new Set(entries.map((entry) => entry.category)).forEach((category) => {
          const group = groupFor(category); group.section.open = open; group.mount();
        });
      });
      groupControls.append(button);
    });
    const resultBar = el('div', 'equipment-result-bar'); resultBar.append(count, groupControls);
    host.replaceChildren(el('h1', '', '武器图鉴'), el('p', 'section-intro', '点击分类标题可展开或收起，深渊、诅咒武器置顶。每类先列可强化武器，按火、水、雷、风、光、暗、通用排序，同属性内高星优先、同星按图鉴倒序；普通武器随后按高星和图鉴倒序排列。可强化武器可切换形态，查看对应名称、图标、面板与效果；卡片可切换武器和魂珠效果，计算与材料可按需展开。'), toolbar, resultBar, groups, attributeFilter.floating);
    paint();
    window.WFWikiAliases?.watch(host, paint);
  };
})();
