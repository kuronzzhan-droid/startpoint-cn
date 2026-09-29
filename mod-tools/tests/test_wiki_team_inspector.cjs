const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../wiki/team-state.js');
const source = (name) => fs.readFileSync(path.join(__dirname,'../wiki',name),'utf8');
class Node {
  constructor(tag, className = '', text = '') {
    Object.assign(this,{tag,className,ownText:String(text || ''),children:[],events:{},attributes:{},value:'',disabled:false,hidden:false});
    this.classList = {toggle:()=>{},add:()=>{},remove:()=>{}};
  }
  append(...nodes) {nodes.forEach((node) => {node.parent = this; this.children.push(node);});}
  prepend(...nodes) {nodes.forEach((node) => {node.parent = this;}); this.children.unshift(...nodes);}
  replaceChildren(...nodes) {this.children.forEach((node) => {node.parent = null;}); this.children = []; this.ownText = ''; this.append(...nodes);}
  setAttribute(key, value) {this.attributes[key] = value;}
  addEventListener(name, handler) {this.events[name] = handler;}
  get isConnected() {return this.root || Boolean(this.parent?.isConnected);}
  get options() {return this.children;}
  get textContent() {return this.ownText + this.children.map((node) => node.textContent).join('');}
  set textContent(value) {this.replaceChildren(); this.ownText = String(value);}
  querySelectorAll(selector) {return this.all((node) => selector.startsWith('.') ? node.className.split(' ').includes(selector.slice(1)) : node.tag === selector);}
  all(match) {return this.children.flatMap((node) => [...(match(node) ? [node] : []), ...node.all(match)]);}
  async fire(name, extra = {}) {if (!this.disabled) return this.events[name]?.({preventDefault(){},...extra});}
}
const el = (tag, cls, text) => new Node(tag, cls, text);
const data = {meta:{sentinel:'full-meta'},characters:['a','b','c','d'].map((id) => ({id,name:`角色${id}`,icon:`${id}.png`,element:'火'})),
  equipment:[{id:'w',name:'武器',element:'火',rarity:5,soul:{available:true}},
    {id:'water',name:'水弓',element:'水',rarity:4,soul:{available:true}},
    {id:'no-soul',name:'无魂珠武器',element:'火',rarity:5,soul:{available:false}}]};
