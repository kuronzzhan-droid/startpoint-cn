const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../wiki/team-state.js');
const source = (name) => fs.readFileSync(path.join(__dirname,'../wiki',name),'utf8');
class Node {
  constructor(tag, className = '', text = '') {
    Object.assign(this,{tag,className,ownText:String(text || ''),children:[],events:{},attributes:{},dataset:{},value:'',disabled:false,hidden:false});
    this.classList = {toggle:()=>{},add:()=>{},remove:()=>{}};
  }
  append(...nodes) {nodes.forEach((node) => {node.parent = this; this.children.push(node);});}
  prepend(...nodes) {nodes.forEach((node) => {node.parent = this;}); this.children.unshift(...nodes);}
  replaceChildren(...nodes) {this.children.forEach((node) => {node.parent = null;}); this.children = []; this.ownText = ''; this.append(...nodes);}
  setAttribute(key, value) {this.attributes[key] = value;}
  getAttribute(key) {return this.attributes[key];}
  addEventListener(name, handler) {this.events[name] = handler;}
  get isConnected() {return this.root || Boolean(this.parent?.isConnected);}
  get options() {return this.children;}
  get textContent() {return this.ownText + this.children.map((node) => node.textContent).join('');}
  set textContent(value) {this.replaceChildren(); this.ownText = String(value);}
  querySelectorAll(selector) {return this.all((node) => selector === '[data-catalog-avatar]' ? node.dataset.catalogAvatar !== undefined
    : selector.startsWith('.') ? node.className.split(' ').includes(selector.slice(1)) : node.tag === selector);}
  querySelector(selector) {return this.querySelectorAll(selector)[0] || null;}
  all(match) {return this.children.flatMap((node) => [...(match(node) ? [node] : []), ...node.all(match)]);}
  async fire(name, extra = {}) {if (!this.disabled) return this.events[name]?.({preventDefault(){},...extra});}
}
const el = (tag, cls, text) => new Node(tag, cls, text);
const data = {meta:{sentinel:'full-meta'},characters:['a','b','c','d'].map((id) => ({id,name:`角色${id}`,icon:`${id}.png`,element:'火',
  rarity:5,type:'剑士',theme:'常服',...(id === 'a' ? {limited:true,origin:'新增MOD'} : {}),
  avatars:{before:`${id}.png`,...(id === 'd' ? {} : {after:`${id}-after.png`})}})),
  equipment:[{id:'w',name:'武器',element:'火',rarity:5,awakenedEffects:['装备攻击 +25%'],
    enhancement:{maxLevel:120,effects:['强化技能伤害 +80%']},soul:{available:true,effects:['魂珠攻击 +10%']}},
    {id:'water',name:'水弓',element:'水',rarity:4,soul:{available:true}},
    {id:'no-soul',name:'无魂珠武器',element:'火',rarity:5,soul:{available:false}}]};
