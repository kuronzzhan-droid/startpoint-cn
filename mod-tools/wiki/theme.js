/* Theme preference is local to this browser; character artwork keeps its colors. */
(() => {
  'use strict';
  const key = 'wf-wiki-theme';
  let current = 'light';
  try { if (localStorage.getItem(key) === 'dark') current = 'dark'; } catch { /* Optional persistence. */ }
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'theme-toggle';
  const apply = () => {
    document.documentElement.dataset.theme = current;
    button.textContent = current === 'dark' ? '☀ 明亮' : '☾ 黑夜';
    button.setAttribute('aria-label', current === 'dark' ? '切换明亮风格' : '切换黑夜风格');
    button.setAttribute('aria-pressed', String(current === 'dark'));
  };
  button.addEventListener('click', () => {
    current = current === 'dark' ? 'light' : 'dark'; apply();
    try { localStorage.setItem(key, current); } catch { /* Switching still works. */ }
  });
  apply();
  document.querySelector('.brand')?.after(button);
})();
