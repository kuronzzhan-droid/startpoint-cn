/* Catalogue density is independent from filters and team composition. */
(() => {
  'use strict';
  const catalog = document.getElementById('catalog-view');
  const control = document.getElementById('catalog-layout');
  if (!catalog || !control) return;
  const choices = new Set(['extra-large', 'large', 'standard', 'dense']);
  const storageKey = 'wf-wiki-catalog-layout';
  const apply = (value) => {
    const layout = choices.has(value) ? value : 'standard';
    catalog.dataset.layout = layout;
    control.value = layout;
  };
  let saved;
  try { saved = localStorage.getItem(storageKey); } catch { /* Storage can be disabled for local files. */ }
  apply(saved);
  control.addEventListener('change', () => {
    apply(control.value);
    try { localStorage.setItem(storageKey, control.value); } catch { /* The current view still works. */ }
  });
})();
