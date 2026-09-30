/* Series are a navigation layer; guides and recommendations keep their original dungeon IDs. */
(() => {
  'use strict';
  const definitions = {
    'series-gauntlets': {title:'连战模式', labels:['幻想连战', '普通深渊', '深渊连战EX'], compact:false},
    'series-machina': {title:'机兵决战', labels:['火', '水', '雷', '风', '光', '暗', '无属性'], compact:true},
    'series-waste-dragons': {title:'荒龙讨伐', labels:['火', '水', '雷', '风', '光', '暗'], compact:true},
    'series-spirit-beasts': {title:'精灵兽讨伐', labels:['火', '水', '雷', '风', '光', '暗'], compact:true},
  };
  const preferred = (items) => items.find((item) => /^boss-/.test(item.id))
    || items.find((item) => /^event-rush-/.test(item.id))
    || items.find((item) => item.category === '领主战')
    || items.find((item) => item.category === '模式') || items[0];
  function group(items, id) {
    const definition = Object.hasOwn(definitions, id) ? definitions[id] : null;
    const members = items.filter((item) => item.seriesId === id && item.variantLabel);
    if (!definition || !members.length) return null;
    const labels = [...new Set(members.map((item) => item.variantLabel))];
    labels.sort((a, b) => {
      const ai = definition.labels.indexOf(a), bi = definition.labels.indexOf(b);
      return (ai < 0 ? 100 : ai) - (bi < 0 ? 100 : bi) || a.localeCompare(b, 'zh-CN');
    });
    const variants = labels.map((label) => {
      const versions = members.filter((item) => item.variantLabel === label);
      return {label, versions, primary:preferred(versions)};
    });
    const primary = preferred(members);
    return {...definition, id, members, variants, category:primary.category,
      categories:[...new Set(members.map((item) => item.category))],
      banner:primary.banner, entryImage:primary.entryImage,
      summary:labels.join(' · '),
      countText:`${variants.length} ${definition.compact ? '种首领' : '种连战'} · ${members.length} 个版本`};
  }
  function entries(items) {
    const result = [], included = new Set();
    for (const item of items) {
      const series = group(items, item.seriesId);
      if (!series) {result.push(item); continue;}
      if (!included.has(series.id)) {result.push(series); included.add(series.id);}
    }
    return result;
  }
  function render(host, series, data, ui, options, renderLeaf) {
    const {el} = ui, D = window.WFDungeons, page = el('article', 'dungeon-detail dungeon-series');
    const back = el('a', 'back-button', '‹ 返回副本与模式'); back.href = '#dungeons';
    const heading = el('header', 'dungeon-header'); heading.append(el('h1', '', series.title));
    const intro = el('p', 'dungeon-series-intro muted', '选择首领或连战模式，查看攻略与推荐队伍。');
    const choices = el('div', 'dungeon-variants'); choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', `${series.title}分类`);
    const versions = el('details', 'dungeon-fold dungeon-versions'), versionTitle = el('summary'), versionList = el('div', 'dungeon-version-list');
    versions.append(versionTitle, versionList);
    const content = el('div', 'dungeon-series-content'), controls = [];
    page.append(back, heading, intro, choices, versions, content); host.replaceChildren(page);
    let currentVariant = null;
    function selectVersion(item) {
      for (const node of versionList.children) node.setAttribute('aria-pressed', String(node.dataset.id === item.id));
      return renderLeaf(content, data, ui, {...options, id:item.id, embedded:true});
    }
    function choose(variant) {
      currentVariant = variant;
      controls.forEach(({node, value}) => node.setAttribute('aria-pressed', String(value === variant)));
      versions.open = false; versionTitle.textContent = `${variant.label} · 关卡版本（${variant.versions.length}）`;
      versionList.replaceChildren();
      for (const item of variant.versions) {
        const row = D.button(ui, '', () => selectVersion(item), 'dungeon-version'); row.dataset.id = item.id;
        row.append(el('span', 'dungeon-version-name', item.title), el('span', 'muted', `${item.category} · ${item.quests?.length || 0} 个关卡`));
        versionList.append(row);
      }
      return selectVersion(variant.primary);
    }
    for (const variant of series.variants) {
      const node = D.button(ui, '', () => choose(variant), 'dungeon-variant');
      const art = D.image(ui, variant.primary.entryImage || variant.primary.banner, variant.primary.title, 'dungeon-variant-icon');
      if (art) node.append(art);
      const label = el('span', 'dungeon-variant-label'); label.append(el('strong', '', variant.label));
      if (series.compact) label.append(el('span', '', variant.primary.title));
      node.append(label); choices.append(node); controls.push({node, value:variant});
    }
    const initial = choose(series.variants[0]);
    return Promise.resolve(initial).then(() => ({series, get variant() {return currentVariant;}}));
  }
  window.WFDungeonSeries = {group, entries, render};
})();
