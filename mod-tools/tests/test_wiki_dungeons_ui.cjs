const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {Node: BaseNode} = require('./wiki_equipment_fixture.cjs');
class Node extends BaseNode {
  matches(selector) {
    const value = selector.trim();
    if (value.startsWith('.')) return this.className.split(' ').includes(value.slice(1));
    return this.tag === value;
  }
  querySelectorAll(selector) {return this.all((node) => selector.split(',').some((part) => node.matches(part)));}
  querySelector(selector) {return this.querySelectorAll(selector)[0] || null;}
  async fire(name, extra = {}) {
    for (const callback of this.events[name] || []) await callback({target:this, preventDefault(){}, stopPropagation(){}, ...extra});
  }
}
const item = {id:'five-boss', title:'五重决战', category:'模式', summary:'五连战', banner:'media/five/banner.webp',
  entryImage:'media/five/entry.png', previewImages:['media/five/preview.webp'], legacyGuide:'five-boss',
  quests:[{name:'试炼之门', difficulty:'极难', element:'火'}]};
const emptyGuide = () => ({guide:{id:item.id, text:'', revision:0, teamIds:[], imageIds:[], images:[]}, teams:[]});
const team = (id = 't1', title = '能力火') => ({id, title, element:'火', category:'原版毕业队', team:{main:['c1'], unison:[], weapon:[], soul:[]}});
function env(responder = async (route) => {if (route === '/admin/me') throw {status:401}; return emptyGuide();}) {
  const document = new Node('document'), el = (...args) => Object.assign(new Node(...args), {document});
  const host = el('main'); document.append(host);
  const location = {href:'http://127.0.0.1:8877/#dungeons/five-boss', origin:'http://127.0.0.1:8877', protocol:'http:', hash:'#dungeons/five-boss'};
  const calls = [], window = {location, WFCommunity:{client:{request:async (...args) => {calls.push(args); return responder(...args);}},
    categoryLabel:value=>value, message:error=>error.message || '请求失败', board:(_team, _data, _ui, options)=>el('div', 'shared-board', options.preview ? '六头像预览' : '完整盘')},
  WFCommunityGameCodes:{readonly:()=>el('button', 'shared-code', '复制队伍码')}};
  const context = {window, document, URL, URLSearchParams, AbortController, setTimeout, clearTimeout};
  ['dungeons.js', 'dungeons-admin.js'].forEach((file) => vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../wiki', file), 'utf8'), context));
  const ui = {el}, data = {dungeons:{schemaVersion:1, source:{label:'灰服资料快照'}, items:[item,
    {id:'dragon', title:'火龙领主', category:'领主战', summary:'火龙讨伐'}, {id:'storm-event', title:'疾风活动', category:'活动'}]}, characters:[]};
  return {context, window, document, host, ui, data, calls, el, find:cls=>host.querySelector(cls),
    button(label){return host.all(node=>node.tag==='button' && node.textContent===label)[0];},
    render:options=>window.renderWikiDungeons(host, data, ui, options)};
}
test('catalog filters categories and multiple search terms without navigation or eager preview images', async () => {
  const x = env(); await x.render({});
  assert.equal(x.calls.length, 0); assert.equal(x.host.querySelectorAll('.dungeon-card').length, 3);
  await x.button('领主战').fire('click');
  assert.deepEqual(x.host.querySelectorAll('.dungeon-card').filter(node=>!node.hidden).map(node=>node.href), ['#dungeons/dragon']);
  await x.button('全部').fire('click'); const search=x.find('.dungeon-search'); search.value='五重 五连'; await search.fire('input');
  assert.equal(x.host.querySelectorAll('.dungeon-card').filter(node=>!node.hidden).length, 1);
  assert.equal(x.find('.dungeon-card').querySelector('img').loading, 'lazy');
  assert.ok(x.host.querySelectorAll('img').every(img=>!img.src.includes('preview')));
});
test('lord and raid cards use compact entry icons and quest counts while activities keep banners', async () => {
  const x=env(); const lord=x.data.dungeons.items[1];
  Object.assign(lord,{entryImage:'media/lord/icon.png',banner:'media/lord/banner.webp',quests:[{name:'初级'},{name:'超级'}]});
  x.data.dungeons.items.push({id:'raid',title:'降临讨伐',category:'降临讨伐',banner:'media/raid/icon.png',quests:[{name:'上级'}]});
  await x.render({});
  const compact=x.host.querySelectorAll('.dungeon-card-compact');assert.equal(compact.length,2);
  assert.equal(compact[0].querySelector('img').src,'http://127.0.0.1:8877/media/lord/icon.png');
  assert.equal(compact[0].querySelector('.dungeon-card-count').textContent,'领主战 · 2 个关卡');
  assert.equal(compact[1].querySelector('.dungeon-card-count').textContent,'降临讨伐 · 1 个关卡');
  const activity=x.host.querySelectorAll('.dungeon-card').find(node=>node.href==='#dungeons/storm-event');
  assert.ok(!activity.className.includes('dungeon-card-compact'));assert.ok(!x.find('.dungeon-grid-compact'));
  await x.button('领主战').fire('click');assert.ok(x.find('.dungeon-grid-compact'));
  await x.button('全部').fire('click');const search=x.find('.dungeon-search');search.value='讨伐';await search.fire('input');
  assert.ok(x.find('.dungeon-grid-compact'));assert.equal(x.host.querySelectorAll('.dungeon-card').filter(node=>!node.hidden).length,2);
  search.value='';await search.fire('input');assert.ok(!x.find('.dungeon-grid-compact'));
});
test('compact detail uses a small header icon and retains its expandable original artwork', async () => {
  const x=env();Object.assign(x.data.dungeons.items[1],{entryImage:'media/lord/icon.png',banner:'media/lord/banner.webp'});
  await x.render({id:'dragon'});const hero=x.find('.dungeon-hero-compact');
  assert.ok(hero);assert.equal(hero.parent,x.find('.dungeon-header-compact'));
  assert.equal(hero.src,'http://127.0.0.1:8877/media/lord/icon.png');
  const previews=x.find('.dungeon-fold');assert.equal(previews.querySelectorAll('img').length,0);
  previews.open=true;await previews.fire('toggle');assert.equal(previews.querySelectorAll('img').length,2);
});
test('only safe same-origin images are rendered and text remains text', async () => {
  const x = env(); const D = x.window.WFDungeons;
  for (const url of ['javascript:alert(1)', 'data:image/svg+xml,a', '//evil.test/a', 'https://evil.test/a', '/bad\\path', '/line\nfeed']) assert.equal(D.imageUrl(url), '');
  assert.equal(D.imageUrl('/media/a.png'), 'http://127.0.0.1:8877/media/a.png');
  D.guideView(x.host, {guide:{text:'<img src=x onerror=alert(1)>', images:[{url:'javascript:x'}, {url:'/api/community/dungeon-images/a'}]}, teams:[]}, x.data, x.ui);
  assert.equal(x.host.querySelectorAll('img').length, 1); assert.equal(x.find('.dungeon-guide-text').textContent, '<img src=x onerror=alert(1)>');
});
test('offline snapshots only permit bundled media paths and never arbitrary local or remote images', () => {
  const x=env(); Object.assign(x.window.location,{protocol:'file:',href:'file:///D:/wiki/index.html',origin:'null'});
  const D=x.window.WFDungeons;
  assert.equal(D.imageUrl('media/dungeons/ab123.webp'),'file:///D:/wiki/media/dungeons/ab123.webp');
  for(const url of ['file:///C:/private.png','../private.png','media/../private.png','https://evil.test/a.png','/media/a.png','data:image/png,a']) assert.equal(D.imageUrl(url),'');
});
test('source notes retain provenance while hiding machine-only status strings', async () => {
  const x=env(); x.data.dungeons.source={label:'灰服目录',status:'gray-stage-node-partial'}; await x.render({});
  assert.equal(x.find('.dungeon-source').textContent,'灰服目录');
});
test('detail preserves lazy five-boss query and previews while a guide request is pending', async () => {
  let resolve; const x = env(route=>route==='/admin/me' ? Promise.reject({status:401}) : new Promise(done=>{resolve=done;}));
  let legacyCalls=0; const task=x.render({id:'five-boss',renderLegacyGuide:host=>{legacyCalls++; host.append(x.el('p','','波次查询'));}});
  const fold=x.find('.dungeon-legacy'); assert.ok(fold); assert.equal(legacyCalls,0);
  assert.ok(fold.querySelector('summary').textContent.includes('本地机制快照'));
  fold.open=true; await fold.fire('toggle'); await fold.fire('toggle'); assert.equal(legacyCalls,1);
  const previews=x.host.querySelectorAll('.dungeon-fold')[0]; assert.equal(previews.querySelectorAll('img').length,0);
  previews.open=true; await previews.fire('toggle'); assert.equal(previews.querySelectorAll('img').length,2);
  resolve(emptyGuide()); await task; assert.ok(x.host.textContent.includes('波次查询')); assert.ok(!x.button('编辑攻略与推荐队伍'));
});
test('late requests after a route change cannot attach admin controls or stale guides', async () => {
  const pending=[]; const x=env(()=>new Promise(resolve=>pending.push(resolve)));
  const task=x.render({id:'five-boss'}); x.window.location.hash='#team'; x.host.replaceChildren(x.el('p','','新页面'));
  pending[0]({id:'owner', role:'owner'}); pending[1](emptyGuide()); await task;
  assert.equal(x.host.textContent,'新页面');
});
test('guide errors expose retry without claiming there are no recommendations', async () => {
  const x=env(async()=>{throw new Error('offline');}); await x.render({id:'five-boss'});
  assert.ok(x.host.textContent.includes('试炼之门')); assert.ok(x.button('重试'));
  assert.ok(!x.host.textContent.includes('暂无推荐队伍'));
});
test('recommendations reuse shared board and code views and open their own team detail', () => {
  const x=env(); x.window.WFDungeons.guideView(x.host, {...emptyGuide(),teams:[team()]},x.data,x.ui);
  assert.equal(x.find('.dungeon-team-link').href,'#community/t1');
  assert.equal(x.find('.shared-board').textContent,'六头像预览'); assert.ok(x.find('.shared-code'));
});
test('admin controls require verified identity and completed password change', async () => {
  for(const identity of [{id:'a',email:'a@example.test',role:'guest'},{id:'a',email:'a@example.test',role:'editor',mustChangePassword:true},{},{id:'a'}, {email:'a@example.test'}, {id:'a',email:'a@example.test',role:null}]) {
    const x=env(async route=>route==='/admin/me'?identity:emptyGuide()); await x.render({id:'five-boss'});
    assert.ok(!x.button('编辑攻略与推荐队伍'));
  }
  const x=env(async route=>route==='/admin/me'?{id:'editor',email:'editor@example.test',role:'editor'}:emptyGuide()); await x.render({id:'five-boss'});
  assert.ok(x.button('编辑攻略与推荐队伍')); assert.ok(!x.find('.dungeon-editor'));
  await x.button('编辑攻略与推荐队伍').fire('click'); assert.ok(x.find('.dungeon-editor'));
});
test('verified legacy Access identity can edit without inventing a role, while failed authentication cannot', async () => {
  const x=env(async route=>route==='/admin/me'?{id:'access-subject',email:'editor@example.test'}:emptyGuide());
  await x.render({id:'five-boss'}); assert.ok(x.button('编辑攻略与推荐队伍'));
  const denied=env(async route=>{if(route==='/admin/me')throw {status:403};return emptyGuide();});
  await denied.render({id:'five-boss'});assert.ok(!denied.button('编辑攻略与推荐队伍'));
});
function edit(x, result=emptyGuide(), onSaved=()=>{}) {
  return x.window.WFDungeonsAdmin.editor(x.host,item,result,x.data,x.ui,{current:()=>true,onSaved});
}
test('removing a recommendation only changes the staged relation and saves with the expected revision', async () => {
  let saved; const x=env(async (_route, body)=>({guide:{...emptyGuide().guide,...body,revision:8},teams:[]}));
  const form=edit(x,{guide:{...emptyGuide().guide,text:'原攻略',revision:7,teamIds:['t1']},teams:[team()]},result=>{saved=result;});
  await x.button('移除').fire('click'); assert.equal(x.calls.length,0);
  x.find('.dungeon-guide-input').value='新攻略'; await form.fire('submit');
  assert.equal(x.calls[0][0],'/admin/dungeons/five-boss'); assert.equal(x.calls[0][2],'PATCH');
  assert.deepEqual(JSON.parse(JSON.stringify(x.calls[0][1])),{expectedRevision:7,text:'新攻略',teamIds:[],imageIds:[]});
  assert.equal(saved.guide.revision,8);
});
test('revision conflicts keep all drafts and only a deliberate merge action advances the base', async () => {
  const attempted=[]; const x=env(async (_route, body, method)=>{
    if(method==='PATCH'){attempted.push(body);throw {status:409,code:'edit_conflict'};}
    return {guide:{...emptyGuide().guide,text:'别人最新攻略',revision:9},teams:[]};
  });
  const form=edit(x,{guide:{...emptyGuide().guide,text:'旧攻略',revision:3,teamIds:['t1'],imageIds:['i1'],images:[{id:'i1',url:'/image.png'}]},teams:[team()]});
  x.find('.dungeon-guide-input').value='我的未保存攻略'; await form.fire('submit');
  assert.equal(x.find('.dungeon-guide-input').value,'我的未保存攻略'); assert.equal(attempted[0].expectedRevision,3);
  await x.button('读取最新版本供合并').fire('click'); assert.ok(x.host.textContent.includes('别人最新攻略'));
  await form.fire('submit'); assert.equal(attempted[1].expectedRevision,3);
  await x.button('读取最新版本供合并').fire('click'); await x.button('以最新版本继续编辑').fire('click');
  await form.fire('submit'); assert.equal(attempted[2].expectedRevision,9); assert.equal(attempted[2].text,'我的未保存攻略');
  assert.deepEqual(Array.from(attempted[2].teamIds),['t1']); assert.deepEqual(Array.from(attempted[2].imageIds),['i1']);
});
test('draft images use authenticated previews and are excluded until explicitly added and saved', async () => {
  const x=env(async(_route,body)=>({guide:{...emptyGuide().guide,...body,revision:1},teams:[]}));
  const form=edit(x,{...emptyGuide(),availableImages:[{id:'draft',url:'/api/community/dungeon-images/draft',previewUrl:'/api/community/admin/dungeons/five-boss/images/draft'}]});
  assert.equal(x.host.querySelector('img').src,'http://127.0.0.1:8877/api/community/admin/dungeons/five-boss/images/draft');
  await form.fire('submit'); assert.deepEqual(Array.from(x.calls[0][1].imageIds),[]);
  await x.button('加入攻略').fire('click'); await form.fire('submit'); assert.deepEqual(Array.from(x.calls[1][1].imageIds),['draft']);
});
test('team picker paginates public teams and searches loaded titles', async () => {
  let n=0; const x=env(async()=>++n===1?{items:[team()],nextCursor:'next page'}:{items:[team('t2','技能水')],nextCursor:''});
  edit(x); await x.button('加载队伍').fire('click'); await x.button('继续加载队伍').fire('click');
  assert.equal(x.calls[0][0],'/teams?sort=latest'); assert.ok(x.calls[1][0].includes('cursor=next+page'));
  const search=x.host.all(node=>node.attributes['aria-label']==='查找可添加的队伍')[0]; search.value='技能水'; await search.fire('input');
  assert.equal(x.find('.dungeon-team-candidates').children.length,1); assert.ok(x.find('.dungeon-team-candidates').textContent.includes('技能水'));
  await x.button('添加').fire('click'); assert.ok(x.find('.dungeon-selected-teams').textContent.includes('技能水'));
});
test('invalid image types fail before decoding and binary uploads use same-origin credentials', async () => {
  const x=env(); await assert.rejects(x.window.WFDungeonsAdmin.shrink({type:'image/svg+xml',size:20}),/PNG/);
  await assert.rejects(x.window.WFDungeonsAdmin.shrink({type:'image/png',size:21*1024*1024}),/20 MB/);
  let call; x.window.fetch=async(...args)=>{call=args;return{ok:true,json:async()=>({image:{id:'x',previewUrl:'/api/community/admin/dungeons/five-boss/images/x'}})};};
  const blob={type:'image/webp',size:123}; await x.window.WFDungeonsAdmin.upload('five-boss',blob);
  assert.equal(call[0],'/api/community/admin/dungeons/five-boss/images'); assert.equal(call[1].credentials,'same-origin');
  assert.equal(call[1].body,blob); assert.equal(call[1].headers['Content-Type'],'image/webp');
});
test('upload compression bounds dimensions and bytes, and releases image object URLs', async () => {
  const x=env(); let revoked, canvas, drawn=0;
  class MockURL extends URL {static createObjectURL(){return 'blob:test';}static revokeObjectURL(url){revoked=url;}}
  class Image {constructor(){this.naturalWidth=3200;this.naturalHeight=1600;}set src(value){this.onload();}}
  x.context.URL=MockURL;x.context.Image=Image;
  x.context.document.createElement=()=>canvas={getContext:()=>({clearRect(){},drawImage(){drawn++;}}),toBlob(callback,type,quality){callback({type,size:quality>.8?600000:400000});}};
  const blob=await x.window.WFDungeonsAdmin.shrink({type:'image/png',size:999999});
  assert.equal(canvas.width,1600);assert.equal(canvas.height,800);assert.ok(blob.size<=512*1024);assert.equal(blob.type,'image/webp');
  assert.equal(revoked,'blob:test');assert.equal(drawn,1);
});
test('unavailable linked records report their own error without pretending a revision conflict', async () => {
  const x=env(async()=>{throw {status:409,code:'references_unavailable',message:'推荐队伍已隐藏，请先移除。'};});
  const form=edit(x);await form.fire('submit');
  assert.ok(x.host.textContent.includes('推荐队伍已隐藏'));assert.ok(!x.button('读取最新版本供合并'));
});
