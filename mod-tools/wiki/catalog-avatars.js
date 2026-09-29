/* Only catalogue portraits follow this preference; team and detail views keep their own state. */
(() => {
  'use strict';
  window.WFCatalogAvatars = {create({host, catalog, characters, ui}) {
    const {el, picture, safeUrl} = ui;
    const storageKey = 'wf-wiki-catalog-avatar';
    const byId = new Map(characters.map((character) => [String(character.id), character]));
    let form = 'before';
    try { if (localStorage.getItem(storageKey) === 'after') form = 'after'; } catch { /* Offline storage may be disabled. */ }
    const group = el('div', 'catalog-avatar-controls catalog-layout-group');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', '角色图鉴头像');
    group.title = '切换全部图鉴头像；没有对应头像时使用已收录头像';
    group.append(el('span', 'catalog-layout-label', '头像'));
    const choices = [['before', '觉醒前'], ['after', '觉醒后']];
    const buttons = choices.map(([value, label]) => {
      const button = el('button', 'catalog-layout-button', label);
      button.type = 'button';
      button.dataset.avatarForm = value;
      button.addEventListener('click', () => apply(value));
      group.append(button);
      return button;
    });
    const paint = (host, character) => {
      const avatars = character.avatars || {};
      const wanted = safeUrl(avatars[form]);
      const url = wanted || safeUrl(character.icon) || safeUrl(avatars.before) || safeUrl(avatars.after);
      host.title = wanted ? '' : '未收录此状态的头像，显示现有头像';
      const current = host.querySelector('img');
      if (current && current.getAttribute('src') === url) return;
      host.replaceChildren(picture(url, '', ''));
    };
    const updateButtons = () => buttons.forEach((button) =>
      button.setAttribute('aria-pressed', String(button.dataset.avatarForm === form)));
    function apply(value) {
      form = value === 'after' ? 'after' : 'before';
      updateButtons();
      try { localStorage.setItem(storageKey, form); } catch { /* The current view still switches. */ }
      catalog.querySelectorAll('[data-catalog-avatar]').forEach((node) => {
        const character = byId.get(node.dataset.catalogAvatar);
        if (character) paint(node, character);
      });
    }
    updateButtons();
    host.append(group);
    return {picture(character) {
      const node = el('span', 'catalog-avatar');
      node.dataset.catalogAvatar = String(character.id);
      paint(node, character);
      return node;
    }};
  }};
})();
