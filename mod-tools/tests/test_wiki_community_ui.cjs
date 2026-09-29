const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../wiki/community-client.js');
const tick = () => new Promise((resolve) => setImmediate(resolve));
class Node {
  constructor(tag, className='', text='') {Object.assign(this,{tag,className,ownText:String(text),children:[],events:{},attributes:{},value:'',checked:false,disabled:false});}
  append(...nodes) {nodes.forEach((node)=>{node.parent=this;this.children.push(node);});}
  prepend(...nodes) {nodes.forEach((node)=>{node.parent=this;});this.children.unshift(...nodes);}
  replaceChildren(...nodes) {this.children.forEach((node)=>node.parent=null);this.children=[];this.ownText='';this.append(...nodes);}
  remove() {if(this.parent)this.parent.children=this.parent.children.filter((node)=>node!==this);this.parent=null;}
  set textContent(text) {this.replaceChildren();this.ownText=String(text);}
  get textContent() {return this.ownText+this.children.map((node)=>node.textContent).join('');}
  setAttribute(key,value) {this.attributes[key]=value;}
  addEventListener(key,callback) {this.events[key]=callback;}
  get isConnected() {return this.connected===true || Boolean(this.parent?.isConnected);}
  async fire(name) {return this.events[name]?.({preventDefault(){}});}
  querySelectorAll(selector) {
    const match=(node)=>selector==='input:checked' ? node.tag==='input'&&node.checked
      : selector.startsWith('.') ? node.className.split(' ').includes(selector.slice(1)) : node.tag===selector;
    return this.children.flatMap((node)=>[...(match(node)?[node]:[]),...node.querySelectorAll(selector)]);
  }
}
const el=(tag,cls,value)=>new Node(tag,cls,value);
const data={characters:['c1','c2','c3'].map((id)=>({id,name:`角色${id}`,element:'火',icon:'test.webp'})),
  equipment:[{id:'w1',name:'装备',soul:{available:true}}]};
const team=C.teamCopy({main:['c1','c2','c3'],weapon:['w1']});
const item={id:'t1',status:'approved',title:'推荐 <img src=x onerror=alert(1)>',author:'作者',notes:'<script>bad</script>',
  team,element:'火',damageTypes:['skill'],createdAt:'2026-09-29T01:00:00Z',likes:3};
