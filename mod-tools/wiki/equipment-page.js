/* Shared weapon panels for the catalogue and an individual equipment page. */
(() => {
  'use strict';
  window.renderWikiWeaponPage = function (host, data, ui, entryId = '') {
    const {lazyDetails, renderReadable} = window.WFWikiReadable;
    const {el, picture} = ui;
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
    const effects = (parent, label, values) => {
      if (!values?.length) return;
      parent.append(el('h4', '', label)); const ul = el('ul');
      (Array.isArray(values) ? values : [values]).forEach((value) => ul.append(el('li', '', typeof value === 'string' ? value : value.description || value.text || '')));
      parent.append(ul);
    };
    const stats = (value) => value ? `HP ${value.hp} / 攻击力 ${value.atk}` : '暂无数值';
    function weaponCard(entry) {
        const e = entry.enhancement, stateKey = entry.id || entry.name;
        const forms = Array.isArray(e?.forms) ? e.forms.filter((form) => form && Number.isFinite(Number(form.level)) && Number(form.level) > 0)
          .map((form) => ({...form, level: Number(form.level)})).sort((a, b) => a.level - b.level) : [];
        const stages = forms.length ? forms : e ? [{...e, level: Number(e.maxLevel), label: `强化后 Lv${e.maxLevel}`}] : [];
        const originalLabel = forms.length ? '原始形态' : '强化前';
        const card = el('details', `equipment-card game-panel${e ? ' equipment-enhanceable' : ''}`);
        const summary = el('summary');
        const title = el('div', 'equipment-card-title'), name = el('strong', '', entry.name);
        title.append(name, el('span', 'muted', [entry.category, entry.element, `${entry.rarity}★`].filter(Boolean).join(' · ')));
        const stateLabel = el('span', 'equipment-current-state');
        if (e) title.append(el('span', `equipment-enhance-badge${forms.length ? ' equipment-forms-badge' : ''}`, `可强化 · ${forms.length ? `${forms.length + 1} 种形态 · ` : ''}最高 Lv${e.maxLevel}`), stateLabel);
        let icon = el('span');
        summary.append(icon, title);
        const panelStats = el('span', 'equipment-current-state'); title.append(panelStats);
        let body, active, selectedLevel = 0, renderedLevel, effectLevel = 'max', renderedEffectLevel;
        const buttons = [], effectButtons = [];
        function renderHeader(level) {
          active = stages.find((stage) => stage.level === Number(level));
          selectedLevel = active?.level || 0;
          const activeLabel = active?.label || `强化后 Lv${selectedLevel}`;
          const shownName = active ? active.name || entry.name : entry.name;
          name.textContent = shownName;
          card.setAttribute('data-enhanced', String(Boolean(active)));
          card.setAttribute('data-enhancement-level', String(selectedLevel));
          stateLabel.textContent = `当前：${active ? activeLabel : originalLabel}`;
          panelStats.textContent = `${active ? '满觉醒＋强化' : '满觉醒'} ${stats(active ? active.stats?.total : entry.stats?.awakened)}`;
          let nextIcon = picture(active ? active.icon || entry.icon : entry.icon, shownName, 'equipment-icon');
          if (active?.frame) {
            const framed = el('span', 'equipment-framed-icon');
            framed.append(picture(active.frame, '', 'equipment-frame-image'), nextIcon); nextIcon = framed;
          }
          icon.replaceWith(nextIcon); icon = nextIcon;
          buttons.forEach(({button, value, label}) => {
            button.setAttribute('aria-pressed', String(value === selectedLevel));
            button.textContent = `${value === selectedLevel ? '● ' : ''}${label}`;
          });
        }
        function renderBody() {
          if (!card.open || (renderedLevel === selectedLevel && renderedEffectLevel === effectLevel)) return;
          if (!body) {
            const effectControls = el('div', 'team-controls equipment-toggle');
            effectControls.setAttribute('role', 'group'); effectControls.setAttribute('aria-label', `${entry.name}本体效果等级`);
            [['initial', '初始效果'], ['max', '满级效果']].forEach(([value, label]) => {
              const button = el('button', 'secondary-button', label); button.type = 'button';
              button.setAttribute('data-effect-level', value);
              button.addEventListener('click', () => {if (value !== effectLevel) {effectLevel = value; renderBody();}});
              effectButtons.push({button, value}); effectControls.append(button);
            });
            body = el('div', 'equipment-state'); card.append(effectControls, body);
            if (e?.costs) card.append(lazyDetails(ui, forms.length ? `强化材料（0→${e.maxLevel}级完整路线）` : '强化材料', '',
              (cost) => renderReadable(cost, e.costs, ui)));
            if (entry.soul?.available) effects(card, '魂珠效果', entry.soul.effects);
            if (entry.soul?.note) card.append(el('p', 'muted', entry.soul.note));
            (entry.notes || []).forEach((note) => card.append(el('p', 'weapon-note', note)));
          }
          const fullEffects = effectLevel === 'max';
          const baseEffects = fullEffects ? entry.awakenedEffects : entry.baseEffects;
          effectButtons.forEach(({button, value}) => button.setAttribute('aria-pressed', String(value === effectLevel)));
          const activeLabel = active?.label || `强化后 Lv${selectedLevel}`;
          body.replaceChildren(el('p', '', active ? active.description || entry.description : entry.description));
          if (active) {
            body.append(el('h3', '', activeLabel), el('p', 'equipment-stat', `满觉醒＋强化合计 ${stats(active.stats?.total)}`));
            if (forms.length && selectedLevel === 200) body.append(el('p', 'equipment-highest-marker', '最高强化 · Lv200'));
            if (active.stats?.additional) body.append(el('p', 'muted', `其中强化追加 ${stats(active.stats.additional)}`));
            if (fullEffects && active.finalDescription) {body.append(el('h4', '', '强化后完整效果（含本体）'), el('p', '', active.finalDescription));}
            if (!fullEffects) body.append(el('p', 'muted', '当前对照本体初始效果；强化追加效果仍按已选形态显示，上方合计面板按满觉醒计算。'));
            effects(body, fullEffects ? '本体满级效果（保留）' : '本体初始效果（对照）', baseEffects);
            effects(body, `强化 Lv${selectedLevel} 追加效果`, active.effects);
            if (fullEffects && active.panelDescription) {body.append(el('h4', '', '强化阶段说明'), el('p', '', active.panelDescription));}
            if (active.note) body.append(el('p', 'muted', active.note));
          } else {
            body.append(el('h3', '', e ? originalLabel : '武器面板'), el('p', 'equipment-stat', `初始 ${stats(entry.stats?.base)}\n满觉醒 ${stats(entry.stats?.awakened)}`));
            effects(body, fullEffects ? '本体满级效果' : '本体初始效果', baseEffects);
            if (fullEffects && entry.panelDescription) body.append(el('p', '', entry.panelDescription));
          }
          renderedLevel = selectedLevel; renderedEffectLevel = effectLevel;
        }
        if (e) {
          const toggle = el('div', `team-controls equipment-toggle${forms.length ? ' equipment-toggle-forms' : ''}`);
          toggle.setAttribute('role', 'group'); toggle.setAttribute('aria-label', `${entry.name}强化状态`);
          [[0, originalLabel], ...stages.map((stage) => [stage.level, stage.label || `强化后 Lv${stage.level}`])].forEach(([value, label]) => {
            const button = el('button', 'secondary-button', label); button.type = 'button';
            button.setAttribute('data-level', String(value));
            button.addEventListener('click', (event) => {
              event.preventDefault(); event.stopPropagation();
              if (value === selectedLevel) return;
              enhancedStates.set(stateKey, value); renderHeader(value); renderBody();
            });
            buttons.push({button, value, label}); toggle.append(button);
          });
          title.append(toggle);
        }
        card.append(summary); renderHeader(enhancedStates.get(stateKey) || 0);
        card.addEventListener('toggle', renderBody);
        return card;
    }
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
      const items = entries.filter((entry) => (!filter.value || entry.category === filter.value) &&
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
    const toolbar = el('div', 'team-controls equipment-toolbar'); toolbar.append(search, filter, rarityFilter, enhancementFilter);
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
    host.replaceChildren(el('h1', '', '武器图鉴'), el('p', 'section-intro', '点击分类标题可展开或收起，深渊、诅咒武器置顶。每类先列可强化武器，按火、水、雷、风、光、暗、通用排序，同属性内高星优先、同星按图鉴倒序；普通武器随后按高星和图鉴倒序排列。可强化武器可切换形态，查看对应名称、图标、面板与效果；魂珠和材料独立列出。'), toolbar, resultBar, groups);
    paint();
    window.WFWikiAliases?.watch(host, paint);
  };
})();
