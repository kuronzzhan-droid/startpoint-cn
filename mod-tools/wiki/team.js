/* Editing stays local; administrator collection is a separate explicit action. */
(() => {
  'use strict';
  const storageKey = 'wf-wiki-teams-v1';
  const S = window.WFTeamState;
  let team = S.empty(), undo = [], redo = [], chosen = {group: 'main', index: 0};
  let inspected = {group: 'main', index: 0};
  let characterFilterState = {}, equipmentFilterState = {}, name = '我的队伍';
  const labels = {main: '主位', unison: '合击', weapon: '装备', soul: '魂珠'};
  let imported;
  window.WFTeamImport = {load(value, title, selection) {imported = {team: S.copy(value), title, selection};}};
  function savedTeams() {
    try { const data = JSON.parse(localStorage.getItem(storageKey) || '[]'); return Array.isArray(data) ? data.filter((item) => item && typeof item.name === 'string' && item.team && typeof item.team === 'object') : []; }
    catch { return []; }
  }
  window.renderWikiTeam = (host, data, ui) => {
    const {el, picture, elementBadge} = ui;
    const characters = new Map(data.characters.map((c) => [String(c.id), c]));
    const equipment = new Map((data.equipment || []).map((w) => [String(w.id), w]));
    const equipmentCompare = window.WFEquipmentOrder.createCompare(data.equipment || []);
    if (imported) {
      undo.push(S.copy(team)); redo = [];
      team = S.validate(imported.team, characters, equipment);
      name = String(imported.title || '推荐队伍').slice(0, 60);
      inspected = ['main','unison'].includes(imported.selection?.group) && [0,1,2].includes(imported.selection?.index)
        ? {...imported.selection} : {group:'main',index:0}; imported = null;
    }
    team = S.validate(team, characters, equipment);
    const board = el('div', 'team-board game-panel');
    const preview = el('section', 'team-preview game-panel');
    const library = el('section', 'team-library game-panel');
    const controls = el('div', 'team-controls');
    const status = el('p', 'team-status'); status.setAttribute('role', 'status');
    const avatarControls = el('div', 'team-avatar-controls');
    const avatars = window.WFCatalogAvatars?.create({host: avatarControls, catalog: host,
      characters: data.characters, ui, label: '编队头像'});
    const inspector = window.WFTeamInspector?.create(data, ui, avatars);
    const title = el('input'); title.value = name; title.maxLength = 60; title.setAttribute('aria-label', '队伍名称');
    title.addEventListener('input', () => {name = title.value;});
    function button(label, action, className = 'secondary-button') {
      const b = el('button', className, label); b.type = 'button'; b.addEventListener('click', action); return b;
    }
    function change(next) {
      if (JSON.stringify(next) === JSON.stringify(team)) {paintBoard(); return;}
      undo.push(S.copy(team)); undo = undo.slice(-50); redo = []; team = next; paintBoard();
    }
    function assign(id, kind = '') {
      const expected = S.isCharacter(chosen.group) ? 'character' : 'equipment';
      if (kind && kind !== expected) {status.textContent = '请把角色放入主位或合击位，把武器放入装备或魂珠槽。'; return;}
      if (S.isCharacter(chosen.group)) inspected = {...chosen};
      change(S.place(team, chosen.group, chosen.index, id, characters, equipment));
    }
    function chooseSlot(group, index) {
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
    const collect = button('收录配队大全', () => window.WFCommunity.openSubmit({team: S.copy(team), title: name, data, ui}), 'primary-button');
    collect.hidden = true; controls.append(collect);
    window.WFCommunity?.client?.request('/admin/me').then((identity) => {
      if (identity?.id && identity?.email && controls.isConnected) collect.hidden = false;
    }).catch(() => {});
    const recommendations = el('a', 'text-button', '查看配队大全'); recommendations.href = '#community'; controls.append(recommendations);
    controls.append(avatarControls);
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
          const slot = item && !S.isCharacter(group) ? el('a', `team-slot team-slot-${group}`)
            : item ? button('', () => {inspected = {group,index}; paintBoard();}, `team-slot team-slot-${group}`)
            : button('', () => {chooseSlot(group, index); paintBoard(); paintLibrary();}, `team-slot team-slot-${group}`);
          if (item && !S.isCharacter(group)) {
            slot.href = `#weapon/${encodeURIComponent(item.id)}`;
            slot.addEventListener('click', () => window.WFTeamInspector?.remember('weapon', item.id));
          }
          if (item && S.isCharacter(group)) slot.setAttribute('aria-current', String(inspected.group === group && inspected.index === index));
          slot.classList.toggle('selected', chosen.group === group && chosen.index === index);
          slot.setAttribute('aria-label', `${index + 1}号${labels[group]}：${item?.name || '空位'}`);
          slot.title = `${labels[group]} · ${item?.name || '点击选择或拖入'}`;
          slot.append(el('span', 'team-slot-label', labels[group]));
          if (item) {
            slot.append(S.isCharacter(group) && avatars ? avatars.picture(item, item.name, 'team-slot-image')
              : picture(item.icon, item.name, 'team-slot-image'));
            if (S.isCharacter(group)) {
              slot.append(elementBadge(item.element));
              window.WFCharacterFrame?.apply(slot, item);
              window.WFCharacterBadges?.append(slot, item, ui);
            }
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
          if (item) {
            const replace = button('换', () => {chooseSlot(group, index); paintBoard(); paintLibrary();}, 'team-slot-replace');
            replace.setAttribute('aria-label', `替换${index + 1}号${labels[group]}`); replace.title = `替换${labels[group]}`; wrap.append(replace);
          }
          if (item) {const remove = button('×', () => change(S.place(team, group, index, '', characters, equipment)), 'team-slot-remove'); remove.setAttribute('aria-label', `移除${index + 1}号${labels[group]}`); remove.title = `移除${labels[group]}`; wrap.append(remove);}
          stack.append(wrap);
        }
        grid.append(column);
      }
      board.append(grid); paintPreview(); inspector?.show(team[inspected.group][inspected.index]);
    }
    function paintPreview() {
      preview.replaceChildren(el('h2', '', '编成资料'));
      const rules = S.ruleNotes(team, equipment, data.equipmentMeta?.partyRules);
      if (rules.length) {
        const notes = el('details', 'team-preview-rules'); notes.append(el('summary', '', `装备规则 · ${rules.length} 条`));
        rules.forEach((value) => notes.append(el('p', 'weapon-note', value))); preview.append(notes);
      }
      const leader = characters.get(team.main[0]);
      if (leader) preview.append(button(`队长技 · ${leader.name} ›`, () => {inspected = {group:'main',index:0}; paintBoard();}, 'text-button team-preview-leader'));
      for (let i = 0; i < 3; i++) {
        const main = characters.get(team.main[i]), unison = characters.get(team.unison[i]);
        const box = el('details', 'team-pair'); box.open = i === inspected.index;
        const summary = el('summary');
        summary.append(el('span', 'team-pair-number', `${i + 1}号位`),
          el('span', 'team-pair-names', `${main?.name || '空位'} / ${unison?.name || '空位'}`)); box.append(summary);
        for (const [label, item] of [['主位', main], ['合击', unison]]) if (item) {
          const row = el('div', 'team-pair-character');
          const show = button('查看面板', () => {inspected = {group:label === '主位' ? 'main' : 'unison',index:i}; paintBoard();}, 'text-button');
          show.setAttribute('aria-label', `查看${i + 1}号${label}${item.name}面板`);
          row.append(el('span', 'team-pair-kind', label), el('strong', '', item.name), elementBadge(item.element), show); box.append(row);
        }
        for (const group of ['weapon', 'soul']) {
          const item = equipment.get(team[group][i]); if (!item) continue;
          const effect = el('details', 'team-pair-effect'), caption = el('summary');
          caption.append(el('span', 'team-pair-kind', labels[group]), el('strong', '', item.name)); effect.append(caption);
          const effects = group === 'soul' ? item.soul?.effects : item.awakenedEffects || item.baseEffects;
          effect.append(el('p', '', Array.isArray(effects) ? effects.join('\n') : effects || item.description || '暂无效果说明'));
          if (group === 'weapon' && item.enhancement) {
            effect.append(el('h4', '', `强化至 Lv${item.enhancement.maxLevel} 的追加效果`),
              el('p', '', (item.enhancement.effects || []).join('\n')));
          }
          box.append(effect);
        }
        preview.append(box);
      }
    }
    const equipmentFilters = window.WFTeamEquipmentFilters.create({equipment:[...equipment.values()], ui,
      initialState:equipmentFilterState, onStateChange:(state) => {equipmentFilterState = state;}, onChange:() => paintLibrary()});
    const characterFilters = window.WFCharacterFilters.create({characters: [...characters.values()], ui,
      idPrefix: 'team-character', initialState: characterFilterState,
      onStateChange: (state) => {characterFilterState = state;}, onChange: () => paintLibrary()});
    const modeSwitch = el('div', 'team-mode-switch'); modeSwitch.setAttribute('role', 'group'); modeSwitch.setAttribute('aria-label', '候选类别');
    function switchMode(mode) {
      if ((mode === 'character' && S.isCharacter(chosen.group)) || chosen.group === mode) return;
      chooseSlot(mode === 'character' ? 'main' : mode, chosen.index); paintBoard(); paintLibrary();
    }
    const characterButton = button('角色', () => switchMode('character'), 'team-mode-button');
    const weaponButton = button('武器', () => switchMode('weapon'), 'team-mode-button');
    const soulButton = button('魂珠', () => switchMode('soul'), 'team-mode-button');
    modeSwitch.append(characterButton, weaponButton, soulButton);
    const candidates = el('div', 'team-candidates');
    const heading = el('h2'); library.append(heading, modeSwitch, characterFilters.element, equipmentFilters.element, candidates);
    function paintLibrary() {
      const characterMode = S.isCharacter(chosen.group);
      heading.textContent = `选择${labels[chosen.group]} · ${chosen.index + 1}号位`;
      characterButton.setAttribute('aria-pressed', String(characterMode));
      weaponButton.setAttribute('aria-pressed', String(chosen.group === 'weapon'));
      soulButton.setAttribute('aria-pressed', String(chosen.group === 'soul'));
      characterFilters.element.hidden = !characterMode;
      equipmentFilters.element.hidden = characterMode;
      if (!characterMode) equipmentFilters.setMode(chosen.group);
      const items = characterMode ? [...characters.values()].filter(characterFilters.matches)
        : [...equipment.values()].filter(equipmentFilters.matches);
      if (characterMode) items.sort(window.WFCharacterOrder.compare);
      else items.sort(equipmentCompare);
      candidates.replaceChildren();
      for (const item of items) {
        const candidateName = `${item.name}${chosen.group === 'soul' ? '魂珠' : ''}`;
        const b = button('', () => assign(item.id), 'team-candidate'); b.title = `${candidateName} ${item.theme || ''}`;
        b.setAttribute('aria-label', `选择${candidateName}`); b.draggable = true;
        const image = characterMode && avatars ? avatars.picture(item, item.name, 'team-candidate-image')
          : picture(item.icon, item.name, 'team-candidate-image');
        if (characterMode) {
          const art = el('span', 'team-candidate-art'); art.append(image);
          window.WFCharacterFrame?.apply(art, item);
          window.WFCharacterBadges?.append(art, item, ui); b.append(art);
        } else b.append(image);
        b.append(el('span', '', item.name));
        if (characterMode) b.append(elementBadge(item.element));
        else b.append(el('span', 'team-candidate-equipment-type', `${chosen.group === 'soul' ? '魂珠' : '武器'} · ${item.element || '未标注'}${item.rarity ? ` · ${item.rarity}★` : ''}`));
        b.addEventListener('dragstart', (event) => event.dataTransfer.setData('application/x-wf-wiki', JSON.stringify({id: item.id, kind: characterMode ? 'character' : 'equipment'})));
        candidates.append(b);
      }
      if (!items.length) candidates.append(el('p', '', '没有匹配的候选。'));
    }
    const mainColumn = el('div', 'team-main'); mainColumn.append(board, preview);
    const layout = el('div', 'team-layout'); if (inspector) layout.append(inspector.element); layout.append(mainColumn, library);
    host.replaceChildren(el('h1', '', '配队模拟'), el('p', 'section-intro', '拖拽头像到槽位，或点空位／「换」后选择候选。点击盘中的角色头像，在角色面板查看技能与能力；第一列主位为队长。'),
      controls, status, layout, el('p', 'muted', '用于编成与查阅效果；主位限制、触发条件和武器特殊规则请结合说明判断。本页不模拟战斗过程或计算实战伤害。'));
    refreshSaved(); paintBoard(); paintLibrary();
  };
})();
