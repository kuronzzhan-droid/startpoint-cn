(() => {
  'use strict';
  function weaponPage(host, data, ui) {
    const {el, picture} = ui;
    const entries = data.equipment || [];
    const search = el('input'); search.type = 'search'; search.placeholder = '搜索武器、效果或关键词'; search.setAttribute('aria-label', '搜索武器');
    const filter = el('select'); filter.setAttribute('aria-label', '武器分类');
    const count = el('p', 'muted');
    const grid = el('div', 'equipment-grid');
    ['全部武器', ...new Set(entries.map((entry) => entry.category))].forEach((label, i) => {const option = el('option', '', label); option.value = i ? label : ''; filter.append(option);});
    const effects = (parent, label, values) => {
      if (!values?.length) return;
      parent.append(el('h4', '', label)); const ul = el('ul');
      (Array.isArray(values) ? values : [values]).forEach((value) => ul.append(el('li', '', typeof value === 'string' ? value : value.description || value.text || '')));
      parent.append(ul);
    };
    const stats = (value) => value ? `HP ${value.hp} / 攻击力 ${value.atk}` : '暂无数值';
    function paint() {
      const q = search.value.trim().toLowerCase();
      const items = entries.filter((entry) => (!filter.value || entry.category === filter.value) && JSON.stringify(entry).toLowerCase().includes(q));
      count.textContent = `共 ${items.length} 件武器`; grid.replaceChildren();
      items.forEach((entry) => {
        const card = el('details', 'equipment-card game-panel');
        const summary = el('summary');
        const title = el('div'); title.append(el('strong', '', entry.name), el('span', 'muted', `${entry.category} · ${entry.rarity}★`));
        summary.append(picture(entry.enhancement?.icon || entry.icon, entry.name, 'equipment-icon'), title);
        card.append(summary, el('p', '', entry.description), el('p', 'equipment-stat', `初始 ${stats(entry.stats?.base)}\n满觉醒 ${stats(entry.stats?.awakened)}`));
        effects(card, '初始效果', entry.baseEffects); effects(card, '满觉醒效果', entry.awakenedEffects);
        if (entry.panelDescription) card.append(el('p', '', entry.panelDescription));
        if (entry.enhancement) {
          const e = entry.enhancement; card.append(el('h3', '', `强化 Lv${e.maxLevel} · ${e.name}`), el('p', '', e.description), el('p', 'equipment-stat', `强化后合计 ${stats(e.stats?.total)}`));
          effects(card, '满强化追加效果', e.effects);
          if (e.finalDescription || e.panelDescription) card.append(el('p', '', e.finalDescription || e.panelDescription));
          if (e.note) card.append(el('p', 'muted', e.note));
          if (e.costs) {const cost = el('details'); cost.append(el('summary', '', '强化材料')); renderReadable(cost, e.costs, ui); card.append(cost);}
        }
        if (entry.soul?.available) effects(card, '魂珠效果', entry.soul.effects);
        card.append(el('p', 'muted', entry.soul?.note || ''));
        (entry.notes || []).forEach((note) => card.append(el('p', 'weapon-note', note)));
        grid.append(card);
      });
    }
    search.addEventListener('input', paint); filter.addEventListener('change', paint);
    const toolbar = el('div', 'team-controls'); toolbar.append(search, filter);
    host.replaceChildren(el('h1', '', '武器图鉴'), el('p', 'section-intro', '查看本体、满觉醒、强化与魂珠效果。悖论、诅咒和羁绊武器可按分类快速查找。'), toolbar, count, grid);
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
