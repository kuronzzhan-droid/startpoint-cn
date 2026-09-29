/* Detail rendering stays separate so the catalogue remains small and searchable. */
window.renderWikiCharacter = function renderWikiCharacter(container, character, meta, ui) {
  'use strict';
  const {el, list, object, text, safeUrl, safeData, disclosure, elementBadge, picture, formatNumber, stars, categoryName} = ui;
  const fragment = document.createDocumentFragment();
  const sections = [];
  const breadcrumb = el('nav', 'breadcrumbs');
  breadcrumb.setAttribute('aria-label', '当前位置');
  const back = el('a', '', '全部角色');
  back.href = '#';
  breadcrumb.append(back, el('span', '', '/'), el('span', '', text(character.name, character.code)));
  fragment.append(breadcrumb);
  const heading = el('header', 'detail-heading');
  const identity = el('div');
  identity.append(el('div', 'detail-title', text(character.title, 'MOD 角色资料')),
    el('h1', '', text(character.name, character.code)),
    el('div', 'character-code', `No. ${text(character.id)} · ${text(character.code)}`));
  const badges = el('div', 'detail-badges');
  badges.append(elementBadge(character.element), el('span', 'badge', character.type),
    el('span', 'badge', categoryName(character)), el('span', 'badge', character.origin));
  const rarity = el('span', 'stars', stars(character.rarity));
  rarity.setAttribute('aria-label', `${text(character.rarity, '未知')}星`);
  badges.append(rarity);
  heading.append(identity, badges);
  fragment.append(heading);

  function section(id, title) {
    const node = el('section', 'detail-section');
    node.id = `detail-${id}`;
    const h2 = el('h2', 'section-title', title);
    h2.id = `detail-title-${id}`;
    node.setAttribute('aria-labelledby', h2.id);
    node.append(h2);
    sections.push({id: node.id, title, node});
    return node;
  }
  function note(value) { return el('div', 'note-box', value); }
  function paragraph(value, className = 'description') { return el('p', className, value); }
  function dataTable(headers, rows) {
    const wrap = el('div', 'stats-table-wrap');
    const table = el('table', 'stats-table');
    const head = el('thead');
    const header = el('tr');
    headers.forEach((value) => {
      const th = el('th', '', value);
      th.scope = 'col';
      header.append(th);
    });
    head.append(header);
    const body = el('tbody');
    rows.forEach((row) => {
      const tr = el('tr');
      row.forEach((value) => tr.append(el('td', '', value)));
      body.append(tr);
    });
    table.append(head, body);
    wrap.append(table);
    return wrap;
  }

  const overview = el('div', 'detail-layout');
  const portraits = list(character.portraits).filter((p) => p && safeUrl(p.url));
  const artPanel = el('div', 'portrait-panel');
  const stage = el('div', 'portrait-stage');
  const portraitButtons = el('div', 'portrait-controls');
  function showPortrait(index) {
    const selected = portraits[index];
    stage.replaceChildren(picture(selected?.url || character.icon, `${text(character.name)} · ${text(selected?.label, '角色图像')}`, ''));
    [...portraitButtons.children].forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
  }
  portraits.forEach((portrait, index) => {
    const button = el('button', '', text(portrait.label, `立绘 ${index + 1}`));
    button.type = 'button';
    button.setAttribute('aria-pressed', String(index === 0));
    button.addEventListener('click', () => showPortrait(index));
    portraitButtons.append(button);
  });
  showPortrait(0);
  artPanel.append(stage);
  if (portraits.length) artPanel.append(portraitButtons);
  const profile = el('section', 'profile-panel');
  profile.append(el('h2', 'section-title', '角色档案'));
  const info = el('dl', 'info-table');
  const infoRows = [['属性', character.element], ['类型', character.type], ['定位', character.role],
    ['种族', list(character.races).join(' / ')], ['性别', character.gender], ['CV（资料表）', character.cv],
    ['收录来源', character.origin], ['改动范围', list(character.modificationScope).join('、')]];
  infoRows.forEach(([label, value]) => info.append(el('dt', '', label), el('dd', '', text(value, '未记录'))));
  profile.append(info, paragraph(text(character.profile, '当前资料中暂无角色简介。'), 'profile-copy'));
  if (text(character.editorNote).trim()) {
    const editorNote = el('aside', 'editor-note');
    editorNote.setAttribute('aria-label', '资料注记');
    editorNote.append(el('span', 'eyebrow', '资料注记'), paragraph(character.editorNote));
    profile.append(editorNote);
  }
  overview.append(artPanel, profile);
  fragment.append(overview);
  const toc = el('nav', 'detail-toc');
  toc.setAttribute('aria-label', '角色页内目录');
  fragment.append(toc);

  const stats = object(character.stats);
  const statsSection = section('stats', '基础数值');
  statsSection.append(paragraph(text(stats.note, '数值以本次导出数据为准。')));
  const levels = list(stats.levels).filter((row) => row && typeof row === 'object');
  if (levels.length) statsSection.append(dataTable(['等级断点', 'HP', '攻击力'], levels.map((row) =>
    [text(row.level, '—'), formatNumber(row.hp), formatNumber(row.atk)])));
  else statsSection.append(note('当前数据中缺少基础数值表。'));
  if (stats.awakePerNode && typeof stats.awakePerNode === 'object') {
    statsSection.append(el('h3', 'subsection-title', '觉醒节点增量'),
      dataTable(['计算单位', 'HP 增量', '攻击力增量'], [['每个已点亮觉醒大节点',
        formatNumber(stats.awakePerNode.hp), formatNumber(stats.awakePerNode.atk)]]));
  }
  if (stats.awakeNote) statsSection.append(note(stats.awakeNote));
  const extraStats = Object.fromEntries(Object.entries(stats).filter(([key]) => !['levels', 'note', 'awakePerNode', 'awakeNote'].includes(key)));
  if (Object.keys(extraStats).length) statsSection.append(disclosure('更多数值字段', extraStats));

  function abilityCard(ability, label) {
    const entry = object(ability);
    const card = el('div', 'data-card');
    card.append(el('span', 'card-label', label), el('h3', '', text(entry.name, label)), paragraph(text(entry.description, '当前数据中暂无效果文案。')));
    if (entry.descriptionSource) card.append(paragraph(`文案口径：${text(entry.descriptionSource)}`, 'voice-source'));
    const rows = list(entry.rows);
    if (rows.length) {
      const parsed = el('details', 'data-disclosure');
      parsed.append(el('summary', '', `逐条效果与原始数值 · ${rows.length} 条`));
      rows.forEach((row, i) => {
        const value = object(row);
        parsed.append(paragraph(`${text(value.index, i + 1)}. ${text(value.description, '此行暂无自动解释')}`, 'profile-copy'),
          disclosure('查看本条原始字段', value.values ?? row));
      });
      card.append(parsed);
    }
    if (Object.keys(object(entry.customText)).length) card.append(disclosure('关联的游戏文本', entry.customText));
    const programs = list(entry.relatedPrograms);
    if (programs.length) {
      const related = el('details', 'data-disclosure');
      related.append(el('summary', '', `关联能力与特殊弹射程序 · ${programs.length} 组`));
      programs.forEach((program) => {
        related.append(paragraph(text(program.kind, '关联程序'), 'profile-copy'));
        const summaries = el('ul', 'source-list');
        list(program.commands).forEach((command) => summaries.append(el('li', '', text(command))));
        related.append(summaries);
        if (program.commandsNote) related.append(paragraph(program.commandsNote, 'voice-source'));
        related.append(disclosure('完整程序节点与来源', program));
      });
      card.append(related);
    }
    return card;
  }
  const leaderSection = section('leader', '队长技能');
  leaderSection.append(abilityCard(character.leader, 'LEADER ABILITY'));
  const skillSection = section('skills', '主动技能');
  const skillCards = el('div', 'detail-cards');
  const skills = list(character.skills).filter((skill) => skill && typeof skill === 'object');
  skills.forEach((skill) => {
    const label = text(skill.label, ({1: '普通技能', 2: '进化技能', 3: '二次进化技能'})[skill.level] || '主动技能');
    const card = el('div', 'data-card');
    card.append(el('span', 'card-label', label), el('h3', '', text(skill.name, '未命名技能')), paragraph(text(skill.description, '当前数据中暂无技能文案。')));
    const skillMeta = el('div', 'skill-meta');
    if (skill.gauge != null) skillMeta.append(el('span', 'badge', `${text(skill.gaugeLabel, '满技能等级所需能量')} ${formatNumber(skill.gauge)}`));
    card.append(skillMeta);
    const commands = list(skill.commands);
    if (commands.length) {
      const details = el('details', 'data-disclosure');
      details.append(el('summary', '', `技能程序摘要 · ${formatNumber(skill.commandCount ?? commands.length)} 个节点`));
      if (skill.commandsNote) details.append(paragraph(skill.commandsNote, 'voice-source'));
      const summary = el('ul', 'source-list');
      commands.forEach((command) => summary.append(el('li', '', text(command))));
      details.append(summary);
      card.append(details);
    }
    if (skill.warning) card.append(note(skill.warning));
    card.append(disclosure('技能数据与完整程序节点', skill));
    skillCards.append(card);
  });
  skillSection.append(skillCards);
  if (!skills.length) skillSection.append(note('当前数据中没有可展示的主动技能。'));
  if (character.switch) {
    const switching = object(character.switch);
    skillSection.append(note(`技能切换：${text(switching.label, switching.kind)}。具体判定字段见下方数据。`),
      disclosure('技能切换条件数据', switching));
  }
  const abilitySection = section('abilities', '角色能力');
  const abilityCards = el('div', 'detail-cards');
  list(character.abilities).forEach((ability, i) => abilityCards.append(abilityCard(ability, `能力 ${text(ability?.slot, i + 1)}`)));
  abilitySection.append(abilityCards);

  const voices = list(character.voices).filter((voice) => voice && typeof voice === 'object');
  const voiceSection = section('voices', '语音与台词');
  renderVoices(voiceSection, voices);
  const sourceSection = section('sources', '数据口径与来源');
  sourceSection.append(paragraph(`本地版本 ${text(meta.version, '未记录')} · 导出时间 ${text(meta.generatedAt, '未记录')}`),
    paragraph(text(meta.dataNote, '游戏文案与程序数据分别展示；自动解析不等同于实机机制验收。')));
  if (list(character.warnings).length) {
    const warning = el('div', 'note-box');
    const items = el('ul');
    list(character.warnings).forEach((value) => items.append(el('li', '', text(safeData(value)))));
    warning.append(items);
    sourceSection.append(warning);
  }
  if (character.sources) sourceSection.append(disclosure('来源表与校验摘要', character.sources));
  const used = ['id', 'code', 'name', 'title', 'rarity', 'element', 'elementId', 'type', 'role', 'races', 'gender', 'cv', 'profile', 'origin', 'category', 'editorNote', 'earlyDesign', 'modificationScope', 'icon', 'portraits', 'stats', 'leader', 'skills', 'switch', 'abilities', 'voices', 'warnings', 'sources'];
  const extra = Object.fromEntries(Object.entries(character).filter(([key]) => !used.includes(key)));
  if (Object.keys(extra).length) sourceSection.append(disclosure('原始角色字段与扩展资料', extra));
  sections.forEach(({id, title, node}) => {
    const link = el('a', '', title);
    link.href = `#character/${encodeURIComponent(String(character.id))}`;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      document.getElementById(id)?.scrollIntoView({behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
    });
    toc.append(link);
    fragment.append(node);
  });
  container.replaceChildren(fragment);

  function renderVoices(target, entries) {
    const audioCount = entries.filter((voice) => safeUrl(voice.audio)).length;
    const zhCount = entries.filter((voice) => text(voice.zh).trim()).length;
    target.append(paragraph(`${entries.length} 条语音记录 · ${audioCount} 条可试听 · ${zhCount} 条有中文台词。点击播放时才加载音频，同一时间只播放一条。`, 'voice-summary'));
    if (!entries.length) {
      target.append(note('本次快照中未找到该角色的可用语音。'));
      return;
    }
    const toolbar = el('div', 'voice-toolbar');
    const search = el('input');
    search.type = 'search';
    search.placeholder = '搜索语音场景、原文或中文台词…';
    search.setAttribute('aria-label', '搜索本角色语音');
    const category = el('select');
    category.setAttribute('aria-label', '语音场景筛选');
    category.append(el('option', '', '全部场景'));
    category.firstChild.value = '';
    [...new Set(entries.map((voice) => text(voice.category)).filter(Boolean))].forEach((value) => {
      const option = el('option', '', value); option.value = value; category.append(option);
    });
    const translation = el('select');
    translation.setAttribute('aria-label', '台词完整度筛选');
    [['', '全部台词'], ['translated', '已有中文'], ['missing', '中文待补录']].forEach(([value, label]) => {
      const option = el('option', '', label); option.value = value; translation.append(option);
    });
    toolbar.append(search, category, translation);
    const count = el('div', 'voice-match-count');
    count.setAttribute('role', 'status');
    const results = el('div', 'voice-list');
    const more = el('button', 'voice-load-more');
    more.type = 'button';
    target.append(toolbar, count, results, more);
    let matching = entries;
    let shown = 0;
    const sourceLabels = {'current-speech': '游戏内字幕', 'hash-matched-script': '音频匹配台词稿', 'hash-matched-original': '音频匹配原版台词', missing: '暂无台词资料'};
    function voiceCard(voice) {
      const card = el('div', 'voice-card');
      const header = el('div', 'voice-header');
      header.append(el('h3', '', text(voice.label, voice.slot)), el('span', 'badge', text(voice.category, '其他')), el('span', 'voice-slot', voice.slot));
      card.append(header);
      [['原文', voice.ja, '原文待补录', 'original'], ['中文', voice.zh, '中文台词 / 翻译待补录', 'translated']].forEach(([label, value, missing, style]) => {
        const line = el('dl', `voice-text ${style}`);
        line.append(el('dt', '', label), el('dd', value ? '' : 'muted', text(value, missing)));
        card.append(line);
      });
      if (safeUrl(voice.audio)) {
        const audio = el('audio');
        audio.controls = true;
        audio.preload = 'none';
        audio.src = safeUrl(voice.audio);
        audio.setAttribute('aria-label', `${text(character.name)} ${text(voice.label, voice.slot)}语音试听`);
        audio.addEventListener('error', () => {
          if (!card.querySelector('.audio-unavailable')) card.append(paragraph('此音频无法读取，请检查媒体文件是否完整。', 'audio-unavailable'));
        });
        card.append(audio);
      } else card.append(paragraph('本次快照未包含音频文件。', 'audio-unavailable'));
      if (voice.textSource) {
        const source = text(safeData(voice.textSource)).split(' + ').map((part) => sourceLabels[part] || part).join(' + ');
        card.append(paragraph(`台词来源：${source}`, 'voice-source'));
      }
      return card;
    }
    function addPage() {
      const next = matching.slice(shown, shown + 24);
      const page = document.createDocumentFragment();
      next.forEach((voice) => page.append(voiceCard(voice)));
      results.append(page);
      shown += next.length;
      count.textContent = `找到 ${matching.length} 条，已显示 ${shown} 条`;
      count.style.marginBottom = '12px';
      more.hidden = shown >= matching.length;
      more.textContent = `继续显示语音（剩余 ${matching.length - shown} 条）`;
    }
    function filter() {
      const query = search.value.trim().toLocaleLowerCase('zh-CN');
      matching = entries.filter((voice) => (!category.value || voice.category === category.value)
        && (!translation.value || (translation.value === 'translated' ? text(voice.zh).trim() : !text(voice.zh).trim()))
        && (!query || [voice.label, voice.slot, voice.ja, voice.zh].map((value) => text(value)).join(' ').toLocaleLowerCase('zh-CN').includes(query)));
      results.querySelectorAll('audio').forEach((audio) => audio.pause());
      results.replaceChildren();
      shown = 0;
      addPage();
      if (!matching.length) results.append(note('没有匹配的语音，试试其他关键词或场景。'));
    }
    search.addEventListener('input', filter);
    category.addEventListener('change', filter);
    translation.addEventListener('change', filter);
    more.addEventListener('click', addPage);
    filter();
  }
};
