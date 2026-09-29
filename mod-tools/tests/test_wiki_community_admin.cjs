const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const community = require('../wiki/community-client.js');
const source = fs.readFileSync(path.join(__dirname,'../wiki/community-admin.js'),'utf8');
class Node {
  constructor(tag, className = '', value = '') {
    Object.assign(this,{tag,className,text:String(value || ''),children:[],attributes:{},events:{},value:'',hidden:false,disabled:false});
  }
  append(...nodes) {for (const node of nodes) {node.parent = this; this.children.push(node);}}
  replaceChildren(...nodes) {this.children.forEach((node)=>{node.parent=null;}); this.children=[]; this.append(...nodes);}
  setAttribute(key,value) {this.attributes[key]=value;}
  getAttribute(key) {return this.attributes[key];}
  addEventListener(key,fn) {this.events[key]=fn;}
  async click() {if (!this.disabled) await this.events.click?.();}
  get isConnected() {return Boolean(this.root || this.parent?.isConnected);}
  get childElementCount() {return this.children.length;}
  get textContent() {return this.text+this.children.map((node)=>node.textContent).join('');}
  set textContent(value) {this.text=String(value); this.children=[];}
  all(predicate) {return this.children.flatMap((node)=>[...(predicate(node)?[node]:[]),...node.all(predicate)]);}
}
const el=(tag,cls,text)=>new Node(tag,cls,text);
const one=(node,cls)=>node.all((n)=>n.className.split(' ').includes(cls))[0];
const button=(node,label)=>node.all((n)=>n.tag==='button'&&n.textContent===label)[0];
const select=(node,label)=>node.all((n)=>n.tag==='select'&&n.attributes['aria-label']===label)[0];
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
function fixture() {
  const characters=Array.from({length:85},(_,i)=>({id:`c${i+1}`,name:`角色${i+1}`,element:'火',rarity:5,aliases:[]}));
  const equipment=[{id:'w1',name:'武器1',soul:{available:true}},{id:'w2',name:'武器2'}];
  const item={id:'team1',title:'测试盘',notes:'原备注',author:'投稿者',element:'火',damageTypes:['skill'],revision:4,status:'approved',
    team:{main:['c1','c2','c3'],unison:['','',''],weapon:['w1','',''],soul:['','','']}};
  return {data:{characters,equipment},item};
}
function setup(handler,options={}) {
  const {data,item}=fixture(),calls=[],host=el('main'); host.root=true;
  const fetcher=async(url,init)=>{calls.push({url,...init}); return handler ? handler(url,init,{data,item}) :
    response(url.endsWith('/config')?{enabled:true}:url.endsWith('/me')?{id:'trusted',email:'admin@example.test'}:{items:[item],nextCursor:''});};
  const window={WFCommunity:community,location:{protocol:options.protocol||'https:',hostname:options.hostname||'wiki.example'},fetch:fetcher,
    WFWikiData:{loadEquipment:async()=>data.equipment}};
  vm.runInNewContext(source,{window,AbortController,setTimeout,clearTimeout,URLSearchParams});
  return {host,window,data,item,calls,start:()=>window.renderWikiCommunityAdmin(host,data,{el})};
}
test('offline and unconfigured sites never claim successful administrator authentication',async()=>{
  const offline=setup(null,{protocol:'file:'}); await offline.start();
  assert.equal(offline.calls.length,0); assert.match(offline.host.textContent,/离线版不能登录/);
  const disabled=setup(()=>response({enabled:false})); await disabled.start();
  assert.equal(disabled.calls.length,1); assert.match(disabled.host.textContent,/暂未启用社区/);
  assert.equal(disabled.host.all((n)=>n.tag==='form').length,0);
  assert.equal(one(disabled.host,'admin-controls').hidden,false);
});
test('authentication-required state links to server login and cannot accept a supplied email',async()=>{
  const x=setup((url)=>response(url.endsWith('/config')?{enabled:true,development:true}:
    {error:'admin_auth_required',message:'login'},url.endsWith('/config')?200:401));
  await x.start();
  assert.equal(x.host.all((n)=>n.tag==='a'&&n.textContent==='登录管理员')[0].href,'/api/community/admin/login');
  assert.equal(one(x.host,'admin-controls').hidden,false);
  assert.equal(x.host.all((n)=>n.tag==='input').length,0);
  assert.equal(button(x.host,'本机测试：登录测试管理员'),undefined);
});
test('local development login requires an actual cookie endpoint response before showing verified identity',async()=>{
  let logged=false;
  const x=setup((url,init,{item})=>{
    if(url.endsWith('/config')) return response({enabled:true,development:true});
    if(url.endsWith('/development-admin-login')) {assert.equal(init.method,'POST');logged=true;return response({ok:true});}
    if(url.endsWith('/me')) return logged?response({id:'dev',email:'dev-admin@example.test'}):response({error:'admin_auth_required'},401);
    return response({items:[item],nextCursor:''});
  },{protocol:'http:',hostname:'127.0.0.1'});
  await x.start(); assert.doesNotMatch(x.host.textContent,/dev-admin@example.test/);
  await button(x.host,'本机测试：登录测试管理员').click();
  assert.match(x.host.textContent,/本机测试身份 · dev-admin@example.test/);
});
test('editing uses bounded searchable candidates and preserves original data until saving',async()=>{
  const x=setup(); await x.start(); const before=JSON.stringify(x.data);
  await button(x.host,'编辑 / 隐藏').click();
  const form=one(x.host,'admin-edit-form');
  assert.equal(form.all((n)=>n.className==='admin-slot').length,12);
  assert.equal(select(form,'主位 1').children.length,61);
  const search=form.all((n)=>n.attributes['aria-label']==='搜索主位 1')[0];
  search.value='角色85'; search.events.input();
  assert.equal(select(form,'主位 1').children.length,3);
  select(form,'主位 1').value='c85'; select(form,'主位 1').events.change();
  assert.equal(JSON.stringify(x.data),before);
  assert.equal(select(form,'魂珠 1').children.length,2);
});
test('revision conflicts preserve entered values and lock repeated saves until explicit reload',async()=>{
  const x=setup((url,init,{item})=>init.method==='PATCH'?response({error:'edit_conflict'},409):
    response(url.endsWith('/config')?{enabled:true}:url.endsWith('/me')?{id:'a',email:'a@b.test'}:{items:[item],nextCursor:''}));
  await x.start(); await button(x.host,'编辑 / 隐藏').click(); const form=one(x.host,'admin-edit-form');
  const notes=form.all((n)=>n.tag==='textarea')[0]; notes.value='保留我的输入';
  await form.events.submit({preventDefault(){}});
  assert.match(one(form,'admin-edit-status').textContent,/已被其他管理员修改/);
  assert.equal(notes.value,'保留我的输入'); assert.equal(button(form,'保存修改').disabled,true);
  await form.events.submit({preventDefault(){}});
  assert.equal(x.calls.filter((call)=>call.method==='PATCH').length,1);
  assert.equal(button(form,'重新加载列表').hidden,false);
  await button(form,'重新加载列表').click(); assert.equal(form.isConnected,false);
});
test('saving edited slots and hidden state sends the original revision with same-origin credentials',async()=>{
  let saved;
  const x=setup((url,init,{item})=>{
    if(init.method==='PATCH') {saved=JSON.parse(init.body); return response({team:{...item,...saved,revision:5}});}
    return response(url.endsWith('/config')?{enabled:true}:url.endsWith('/me')?{id:'a',email:'a@b.test'}:{items:[item],nextCursor:''});
  });
  await x.start(); await button(x.host,'编辑 / 隐藏').click(); const form=one(x.host,'admin-edit-form');
  select(form,'主位 1').value='c4'; select(form,'主位 1').events.change();
  const meta=one(form,'admin-edit-meta'); meta.all((n)=>n.tag==='select')[1].value='hidden';
  select(form,'配队分类').value='原版毕业队';
  select(form,'玩法分区').value='five-boss';
  await form.events.submit({preventDefault(){}});
  assert.equal(saved.expectedRevision,4); assert.equal(saved.team.main[0],'c4'); assert.equal(saved.status,'hidden');
  assert.equal(saved.damageTypes[0],'skill'); assert.equal(x.calls.find((call)=>call.method==='PATCH').credentials,'same-origin');
  assert.equal(saved.category,'原版毕业队');
  assert.equal(saved.section,'five-boss');
  assert.match(one(x.host,'admin-notice').textContent,/已保存.*当前版本 5/);
});
test('invalid duplicate characters and missing damage selections never reach the write endpoint',async()=>{
  const x=setup(); await x.start(); await button(x.host,'编辑 / 隐藏').click(); const form=one(x.host,'admin-edit-form');
  select(form,'主位 1').value='c2'; select(form,'主位 1').events.change();
  await form.events.submit({preventDefault(){}}); assert.match(one(form,'admin-edit-status').textContent,/重复/);
  form.all((n)=>n.type==='checkbox').forEach((node)=>{node.checked=false;});
  await form.events.submit({preventDefault(){}}); assert.match(one(form,'admin-edit-status').textContent,/至少选择/);
  assert.equal(x.calls.filter((call)=>call.method==='PATCH').length,0);
});
test('late authentication cannot overwrite a different route in the same reused host',async()=>{
  let answer;
  const x=setup((url)=>url.endsWith('/config')?response({enabled:true}):new Promise((resolve)=>{answer=resolve;}));
  const pending=x.start(); await new Promise(setImmediate);
  x.host.replaceChildren(el('section','','另一页面'));
  answer(response({id:'a',email:'a@b.test'})); await pending;
  assert.equal(x.host.textContent,'另一页面'); assert.equal(x.calls.length,2);
});

