const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Node {
  constructor(tag, className = '', value = '') {
    Object.assign(this, {tag, className, textContent:value, children:[], dataset:{}, attributes:{}, events:{}});
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key]; }
  addEventListener(key, callback) { this.events[key] = callback; }
  click() { this.events.click?.(); }
  querySelectorAll(selector) {
    return this.children.flatMap((node) => [
      ...(selector === '[data-catalog-avatar]' ? node.dataset.catalogAvatar != null : node.tag === selector) ? [node] : [],
      ...node.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const el = (tag, cls, value) => new Node(tag, cls, value);
const characters = [{id:'c1', icon:'media/first.webp', avatars:{before:'media/first.webp',after:'media/second.webp'}},
  {id:'c2', icon:'media/single.webp', avatars:{before:'media/single.webp'}}, {id:'c3',icon:'media/legacy.webp'}];
function setup(saved, blocked = false) {
  const storage = new Map(saved ? [['wf-wiki-catalog-avatar', saved]] : []);
  const window = {}, catalog = el('main'), host = el('div');
  const ui = {el, safeUrl:(v) => typeof v === 'string' && !v.startsWith('javascript:') ? v : '',
    picture:(url) => { const img = el('img'); img.setAttribute('src',url); return img; }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../wiki/catalog-avatars.js'),'utf8'), {window,
    localStorage:{getItem:(key) => {if (blocked) throw Error(); return storage.get(key);},
      setItem:(key,value) => {if (blocked) throw Error(); storage.set(key,value);}}});
  const api = window.WFCatalogAvatars.create({host,catalog,characters,ui});
  const cards = characters.map((character) => { const card = el('a'); card.append(api.picture(character)); catalog.append(card); return card; });
  return {api, catalog, cards, buttons:host.querySelectorAll('button'), storage};
}
const src = (node) => node.querySelector('img').getAttribute('src');

test('a single toggle updates every catalogue avatar without rebuilding cards or changing other views', () => {
  const {cards,catalog,buttons,storage} = setup();
  const unrelatedTeam = el('img'); unrelatedTeam.setAttribute('src','media/team.webp');
  const source = JSON.stringify(characters), firstCards = [...catalog.children];
  assert.equal(src(cards[0]),'media/first.webp');
  assert.equal(buttons[0].attributes['aria-pressed'],'true');
  buttons[1].click();
  assert.equal(src(cards[0]),'media/second.webp');
  assert.equal(src(cards[1]),'media/single.webp');
  assert.equal(src(cards[2]),'media/legacy.webp');
  assert.match(cards[1].children[0].title,/未收录/);
  assert.equal(buttons[1].attributes['aria-pressed'],'true');
  assert.equal(storage.get('wf-wiki-catalog-avatar'),'after');
  assert.deepEqual(catalog.children,firstCards);
  assert.equal(unrelatedTeam.getAttribute('src'),'media/team.webp');
  assert.equal(JSON.stringify(characters),source);
  buttons[0].click();
  assert.equal(src(cards[0]),'media/first.webp');
});

test('persisted preference applies to new and filtered catalogue cards', () => {
  const {cards,api,buttons} = setup('after');
  assert.equal(src(cards[0]),'media/second.webp');
  assert.equal(buttons[1].attributes['aria-pressed'],'true');
  assert.equal(src(api.picture(characters[0])),'media/second.webp');
});

test('unavailable storage and obsolete settings still allow both choices', () => {
  for (const [saved,blocked] of [['invalid',false],['after',true]]) {
    const {cards,buttons} = setup(saved,blocked);
    assert.equal(src(cards[0]),'media/first.webp');
    buttons[1].click();
    assert.equal(src(cards[0]),'media/second.webp');
  }
});
