/* An editor owns its saved snapshot; game codes never publish unsaved form data. */
(() => {
  'use strict';
  window.WFCommunityAdminEditor = {create({item, identity, config, data, ui, request, onSaved, onClose, onReload}) {
    const C = window.WFCommunity, {el} = ui, form = el('form', 'admin-edit-form');
    const team = C.teamCopy(item.team), revision = Number(item.revision), editable = [];
    const warning = el('p', 'admin-edit-status'); warning.setAttribute('role', 'status');
    const dirtyStatus = el('p', 'admin-dirty-status'); dirtyStatus.setAttribute('role', 'status');
    const button = (label, action) => {const node = el('button', 'secondary-button', label); node.type = 'button'; node.addEventListener('click', action); return node;};
    const field = (label, input) => {input.setAttribute('aria-label', label); const node = el('label', 'admin-field'); node.append(el('span', '', label), input); return node;};
    function input(value, limit, multiline = false) {
      const node = el(multiline ? 'textarea' : 'input'); node.value = String(value || ''); node.maxLength = limit;
      if (multiline) node.rows = 2; else node.type = 'text'; editable.push(node); return node;
    }
    function select(values, value) {
      const node = el('select'); values.forEach(([key,label]) => {const option = el('option', '', label); option.value = key; node.append(option);});
      node.value = value; editable.push(node); return node;
    }
    const title = input(item.title,80), author = input(item.author,40), notes = input(item.notes,2000,true); title.required = true;
    const element = select([['auto','根据队长属性自动判断'],['universal','宇宙'],
      ...(config.elements || ['火','水','雷','风','光','暗','无']).filter((value) => value !== 'universal').map((value) => [value,value])], item.element || 'auto');
    const status = select([['approved','使用中'],['hidden','回收站 / 已停用']], item.status === 'hidden' ? 'hidden' : 'approved');
    const category = select([...(item.category ? [] : [['','未分类（历史队伍）']]), ...C.teamCategories.map((value) => [value,value])], item.category || '');
    const section = select(Object.entries(C.teamSections), item.section || '');
    const canPrivatize = ['owner','deputy'].includes(identity?.role) || Boolean(item.createdBy && item.createdBy === identity?.id);
    const privateLabel = item.createdBy === identity?.id ? '我的空间（私有）' : item.createdBy ? '创建者的私有空间' : '私有（仅站长及副站长）';
    const visibility = select([['public','配队大全（公开）'], ...(canPrivatize || item.visibility === 'private' ? [['private',privateLabel]] : [])], item.visibility || 'public');
    const heading = el('div', 'admin-edit-heading'); heading.append(el('h2', '', `编辑：${item.title}`), button('关闭编辑', () => {if (form.canClose()) onClose();}));
    const preview = el('div', 'admin-edit-preview'); preview.setAttribute('aria-label', '当前角色与装备预览');
    const names = el('div', 'admin-edit-names'); names.append(field('队伍标题', title), field('投稿者署名', author));
    form.append(heading, el('p', 'admin-version', `当前版本 ${revision} · 保存时自动检查版本`), preview, names);
    const meta = el('div', 'admin-edit-meta'); meta.append(field('属性分类', element), field('展示状态', status),
      field('配队分类', category), field('玩法分区', section), field('保存位置', visibility)); form.append(meta);
    if (!canPrivatize && item.visibility !== 'private') form.append(el('p', 'muted', '只有创建者、站长或副站长可以将这支队伍移入私有空间。'));
    const damages = el('fieldset', 'admin-damage'); damages.append(el('legend', '', '伤害分类（至少一项）'));
    const checks = Object.entries(C.damageTypes).map(([value,label]) => {
      const check = el('input'); check.type = 'checkbox'; check.value = value; check.checked = (item.damageTypes || []).includes(value);
      editable.push(check); damages.append(field(label,check)); return check;
    });
    form.append(damages, field('队伍说明', notes));
    const adjustments = el('details', 'admin-slot-adjustments');
    adjustments.append(el('summary', '', '调整角色与装备'), el('p', 'admin-adjustment-help', '按位置选择主位、合击、武器与魂珠；上方预览会同步更新。'));
    const slots = el('div', 'admin-slots'), slotControls = [];
    const characters = new Map((data.characters || []).map((entry) => [entry.id,entry]));
    const equipment = new Map((data.equipment || []).map((entry) => [entry.id,entry]));
    const avatar = (entry, alt, cls) => {
      const preferred = window.WFCatalogAvatars?.getForm?.();
      return ui.picture ? ui.picture(entry.avatars?.[preferred] || entry.icon,alt,cls) : el('span',cls,entry.name);
    };
    function portrait(group, id, label, cls) {
      const character = group === 'main' || group === 'unison', entry = (character ? characters : equipment).get(id);
      const node = el('span', cls); node.setAttribute('aria-label', `${label}：${entry?.name || (id ? '未收录' : '空位')}`);
      node.title = entry?.name || (id ? '当前图鉴未收录' : '未选择');
      if (entry) {
        node.append(character ? avatar(entry,entry.name,'admin-slot-image')
          : ui.picture ? ui.picture(entry.icon,entry.name,'admin-slot-image') : el('span','',entry.name));
        if (character) window.WFCharacterFrame?.apply(node,entry);
      } else node.append(el('span','',id ? '?' : '—'));
      return node;
    }
    for (const [group,label] of [['main','主位'],['unison','合击'],['weapon','武器'],['soul','魂珠']]) {
      const source = (group === 'main' || group === 'unison') ? data.characters : (data.equipment || []).filter((entry) => group !== 'soul' || entry.soul?.available);
      for (let index = 0; index < 3; index++) {
        const box = el('fieldset', 'admin-slot'); box.append(el('legend', '', `${label} ${index + 1}`));
        const search = input('',100); search.type = 'search'; search.placeholder = '输入名称、主题或别名'; search.setAttribute('aria-label', `搜索${label} ${index + 1}`);
        const choice = select([], ''); choice.setAttribute('aria-label', `${label} ${index + 1}`);
        const hint = el('small', 'admin-slot-hint'), image = el('div', 'admin-slot-portrait');
        const controls = el('div', 'admin-slot-controls'); controls.append(search,choice,hint);
        const name = (entry) => [entry.name,entry.theme || entry.title,entry.element,entry.rarity && `${entry.rarity}星`].filter(Boolean).join(' · ');
        function choices() {
          const term = search.value.trim().toLocaleLowerCase();
          const kind = group === 'main' || group === 'unison' ? 'character' : 'weapon';
          const matches = (source || []).filter((entry) => `${name(entry)} ${(entry.aliases || []).join(' ')} ${(window.WFWikiAliases?.values(kind, entry.id) || []).join(' ')}`.toLocaleLowerCase().includes(term));
          const shown = matches.slice(0,60), id = team[group][index], current = (source || []).find((entry) => entry.id === id);
          if (current && !shown.includes(current)) shown.unshift(current);
          choice.replaceChildren(); const empty = el('option', '', '未选择'); empty.value = ''; choice.append(empty);
          shown.forEach((entry) => {const option = el('option', '', name(entry)); option.value = entry.id; choice.append(option);});
          if (id && !current) {const missing = el('option', '', '原条目不在当前图鉴，请重新选择'); missing.value = id; choice.append(missing);}
          choice.value = id; hint.textContent = matches.length > 60 ? `匹配 ${matches.length} 项，显示前 60 项；可继续输入缩小范围。` : `匹配 ${matches.length} 项`;
        }
        search.addEventListener('input', choices); choice.addEventListener('change', () => {team[group][index] = choice.value; update();});
        slotControls.push({group,index,choice,image,label:`${label} ${index + 1}`}); choices(); box.append(image,controls); slots.append(box);
      }
    }
    function values() {
      const currentTeam = C.teamCopy(team); slotControls.forEach(({group,index,choice}) => {currentTeam[group][index] = choice.value;});
      return {title:title.value.trim(),author:author.value.trim(),notes:notes.value.trim(),team:currentTeam,element:element.value,
        category:category.value,section:section.value,visibility:visibility.value,status:status.value,
        damageTypes:checks.filter((check) => check.checked).map((check) => check.value)};
    }
    let saved = JSON.stringify(values()), busy = false, conflict = false, previewSnapshot = '';
    form.isDirty = () => JSON.stringify(values()) !== saved;
    form.canClose = () => {
      if (busy) {warning.textContent = '正在保存，请稍候再关闭编辑。'; return false;}
      return !form.isDirty() || Boolean(window.confirm?.('还有未保存的修改，确定放弃修改并离开编辑吗？'));
    };
    const blocked = () => conflict ? '版本冲突，请重新加载队伍后再公开队伍码。' : busy ? '正在保存，请稍候。'
      : form.isDirty() ? '还有未保存的修改，请先保存后再公开队伍码。' : '';
    const manager = window.WFCommunityGameCodes?.controls(item,ui,request,{mutationBlocked:blocked});
    function update() {
      dirtyStatus.textContent = blocked(); manager?.refreshAvailability();
      const current = values().team, snapshot = JSON.stringify(current); if (snapshot === previewSnapshot) return;
      previewSnapshot = snapshot;
      const board = C.board && ui.picture ? C.board(current,data,ui,{preview:true,avatars:{picture:avatar}}) : el('div','admin-preview-characters');
      if (!C.board || !ui.picture) for (let index = 0; index < 3; index++) {
        const column = el('div','admin-preview-character-column');
        for (const group of ['main','unison']) column.append(portrait(group,current[group][index],`${group === 'main' ? '主位' : '合击'} ${index + 1}`,'admin-preview-portrait'));
        board.append(column);
      }
      const gear = el('div','admin-preview-equipment');
      for (let index = 0; index < 3; index++) {
        const column = el('div','admin-preview-equipment-column');
        for (const [group,label] of [['weapon','武器'],['soul','魂珠']]) {
          const slot = portrait(group,current[group][index],`${label} ${index + 1}`,'admin-preview-gear');
          slot.append(el('span','admin-preview-gear-label',label)); column.append(slot);
        }
        gear.append(column);
      }
      preview.replaceChildren(board,gear);
      slotControls.forEach(({group,index,image,label}) => image.replaceChildren(portrait(group,current[group][index],label,'admin-slot-portrait-inner')));
    }
    form.addEventListener('input', update); form.addEventListener('change', update);
    adjustments.append(slots); form.append(adjustments,dirtyStatus,warning);
    const save = el('button', 'primary-button', '保存修改'); save.type = 'submit';
    const reload = button('重新加载列表', onReload); reload.hidden = true;
    const actions = el('div','admin-edit-actions'); actions.append(save,reload); form.append(actions);
    if (manager) form.append(manager);
    update();
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); if (busy || conflict) return;
      const next = values(), invalid = !next.title ? '请填写队伍标题。' : !next.damageTypes.length ? '请至少选择一种伤害分类。'
        : (!C.teamCategories.includes(next.category) && (item.category || next.category)) ? '请选择有效的配队分类。'
        : !Object.hasOwn(C.teamSections,next.section) ? '请选择有效的玩法分区。'
        : !['public','private'].includes(next.visibility) ? '请选择有效的保存位置。'
        : next.visibility === 'private' && item.visibility !== 'private' && !canPrivatize ? '只有创建者、站长或副站长可以设为私有。' : C.teamError(next.team,data);
      if (invalid) {warning.textContent = invalid; return;}
      busy = true; save.disabled = true; editable.forEach((node) => {node.disabled = true;}); update(); warning.textContent = '正在保存…';
      try {
        const result = await request(`/admin/teams/${encodeURIComponent(item.id)}`, {expectedRevision:revision,...next});
        if (result.team?.id !== item.id || !Number.isSafeInteger(Number(result.team.revision)) || Number(result.team.revision) <= revision) {
          throw new Error('服务端未返回更新版本，请重新加载列表核实。');
        }
        saved = JSON.stringify(next);
        if (form.isConnected) await onSaved(result.team);
      } catch (error) {
        if (!form.isConnected) return;
        if (error.code === 'edit_conflict') {
          conflict = true; reload.hidden = false;
          warning.textContent = '这张盘已被其他管理员修改。你的输入仍保留，保存已暂停；请重新加载列表后再编辑，避免覆盖他人的修改。';
        } else warning.textContent = C.message(error);
      } finally {busy = false; save.disabled = conflict; editable.forEach((node) => {node.disabled = false;}); update();}
    });
    return form;
  }};
})();
