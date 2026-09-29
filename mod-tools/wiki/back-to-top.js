/* Scroll control stays independent of catalogue routes and filters. */
(() => {
  'use strict';
  const button = document.getElementById('back-to-top');
  if (!button) return;
  const update = () => { button.hidden = window.scrollY < 320; };
  window.addEventListener('scroll', update, {passive: true});
  button.addEventListener('click', () => {
    window.scrollTo({top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
  });
  update();
})();
