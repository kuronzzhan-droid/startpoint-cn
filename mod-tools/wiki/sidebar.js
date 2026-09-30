/* Collapsing navigation changes layout only, keeping filters and routes intact. */
(() => {
  'use strict';
  const shell = document.querySelector('.page-shell');
  const sidebar = shell?.querySelector('.sidebar');
  if (!shell || !sidebar) return;
  const storageKey = 'wf-wiki-sidebar-collapsed';
  const mobile = window.matchMedia?.('(max-width:640px)');
  const mobileCatalog = () => Boolean(mobile?.matches && !location.hash.slice(1));
  let collapsed = false;
  try { collapsed = localStorage.getItem(storageKey) === 'true'; } catch { /* Optional persistence. */ }
  sidebar.id = 'character-sidebar';
  const toolbar = document.createElement('div'); toolbar.className = 'sidebar-toolbar';
  const button = document.createElement('button'); button.type = 'button'; button.className = 'sidebar-toggle';
  button.setAttribute('aria-controls', sidebar.id);
  const paint = () => {
    const page = location.hash.slice(1).split('/')[0];
    const automatic = ['team', 'community', 'weapons', 'weapon', 'five-boss'].includes(page);
    shell.classList.toggle('catalog-home', !page);
    shell.classList.toggle('sidebar-collapsed', collapsed || automatic);
    sidebar.hidden = collapsed || automatic;
    toolbar.hidden = automatic;
    const label = collapsed ? '展开角色目录' : '收起角色目录';
    button.textContent = mobileCatalog() ? (collapsed ? '目录' : '收起') : (collapsed ? '› 展开目录' : '‹ 收起目录');
    button.setAttribute('aria-label', label); button.title = label;
    button.setAttribute('aria-expanded', String(!collapsed));
  };
  const setCollapsed = (value) => {
    collapsed = value; paint();
    try { localStorage.setItem(storageKey, String(collapsed)); } catch { /* Layout still works. */ }
  };
  button.addEventListener('click', () => {
    setCollapsed(!collapsed);
    if (mobileCatalog() && !collapsed) sidebar.scrollIntoView({block: 'start'});
  });
  const closeWithEscape = (event) => {
    if (event.key !== 'Escape' || !mobileCatalog() || collapsed) return;
    event.preventDefault(); setCollapsed(true); button.focus({preventScroll: true});
  };
  sidebar.addEventListener('keydown', closeWithEscape); button.addEventListener('keydown', closeWithEscape);
  mobile?.addEventListener('change', paint);
  window.addEventListener('hashchange', paint);
  toolbar.append(button); shell.prepend(toolbar); paint();
})();
