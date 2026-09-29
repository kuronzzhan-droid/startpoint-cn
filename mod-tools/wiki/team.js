/* Team planning stays in this browser. No account, uploads or game mutations. */
(() => {
  'use strict';
  const storageKey = 'wf-wiki-teams-v1';
  const S = window.WFTeamState;
  let team = S.empty(), undo = [], redo = [], chosen = {group: 'main', index: 0};
  let weaponQuery = '', characterFilterState = {}, name = '我的队伍';
  const labels = {main: '主位', unison: '合击', weapon: '装备', soul: '魂珠'};
  function savedTeams() {
    try { const data = JSON.parse(localStorage.getItem(storageKey) || '[]'); return Array.isArray(data) ? data.filter((item) => item && typeof item.name === 'string' && item.team && typeof item.team === 'object') : []; }
    catch { return []; }
  }
  window.renderWikiTeam = (host, data, ui) => {
    const {el, picture, elementBadge} = ui;
    const characters = new Map(data.characters.map((c) => [String(c.id), c]));
    const equipment = new Map((data.equipment || []).map((w) => [String(w.id), w]));
    team = S.validate(team, characters, equipment);
    const board = el('div', 'team-board game-panel');
    const preview = el('section', 'team-preview game-panel');
    const library = el('section', 'team-library game-panel');
    const controls = el('div', 'team-controls');
    const status = el('p', 'team-status'); status.setAttribute('role', 'status');
    const title = el('input'); title.value = name; title.maxLength = 60; title.setAttribute('aria-label', '队伍名称');
    title.addEventListener('input', () => {name = title.value;});
    function button(label, action, className = 'secondary-button') {
      const b = el('button', className, label); b.type = 'button'; b.addEventListener('click', action); return b;
    }
    function change(next) {
      if (JSON.stringify(next) === JSON.stringify(team)) return;
      undo.push(S.copy(team)); undo = undo.slice(-50); redo = []; team = next; paintBoard();
    }
    function assign(id, kind = '') {
      const expected = S.isCharacter(chosen.group) ? 'character' : 'equipment';
      if (kind && kind !== expected) {status.textContent = '请把角色放入主位或合击位，把武器放入装备或魂珠槽。'; return;}
      change(S.place(team, chosen.group, chosen.index, id, characters, equipment));
    }
    function chooseSlot(group, index) {
      if (S.isCharacter(group) !== S.isCharacter(chosen.group)) {
        weaponQuery = ''; weaponSearch.value = ''; characterFilters.clearSearch(false);
        characterFilterState = characterFilters.getState();
      }
      chosen = {group, index};
    }
    const picker = el('select'); picker.setAttribute('aria-label', '已保存队伍');
    function refreshSaved() {
      picker.replaceChildren(el('option', '', '选择已保存队伍'));
      savedTeams().forEach((item, i) => {const o = el('option', '', item.name || `队伍${i + 1}`); o.value = String(i); picker.append(o);});
      picker.options[0].value = '';
    }
    const save = () => {
      const saved = savedTeams(); const record = {name: name.trim() || '我的队伍', team: S.copy(team)};
      const index = saved.findIndex((item) => item.name === record.name);
      if (index >= 0) saved[index] = record; else saved.unshift(record);
      try {localStorage.setItem(storageKey, JSON.stringify(saved)); refreshSaved(); status.textContent = '队伍已保存到此浏览器。';}
      catch {status.textContent = '此浏览器暂不能保存，请使用导出队伍。';}
    };
    picker.addEventListener('change', () => {
      const item = savedTeams()[Number(picker.value)]; if (!item || picker.value === '') return;
      change(S.validate(item.team, characters, equipment)); name = item.name || '我的队伍'; title.value = name;
    });
    const file = el('input'); file.type = 'file'; file.accept = 'application/json,.json'; file.hidden = true;
    file.addEventListener('change', async () => {
      const selected = file.files[0]; if (!selected) return;
      try {
        if (selected.size > 100000) throw new Error();
        const record = JSON.parse(await selected.text());
        if (record.format !== 'wf-wiki-team-v1' || !record.team) throw new Error();
        change(S.validate(record.team, characters, equipment));
        name = String(record.name || '导入的队伍').slice(0, 60); title.value = name;
        status.textContent = '已导入队伍；不在当前图鉴中的条目已留空。';
      } catch {status.textContent = '请选择本站导出的队伍 JSON 文件。';}
      file.value = '';
    });
    controls.append(title, button('保存队伍', save, 'primary-button'), picker,
      button('撤销', () => {if (undo.length) {redo.push(S.copy(team)); team = undo.pop(); paintBoard();}}),
      button('重做', () => {if (redo.length) {undo.push(S.copy(team)); team = redo.pop(); paintBoard();}}),
      button('清空队伍', () => change(S.empty())), button('导入队伍', () => file.click()),
      button('导出队伍', () => {
        const blob = new Blob([JSON.stringify({format: 'wf-wiki-team-v1', name, team}, null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob), a = el('a'); a.href = url; a.download = `${name || '队伍'}.json`;
        a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }), file);
    function paintBoard() {
      board.replaceChildren(el('h2', '', '队伍编成'));
      const grid = el('div', 'team-columns');
      for (let index = 0; index < 3; index++) {
        const column = el('div', 'team-column'); column.setAttribute('role', 'group'); column.setAttribute('aria-label', `${index + 1}号位`);
        const stack = el('div', 'team-card-stack'); column.append(stack);
        if (index === 0) stack.append(el('span', 'team-leader-flag', '队长'));
        for (const group of ['main', 'weapon', 'soul', 'unison']) {
          const source = S.isCharacter(group) ? characters : equipment;
          const item = source.get(team[group][index]);
          const wrap = el('div', `team-slot-wrap team-slot-wrap-${group}`);
          const slot = button('', () => {chooseSlot(group, index); paintBoard(); paintLibrary();}, `team-slot team-slot-${group}`);
          slot.classList.toggle('selected', chosen.group === group && chosen.index === index);
          slot.setAttribute('aria-label', `${index + 1}号${labels[group]}：${item?.name || '空位'}`);
          slot.title = `${labels[group]} · ${item?.name || '点击选择或拖入'}`;
          slot.append(el('span', 'team-slot-label', labels[group]));
          if (item) {
            slot.append(picture(item.icon, item.name, 'team-slot-image'));
            if (S.isCharacter(group)) slot.append(elementBadge(item.element));
          } else slot.append(el('span', 'team-slot-empty', '+'));
          slot.querySelectorAll('img').forEach((img) => {img.draggable = false;});
          slot.draggable = Boolean(item);
          slot.addEventListener('dragstart', (event) => {event.dataTransfer.setData('application/x-wf-wiki', JSON.stringify({id: team[group][index], kind: S.isCharacter(group) ? 'character' : 'equipment'}));});
          slot.addEventListener('dragover', (event) => {event.preventDefault(); slot.classList.add('drag-over');});
          slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
          slot.addEventListener('drop', (event) => {
            event.preventDefault(); slot.classList.remove('drag-over');
            try {
              const value = JSON.parse(event.dataTransfer.getData('application/x-wf-wiki'));
              if (value.kind !== (S.isCharacter(group) ? 'character' : 'equipment')) {
                status.textContent = '角色只能放入主位或合击位，武器只能放入装备或魂珠槽。'; return;
              }
              chooseSlot(group, index); assign(value.id, value.kind); paintBoard(); paintLibrary();
            }
            catch {status.textContent = '请从本页角色或武器列表拖入。';}
          });
          wrap.append(slot);
          if (item) {const remove = button('×', () => change(S.place(team, group, index, '', characters, equipment)), 'team-slot-remove'); remove.setAttribute('aria-label', `移除${index + 1}号${labels[group]}`); remove.title = `移除${labels[group]}`; wrap.append(remove);}
          stack.append(wrap);
        }
        grid.append(column);
      }
      board.append(grid); paintPreview();
    }
    function paintPreview() {
      preview.replaceChildren(el('h2', '', '编成资料'));
      S.ruleNotes(team, equipment, data.equipmentMeta?.partyRules).forEach((value) => preview.append(el('p', 'weapon-note', value)));
      const leader = characters.get(team.main[0]);
      if (leader) preview.append(el('h3', '', `队长 · ${leader.name}`), el('p', '', leader.leader?.description || '无队长技'));
      for (let i = 0; i < 3; i++) {
        const main = characters.get(team.main[i]), unison = characters.get(team.unison[i]);
        const box = el('details', 'team-pair'); box.open = i === 0;
        box.append(el('summary', '', `${i + 1}号位：${main?.name || '空位'} / ${unison?.name || '空位'}`));
        for (const [label, item] of [['主位', main], ['合击', unison]]) if (item) {
          box.append(el('h3', '', `${label} · ${item.name}`), elementBadge(item.element));
          const a = el('a', 'text-button', '查看角色详情'); a.href = `#character/${encodeURIComponent(item.id)}`; box.append(a);
          (item.abilities || []).forEach((ability) => box.append(el('p', '', `${ability.name}：${ability.description || '未配置'}`)));
        }
        for (const group of ['weapon', 'soul']) {
          const item = equipment.get(team[group][i]); if (!item) continue;
          box.append(el('h3', '', `${labels[group]} · ${item.name}`));
          const effects = group === 'soul' ? item.soul?.effects : item.awakenedEffects || item.baseEffects;
          box.append(el('p', '', Array.isArray(effects) ? effects.join('\n') : effects || item.description || ''));
          if (group === 'weapon' && item.enhancement) {
            box.append(el('h4', '', `强化至 Lv${item.enhancement.maxLevel} 的追加效果`),
              el('p', '', (item.enhancement.effects || []).join('\n')));
          }
        }
        preview.append(box);
      }
    }
    const weaponSearch = el('input', 'team-weapon-search'); weaponSearch.type = 'search'; weaponSearch.placeholder = '搜索武器或魂珠'; weaponSearch.value = weaponQuery; weaponSearch.setAttribute('aria-label', '配队武器搜索');
    const characterFilters = window.WFCharacterFilters.create({characters: [...characters.values()], ui,
      idPrefix: 'team-character', initialState: characterFilterState,
      onChange: (state) => {characterFilterState = state; paintLibrary();}});
    const modeSwitch = el('div', 'team-mode-switch'); modeSwitch.setAttribute('role', 'group'); modeSwitch.setAttribute('aria-label', '候选类别');
    function switchMode(characterMode) {
      if (S.isCharacter(chosen.group) === characterMode) return;
      chooseSlot(characterMode ? 'main' : 'weapon', chosen.index); paintBoard(); paintLibrary();
    }
    const characterButton = button('角色', () => switchMode(true), 'team-mode-button');
    const weaponButton = button('武器', () => switchMode(false), 'team-mode-button');
    modeSwitch.append(characterButton, weaponButton);
    const candidates = el('div', 'team-candidates');
    const heading = el('h2'); library.append(heading, modeSwitch, characterFilters.element, weaponSearch, candidates);
    function paintLibrary() {
      const characterMode = S.isCharacter(chosen.group);
      heading.textContent = `选择${labels[chosen.group]} · ${chosen.index + 1}号位`;
      characterButton.setAttribute('aria-pressed', String(characterMode));
      weaponButton.setAttribute('aria-pressed', String(!characterMode));
      characterFilters.element.hidden = !characterMode;
      weaponSearch.hidden = characterMode;
      const items = characterMode ? [...characters.values()].filter(characterFilters.matches)
        : [...equipment.values()].filter((item) => (chosen.group !== 'soul' || item.soul?.available)
          && `${item.name} ${(item.aliases || []).join(' ')} ${item.category || ''}`.toLowerCase().includes(weaponQuery.toLowerCase()));
      if (!characterMode) {
        const priority = (item) => ['深渊武器', '诅咒武器'].includes(item.category) ? 0 : 1;
        items.sort((a, b) => priority(a) - priority(b));
      }
      candidates.replaceChildren();
      for (const item of items) {
        const b = button('', () => assign(item.id), 'team-candidate'); b.title = `${item.name} ${item.theme || ''}`;
        b.setAttribute('aria-label', `选择${item.name}`); b.draggable = true;
        b.append(picture(item.icon, item.name, 'team-candidate-image'), el('span', '', item.name));
        if (characterMode) b.append(elementBadge(item.element));
        b.addEventListener('dragstart', (event) => event.dataTransfer.setData('application/x-wf-wiki', JSON.stringify({id: item.id, kind: characterMode ? 'character' : 'equipment'})));
        candidates.append(b);
      }
      if (!items.length) candidates.append(el('p', '', '没有匹配的候选。'));
    }
    weaponSearch.addEventListener('input', () => {weaponQuery = weaponSearch.value; paintLibrary();});
    const layout = el('div', 'team-layout'); layout.append(board, library, preview);
    host.replaceChildren(el('h1', '', '配队模拟'), el('p', 'section-intro', '拖拽头像到槽位，或先点槽位再点候选。重复角色会交换位置；第一列主位为队长。'),
      controls, status, layout, el('p', 'muted', '用于编成与查阅效果；主位限制、触发条件和武器特殊规则请结合说明判断。本页不模拟战斗过程或计算实战伤害。'));
    refreshSaved(); paintBoard(); paintLibrary();
  };
})();
