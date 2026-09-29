/* Weapon and soul pickers retain separate filters, using exported equipment metadata. */
(() => {
  'use strict';
  const elements = ['火', '水', '雷', '风', '光', '暗'];
  const normalized = (value) => String(value ?? '').normalize('NFKC').toLocaleLowerCase('zh-CN');
  const elementOf = (item) => [...elements, '通用/未分类'].includes(item.element) ? item.element : '未标注';
  window.WFTeamEquipmentFilters = {
    create({equipment, ui, initialState = {}, onChange = () => {}, onStateChange = () => {}}) {
      const {el, nativeIcon} = ui;
      const states = Object.fromEntries(['weapon', 'soul'].map((mode) => [mode,
        Object.fromEntries(['search', 'element', 'rarity'].map((key) => [key, String(initialState[mode]?.[key] ?? '')]))]));
      let mode = 'weapon';
      const root = el('div', 'team-equipment-filters');
      const search = el('input', 'team-equipment-search'); search.type = 'search'; search.autocomplete = 'off';
      const row = el('div', 'team-equipment-elements'); row.setAttribute('role', 'group');
      const buttons = [];
      const availableElements = new Set(equipment.map(elementOf));
      const values = ['', ...elements, ...['通用/未分类', '未标注'].filter((value) => availableElements.has(value))];
      const rarity = el('select');
      const rarities = [...new Set(equipment.map((item) => String(item.rarity ?? '')).filter(Boolean))].sort((a,b) => Number(b) - Number(a));
      ['', ...rarities].forEach((value) => {const option = el('option', '', value ? `${value} 星` : '全部星级'); option.value = value; rarity.append(option);});
      const reset = el('button', 'text-button', '重置筛选'); reset.type = 'button';
      const controls = el('div', 'team-equipment-options'); controls.append(rarity, reset);
      const note = el('p', 'character-filter-help', '按现有装备属性分类；魂珠沿用对应武器分类。“通用”包含通用及尚未分类的装备。');
      const getState = () => ({weapon:{...states.weapon},soul:{...states.soul}});
      function notify() {onStateChange(getState()); onChange();}
      function sync() {
        const label = mode === 'soul' ? '魂珠' : '武器', state = states[mode];
        search.value = state.search; search.placeholder = `搜索${label}、别名或分类`; search.setAttribute('aria-label', `配队${label}搜索`);
        rarity.value = state.rarity; rarity.setAttribute('aria-label', `配队${label}星级`);
        row.setAttribute('aria-label', `${label}属性`);
        buttons.forEach(({button, value}) => {
          button.setAttribute('aria-label', `${label}${value ? `${value}属性` : '全部属性'}`);
          button.setAttribute('aria-pressed', String(state.element === value));
        });
      }
      values.forEach((value) => {
        const button = el('button', 'character-filter-element'); button.type = 'button';
        if (elements.includes(value) && nativeIcon) button.append(nativeIcon('elements', value, value));
        button.append(el('span', '', value === '通用/未分类' ? '通用' : value || '全部'));
        button.addEventListener('click', () => {states[mode].element = value; sync(); notify();});
        buttons.push({button,value}); row.append(button);
      });
      for (const state of Object.values(states)) {
        if (!values.includes(state.element)) state.element = '';
        if (!rarities.includes(state.rarity)) state.rarity = '';
      }
      search.addEventListener('input', () => {states[mode].search = search.value; notify();});
      rarity.addEventListener('change', () => {states[mode].rarity = rarity.value; notify();});
      reset.addEventListener('click', () => {states[mode] = {search:'',element:'',rarity:''}; sync(); notify();});
      root.append(search, row, controls, note); sync();
      return {
        element: root, getState,
        setMode(value) {mode = value === 'soul' ? 'soul' : 'weapon'; sync();},
        matches(item) {
          const state = states[mode], terms = normalized(state.search).trim().split(/\s+/).filter(Boolean);
          return (mode !== 'soul' || item.soul?.available === true)
            && (!state.element || elementOf(item) === state.element)
            && (!state.rarity || String(item.rarity ?? '') === state.rarity)
            && terms.every((term) => normalized(`${item.name} ${(item.aliases || []).join(' ')} ${item.category || ''}`).includes(term));
        },
      };
    },
  };
})();
