/* Touch swipes use the same links as the header; editing and local drags keep priority. */
(() => {
  'use strict';
  const nav = document.querySelector('.app-navigation'), main = document.getElementById('main-content');
  if (!nav || !main || !window.matchMedia) return;
  const links = [...nav.querySelectorAll('a[href^="#"]')];
  const routes = links.map(link => link.getAttribute('href').slice(1));
  const contentRoutes = new Set(['', 'community', 'weapons', 'dungeons']);
  const mobile = window.matchMedia('(max-width:760px)');
  const header = nav.closest('.masthead');
  const hint = document.createElement('p'); hint.className = 'mobile-nav-hint';
  hint.textContent = '左右滑动栏目，切换页面'; hint.setAttribute('aria-hidden', 'true'); header?.append(hint);
  const interactive = 'input,textarea,select,button,summary,label,form,[contenteditable]:not([contenteditable="false"]),[role="combobox"],[draggable="true"]';
  const editable = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="combobox"]';
  let gesture = null, suppressClickUntil = 0;
  const route = () => window.location.hash.replace(/^#/, '');
  const currentIndex = () => links.findIndex(link => link.getAttribute('aria-current') === 'page');
  const accounts = () => /^community\/accounts(?:\/|$)/.test(route());
  const element = target => target?.nodeType === 1 ? target : target?.parentElement;
  function available() {
    return mobile.matches && currentIndex() >= 0 && !accounts() && !main.querySelector('form')
      && !document.querySelector('dialog[open],[aria-modal="true"]')
      && !document.activeElement?.matches?.(editable);
  }
  function hasHorizontalScroll(target, boundary) {
    for (let current = target; current && current !== boundary; current = current.parentElement) {
      if (current.scrollWidth > current.clientWidth + 1 && /(auto|scroll)/.test(window.getComputedStyle(current).overflowX)) return true;
    }
    return false;
  }
  function sync() {
    gesture = null;
    header?.classList.toggle('mobile-nav-ready', mobile.matches && currentIndex() >= 0 && !accounts());
  }
  document.addEventListener('touchstart', event => {
    gesture = null;
    if (event.touches.length !== 1 || !available()) return;
    const target = element(event.target), point = event.touches[0], onNav = target && nav.contains(target);
    if (!target || target.closest(interactive)) return;
    if (!onNav && (!contentRoutes.has(route()) || !main.contains(target) || hasHorizontalScroll(target, main))) return;
    // Preserve the browser's own edge/back gesture.
    if (point.clientX < 18 || point.clientX > window.innerWidth - 18) return;
    gesture = {identifier: point.identifier, x: point.clientX, y: point.clientY, at: Date.now(), hash: route(), index: currentIndex(), horizontal: false};
  }, {passive: true});
  document.addEventListener('touchmove', event => {
    if (!gesture) return;
    if (event.touches.length !== 1 || !available() || gesture.hash !== route()) {gesture = null; return;}
    const point = [...event.touches].find(touch => touch.identifier === gesture.identifier);
    if (!point) {gesture = null; return;}
    const x = Math.abs(point.clientX - gesture.x), y = Math.abs(point.clientY - gesture.y);
    if (!gesture.horizontal && y > 10 && y >= x) {gesture = null; return;}
    if (!gesture.horizontal && x >= 12 && x > y * 1.5) gesture.horizontal = true;
    if (gesture.horizontal) {
      if (!event.cancelable) {gesture = null; return;}
      event.preventDefault();
    }
  }, {passive: false});
  document.addEventListener('touchend', event => {
    const current = gesture; gesture = null;
    if (!current || event.touches.length || !available() || current.hash !== route()) return;
    const point = [...event.changedTouches].find(touch => touch.identifier === current.identifier);
    if (!point) return;
    const x = point.clientX - current.x, y = point.clientY - current.y;
    const threshold = Math.min(80, Math.max(52, window.innerWidth * .15));
    if (!current.horizontal || Math.abs(x) < threshold || Math.abs(x) < Math.abs(y) * 1.5 || Date.now() - current.at > 1200) return;
    suppressClickUntil = Date.now() + 500;
    const next = current.index + (x < 0 ? 1 : -1);
    if (next < 0 || next >= routes.length) return;
    window.location.hash = links[next].getAttribute('href');
    window.scrollTo?.({top: 0, behavior: 'auto'});
  }, {passive: true});
  document.addEventListener('touchcancel', () => {gesture = null;}, {passive: true});
  document.addEventListener('click', event => {
    if (suppressClickUntil <= Date.now() || event.detail === 0) return;
    suppressClickUntil = 0; event.preventDefault(); event.stopPropagation();
  }, true);
  // The first router render may finish after the deferred scripts have loaded.
  if (window.MutationObserver) new window.MutationObserver(sync).observe(nav, {subtree:true, attributes:true, attributeFilter:['aria-current']});
  window.addEventListener('hashchange', sync); mobile.addEventListener?.('change', sync); sync();
})();
