/* Shared character search/filter controls for the catalogue and team picker. */
(() => {
  'use strict';
  const fields = ['element', 'rarity', 'type', 'origin'];
  const elements = ['火', '水', '雷', '风', '光', '暗'];
  const normalized = (value) => String(value ?? '').normalize('NFKC').toLocaleLowerCase('zh-CN');
  const searchIndex = new WeakMap();
  const searchText = (character) => {
    if (!searchIndex.has(character)) searchIndex.set(character, normalized(JSON.stringify(character)));
    return searchIndex.get(character);
  };
  function create({characters, ui, idPrefix, onChange = () => {}, onReset, initialState = {}}) {
    const {el, nativeIcon} = ui;
    const state = Object.fromEntries(['search', ...fields].map((key) => [key, String(initialState[key] ?? '')]));
    const root = el('section', 'character-filters'); root.setAttribute('aria-label', '查找角色');
    const heading = el('div', 'character-filter-heading'); heading.append(el('h3', '', '查找角色'));
    const resetButton = el('button', 'text-button', '重置筛选'); resetButton.type = 'button';
    heading.append(resetButton);
    const searchLabel = el('label', 'character-filter-search-label', '名字、别名、主题或技能');
    searchLabel.htmlFor = `${idPrefix}-search`;
    const search = el('input', 'character-filter-search'); search.id = searchLabel.htmlFor;
    search.type = 'search'; search.placeholder = '输入角色名、别称或技能…'; search.autocomplete = 'off';
    const elementRow = el('div', 'character-filter-elements'); elementRow.setAttribute('role', 'group'); elementRow.setAttribute('aria-label', '角色属性');
    const elementButtons = [];
    const selects = {};
    const choices = el('div', 'character-filter-fields');
    let searchTimer;
    const notify = () => {clearTimeout(searchTimer); onChange({...state});};
    function sync() {
      search.value = state.search;
      Object.entries(selects).forEach(([key, select]) => {select.value = state[key];});
      elementButtons.forEach(({button, value}) => button.setAttribute('aria-pressed', String(value === state.element)));
    }
    ['', ...elements].forEach((value) => {
      const button = el('button', 'character-filter-element'); button.type = 'button';
      button.setAttribute('aria-label', value ? `${value}属性` : '全部属性');
      if (value) button.append(nativeIcon('elements', value, value));
      button.append(el('span', '', value || '全部'));
      button.addEventListener('click', () => {state.element = value; sync(); notify();});
      elementButtons.push({button, value}); elementRow.append(button);
    });
    [['rarity', '星级', '全部星级'], ['type', '战斗类型', '全部类型'], ['origin', '收录来源', '全部来源']].forEach(([key, label, allLabel]) => {
      const field = el('label', 'character-filter-field'); field.htmlFor = `${idPrefix}-${key}`;
      field.append(el('span', '', label));
      const select = el('select'); select.id = field.htmlFor; select.setAttribute('aria-label', label);
      const all = el('option', '', allLabel); all.value = ''; select.append(all);
      const values = [...new Set(characters.map((character) => String(character[key] ?? '')).filter(Boolean))];
      if (key === 'rarity') values.sort((a, b) => Number(b) - Number(a));
      values.forEach((value) => {const option = el('option', '', key === 'rarity' ? `${value} 星` : value); option.value = value; select.append(option);});
      if (!values.includes(state[key])) state[key] = '';
      select.addEventListener('change', () => {state[key] = select.value; notify();});
      selects[key] = select; field.append(select); choices.append(field);
    });
    if (!elements.includes(state.element)) state.element = '';
    function reset(emit = true) {
      clearTimeout(searchTimer);
      Object.keys(state).forEach((key) => {state[key] = '';}); sync();
      if (emit) notify();
    }
    resetButton.addEventListener('click', () => {reset(false); if (onReset) onReset(); else notify();});
    search.addEventListener('input', () => {state.search = search.value; clearTimeout(searchTimer); searchTimer = setTimeout(notify, 80);});
    root.append(heading, searchLabel, search, el('p', 'character-filter-help', '支持多关键词，以空格分隔'), elementRow, choices);
    sync();
    return {
      element: root, search,
      matches(character) {
        return fields.every((key) => !state[key] || String(character[key] ?? '') === state[key])
          && normalized(state.search).trim().split(/\s+/).filter(Boolean).every((term) => searchText(character).includes(term));
      },
      hasActiveFilters: () => Object.values(state).some((value) => value.trim()),
      getState: () => ({...state}),
      clearSearch(emit = true) {clearTimeout(searchTimer); state.search = ''; sync(); if (emit) notify();},
      focus: () => search.focus(), reset,
    };
  }
  window.WFCharacterFilters = {create};
})();
