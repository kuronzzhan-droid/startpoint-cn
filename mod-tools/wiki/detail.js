/* Native-style character dashboard: illustrated card, status bar and accessible tabs. */
window.renderWikiCharacter = function renderWikiCharacter(container, character, meta, ui) {
  'use strict';
  const {el, list, object, text, safeUrl, elementBadge, picture, formatNumber, rarityBadge, nativeIcon, categoryName} = ui;
  const fragment = document.createDocumentFragment();
  const breadcrumb = el('nav', 'breadcrumbs');
  breadcrumb.setAttribute('aria-label', '当前位置');
  const back = el('a', 'back-button', '‹ 返回角色列表'); back.href = '#';
  breadcrumb.append(back, el('span', '', categoryName(character)));
  fragment.append(breadcrumb);
  const heading = el('header', 'detail-heading game-panel');
  const identity = el('div', 'detail-identity');
  identity.append(el('div', 'detail-title', text(character.title, '角色资料')), el('h1', '', text(character.name)));
  if (list(character.aliases).length) identity.append(el('span', 'alias-tag', character.aliases.join(' / ')));
  const badges = el('div', 'detail-badges');
  badges.append(elementBadge(character.element), rarityBadge(character.rarity), el('span', 'badge', categoryName(character)));
  list(character.themes || (character.theme ? [character.theme] : [])).forEach((theme) => badges.append(el('span', 'theme-tag', theme)));
  heading.append(identity, badges);
  fragment.append(heading);

  function paragraph(value, className = 'description') { return el('p', className, value); }
  function note(value) { return el('div', 'note-box', value); }
  function section(title) {
    const node = el('section', 'detail-section'); node.append(el('h2', 'section-title', title)); return node;
  }
  function dataTable(headers, rows) {
    const wrap = el('div', 'stats-table-wrap');
    const table = el('table', 'stats-table');
    const head = el('thead'); const tr = el('tr');
    headers.forEach((value) => { const th = el('th', '', value); th.scope = 'col'; tr.append(th); });
    head.append(tr); const body = el('tbody');
    rows.forEach((row) => { const line = el('tr'); row.forEach((value) => line.append(el('td', '', value))); body.append(line); });
    table.append(head, body); wrap.append(table); return wrap;
  }

  const layout = el('div', 'detail-layout');
  const portraits = list(character.portraits).filter((portrait) => portrait && safeUrl(portrait.url));
  const artPanel = el('div', 'portrait-panel');
  const stage = el('div', 'portrait-stage');
  const portraitButtons = el('div', 'portrait-controls');
  function showPortrait(index) {
    const selected = portraits[index];
    stage.replaceChildren(picture(selected?.url || character.icon, `${text(character.name)} · ${text(selected?.label, '角色立绘')}`, ''));
    [...portraitButtons.children].forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
  }
  portraits.forEach((portrait, index) => {
    const button = el('button', '', text(portrait.label, `立绘 ${index + 1}`)); button.type = 'button';
    button.addEventListener('click', () => showPortrait(index)); portraitButtons.append(button);
  });
  showPortrait(0);
  artPanel.append(stage);
  if (portraits.length) artPanel.append(portraitButtons);
  const artCaption = el('div', 'portrait-caption');
  artCaption.append(el('span', '', text(character.name)), el('span', '', text(character.title)));
  artPanel.append(artCaption);
  const dashboard = el('div', 'character-dashboard');
  layout.append(artPanel, dashboard);
  fragment.append(layout);

  const stats = object(character.stats);
  const levels = list(stats.levels).filter((row) => row && Number.isFinite(Number(row.level))).sort((a, b) => Number(a.level) - Number(b.level));
  const status = el('div', 'status-panel');
  const statusHeader = el('div', 'status-header');
  const type = el('span', 'type-label'); type.append(nativeIcon('types', character.type, ''), el('span', '', text(character.type, '类型未记录')));
  const levelSelect = el('select'); levelSelect.setAttribute('aria-label', '选择基础数值等级');
  levels.forEach((row, index) => { const option = el('option', '', `Lv. ${row.level}`); option.value = String(index); levelSelect.append(option); });
  if (levels.length) levelSelect.value = String(levels.length - 1);
  else levelSelect.append(el('option', '', '等级未记录'));
  statusHeader.append(type, el('span', 'status-races', list(character.races).join(' / ')), levelSelect);
  const values = el('div', 'status-values');
  const hp = el('strong'); const atk = el('strong');
  [['hp', 'HP', hp], ['atk', '攻击力', atk]].forEach(([key, label, value]) => {
    const tile = el('div', 'status-value'); const icon = el('span', 'stat-icon'); icon.append(nativeIcon('icons', key, ''));
    tile.append(icon, el('span', 'stat-label', label), value); values.append(tile);
  });
  function updateStatus() { const value = levels[Number(levelSelect.value)] || {}; hp.textContent = formatNumber(value.hp); atk.textContent = formatNumber(value.atk); }
  levelSelect.addEventListener('change', updateStatus); updateStatus();
  status.append(statusHeader, values, el('div', 'status-note', '基础数值 · 未计觉醒节点、玛纳板、装备与能力加成'));
  dashboard.append(status);

  const tabList = el('div', 'detail-tabs'); tabList.setAttribute('role', 'tablist'); tabList.setAttribute('aria-label', '角色详细资料');
  const panels = el('div', 'detail-panels');
  dashboard.append(tabList, panels);
  const tabs = [];
  function tab(key, label) {
    const button = el('button', '', label); button.type = 'button'; button.id = `tab-${key}`;
    button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', `panel-${key}`);
    const panel = el('div', 'detail-tab-panel'); panel.id = `panel-${key}`; panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', button.id); panel.tabIndex = 0;
    button.addEventListener('click', () => selectTab(key));
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = tabs.findIndex((item) => item.key === key);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      selectTab(tabs[next].key); tabs[next].button.focus();
    });
    tabs.push({key, button, panel}); tabList.append(button); panels.append(panel); return panel;
  }
  function selectTab(key) {
    tabs.forEach((item) => {
      const selected = item.key === key; item.panel.hidden = !selected;
      item.button.setAttribute('aria-selected', String(selected)); item.button.tabIndex = selected ? 0 : -1;
      if (!selected) item.panel.querySelectorAll('audio').forEach((audio) => audio.pause());
    });
  }

  const profilePanel = tab('profile', '资料');
  const profile = section('角色档案');
  const info = el('dl', 'info-table');
  [['属性', character.element], ['类型', character.type], ['定位', character.role], ['种族', list(character.races).join(' / ')],
    ['性别', character.gender], ['CV（资料表）', character.cv], ['收录来源', character.origin]].forEach(([label, value]) =>
    info.append(el('dt', '', label), el('dd', '', text(value, '未记录'))));
  profile.append(info, paragraph(text(character.profile, '当前资料中暂无角色简介。'), 'profile-copy'));
  if (text(character.editorNote).trim()) {
    const annotation = el('aside', 'editor-note'); annotation.setAttribute('aria-label', '资料注记');
    annotation.append(el('span', 'eyebrow', '资料注记'), paragraph(character.editorNote)); profile.append(annotation);
  }
  profilePanel.append(profile);
  const statSection = section('等级与基础数值');
  statSection.append(paragraph(text(stats.note, '数值以本次导出资料为准。'), 'panel-note'));
  if (levels.length) statSection.append(dataTable(['等级断点', 'HP', '攻击力'], levels.map((row) => [row.level, formatNumber(row.hp), formatNumber(row.atk)])));
  else statSection.append(note('当前资料缺少基础数值。'));
  if (stats.awakePerNode) {
    statSection.append(el('h3', 'subsection-title', '觉醒节点增量'), dataTable(['每个已点亮大节点', 'HP 增量', '攻击力增量'],
      [['独立加成', formatNumber(stats.awakePerNode.hp), formatNumber(stats.awakePerNode.atk)]]));
    if (stats.awakeNote) statSection.append(note(stats.awakeNote));
  }
  profilePanel.append(statSection);

  function effectCard(entry, label) {
    const data = object(entry); const card = el('div', 'data-card');
    card.append(el('span', 'card-label', label));
    if (data.name && data.name !== label) card.append(el('h3', '', data.name));
    card.append(paragraph(text(data.description, '当前资料中暂无效果文案。')));
    const rows = list(data.rows).filter((row) => row && row.description);
    if (rows.length > 1) {
      const detail = el('details', 'effect-breakdown'); detail.append(el('summary', '', `分项效果 · ${rows.length} 条`));
      const items = el('ul'); rows.forEach((row) => items.append(el('li', '', row.description))); detail.append(items); card.append(detail);
    }
    window.renderWikiNumericDetails(card, data.numericDetails, ui);
    list(data.relatedPrograms).forEach((program) => window.renderWikiNumericDetails(card, program.numericDetails, ui));
    return card;
  }
  const skillPanel = tab('skills', '技能');
  const leaderSection = section('队长技能'); leaderSection.append(effectCard(character.leader, '队长')); skillPanel.append(leaderSection);
  const skillSection = section('主动技能');
  const skills = list(character.skills).filter((skill) => skill && typeof skill === 'object');
  skills.forEach((skill) => {
    const label = text(skill.label, ({1:'普通技能',2:'进化技能',3:'二次进化技能'})[skill.level] || '主动技能');
    const card = effectCard(skill, label);
    if (skill.gauge != null) {
      const energy = el('div', 'skill-energy'); energy.append(el('span', '', text(skill.gaugeLabel, '满技能等级所需能量')), el('strong', '', formatNumber(skill.gauge)));
      card.insertBefore(energy, card.querySelector('.numeric-block'));
    }
    skillSection.append(card);
  });
  if (!skills.length) skillSection.append(note('当前资料中没有可展示的主动技能。'));
  if (character.switch?.label) skillSection.append(note(`技能切换条件：${character.switch.label}${character.switch.conditionName ? ` · ${character.switch.conditionName}` : ''}`));
  skillPanel.append(skillSection);
  if (character.legacyReference) {
    const reference = character.legacyReference;
    const legacy = section('前人 Wiki · 历史参考');
    legacy.append(note(reference.note), paragraph(`旧稿更新于 ${reference.updatedAt || '未记录'}`, 'panel-note'));
    list(reference.skills).forEach((skill) => legacy.append(effectCard(skill, skill.label)));
    skillPanel.append(legacy);
  }
  const abilityPanel = tab('abilities', '能力');
  const abilitySection = section('角色能力');
  list(character.abilities).forEach((ability, index) => abilitySection.append(effectCard(ability, `能力 ${text(ability?.slot, index + 1)}`)));
  abilityPanel.append(abilitySection);
  const voicePanel = tab('voices', '语音');
  const voiceSection = section('语音与台词');
  window.renderWikiVoices(voiceSection, list(character.voices).filter((voice) => voice && typeof voice === 'object'), character, ui);
  voicePanel.append(voiceSection);
  const comparison = object(character.officialComparison);
  if (comparison.status === 'changed' || comparison.status === 'unchanged') {
    const comparePanel = tab('comparison', '原版差异');
    window.renderWikiComparison(comparePanel, comparison, ui);
  }
  const sourcePanel = tab('about', '说明');
  const about = section('资料说明');
  about.append(paragraph(`游戏数据版本 ${text(meta.version, '未记录')}`, 'panel-note'),
    paragraph(`资料更新于 ${text(meta.generatedAt, '未记录')}`, 'panel-note'),
    paragraph('数值与台词以此份资料快照为准。技能按普通与进化分别展示；语音来源逐条标注，未取得可靠台词的录音保留待补录标记。', 'panel-note'));
  if (meta.dataNote) about.append(note(meta.dataNote));
  if (meta.voiceCounts?.scopeNote) about.append(paragraph(meta.voiceCounts.scopeNote, 'panel-note'));
  list(meta.credits).forEach((credit) => about.append(paragraph(credit, 'panel-note')));
  sourcePanel.append(about);
  selectTab(comparison.status === 'changed' ? 'comparison' : 'profile');
  container.replaceChildren(fragment);
};
