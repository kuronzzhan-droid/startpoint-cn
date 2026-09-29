const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const order = require('../wiki/equipment-order.js');
const entries = [
  {id:'zzz',name:'早期五星',rarity:5,category:'其他武器'},
  {id:'aaa',name:'后期五星',rarity:5,category:'其他武器'},
  {id:'weak',name:'近期三星',rarity:3,category:'其他武器'},
  {id:'abyss-old',name:'深渊早期五星',rarity:5,category:'深渊武器'},
  {id:'abyss-new',name:'深渊后期五星',rarity:5,category:'深渊武器'},
  {id:'abyss-low',name:'深渊一星',rarity:1,category:'深渊武器'},
];
test('higher rarity precedes newer low rarity and same-rarity order ignores opaque ID spelling', () => {
  const before = entries.map((entry) => entry.id), compare = order.createCompare(entries);
  assert.deepEqual([...entries].sort(compare).map((entry) => entry.id),['abyss-new','abyss-old','aaa','zzz','weak','abyss-low']);
  assert.deepEqual(entries.map((entry) => entry.id),before);
  assert.deepEqual([entries[0],entries[1],entries[2]].sort(compare).map((entry) => entry.id),['aaa','zzz','weak']);
});
test('unknown positions and missing rarity sort after known entries without producing NaN', () => {
  const compare = order.createCompare(entries);
  assert.ok(compare(entries[0],{id:'not-in-catalog',rarity:5}) < 0);
  assert.ok(compare(entries[5],{id:'not-in-catalog'}) < 0);
  assert.equal(compare({id:'none',rarity:'invalid'},{id:'other'}),0);
});
class Node {
  constructor(tag, cls = '', text = '') {Object.assign(this,{tag,className:cls,ownText:text,children:[],events:{},attributes:{},value:''});}
  append(...nodes) {nodes.forEach((node) => {node.parent = this;this.children.push(node);});}
  replaceChildren(...nodes) {this.children = []; this.ownText = ''; this.append(...nodes);}
  replaceWith(next) {const index = this.parent.children.indexOf(this);this.parent.children[index] = next;next.parent = this.parent;}
  setAttribute(key,value) {this.attributes[key] = value;}
  addEventListener(name, listener) {this.events[name] = listener;}
  get textContent() {return this.ownText + this.children.map((node) => node.textContent).join('');}
  set textContent(text) {this.children = [];this.ownText = text;}
  all(match) {return this.children.flatMap((node) => [...(match(node) ? [node] : []),...node.all(match)]);}
  fire(name) {this.events[name]?.();}
}
test('weapon groups start unmounted and preserve category/rarity ordering when expanded and filtered', () => {
  const el = (...args) => new Node(...args), host = el('main');
  const window = {WFEquipmentOrder:order,WFWikiReadable:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../wiki/equipment-page.js'),'utf8'),{window});
  window.renderWikiWeaponPage(host,{equipment:entries},{el,picture:(_url, name, cls) => el('img',cls,name)});
  const names = () => host.all((node) => node.tag === 'strong').map((node) => node.textContent);
  assert.deepEqual(names(), []);
  assert.ok(host.all((node) => node.className === 'equipment-group').every((node) => node.open === false));
  host.all((node) => node.tag === 'button' && node.textContent === '全部展开')[0].fire('click');
  assert.deepEqual(names(),['深渊后期五星','深渊早期五星','深渊一星','后期五星','早期五星','近期三星']);
  const rarity = host.all((node) => node.attributes['aria-label'] === '武器星级')[0];
  rarity.value = '5'; rarity.fire('change');
  assert.deepEqual(names(),['深渊后期五星','深渊早期五星','后期五星','早期五星']);
  const category = host.all((node) => node.attributes['aria-label'] === '武器分类')[0];
  category.value = '其他武器'; category.fire('change'); assert.deepEqual(names(),['后期五星','早期五星']);
});

test('a standalone weapon still opens its detail card immediately', () => {
  const el = (...args) => new Node(...args), host = el('main'), document = {};
  const window = {WFEquipmentOrder:order,WFWikiReadable:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../wiki/equipment-page.js'),'utf8'),{window,document});
  window.renderWikiWeaponPage(host,{equipment:entries},{el,picture:(_url,name,cls) => el('img',cls,name)},'aaa');
  const card = host.all((node) => node.className.includes('equipment-card'))[0];
  assert.equal(card.open,true); assert.match(document.title,/后期五星/);
});
