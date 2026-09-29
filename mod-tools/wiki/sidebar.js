/* Collapsing navigation changes layout only, keeping filters and routes intact. */
(() => {
  'use strict';
  const shell = document.querySelector('.page-shell');
  const sidebar = shell?.querySelector('.sidebar');
  if (!shell || !sidebar) return;
  const storageKey = 'wf-wiki-sidebar-collapsed';
  let collapsed = false;
  try { collapsed = localStorage.getItem(storageKey) === 'true'; } catch { /* Optional persistence. */ }
  sidebar.id = 'character-sidebar';
  const toolbar = document.createElement('div'); toolbar.className = 'sidebar-toolbar';
  const button = document.createElement('button'); button.type = 'button'; button.className = 'sidebar-toggle';
  button.setAttribute('aria-controls', sidebar.id);
  const paint = () => {
    shell.classList.toggle('sidebar-collapsed', collapsed);
    sidebar.hidden = collapsed;
    button.textContent = collapsed ? '› 展开目录' : '‹ 收起目录';
    button.setAttribute('aria-expanded', String(!collapsed));
  };
  button.addEventListener('click', () => {
    collapsed = !collapsed; paint();
    try { localStorage.setItem(storageKey, String(collapsed)); } catch { /* Layout still works. */ }
  });
  toolbar.append(button); shell.prepend(toolbar); paint();
})();