const plate = {...S.empty(),main:['a','b','c'],unison:['d','',''],weapon:['w','','']};
const one = (host, label) => host.all((node) => node.attributes['aria-label'] === label)[0];
const button = (host, label) => host.all((node) => node.tag === 'button' && node.textContent === label)[0];
function inspector(loadCharacter) {
  const listeners = {}, rendered = [];
  const window = {location:{hash:'#team'},addEventListener:(key, fn) => {listeners[key] = fn;},WFWikiData:{loadCharacter},
    renderWikiCharacterSummary(host, character, meta, ui, options) {rendered.push({character,meta,options});host.replaceChildren(ui.el('p','',character.name));}};
  vm.runInNewContext(source('team-inspector.js'),{window});
  const instance = window.WFTeamInspector.create(data,{el}); instance.element.root = true;
  return {window,listeners,rendered,instance,api:window.WFTeamInspector};
}
test('inspector requests a complete character and renders existing skills summary with native metadata', async () => {
  const full = {id:'a',name:'完整角色',skills:[{description:'完整技能'}],abilities:[{description:'主位能力'}]};
  const x = inspector(async (id) => {assert.equal(id,'a'); return full;}); await x.instance.show('a');
  assert.equal(x.rendered[0].character,full); assert.equal(x.rendered[0].meta,data.meta);
  assert.equal(x.instance.element.querySelectorAll('a')[0].href,'#character/a/details/profile');
  x.rendered[0].options.onOpenDetails('skills'); assert.equal(x.window.location.hash,'#character/a/details/skills');
});
test('older character loads cannot overwrite the most recently clicked avatar', async () => {
  const pending = {}, x = inspector((id) => new Promise((resolve) => {pending[id] = resolve;}));
  const a = x.instance.show('a'), b = x.instance.show('b');
  pending.b({id:'b',name:'角色b'}); await b; pending.a({id:'a',name:'角色a'}); await a;
  assert.deepEqual(x.rendered.map((entry) => entry.character.id),['b']);
});
test('unchanged selection does not duplicate requests and leaving the route prevents late rendering', async () => {
  let calls = 0, resolve;
  const x = inspector(() => {calls++;return new Promise((done) => {resolve = done;});});
  const first = x.instance.show('a'); await x.instance.show('a'); assert.equal(calls,1);
  x.window.location.hash = '#weapons'; resolve({id:'a',name:'A'}); await first; assert.equal(x.rendered.length,0);
});
test('empty slots show guidance and a failed data request can be retried', async () => {
  let failed = true;
  const x = inspector(async () => {if (failed) throw new Error('网络暂时不可用'); return {id:'a',name:'A'};});
  await x.instance.show(''); assert.match(x.instance.element.textContent,/点击盘子里的角色头像/);
  await x.instance.show('a'); assert.match(x.instance.element.textContent,/网络暂时不可用/);
  failed = false; await button(x.instance.element,'重新载入角色资料').fire('click'); assert.equal(x.rendered.length,1);
});
test('return link is limited to an explicitly opened team detail and cleared after unrelated navigation', async () => {
  const x = inspector(async () => null), host = el('section'); host.root = true;
  x.api.attachReturn(host,'character/a',{el}); assert.equal(host.children.length,0);
  x.api.remember('character','a'); x.api.attachReturn(host,'character/b',{el}); assert.equal(host.children.length,0);
  x.api.attachReturn(host,'character/a/details/voices',{el}); assert.equal(host.children[0].href,'#team');
  host.replaceChildren(); x.window.location.hash = '#'; x.listeners.hashchange();
  x.api.attachReturn(host,'character/a',{el}); assert.equal(host.children.length,0);
  x.api.remember('weapon','w'); x.api.attachReturn(host,'weapon/w',{el}); assert.equal(host.children[0].href,'#team');
});
function teamPage() {
  const inspected = [], remembered = [], stored = new Map();
  const window = {WFTeamState:S,location:{hash:'#team'},WFCharacterOrder:{compare:() => 0},
    WFTeamInspector:{create:() => ({element:el('aside','team-inspector'),show:(id) => inspected.push(id)}),remember:(...args) => remembered.push(args)},
    WFCharacterFilters:{create:() => ({element:el('div'),clearSearch(){},getState:() => ({}),matches:() => true})}};
  const ui = {el,picture:(path,name,cls) => el('img',cls,name),elementBadge:(element) => el('span','element-badge',element)};
  const context = {window,localStorage:{getItem:(key) => stored.get(key),setItem:(key,value) => stored.set(key,value)},setTimeout};
  vm.runInNewContext(source('team-equipment-filters.js'),context);
  vm.runInNewContext(source('team.js'),context);
  const host = el('main'); host.root = true;
  return {window,host,inspected,remembered,render:() => window.renderWikiTeam(host,data,ui)};
}
test('imported recommendation selection opens its character panel without changing the team or route', async () => {
  const x = teamPage(); x.window.WFTeamImport.load(plate,'推荐盘',{group:'unison',index:0}); x.render();
  assert.equal(x.inspected.at(-1),'d');
  const avatar = one(x.host,'2号主位：角色b'); assert.equal(avatar.tag,'button'); await avatar.fire('click');
  assert.equal(x.inspected.at(-1),'b'); assert.equal(x.window.location.hash,'#team');
  assert.ok(one(x.host,'1号主位：角色a')); assert.ok(one(x.host,'1号合击：角色d'));
  assert.equal(one(x.host,'2号主位：角色b').attributes['aria-current'],'true');
});
test('replacement and dragging still assign slots while keeping the active avatar panel in sync', async () => {
  const x = teamPage(); x.window.WFTeamImport.load(plate,'推荐盘'); x.render();
  await one(x.host,'替换2号主位').fire('click'); await one(x.host,'选择角色d').fire('click');
  assert.ok(one(x.host,'2号主位：角色d')); assert.ok(one(x.host,'1号合击：角色b')); assert.equal(x.inspected.at(-1),'d');
  await one(x.host,'3号主位：角色c').fire('drop',{dataTransfer:{getData:() => JSON.stringify({id:'a',kind:'character'})}});
  assert.ok(one(x.host,'3号主位：角色a')); assert.ok(one(x.host,'1号主位：角色c')); assert.equal(x.inspected.at(-1),'a');
});
test('returning from full details retains imported title, every slot and selected avatar', async () => {
  const x = teamPage(); x.window.WFTeamImport.load(plate,'保留的盘'); x.render();
  await one(x.host,'2号主位：角色b').fire('click');
  x.host.replaceChildren(el('p','','角色完整详情')); x.render();
  assert.equal(one(x.host,'队伍名称').value,'保留的盘'); assert.equal(x.inspected.at(-1),'b');
  assert.ok(one(x.host,'1号主位：角色a')); assert.ok(one(x.host,'1号合击：角色d'));
  const weapon = one(x.host,'1号装备：武器'); assert.equal(weapon.href,'#weapon/w'); await weapon.fire('click');
  assert.deepEqual(x.remembered,[['weapon','w']]);
});

test('three picker tabs assign to distinct slots, and selecting an empty soul slot opens only souls', async () => {
  const x = teamPage(); x.window.WFTeamImport.load(plate,'筛选盘'); x.render();
  await button(x.host,'武器').fire('click');
  assert.equal(button(x.host,'武器').attributes['aria-pressed'],'true'); assert.ok(one(x.host,'选择无魂珠武器'));
  await one(x.host,'武器水属性').fire('click'); assert.ok(one(x.host,'选择水弓')); assert.equal(one(x.host,'选择武器'),undefined);
  await one(x.host,'1号魂珠：空位').fire('click');
  assert.equal(button(x.host,'魂珠').attributes['aria-pressed'],'true'); assert.ok(one(x.host,'选择武器魂珠')); assert.equal(one(x.host,'选择无魂珠武器魂珠'),undefined);
  await one(x.host,'选择武器魂珠').fire('click'); assert.ok(one(x.host,'1号魂珠：武器'));
  await button(x.host,'武器').fire('click'); assert.ok(one(x.host,'选择水弓')); assert.equal(one(x.host,'选择武器'),undefined);
  await one(x.host,'选择水弓').fire('click'); assert.ok(one(x.host,'1号装备：水弓')); assert.ok(one(x.host,'1号魂珠：武器'));
  await one(x.host,'替换1号魂珠').fire('click'); assert.equal(button(x.host,'魂珠').attributes['aria-pressed'],'true');
  await button(x.host,'角色').fire('click'); assert.equal(button(x.host,'角色').attributes['aria-pressed'],'true'); assert.ok(one(x.host,'选择角色a'));
  assert.ok(one(x.host,'1号主位：角色a')); assert.equal(x.window.location.hash,'#team');
});
