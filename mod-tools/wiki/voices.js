/* Paged native audio controls; no audio is fetched before playback. */
window.renderWikiVoices = function renderWikiVoices(target, entries, character, ui) {
  'use strict';
  const {el, list, text, safeUrl, safeData} = ui;
  const paragraph = (value, className) => el('p', className, value);
  const note = (value) => el('div', 'note-box', value);
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
    const sourceLabels = {'current-speech': '游戏内字幕', 'package-speech': '独立角色包字幕', 'hash-matched-script': '音频匹配台词稿', 'hash-matched-original': '音频匹配原版台词', missing: '暂无台词资料'};
    function voiceCard(voice) {
      const card = el('div', 'voice-card');
      const header = el('div', 'voice-header');
      header.append(el('h3', '', text(voice.label, '角色语音')), el('span', 'badge', text(voice.category, '其他')));
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
        audio.setAttribute('aria-label', `${text(character.name)} ${text(voice.label, '角色')}语音试听`);
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
        && (!query || [voice.label, voice.ja, voice.zh].map((value) => text(value)).join(' ').toLocaleLowerCase('zh-CN').includes(query)));
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
};
