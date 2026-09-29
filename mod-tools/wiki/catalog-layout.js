/* Catalogue density is independent from filters and team composition. */
(() => {
  'use strict';
  const catalog = document.getElementById('catalog-view');
  const control = document.getElementById('catalog-layout');
  if (!catalog || !control) return;
  const choices = [
    ['standard', '标准'], ['dense', '致密'], ['portrait', '立绘'],
  ];
  const storageKey = 'wf-wiki-catalog-layout';
  const group = document.createElement('div');
  group.id = 'catalog-layout';
  group.className = 'catalog-layout-group';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', '角色排列');
  const label = document.createElement('span');
  label.className = 'catalog-layout-label';
  label.textContent = '排列';
  group.append(label);
  const buttons = choices.map(([value, name]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'catalog-layout-button';
    button.dataset.layout = value;
    button.textContent = name;
    button.setAttribute('aria-pressed', 'false');
    group.append(button);
    return button;
  });
  const apply = (value) => {
    const layout = choices.some(([choice]) => choice === value) ? value : 'standard';
    catalog.dataset.layout = layout;
    buttons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.layout === layout)));
    return layout;
  };
  (control.closest('label') || control).replaceWith(group);
  let saved;
  try { saved = localStorage.getItem(storageKey); } catch { /* Storage can be disabled for local files. */ }
  const initial = apply(saved);
  if (saved && saved !== initial) {
    try { localStorage.setItem(storageKey, initial); } catch { /* Old choices still fall back in this view. */ }
  }
  buttons.forEach((button) => button.addEventListener('click', () => {
    if (catalog.dataset.layout === button.dataset.layout) return;
    const layout = apply(button.dataset.layout);
    try { localStorage.setItem(storageKey, layout); } catch { /* The current view still works. */ }
    catalog.dispatchEvent(new Event('cataloglayoutchange'));
  }));
})();
