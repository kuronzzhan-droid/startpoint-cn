(() => {
  'use strict';
  function weaponPage(host, data, ui) {
    const {el, picture} = ui;
    const categoryOrder = ['深渊武器', '诅咒武器', '悖论武器', '羁绊武器', '五重决战武器', '世界弹射器宝珠', '其他武器'];
    const categoryRank = (category) => {const rank = categoryOrder.indexOf(category); return rank < 0 ? categoryOrder.length : rank;};
    const entries = [...(data.equipment || [])].sort((a, b) => categoryRank(a.category) - categoryRank(b.category));
    const enhancedStates = new Map();
    const groupStates = new Map(), visibleGroups = new Map();
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
    function paint() {
      visibleGroups.forEach((section, category) => groupStates.set(category, section.open));
      visibleGroups.clear();
      const q = search.value.trim().toLowerCase();
      const items = entries.filter((entry) => (!filter.value || entry.category === filter.value) &&
        (!rarityFilter.value || String(entry.rarity) === rarityFilter.value) &&
        (!enhancementFilter.value || Boolean(entry.enhancement) === (enhancementFilter.value === 'yes')) && JSON.stringify(entry).toLowerCase().includes(q));
      count.textContent = `共 ${items.length} 件武器 · ${items.filter((entry) => entry.enhancement).length} 件可强化`; groups.replaceChildren();
      const grids = new Map();
      [...new Set(items.map((entry) => entry.category))].forEach((category) => {
        const members = items.filter((entry) => entry.category === category), enhanced = members.filter((entry) => entry.enhancement).length;
        const section = el('details', 'equipment-group'), heading = el('summary', 'equipment-group-heading');
        section.open = groupStates.get(category) ?? true;
        visibleGroups.set(category, section);
        heading.title = '点击展开或收起此分类';
        heading.append(el('h2', '', category), el('span', 'equipment-group-count', `${members.length} 件${enhanced ? ` · ${enhanced} 件可强化` : ''}`));
        const grid = el('div', 'equipment-grid'); grids.set(category, grid); section.append(heading, grid); groups.append(section);
      });
      if (!items.length) groups.append(el('p', 'equipment-empty', '没有符合条件的武器，请调整分类或搜索词。'));
      items.forEach((entry) => {
        const e = entry.enhancement, stateKey = entry.id || entry.name;
        const forms = Array.isArray(e?.forms) ? e.forms.filter((form) => form && Number.isFinite(Number(form.level)) && Number(form.level) > 0)
          .map((form) => ({...form, level: Number(form.level)})).sort((a, b) => a.level - b.level) : [];
        const stages = forms.length ? forms : e ? [{...e, level: Number(e.maxLevel), label: `强化后 Lv${e.maxLevel}`}] : [];
        const originalLabel = forms.length ? '原始形态' : '强化前';
        const card = el('details', `equipment-card game-panel${e ? ' equipment-enhanceable' : ''}`);
        const summary = el('summary');
        const title = el('div', 'equipment-card-title'), name = el('strong', '', entry.name);
        title.append(name, el('span', 'muted', `${entry.category} · ${entry.rarity}★`));
        const stateLabel = el('span', 'equipment-current-state');
        if (e) title.append(el('span', `equipment-enhance-badge${forms.length ? ' equipment-forms-badge' : ''}`, `可强化 · ${forms.length ? `${forms.length + 1} 种形态 · ` : ''}最高 Lv${e.maxLevel}`), stateLabel);
        let icon = picture(entry.icon, entry.name, 'equipment-icon');
        summary.append(icon, title);
        const body = el('div', 'equipment-state');
        const buttons = [];
        function renderState(level) {
          const active = stages.find((stage) => stage.level === Number(level));
          const selectedLevel = active?.level || 0;
          const activeLabel = active?.label || `强化后 Lv${selectedLevel}`;
          const shownName = active ? active.name || entry.name : entry.name;
          name.textContent = shownName;
          card.setAttribute('data-enhanced', String(Boolean(active)));
          card.setAttribute('data-enhancement-level', String(selectedLevel));
          stateLabel.textContent = `当前：${active ? activeLabel : originalLabel}`;
          let nextIcon = picture(active ? active.icon || entry.icon : entry.icon, shownName, 'equipment-icon');
          if (active?.frame) {
            const framed = el('span', 'equipment-framed-icon');
            framed.append(picture(active.frame, '', 'equipment-frame-image'), nextIcon); nextIcon = framed;
          }
          icon.replaceWith(nextIcon); icon = nextIcon;
          body.replaceChildren(el('p', '', active ? active.description || entry.description : entry.description));
          if (active) {
            body.append(el('h3', '', activeLabel), el('p', 'equipment-stat', `满觉醒＋强化合计 ${stats(active.stats?.total)}`));
            if (forms.length && selectedLevel === 200) body.append(el('p', 'equipment-highest-marker', '最高强化 · Lv200'));
            if (active.stats?.additional) body.append(el('p', 'muted', `其中强化追加 ${stats(active.stats.additional)}`));
            if (active.finalDescription) {body.append(el('h4', '', '强化后完整效果（含本体）'), el('p', '', active.finalDescription));}
            effects(body, '本体满觉醒效果（保留）', entry.awakenedEffects);
            effects(body, `强化 Lv${selectedLevel} 追加效果`, active.effects);
            if (active.panelDescription) {body.append(el('h4', '', '强化阶段说明'), el('p', '', active.panelDescription));}
            if (active.note) body.append(el('p', 'muted', active.note));
          } else {
            body.append(el('h3', '', e ? originalLabel : '武器面板'), el('p', 'equipment-stat', `初始 ${stats(entry.stats?.base)}\n满觉醒 ${stats(entry.stats?.awakened)}`));
            effects(body, '初始效果', entry.baseEffects); effects(body, '满觉醒效果', entry.awakenedEffects);
            if (entry.panelDescription) body.append(el('p', '', entry.panelDescription));
          }
          buttons.forEach(({button, value, label}) => {
            button.setAttribute('aria-pressed', String(value === selectedLevel));
            button.textContent = `${value === selectedLevel ? '● ' : ''}${label}`;
          });
        }
        if (e) {
          const toggle = el('div', `team-controls equipment-toggle${forms.length ? ' equipment-toggle-forms' : ''}`);
          toggle.setAttribute('role', 'group'); toggle.setAttribute('aria-label', `${entry.name}强化状态`);
          [[0, originalLabel], ...stages.map((stage) => [stage.level, stage.label || `强化后 Lv${stage.level}`])].forEach(([value, label]) => {
            const button = el('button', 'secondary-button', label); button.type = 'button';
            button.setAttribute('data-level', String(value));
            button.addEventListener('click', (event) => {event.preventDefault(); event.stopPropagation(); enhancedStates.set(stateKey, value); renderState(value); card.open = true;});
            buttons.push({button, value, label}); toggle.append(button);
          });
          title.append(toggle);
        }
        card.append(summary, body); renderState(enhancedStates.get(stateKey) || 0);
        if (e?.costs) {const cost = el('details'); cost.append(el('summary', '', forms.length ? `强化材料（0→${e.maxLevel}级完整路线）` : '强化材料')); renderReadable(cost, e.costs, ui); card.append(cost);}
        if (entry.soul?.available) effects(card, '魂珠效果', entry.soul.effects);
        card.append(el('p', 'muted', entry.soul?.note || ''));
        (entry.notes || []).forEach((note) => card.append(el('p', 'weapon-note', note)));
        grids.get(entry.category).append(card);
      });
    }
    search.addEventListener('input', paint); filter.addEventListener('change', paint); rarityFilter.addEventListener('change', paint); enhancementFilter.addEventListener('change', paint);
    const toolbar = el('div', 'team-controls equipment-toolbar'); toolbar.append(search, filter, rarityFilter, enhancementFilter);
    const groupControls = el('div', 'team-controls equipment-group-controls');
    [[true, '全部展开'], [false, '全部收起']].forEach(([open, label]) => {
      const button = el('button', 'secondary-button', label); button.type = 'button';
      button.addEventListener('click', () => {
        entries.forEach((entry) => groupStates.set(entry.category, open));
        visibleGroups.forEach((section) => {section.open = open;});
      });
      groupControls.append(button);
    });
    const resultBar = el('div', 'equipment-result-bar'); resultBar.append(count, groupControls);
    host.replaceChildren(el('h1', '', '武器图鉴'), el('p', 'section-intro', '点击分类标题可展开或收起，深渊、诅咒武器置顶。所有带「可强化」标识的武器均可切换强化前后，查看对应名称、图标、面板与效果；魂珠和材料独立列出。'), toolbar, resultBar, groups);
    paint();
  }
  const fieldNames = {name: '名称', description: '说明', level: '等级', maxLevel: '最高等级', hp: '生命值', element: '属性', attack: '攻击', atk: '攻击',
    count: '数量', amount: '数量', quantity: '数量', item: '材料', itemName: '材料', costs: '材料', mechanics: '机制', summary: '概览',
    entry: '进入方式', stages: '阶段', bosses: 'Boss', affixes: '词缀', rewards: '奖励', notes: '提示', title: '名称', rounds: '轮次',
    difficulty: '难度', waves: '波次', stage: '阶段', rule: '规则', effects: '效果', before: '原版', after: '当前', chance: '概率',
    rate: '概率', value: '数值', duration: '持续时间', unlock: '解锁', perRun: '每场', pool: '候选池', label: '名称', note: '说明',
    routeCount: '路线数量', upperRoutes: '上半场', lowerRoutes: '下半场', wave: '波次', hpDisplay: '生命值', scope: '范围',
    enabled:'当前开放',soloAvailable:'支持单人',maxPlayers:'最多人数',ticketName:'入场凭证',round:'场次',order:'波次',simultaneous:'同屏出场',
    fromLevel:'起始强化等级',toLevel:'强化至',perLevelCosts:'每级所需材料',requiredAwakeningLevel:'所需觉醒等级',total:'总计',
    hpText:'多人生命值',soloHpText:'单人生命值',trials:'试炼要求',entryMechanics:'开场机制',enemyConditions:'敌方状态',timeLimitSeconds:'限时（秒）',feverCapacity:'Fever容量'};
  function renderReadable(parent, value, ui, depth = 0) {
    const {el} = ui;
    if (value == null || value === '') return;
    if (typeof value !== 'object') {parent.append(el('p', '', typeof value === 'boolean' ? (value ? '是' : '否') : value)); return;}
    if (Array.isArray(value)) {
      value.forEach((entry) => {const box = el('div', depth < 2 ? 'guide-item' : 'guide-detail'); renderReadable(box, entry, ui, depth + 1); parent.append(box);}); return;
    }
    Object.entries(value).forEach(([key, child]) => {
      if (['id', 'sourceHashes', 'sourceFiles', 'sourceMissing', 'key', 'icon', 'meta', 'questId'].includes(key) || child == null || child === '') return;
      if ((key === 'hp' && value.hpText) || (key === 'soloHp' && value.soloHpText)) return;
      if (key === 'name' || key === 'title' || key === 'label') {parent.append(el(depth < 2 ? 'h2' : 'h3', '', child)); return;}
      if (typeof child === 'object') {
        const box = el('div', 'guide-field'); box.append(el('h4', '', fieldNames[key] || key)); renderReadable(box, child, ui, depth + 1); parent.append(box);
      } else parent.append(el('p', '', `${fieldNames[key] || key}：${typeof child === 'boolean' ? (child ? '是' : '否') : child}`));
    });
  }
  window.renderWikiPage = (route, host, data, ui) => {
    if (route === 'team') {window.renderWikiTeam(host, data, ui); return true;}
    if (route === 'weapons') {weaponPage(host, data, ui); return true;}
    if (route === 'five-boss') {
      const box = ui.el('div', 'boss-guide');
      if (data.bossGuide) {
        const guide = data.bossGuide;
        box.append(ui.el('h1','',guide.title),ui.el('p','section-intro',guide.summary));
        renderReadable(box, {entry:guide.entry,notes:guide.notes,rewards:guide.rewards},ui);
        box.append(ui.el('h2','','路线与各波敌人'));
        (guide.stages || []).forEach((stage) => {
          const section = ui.el('details','guide-item');
          section.append(ui.el('summary','',`${stage.round === 1 ? '上半场' : '下半场'} · ${stage.name}`));
          const detail = {...stage}; delete detail.name; delete detail.round;
          renderReadable(section,detail,ui); box.append(section);
        });
        const bosses = ui.el('details','guide-item'); bosses.append(ui.el('summary','','Boss 机制速查'));
        renderReadable(bosses,guide.bosses,ui); box.append(bosses);
      }
      else box.append(ui.el('p', '', '当前快照暂无五重决战资料。'));
      host.replaceChildren(box); return true;
    }
    return false;
  };
})();
