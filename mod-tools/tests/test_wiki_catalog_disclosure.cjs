const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Node {
  constructor(tag, cls = '') {
    Object.assign(this, {tag, className: cls, children: [], dataset: {}, attributes: {}, events: {}, hidden: false, value: ''});
    this.classList = {add: (value) => {this.className += ` ${value}`;}};
  }
  append(...items) {
    for (const node of items) {
      if (node.tag === '#fragment') {this.append(...[...node.children]); continue;}
      if (node.parent) node.parent.children = node.parent.children.filter((item) => item !== node);
      node.parent = this; this.children.push(node);
    }
  }
  replaceChildren(...items) {this.children.forEach((node) => {node.parent = null;}); this.children = []; this.append(...items);}
  setAttribute(key, value) {this.attributes[key] = value;}
  getAttribute(key) {return this.attributes[key];}
  addEventListener(name, fn) {this.events[name] = fn;}
  fire(name) {this.events[name]?.({target: this});}
  matches(selector) {return selector.startsWith('#') ? this.id === selector.slice(1) : selector.startsWith('.') ? this.className.split(' ').includes(selector.slice(1)) : this.tag === selector;}
  querySelectorAll(selector) {return this.children.flatMap((node) => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]);}
  querySelector(selector) {return this.querySelectorAll(selector)[0] || null;}
  closest(selector) {return this.matches(selector) ? this : this.parent?.closest(selector) || null;}
}
function setup(handler = async () => ({items: []})) {
  const root = new Node('html'), catalog = new Node('section'); catalog.id = 'catalog-view'; root.append(catalog);
  const add = (id, tag = 'div', parent = root, cls = '') => {const node = new Node(tag, cls); node.id = id; parent.append(node); return node;};
  const controls = add('controls', 'div', catalog), display = add('display', 'div', controls, 'catalog-display-controls');
  add('catalog-character-filters', 'div', controls); add('catalog-avatar-controls', 'div', display);
  const sort = add('sort-order', 'select', display); sort.value = 'default';
  const heading = add('heading', 'div', catalog, 'section-heading'), title = new Node('h2'); heading.append(title);
  const count = add('result-count', 'span', title);
  ['filter-status', 'character-grid', 'empty-state', 'load-error', 'catalog-stats'].forEach((id) => add(id, 'div', catalog));
  ['header-version', 'nav-count', 'snapshot-note', 'category-nav', 'all-categories', 'empty-reset'].forEach((id) => add(id));
  const document = {getElementById: (id) => root.querySelector(`#${id}`), querySelectorAll: (query) => root.querySelectorAll(query),
    createElement: (tag) => new Node(tag), createDocumentFragment: () => new Node('#fragment'), addEventListener() {},
    documentElement: {style: {setProperty() {}}, classList: {add() {}}}};
  let callbacks, avatarCreates = 0; const requests = [];
  const state = {search: '', element: '', rarity: '', type: '', origin: ''};
  const characters = [{id: 'c1', name: '甲', element: '火', rarity: 5}, {id: 'c2', name: '乙', element: '水', rarity: 4}];
  const window = {WF_WIKI: {meta: {}, characters}, addEventListener() {},
    WFCommunity: {client: {request: (...args) => {requests.push(args); return handler(...args);}}},
    WFCharacterOrder: {compare: (a, b) => a.id.localeCompare(b.id)},
    WFCatalogAvatars: {create: () => ({picture: () => {avatarCreates++; return new Node('img');}})},
    WFCharacterFilters: {create(options) {callbacks = options; return {
      element: new Node('details'), getState: () => ({...state}),
      matches: (item) => (!state.element || state.element === item.element) && (!state.search || item.name.includes(state.search)),
      hasActiveFilters: () => Object.values(state).some(Boolean),
      reset() {Object.keys(state).forEach((key) => {state[key] = '';}); options.onStateChange({...state});},
    };}}, createWikiRouter: ({renderCatalog}) => renderCatalog};
  const context = {document, window, location: {hash: '', protocol: 'https:'}};
  for (const name of ['catalog-disclosure.js', 'catalog-ratings.js', 'app.js'])
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../wiki', name), 'utf8'), context);
  return {catalog, display, count, heading, sort, requests, updateRating: (id, value) => window.WFCatalogRatings.update(id, value), get created() {return avatarCreates;},
    cards: () => catalog.querySelectorAll('.character-card'), toggle: () => document.getElementById('catalog-list-toggle').fire('click'),
    change(values) {Object.assign(state, values); callbacks.onStateChange({...state}); callbacks.onChange({...state});},
    passive() {callbacks.onChange({...state});}, repeatNotify() {callbacks.onStateChange({...state}); callbacks.onChange({...state});}};
}

test('the real app creates no cards or portraits until the list is opened, and collapses by unmounting', () => {
  const x = setup(); assert.equal(x.created, 0); assert.equal(x.cards().length, 0);
  assert.equal(x.count.textContent, '2 / 2'); assert.equal(x.display.parent, x.heading);
  assert.equal(x.catalog.querySelector('.catalog-list-label').textContent, '展开角色列表');
  x.passive(); assert.equal(x.created, 0);
  x.toggle(); assert.equal(x.cards().length, 2); assert.equal(x.created, 2);
  assert.equal(x.catalog.querySelector('.catalog-list-label').textContent, '收起角色列表');
  x.toggle(); assert.equal(x.cards().length, 0);
  x.passive(); x.sort.fire('change'); assert.equal(x.created, 2); assert.equal(x.cards().length, 0);
});

test('batch ratings are lazy and update mounted card text without recreating portraits; rating sort preserves filters and collapse', async () => {
  let resolve; const x = setup(() => new Promise((done) => {resolve = done;}));
  await new Promise(setImmediate); assert.equal(x.requests.length, 0);
  x.toggle(); await new Promise(setImmediate); assert.equal(x.requests.length, 1); const original = x.cards()[0];
  resolve({items: [{id: 'c1', average: 0, voters: 1}, {id: 'c2', average: 5, voters: 1}]}); await new Promise(setImmediate);
  assert.equal(x.cards()[0], original); assert.equal(x.created, 2);
  assert.equal(original.querySelector('.card-rating').textContent, '评分 0.0');
  x.sort.value = 'rating-global-desc'; x.sort.fire('change'); assert.equal(x.cards()[0].href, '#character/c2');
  x.change({element: '火'}); assert.equal(x.cards().length, 1); assert.equal(x.cards()[0].href, '#character/c1');
  x.toggle(); const before = x.created; x.updateRating('c1', {average: 4, voters: 2}); x.passive();
  assert.equal(x.cards().length, 0); assert.equal(x.created, before); assert.equal(x.requests.length, 1);
});

test('selecting rating sort while collapsed loads one batch without mounting any card', async () => {
  const x = setup(); x.sort.value = 'rating-element-asc'; x.sort.fire('change'); await new Promise(setImmediate);
  assert.equal(x.requests.length, 1); assert.equal(x.created, 0); assert.equal(x.cards().length, 0);
});

test('active user filters reopen results; passive aliases and delayed duplicate notifications preserve manual collapse', () => {
  const x = setup(); x.change({element: '火'}); assert.equal(x.cards().length, 1);
  x.toggle(); assert.equal(x.cards().length, 0); const before = x.created;
  x.passive(); x.repeatNotify(); assert.equal(x.created, before); assert.equal(x.cards().length, 0);
  x.change({element: '水'}); assert.equal(x.cards().length, 1);
  x.toggle(); x.change({element: '', search: '甲'}); assert.equal(x.cards().length, 1);
});