function setup(client) {
  const location={hash:'#community'}, window={WFCommunity:{...C,client},WFTeamImport:{load:(...args)=>{window.imported=args;}}};
  const context={window,location,URLSearchParams,Date,console};
  for (const file of ['community.js','community-submit.js']) vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../wiki',file),'utf8'),context);
  const host=el('main');host.connected=true;
  const ui={el,picture:()=>el('img')};
  const modals=[], challenges=[];
  window.WFCommunity.dialog=()=>{const modal={element:el('dialog'),cleanup(fn){this.clean=fn;}};modal.element.connected=true;modals.push(modal);return modal;};
  window.WFCommunity.challenge=(_host,_config,_action,_ui,onChange)=>{
    const challenge={tokens:[],resets:0,destroyed:false,take(){onChange(false);return this.tokens.shift()||'';},reset(){this.resets++;onChange(false);},destroy(){this.destroyed=true;},ready(token){this.tokens.push(token);onChange(true);}};
    challenges.push(challenge);return challenge;
  };
  return {window,context,host,ui,modals,challenges,C:window.WFCommunity};
}
const config={enabled:true,elements:['火','水','universal']};
test('recommendations paginate, escape text, link plates and load a copied team into editor',async()=>{
  const calls=[];const x=setup({config:async()=>config,request:async(p)=>{calls.push(p);return calls.length===1?{items:[{...item}],nextCursor:'second'}:{items:[{...item,id:'t2'}]};}});
  await x.window.renderWikiCommunity(x.host,data,x.ui);await tick();
  assert.match(x.host.textContent,/<img src=x onerror=alert\(1\)>/);
  assert.equal(x.host.querySelectorAll('script').length,0);
  const links=x.host.querySelectorAll('a').map((link)=>link.href);
  assert.ok(links.includes('#character/c1'));assert.ok(links.includes('#weapon/w1'));
  const more=x.host.querySelectorAll('.community-more')[0];await more.fire('click');await tick();
  assert.match(calls[1],/cursor=second/);assert.equal(x.host.querySelectorAll('.community-card').length,2);
  const use=x.host.querySelectorAll('button').find((button)=>button.textContent==='装入编成');await use.fire('click');
  assert.equal(x.context.location.hash,'#team');assert.equal(x.window.imported[1],item.title);
  x.window.imported[0].main[0]='changed';assert.equal(item.team.main[0],'c1');
});
test('old page cannot populate a newly mounted page even when both have the same route',async()=>{
  let resolve;const x=setup({config:async()=>config,request:()=>new Promise((done)=>{resolve=done;})});
  await x.window.renderWikiCommunity(x.host,data,x.ui);await tick();
  const oldCards=x.host.querySelectorAll('.community-grid')[0];x.host.replaceChildren(el('p','','new page'));
  resolve({items:[item]});await tick();assert.equal(oldCards.children.length,0);assert.equal(x.host.textContent,'new page');
});
test('filter races cannot restore old results and non-public rows are not displayed',async()=>{
  const requests=[];const x=setup({config:async()=>config,request:(url)=>new Promise((resolve)=>requests.push({url,resolve}))});
  await x.window.renderWikiCommunity(x.host,data,x.ui);await tick();
  const select=x.host.querySelectorAll('select')[0];select.value='水';select.fire('change');
  requests[1].resolve({items:[{...item,id:'water',title:'水队'}, {...item,id:'hidden',status:'hidden',title:'不公开'}]});await tick();
  requests[0].resolve({items:[item]});await tick();
  assert.match(x.host.textContent,/水队/);assert.doesNotMatch(x.host.textContent,/不公开|推荐 <img/);
});
test('failed community config keeps the source link and a retry action visible',async()=>{
  const x=setup({config:async()=>{throw new Error('此站暂未启用配队社区');}});
  await x.window.renderWikiCommunity(x.host,data,x.ui);
  assert.match(x.host.textContent,/暂未启用/);assert.ok(x.host.querySelectorAll('a').some((node)=>node.href===C.sourceUrl));
  assert.equal(x.host.querySelectorAll('button').find((node)=>node.textContent==='重试连接').hidden,false);
});
test('administrator collection checks the session and preserves input after request failure',async()=>{
  const calls=[];const x=setup({config:async()=>config,request:async(path,body)=>{
    if(path==='/admin/me')return {id:'admin'};
    assert.equal(path,'/admin/teams');calls.push(body);if(calls.length===1)throw new Error('网络失败');return {team:{id:'new',status:'approved'}};
  }});
  await x.C.openSubmit({team,title:'我的盘',data,ui:x.ui});await tick();
  const dialog=x.modals[0].element,inputs=dialog.querySelectorAll('input'),form=dialog.querySelectorAll('form')[0];
  inputs[1].value='投稿人';inputs.find((input)=>input.value==='skill').checked=true;
  await form.fire('submit');
  assert.equal(inputs[0].value,'我的盘');assert.equal(inputs[1].value,'投稿人');assert.match(dialog.textContent,/网络失败/);
  await form.fire('submit');assert.equal(calls.length,2);assert.equal(calls[1].turnstileToken,undefined);assert.match(dialog.textContent,/收录成功/);
  assert.ok(dialog.querySelectorAll('a').some((node)=>node.href==='#community/new'));
  assert.equal(x.challenges.length,0);
});
test('duplicate hidden submissions do not expose a team detail link',async()=>{
  const x=setup({config:async()=>config,request:async(path)=>{if(path==='/admin/me')return {id:'admin'};const error=new Error('duplicate');Object.assign(error,{code:'duplicate',data:{existingId:'secret',status:'hidden'}});throw error;}});
  await x.C.openSubmit({team,title:'我的盘',data,ui:x.ui});await tick();
  const dialog=x.modals[0].element,inputs=dialog.querySelectorAll('input');inputs[1].value='作者';inputs.find((input)=>input.value==='skill').checked=true;
  await dialog.querySelectorAll('form')[0].fire('submit');
  assert.match(dialog.textContent,/暂不公开/);assert.equal(dialog.querySelectorAll('a').filter((node)=>node.href==='#community/secret').length,0);
});
test('a visitor cannot reach administrator creation controls',async()=>{
  const calls=[];const x=setup({request:async(path)=>{calls.push(path);const error=new Error('需要管理员登录');error.status=401;throw error;}});
  await x.C.openSubmit({team,title:'我的盘',data,ui:x.ui});await tick();
  const dialog=x.modals[0].element;assert.deepEqual(calls,['/admin/me']);assert.equal(dialog.querySelectorAll('form').length,0);
  assert.ok(dialog.querySelectorAll('a').some((node)=>node.href==='#community/admin'));
});
test('like count changes only from a verified server response and repeated likes stay disabled',async()=>{
  const calls=[],results=[];const x=setup({config:async()=>config,request:async(_path,body)=>{calls.push(body);return {likes:4,likedToday:true};}});
  await x.C.openLike(item,x.ui,(result)=>results.push(result));await tick();
  const dialog=x.modals[0].element,button=dialog.querySelectorAll('button')[0];
  await button.fire('click');assert.equal(calls.length,0);
  x.challenges[0].ready('like-token');await button.fire('click');
  assert.equal(results[0].likes,4);assert.equal(button.disabled,true);assert.equal(x.challenges[0].resets,1);
  await button.fire('click');assert.equal(calls.length,1);
});
