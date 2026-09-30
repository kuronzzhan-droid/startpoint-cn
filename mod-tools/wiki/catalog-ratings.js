/* One public aggregate request for the catalogue; never fetch individual votes. */
(() => {
  'use strict';
  const modes = [['rating-element-desc', '属性内评分从高到低'], ['rating-element-asc', '属性内评分从低到高'],
    ['rating-global-desc', '全体评分从高到低'], ['rating-global-asc', '全体评分从低到高']];
  const elements = ['火', '水', '雷', '风', '光', '暗'];
  const rank = (value) => elements.includes(value) ? elements.indexOf(value) : elements.length;
  const normalize = (value) => {
    if (!value || !Number.isSafeInteger(value.voters) || value.voters < 0) return null;
    if (value.voters === 0) return value.average === null ? {average: null, voters: 0} : null;
    return typeof value.average === 'number' && Number.isFinite(value.average) && value.average >= 0 && value.average <= 5
      ? {average: value.average, voters: value.voters} : null;
  };
  const api = window.WFCatalogRatings = {create({characters, sort, host, ui, onChange}) {
    const {el} = ui, ids = new Set(characters.map((character) => String(character.id)));
    const records = new Map(), updated = new Map();
    let phase = 'idle', revision = 0, pending = null;
    const status = el('div', 'catalog-rating-status'), message = el('span');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const retry = el('button', 'text-button', '重试评分'); retry.type = 'button';
    status.append(message, retry); host.append(status);
    modes.forEach(([value, label]) => {const option = el('option', '', label); option.value = value; sort.append(option);});
    const isRatingSort = () => modes.some(([value]) => value === sort.value);
    function paintStatus() {
      status.hidden = phase === 'idle' || phase === 'ready';
      retry.hidden = phase !== 'error';
      message.textContent = phase === 'loading' ? '正在加载玩家评分…' : phase === 'offline'
        ? '离线版无法读取玩家评分；缺少评分显示 —。' : '评分暂时未能加载，缺少评分显示 —。';
    }
    function paint(card) {
      const value = records.get(card.dataset.catalogRatingId), rated = value && value.voters > 0;
      const label = rated ? `评分 ${value.average.toFixed(1)} / 5 · ${value.voters} 人`
        : phase === 'ready' ? '评分 —（未评分）' : '评分 —（尚未加载）';
      const badge = card.querySelector('.card-rating');
      badge.textContent = '评分 ';
      badge.append(el('strong', 'card-rating-value', rated ? value.average.toFixed(1) : '—')); badge.title = label;
      card.title = `${card.dataset.catalogBaseTitle} · ${label}`;
      card.setAttribute('aria-label', `${card.dataset.catalogBaseLabel}，${label}`);
    }
    function update(id, value) {
      id = String(id); const record = normalize(value);
      if (!ids.has(id) || !record) return false;
      const previous = records.get(id);
      records.set(id, record); updated.set(id, ++revision);
      if (previous?.average !== record.average || previous?.voters !== record.voters) onChange();
      return true;
    }
    async function load() {
      if (pending || phase === 'ready' || phase === 'error' || phase === 'offline') return pending;
      if (location.protocol === 'file:') {phase = 'offline'; paintStatus(); return;}
      phase = 'loading'; paintStatus(); const started = revision;
      pending = Promise.resolve().then(() => window.WFCommunity.client.request('/ratings/characters')).then((response) => {
        if (!Array.isArray(response?.items)) throw new Error('invalid_ratings');
        const received = new Map();
        for (const item of response.items) {
          const record = normalize(item);
          if (!record || typeof item.id !== 'string' || received.has(item.id)) throw new Error('invalid_ratings');
          if (ids.has(item.id)) received.set(item.id, record);
        }
        for (const id of ids) {
          if ((updated.get(id) || 0) > started) continue; // A vote accepted after this request wins over its snapshot.
          if (received.has(id)) records.set(id, received.get(id)); else records.delete(id);
        }
        phase = 'ready'; onChange();
      }).catch(() => {phase = 'error';}).finally(() => {pending = null; paintStatus();});
      return pending;
    }
    retry.addEventListener('click', () => {if (phase === 'error') {phase = 'idle'; load();}});
    api.update = update;
    window.addEventListener('wf-character-rating-updated', (event) => {
      if (event.detail) update(event.detail.id, event.detail);
    });
    paintStatus();
    return {isRatingSort, load, update,
      compare(a, b) {
        if (sort.value.startsWith('rating-element-')) {
          const group = rank(a.element) - rank(b.element); if (group) return group;
        }
        const av = records.get(String(a.id)), bv = records.get(String(b.id));
        const ar = Boolean(av?.voters), br = Boolean(bv?.voters);
        if (ar !== br) return ar ? -1 : 1;
        if (ar && av.average !== bv.average) return (av.average - bv.average) * (sort.value.endsWith('-asc') ? 1 : -1);
        if (ar && av.voters !== bv.voters) return bv.voters - av.voters;
        return window.WFCharacterOrder.compare(a, b);
      },
      decorate(card, character) {
        card.dataset.catalogRatingId = String(character.id);
        card.dataset.catalogBaseTitle = card.title;
        card.dataset.catalogBaseLabel = card.getAttribute('aria-label');
        card.querySelector('.card-meta').append(el('span', 'card-rating')); paint(card);
      },
      paintMounted(catalog) {catalog.querySelectorAll('.character-card').forEach(paint);},
    };
  }};
})();