const plate = {...S.empty(),main:['a','b','c'],unison:['d','',''],weapon:['w','','']};
const one = (host, label) => host.all((node) => node.attributes['aria-label'] === label)[0];
const button = (host, label) => host.all((node) => node.tag === 'button' && node.textContent === label)[0];
function inspector(loadCharacter, avatars) {
  const listeners = {}, rendered = [];
  const window = {location:{hash:'#team'},addEventListener:(key, fn) => {listeners[key] = fn;},WFWikiData:{loadCharacter},
    renderWikiCharacterSummary(host, character, meta, ui, options) {rendered.push({character,meta,options});host.replaceChildren(ui.el('p','',character.name),ui.el('div','summary-avatar'));}};
  vm.runInNewContext(source('team-inspector.js'),{window});
  const instance = window.WFTeamInspector.create(data,{el},avatars); instance.element.root = true;
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
test('team origin replaces the overview back link instead of creating duplicate navigation', () => {
  const x = inspector(async () => null), host = el('section'), nav = el('nav'), link = el('a','summary-back-link','返回角色图鉴');
  link.href = '#'; nav.append(link); host.append(nav);
  x.api.remember('character','a'); x.api.attachReturn(host,'character/a',{el});
  assert.equal(host.querySelectorAll('a').length,1); assert.equal(link.href,'#team');
  assert.equal(link.textContent,'‹ 返回当前编队');
});
test('following a character variant preserves an existing team origin without inventing one', () => {
  const x = inspector(async () => null), host = el('section');
  x.window.location.hash = '#character/a'; x.api.rememberVariant('b');
  x.api.attachReturn(host,'character/b',{el}); assert.equal(host.children.length,0);
  x.api.remember('character','a'); x.api.rememberVariant('b');
  x.window.location.hash = '#character/b'; x.listeners.hashchange();
  x.api.attachReturn(host,'character/b',{el}); assert.equal(host.children[0].href,'#team');
});
test('Back and Forward within a followed variant chain retain the current team return link', () => {
  const x = inspector(async () => null);
  const navigate = (route) => {
    x.window.location.hash = '#' + route; x.listeners.hashchange();
    const host = el('section'); x.api.attachReturn(host,route,{el}); return host.children[0]?.href;
  };
  x.api.remember('character','a'); assert.equal(navigate('character/a'),'#team');
  x.api.rememberVariant('b'); assert.equal(navigate('character/b'),'#team');
  x.api.rememberVariant('c'); assert.equal(navigate('character/c'),'#team');
  assert.equal(navigate('character/b'),'#team'); assert.equal(navigate('character/a'),'#team');
  assert.equal(navigate('character/b/details/skills'),'#team'); assert.equal(navigate('character/c'),'#team');
});
test('leaving the explicit variant chain clears every remembered member and a fresh team visit resets it', () => {
  const x = inspector(async () => null);
  const navigate = (route) => {
    x.window.location.hash = '#' + route; x.listeners.hashchange();
    const host = el('section'); x.api.attachReturn(host,route,{el}); return host.children[0]?.href;
  };
  const start = () => {x.api.remember('character','a'); navigate('character/a'); x.api.rememberVariant('b'); navigate('character/b');};
  start(); navigate(''); assert.equal(navigate('character/a'),undefined); assert.equal(navigate('character/b'),undefined);
  start(); assert.equal(navigate('character/unrelated'),undefined); assert.equal(navigate('character/a'),undefined);
  start(); navigate('team'); x.api.remember('weapon','w'); assert.equal(navigate('weapon/w'),'#team');
  assert.equal(navigate('character/b'),undefined);
});
function teamPage(catalogue = data) {
  const inspected = [], remembered = [], stored = new Map();
  const window = {WFTeamState:S,location:{hash:'#team'},WFCharacterOrder:{compare:() => 0},
    WFTeamInspector:{create:() => ({element:el('aside','team-inspector'),show:(id) => inspected.push(id)}),remember:(...args) => remembered.push(args)},
    WFCharacterFilters:{create:() => ({element:el('div'),clearSearch(){},getState:() => ({}),matches:() => true})}};
  const ui = {el,safeUrl:(value)=>typeof value==='string'?value:'',
    picture:(path,name,cls) => {const image=el('img',cls,name);image.setAttribute('src',path);return image;},
    elementBadge:(element) => el('span','element-badge',element)};
  const context = {window,localStorage:{getItem:(key) => stored.get(key),setItem:(key,value) => stored.set(key,value)},setTimeout};
  vm.runInNewContext(source('equipment-order.js'),context);
  vm.runInNewContext(source('team-equipment-filters.js'),context);
  vm.runInNewContext(source('catalog-avatars.js'),context);
  vm.runInNewContext(source('character-badges.js'),context);
  vm.runInNewContext(source('team-saved-store.js'),context);
  vm.runInNewContext(source('team-saved.js'),context);
  vm.runInNewContext(source('team.js'),context);
  const host = el('main'); host.root = true;
  return {window,host,inspected,remembered,stored,render:() => window.renderWikiTeam(host,catalogue,ui)};
}

test('team help starts folded and the title beside the plate survives edits, undo and saving',async()=>{
  const x=teamPage();x.window.WFTeamImport.load(plate,'原队伍名');x.render();
  const help=x.host.querySelector('.team-help'),heading=x.host.querySelector('.team-board-heading');
  assert.equal(help.tag,'details');assert.equal(help.open,false);
  assert.equal(help.children[0].tag,'summary');assert.equal(help.children[0].querySelector('h1').textContent,'配队模拟');
  assert.match(help.textContent,/拖拽头像.*本页不模拟战斗/s);
  const title=one(x.host,'队伍名称');assert.equal(title.parent,heading);
  assert.equal(heading.children[0].textContent,'队伍编成');assert.equal(title.value,'原队伍名');
  assert.equal(x.host.querySelector('.team-toolbar').querySelectorAll('input').filter(n=>!n.hidden).length,0);
  title.value='手机新队伍';await title.fire('input');
  await one(x.host,'替换2号主位').fire('click');await one(x.host,'选择角色d').fire('click');
  await button(x.host,'撤销').fire('click');
  assert.equal(one(x.host,'队伍名称'),title);assert.equal(title.value,'手机新队伍');
  await button(x.host,'保存队伍').fire('click');
  const saved=JSON.parse(x.stored.get('wf-wiki-teams-v1'))[0];assert.equal(saved.name,'手机新队伍');assert.deepEqual(saved.team,plate);
  x.render();assert.equal(one(x.host,'队伍名称').value,'手机新队伍');
  assert.equal(x.host.querySelector('.team-help').open,false);
});
test('a stale quick-load selection refreshes its records without replacing the current team', async () => {
  const x = teamPage(); x.window.WFTeamImport.load(plate, '原队伍'); x.render();
  await button(x.host, '保存队伍').fire('click'); await button(x.host, '清空队伍').fire('click');
  const picker = one(x.host, '已保存队伍'), changed = {...S.empty(), main: ['b', '', '']};
  x.stored.set('wf-wiki-teams-v1', JSON.stringify([{name: '其他页面更新', team: changed}]));
  picker.value = '0'; await picker.fire('change');
  assert.ok(one(x.host, '1号主位：空位')); assert.equal(one(x.host, '队伍名称').value, '原队伍');
  assert.match(x.host.querySelector('.team-status').textContent, /其他页面修改或删除/);
  assert.equal(picker.options[1].textContent, '其他页面更新');
  picker.value = '0'; await picker.fire('change');
  assert.ok(one(x.host, '1号主位：角色b')); assert.equal(one(x.host, '队伍名称').value, '其他页面更新');
});

test('unchanged full-roster candidates are reused across slots and still assign to the latest target',async()=>{
  const catalogue={...data,characters:Array.from({length:572},(_,index)=>({...data.characters[0],id:`c${index}`,name:`角色${index}`}))};
  const x=teamPage(catalogue);x.render();const pool=x.host.querySelector('.team-candidates');
  const mounted=[...pool.children],first=one(x.host,'选择角色0');pool.scrollTop=600;
  await one(x.host,'2号主位：空位').fire('click');
  assert.equal(pool.children.length,572);assert.ok(pool.children.every((node,index)=>node===mounted[index]));
  assert.equal(pool.scrollTop,600);assert.equal(one(x.host,'选择角色0'),first);
  await first.fire('click');assert.ok(one(x.host,'2号主位：角色0'));
  await one(x.host,'1号合击：空位').fire('click');await one(x.host,'选择角色1').fire('click');
  assert.ok(one(x.host,'1号合击：角色1'));assert.ok(pool.children.every((node,index)=>node===mounted[index]));
  const beforeImage=first.querySelector('img');await button(x.host,'觉醒后').fire('click');
  assert.equal(one(x.host,'选择角色0'),first);assert.notEqual(first.querySelector('img'),beforeImage);
  assert.equal(first.querySelector('img').getAttribute('src'),'a-after.png');
  let dragged;await first.fire('dragstart',{dataTransfer:{setData:(_type,value)=>{dragged=JSON.parse(value);}}});
  assert.deepEqual(dragged,{id:'c0',kind:'character'});
});

test('candidate reuse invalidates on sort, filtered IDs and weapon versus soul mode, but preserves same results',async()=>{
  const x=teamPage();x.render();const original=one(x.host,'选择角色a');
  x.window.WFCharacterOrder.compareTeam=(a,b)=>b.name.localeCompare(a.name);
  await one(x.host,'2号主位：空位').fire('click');
  assert.notEqual(one(x.host,'选择角色a'),original);
  assert.deepEqual(x.host.querySelectorAll('.team-candidate').map(n=>n.attributes['aria-label']),['选择角色d','选择角色c','选择角色b','选择角色a']);
  await button(x.host,'武器').fire('click');const weapon=one(x.host,'选择武器');
  await one(x.host,'2号装备：空位').fire('click');assert.equal(one(x.host,'选择武器'),weapon);
  const search=one(x.host,'配队武器搜索');search.value='水弓';await search.fire('input');
  assert.equal(one(x.host,'选择武器'),undefined);const water=one(x.host,'选择水弓');
  await one(x.host,'3号装备：空位').fire('click');assert.equal(one(x.host,'选择水弓'),water);
  await button(x.host,'魂珠').fire('click');assert.equal(one(x.host,'选择水弓'),undefined);assert.ok(one(x.host,'选择水弓魂珠'));
  assert.equal(one(x.host,'选择无魂珠武器魂珠'),undefined);
  await button(x.host,'武器').fire('click');assert.equal(search.value,'水弓');assert.ok(one(x.host,'选择水弓'));
  assert.equal(one(x.host,'选择武器'),undefined);
  search.value='不存在';await search.fire('input');const empty=x.host.querySelector('.team-candidates').children[0];
  await one(x.host,'1号装备：空位').fire('click');assert.equal(x.host.querySelector('.team-candidates').children[0],empty);
});

test('inspector uses the current portrait choice after an asynchronous detail load', async () => {
  let form='before',resolve;
  const x=inspector(()=>new Promise((done)=>{resolve=done;}),{picture(character){return el('span','chosen-avatar',`${character.id}-${form}`);}});
  const loading=x.instance.show('a');form='after';resolve({id:'a',name:'角色a'});await loading;
  assert.equal(x.instance.element.querySelector('.summary-avatar').textContent,'a-after');
  assert.equal(x.rendered.length,1);assert.equal(x.instance.element.querySelectorAll('a')[0].href,'#character/a/details/profile');
});

test('one team switch updates slots and candidates in place without losing selection, filters, history or saved plate',async()=>{
  const x=teamPage();x.window.WFTeamImport.load(plate,'保留头像盘',{group:'unison',index:0});x.render();
  const avatar=one(x.host,'1号主位：角色a'),candidate=one(x.host,'选择角色a');
  const read=(node)=>node.querySelector('img').getAttribute('src');
  await button(x.host,'觉醒后').fire('click');
  assert.equal(read(avatar),'a-after.png');assert.equal(read(candidate),'a-after.png');
  assert.equal(read(one(x.host,'1号合击：角色d')),'d.png');
  assert.equal(one(x.host,'1号主位：角色a'),avatar);assert.equal(x.inspected.at(-1),'d');
  assert.equal(one(x.host,'1号合击：角色d').attributes['aria-current'],'true');
  await button(x.host,'武器').fire('click');await one(x.host,'武器水属性').fire('click');
  await button(x.host,'觉醒前').fire('click');
  assert.ok(one(x.host,'选择水弓'));assert.equal(one(x.host,'选择武器'),undefined);
  await button(x.host,'角色').fire('click');await one(x.host,'替换2号主位').fire('click');await one(x.host,'选择角色d').fire('click');
  await button(x.host,'觉醒后').fire('click');await button(x.host,'撤销').fire('click');
  assert.ok(one(x.host,'2号主位：角色b'));assert.ok(one(x.host,'1号合击：角色d'));
  await button(x.host,'保存队伍').fire('click');const saved=JSON.parse(x.stored.get('wf-wiki-teams-v1'))[0];
  assert.deepEqual(saved.team,plate);assert.equal(saved.name,'保留头像盘');
  x.host.replaceChildren(el('p','','完整资料'));x.render();
  assert.equal(read(one(x.host,'1号主位：角色a')),'a-after.png');assert.equal(button(x.host,'觉醒后').attributes['aria-pressed'],'true');
});
test('imported recommendation selection opens its character panel without changing the team or route', async () => {
  const x = teamPage(); x.window.WFTeamImport.load(plate,'推荐盘',{group:'unison',index:0}); x.render();
  assert.equal(x.inspected.at(-1),'d');
  const avatar = one(x.host,'2号主位：角色b'); assert.equal(avatar.tag,'button'); await avatar.fire('click');
  assert.equal(x.inspected.at(-1),'b'); assert.equal(x.window.location.hash,'#team');
  assert.ok(one(x.host,'1号主位：角色a')); assert.ok(one(x.host,'1号合击：角色d'));
  assert.equal(one(x.host,'2号主位：角色b').attributes['aria-current'],'true');
});

test('global avatar shortcut preference preserves the selected team, weapon filter and stored plate',async()=>{
  const x=teamPage();x.window.WFTeamImport.load(plate,'浮动头像开关验证',{group:'unison',index:0});x.render();
  await button(x.host,'武器').fire('click');await one(x.host,'武器水属性').fire('click');
  const avatar=one(x.host,'1号主位：角色a');
  x.window.WFCatalogAvatars.setForm('after');
  assert.equal(avatar.querySelector('img').getAttribute('src'),'a-after.png');assert.equal(one(x.host,'1号主位：角色a'),avatar);
  assert.equal(button(x.host,'觉醒后').attributes['aria-pressed'],'true');assert.ok(one(x.host,'选择水弓'));assert.equal(one(x.host,'选择武器'),undefined);
  assert.equal(one(x.host,'1号合击：角色d').attributes['aria-current'],'true');assert.equal(x.inspected.at(-1),'d');
  await button(x.host,'保存队伍').fire('click');const saved=JSON.parse(x.stored.get('wf-wiki-teams-v1'))[0];
  assert.deepEqual(saved.team,plate);assert.equal(saved.name,'浮动头像开关验证');
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

test('plate and compact notes share one continuous column and preserve complete folded equipment effects',async()=>{
  const x=teamPage();x.window.WFTeamImport.load({...plate,soul:['w','','']},'资料盘',{group:'main',index:1});x.render();
  const main=x.host.querySelector('.team-main');
  assert.equal(main.children[0],x.host.querySelector('.team-board'));assert.equal(main.children[1],x.host.querySelector('.team-preview'));
  assert.notEqual(x.host.querySelector('.team-library').parent,main);
  let pairs=x.host.querySelectorAll('.team-pair');assert.deepEqual(pairs.map((node)=>node.open),[false,true,false]);
  const effects=x.host.querySelectorAll('.team-pair-effect');assert.equal(effects.length,2);
  assert.match(effects[0].textContent,/装备攻击 \+25%.*强化至 Lv120.*强化技能伤害 \+80%/s);
  assert.match(effects[1].textContent,/魂珠攻击 \+10%/);assert.ok(effects.every((node)=>!node.open && node.tag==='details'));
  assert.equal(effects.flatMap((node)=>node.querySelectorAll('a')).length,0);
  await button(x.host,'队长技 · 角色a ›').fire('click');
  assert.equal(x.inspected.at(-1),'a');pairs=x.host.querySelectorAll('.team-pair');assert.deepEqual(pairs.map((node)=>node.open),[true,false,false]);
  await one(x.host,'查看2号主位角色b面板').fire('click');assert.equal(x.inspected.at(-1),'b');
  assert.equal(x.window.location.hash,'#team');assert.ok(one(x.host,'1号魂珠：武器'));
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

test('weapon and soul candidates put higher rarity first and reverse the full catalogue within a rarity', async () => {
  const x = teamPage(); x.render();
  const names = () => x.host.querySelectorAll('.team-candidate').map((node) => node.attributes['aria-label']);
  await button(x.host,'武器').fire('click');
  assert.deepEqual(names(),['选择无魂珠武器','选择武器','选择水弓']);
  await button(x.host,'魂珠').fire('click');
  assert.deepEqual(names(),['选择武器魂珠','选择水弓魂珠']);
  await one(x.host,'魂珠水属性').fire('click'); assert.deepEqual(names(),['选择水弓魂珠']);
});

test('large character candidates contain only a portrait with attribute and labels, then a single name; drag data and equipment layout stay intact', async () => {
  const x = teamPage(); x.render();
  let pool = x.host.querySelector('.team-candidates'); assert.equal(pool.dataset.kind,'character');
  const candidate = one(x.host,'选择角色a'), art = candidate.querySelector('.team-candidate-art');
  assert.equal(candidate.children.length,2); assert.equal(candidate.children[0],art);
  assert.equal(candidate.children[1].className,'team-candidate-name'); assert.equal(candidate.children[1].textContent,'角色a');
  assert.equal(candidate.children[1].title,'角色a'); assert.ok(art.querySelector('.element-badge'));
  assert.ok(art.querySelector('.character-label-limited')); assert.ok(art.querySelector('.character-label-mod'));
  assert.match(candidate.title,/火属性 · 5星 · 剑士 · 常服/); assert.match(candidate.attributes['aria-description'],/5星/);
  assert.equal(candidate.draggable,true); let dragged;
  await candidate.fire('dragstart',{dataTransfer:{setData:(type,value) => {dragged={type,value:JSON.parse(value)};}}});
  assert.deepEqual(dragged,{type:'application/x-wf-wiki',value:{id:'a',kind:'character'}});
  await button(x.host,'武器').fire('click'); pool = x.host.querySelector('.team-candidates');
  assert.equal(pool.dataset.kind,'weapon'); const weapon = one(x.host,'选择武器');
  assert.equal(weapon.querySelector('.team-candidate-art'),null); assert.equal(weapon.querySelector('.team-candidate-name'),null);
  assert.ok(weapon.querySelector('.team-candidate-equipment-type'));
  await button(x.host,'魂珠').fire('click'); assert.equal(pool.dataset.kind,'soul');
  assert.ok(one(x.host,'选择武器魂珠').querySelector('.team-candidate-equipment-type'));
});
