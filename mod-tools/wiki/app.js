/* A self-contained, file:// compatible catalogue. No network or build runtime required. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const list = (value) => Array.isArray(value) ? value : [];
  const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const text = (value, fallback = '') => value === undefined || value === null || value === ''
    ? fallback : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const el = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = text(value);
    return node;
  };
  const safeUrl = (value) => {
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\\]/.test(value)) return '';
    const candidate = value.trim();
    if (/^[a-z][a-z\d+.-]*:/i.test(candidate) && !/^https?:\/\//i.test(candidate)) return '';
    return candidate;
  };
  const safeData = (value) => JSON.parse(JSON.stringify(value, (_key, item) =>
    typeof item === 'string' && /(?:[A-Za-z]:[\\/]|file:\/\/)/.test(item) ? '本地来源（路径已省略）' : item));
  const disclosure = (label, value) => {
    const node = el('details', 'data-disclosure');
    node.append(el('summary', '', label));
    node.addEventListener('toggle', () => {
      if (node.open && node.childElementCount === 1) {
        node.append(el('pre', '', JSON.stringify(safeData(value), null, 2)));
      }
    });
    return node;
  };
  const elementClasses = {'火': 'fire', '水': 'water', '雷': 'thunder', '风': 'wind', '光': 'light', '暗': 'dark'};
  const elementBadge = (value) => el('span', `element-badge element-${elementClasses[value] || 'other'}`, value || '未知属性');
  const picture = (url, alt, className) => {
    const src = safeUrl(url);
    if (!src) return el('span', 'image-placeholder', '✧');
    const img = el('img', className);
    img.src = src;
    img.alt = alt;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => img.replaceWith(el('span', 'image-placeholder', '✧')), {once: true});
    return img;
  };
  const formatNumber = (value) => {
    if (value === undefined || value === null || value === '') return '—';
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString('zh-CN') : text(value);
  };
  const stars = (value) => '★'.repeat(Math.min(6, Math.max(0, Number(value) || 0)));
  const normalized = (value) => text(value).normalize('NFKC').toLocaleLowerCase('zh-CN');
  const categories = ['毛茸异世界', '原创与改版', 'Boss角色', '小动物'];
  const categoryDescriptions = {
    '毛茸异世界': '来自毛茸异世界的同行者。',
    '原创与改版': '原创角色与官方角色改版，按当前生效资料收录。',
    'Boss角色': '以 Boss 为原型的可玩角色，查阅他们的技能与能力。',
    '小动物': '小动物们的角色资料与战斗能力。',
  };
  const categoryName = (character) => categories.includes(character.category) ? character.category : '原创与改版';
  const data = object(window.WF_WIKI);
  const meta = object(data.meta);
  const characters = list(data.characters).filter((c) => c && typeof c === 'object' && c.id != null);
  const byId = new Map(characters.map((c) => [String(c.id), c]));
  const searchIndex = new Map(characters.map((c) => [String(c.id), normalized(JSON.stringify(safeData(c)))]));
  const helpers = {el, list, object, text, safeUrl, safeData, disclosure, elementBadge, picture, formatNumber, stars, categoryName};
  const controls = {search: $('character-search'), element: $('element-filter'), type: $('type-filter'), origin: $('origin-filter')};
  let currentId = '';
  let selectedCategory = '';
  let searchTimer;

  function fillOptions(select, field) {
    const values = [...new Set(characters.map((c) => text(c[field])).filter(Boolean))];
    values.forEach((value) => {
      const option = el('option', '', value);
      option.value = value;
      select.append(option);
    });
  }

  function renderMeta() {
    const counts = object(meta.counts);
    $('header-version').textContent = text(meta.version);
    $('nav-count').textContent = characters.length;
    const stats = [
      [counts.total ?? characters.length, '角色收录'],
      [counts.newMod ?? characters.filter((c) => c.origin === '新增MOD').length, '新增 MOD'],
      [counts.modifiedOfficial ?? characters.filter((c) => c.origin === '改版官方').length, '官方角色改版'],
    ];
    stats.forEach(([value, label]) => {
      const stat = el('div', 'hero-stat');
      stat.append(el('strong', '', formatNumber(value)), el('span', '', label));
      $('catalog-stats').append(stat);
    });
    $('snapshot-note').append(el('span', '', `数据版本 ${text(meta.version, '未记录')}`));
    if (meta.generatedAt) {
      const date = new Date(meta.generatedAt);
      const formatted = Number.isNaN(date.getTime()) ? text(meta.generatedAt) : date.toLocaleString('zh-CN', {hour12: false});
      $('snapshot-note').append(el('span', '', `导出于 ${formatted}`));
    }
    if (meta.dataNote) $('snapshot-note').append(el('p', '', text(meta.dataNote)));
    if (meta.rosterRule) {
      const scope = el('details', 'data-disclosure');
      scope.append(el('summary', '', '收录范围说明'), el('p', '', meta.rosterRule));
      $('snapshot-note').append(scope);
    }
  }

  function renderCategoryNavigation() {
    categories.forEach((category, index) => {
      const button = el('button', 'category-button');
      button.type = 'button';
      button.dataset.category = category;
      button.setAttribute('aria-pressed', 'false');
      const symbol = el('span', 'category-symbol', ['✧', '◇', '✦', '❧'][index]);
      symbol.setAttribute('aria-hidden', 'true');
      button.append(symbol, el('span', 'category-label', category),
        el('span', 'count-badge', characters.filter((character) => categoryName(character) === category).length));
      button.addEventListener('click', () => { selectedCategory = category; applyFilters(); });
      $('category-nav').append(button);
    });
    $('all-categories').addEventListener('click', () => { selectedCategory = ''; applyFilters(); });
  }

  function card(character) {
    const link = el('a', 'character-card');
    link.href = `#character/${encodeURIComponent(String(character.id))}`;
    link.setAttribute('aria-label', `${text(character.name, character.code)}，${text(character.element)}属性，查看详情`);
    const art = el('div', 'card-art');
    const portraits = list(character.portraits);
    art.append(picture(character.icon || portraits[0]?.url, '', ''), elementBadge(character.element));
    const content = el('div', 'card-content');
    content.append(el('div', 'card-title', text(character.title, character.origin)), el('h4', 'card-name', text(character.name, character.code)));
    if (character.earlyDesign === true) content.append(el('span', 'editor-tag', '早期方案'));
    const details = el('div', 'card-meta');
    details.append(el('span', '', text(character.type, '—')), el('span', '', `#${character.id}`));
    const rarity = el('span', 'stars', stars(character.rarity));
    rarity.setAttribute('aria-label', `${text(character.rarity, '未知')}星`);
    details.append(rarity);
    content.append(details);
    link.append(art, content);
    return link;
  }

  function filteredCharacters() {
    const terms = normalized(controls.search.value).trim().split(/\s+/).filter(Boolean);
    const selected = characters.filter((c) => {
      const matchesFields = ['element', 'type', 'origin'].every((key) => !controls[key].value || text(c[key]) === controls[key].value);
      return (!selectedCategory || categoryName(c) === selectedCategory)
        && matchesFields && terms.every((term) => searchIndex.get(String(c.id)).includes(term));
    });
    const sort = $('sort-order').value;
    if (sort === 'name') selected.sort((a, b) => text(a.name).localeCompare(text(b.name), 'zh-CN'));
    if (sort === 'id') selected.sort((a, b) => Number(a.id) - Number(b.id));
    if (sort === 'rarity') selected.sort((a, b) => Number(b.rarity) - Number(a.rarity) || Number(a.id) - Number(b.id));
    return selected;
  }

  function renderCatalog() {
    const selected = filteredCharacters();
    const fragment = document.createDocumentFragment();
    categories.forEach((category, index) => {
      const members = selected.filter((character) => categoryName(character) === category);
      if (!members.length) return;
      const group = el('section', 'catalog-group');
      const title = el('h3', 'group-title', category);
      title.id = `catalog-group-${index}`;
      title.append(el('span', 'group-count', `${members.length} 位`));
      group.setAttribute('aria-labelledby', title.id);
      const grid = el('div', 'character-grid');
      members.forEach((character) => grid.append(card(character)));
      group.append(title, el('p', 'group-description', categoryDescriptions[category]), grid);
      fragment.append(group);
    });
    $('character-grid').replaceChildren(fragment);
    document.querySelectorAll('.category-button').forEach((button) =>
      button.setAttribute('aria-pressed', String(button.dataset.category === selectedCategory)));
    $('all-categories').setAttribute('aria-current', selectedCategory ? 'false' : 'page');
    $('result-count').textContent = `${selected.length} / ${characters.length}`;
    const filtered = selectedCategory || controls.search.value.trim() || ['element', 'type', 'origin'].some((key) => controls[key].value);
    $('filter-status').textContent = filtered ? `${selectedCategory || '全部分类'} · 找到 ${selected.length} 位角色 · 可继续组合关键词与筛选` : '按毛茸异世界、原创与改版、Boss角色和小动物四栏查阅，也可组合属性、类型与来源筛选。';
    $('empty-state').hidden = selected.length > 0 || characters.length === 0;
    $('load-error').hidden = characters.length > 0;
  }

  function route() {
    const hash = location.hash.slice(1);
    let id = '';
    try { id = hash.startsWith('character/') ? decodeURIComponent(hash.slice(10)) : ''; } catch { id = ''; }
    if (id) {
      const character = byId.get(id);
      $('catalog-view').hidden = true;
      $('detail-view').hidden = false;
      if (id !== currentId) {
        document.querySelectorAll('audio').forEach((audio) => audio.pause());
        if (character && typeof window.renderWikiCharacter === 'function') {
          window.renderWikiCharacter($('detail-view'), character, meta, helpers);
          document.title = `${text(character.name, character.code)} · 星见图鉴`;
        } else {
          const empty = el('div', 'empty-state');
          const back = el('a', 'primary-button', '返回角色索引');
          back.href = '#';
          empty.append(el('h2', '', '未找到这位角色'), el('p', '', '该角色 ID 不在本次导出的资料中。'), back);
          $('detail-view').replaceChildren(empty);
        }
        window.scrollTo({top: 0});
      }
      currentId = id;
    } else {
      if (currentId) document.querySelectorAll('audio').forEach((audio) => audio.pause());
      $('detail-view').hidden = true;
      $('catalog-view').hidden = false;
      document.title = '星见图鉴 · MOD 角色 Wiki';
      currentId = '';
    }
  }

  function applyFilters() {
    renderCatalog();
    if (currentId) location.hash = '';
  }

  function clearFilters() {
    selectedCategory = '';
    Object.values(controls).forEach((control) => { control.value = ''; });
    applyFilters();
  }

  fillOptions(controls.element, 'element');
  fillOptions(controls.type, 'type');
  fillOptions(controls.origin, 'origin');
  renderCategoryNavigation();
  controls.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFilters, 80);
  });
  ['element', 'type', 'origin'].forEach((key) => controls[key].addEventListener('change', applyFilters));
  $('sort-order').addEventListener('change', renderCatalog);
  $('clear-filters').addEventListener('click', clearFilters);
  $('empty-reset').addEventListener('click', clearFilters);
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    document.querySelector('.filter-panel').open = true;
    controls.search.focus();
  });
  document.addEventListener('play', (event) => {
    if (event.target.tagName === 'AUDIO') document.querySelectorAll('audio').forEach((audio) => {
      if (audio !== event.target) audio.pause();
    });
  }, true);
  if (window.matchMedia('(max-width: 640px)').matches) document.querySelector('.filter-panel').open = false;
  renderMeta();
  renderCatalog();
  route();
})();