test('administrators can filter categories and preserve the empty legacy category while editing',async()=>{
  const x=setup();await x.start();
  const category=select(x.host,'查看配队分类');assert.equal(category.children.length,7);category.value='uncategorized';category.events.change();await new Promise(setImmediate);
  assert.equal(new URL(x.calls.at(-1).url,'https://wiki.example').searchParams.get('category'),'uncategorized');
  await button(x.host,'编辑 / 隐藏').click();assert.equal(select(x.host,'配队分类').value,'');
  assert.equal(select(x.host,'配队分类').children[0].textContent,'未分类（历史队伍）');
  assert.equal(select(x.host,'玩法分区').value,'');assert.equal(select(x.host,'玩法分区').children[0].textContent,'通用/其他');
});

test('administrators filter gameplay independently and reject invalid section edits before a request',async()=>{
  const x=setup();await x.start();
  const section=select(x.host,'查看玩法分区');section.value='general';section.events.change();await new Promise(setImmediate);
  const category=select(x.host,'查看配队分类');category.value='玩具盘';category.events.change();await new Promise(setImmediate);
  const params=new URL(x.calls.at(-1).url,'https://wiki.example').searchParams;
  assert.equal(params.get('section'),'general');assert.equal(params.get('category'),'玩具盘');
  await button(x.host,'编辑 / 隐藏').click();select(x.host,'玩法分区').value='not-a-section';
  await one(x.host,'admin-edit-form').events.submit({preventDefault(){}});
  assert.match(one(x.host,'admin-edit-status').textContent,/有效的玩法分区/);assert.equal(x.calls.filter((call)=>call.method==='PATCH').length,0);
});
