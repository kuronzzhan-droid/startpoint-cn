const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const community = require('../wiki/community-client.js');
const source = fs.readFileSync(path.join(__dirname,'../wiki/community-admin-editor.js'),'utf8');
class Node {
  constructor(tag,className='',text='') {Object.assign(this,{tag,className,text,children:[],attributes:{},events:{},value:'',disabled:false});}
  append(...nodes) {for (const node of nodes) {node.parent=this;this.children.push(node);}}
  replaceChildren(...nodes) {this.children=[];this.append(...nodes);}
  setAttribute(key,value) {this.attributes[key]=value;}
  addEventListener(key,fn) {this.events[key]=fn;}
  get isConnected() {return Boolean(this.root||this.parent?.isConnected);}
  get textContent() {return this.text+this.children.map((node)=>node.textContent).join('');}
  set textContent(value) {this.text=String(value);this.children=[];}
  all(predicate) {return this.children.flatMap((node)=>[...(predicate(node)?[node]:[]),...node.all(predicate)]);}
}
const el=(tag,cls,text)=>new Node(tag,cls,text);
const one=(node,cls)=>node.all((n)=>n.className.split(' ').includes(cls))[0];
const control=(node,label)=>node.all((n)=>n.attributes['aria-label']===label)[0];
const button=(node,label)=>node.all((n)=>n.tag==='button'&&n.textContent===label)[0];
function setup({confirm,request,board,pictures=true}={}) {
  const data={characters:[1,2,3,4,5,6,7].map((id)=>({id:`c${id}`,name:`角色${id}`,icon:`c${id}.png`,avatars:{after:`c${id}-after.png`}})),
    equipment:[{id:'w1',name:'武器一',icon:'w1.png',soul:{available:true}},{id:'w2',name:'武器二',icon:'w2.png',soul:{available:true}}]};
  const item={id:'plate',title:'原标题',author:'作者',notes:'说明',revision:4,category:'玩具盘',section:'',visibility:'public',status:'approved',createdBy:'owner',
    element:'火',damageTypes:['skill'],team:{main:['c1','c2','c3'],unison:['c4','c5','c6'],weapon:['w1','',''],soul:['w1','','']}};
  const images=[],frames=[],saved=[],window={WFCommunity:{...community,...(board?{board}: {})},confirm,
    WFCatalogAvatars:{getForm:()=> 'after'},WFCharacterFrame:{apply:(node,entry)=>{frames.push(entry.id);node.setAttribute('data-frame',entry.id);}}};
  const ui={el,...(pictures?{picture:(url,alt,cls)=>{images.push({url,alt});const node=el('img',cls);node.src=url;node.alt=alt;return node;}}:{})};
  vm.runInNewContext(source,{window});let closed=0;
  const form=window.WFCommunityAdminEditor.create({item,identity:{id:'owner',role:'owner'},config:{},data,ui,
    request:request||(async()=>({team:{...item,revision:5}})),onSaved:(team)=>saved.push(team),onClose:()=>{closed++;},onReload:()=>{}});
  form.root=true;
  return {form,item,data,images,frames,saved,closed:()=>closed};
}

test('editor shows six character portraits and six equipment slots while selectors start folded',()=>{
  const x=setup(),preview=one(x.form,'admin-edit-preview'),details=one(x.form,'admin-slot-adjustments');
  assert.equal(details.tag,'details');assert.notEqual(details.open,true);
  assert.equal(preview.all((n)=>n.className==='admin-preview-portrait').length,6);
  assert.equal(preview.all((n)=>n.className==='admin-preview-gear').length,6);
  assert.equal(details.all((n)=>n.className==='admin-slot-portrait-inner').length,12);
  assert.equal(preview.all((n)=>n.tag==='img').filter((n)=>n.src.includes('-after')).length,6);
  assert.equal(x.frames.length,12);assert.equal(control(x.form,'队伍说明').rows,2);
});

test('editor reuses the community preview board and still supplies all equipment slots',()=>{
  const calls=[];const x=setup({board:(team,data,ui,options)=>{calls.push({team,options});return el('div','shared-board');}});
  assert.equal(calls.length,1);assert.equal(calls[0].options.preview,true);assert.ok(calls[0].options.avatars.picture);
  assert.ok(one(x.form,'shared-board'));assert.equal(one(x.form,'admin-preview-equipment').children.length,3);
  control(x.form,'主位 1').value='c7';control(x.form,'主位 1').events.change();
  assert.equal(calls.length,2);assert.equal(calls[1].team.main[0],'c7');assert.equal(x.item.team.main[0],'c1');
  control(x.form,'队伍标题').value='新标题';x.form.events.input();assert.equal(calls.length,2);
});

test('slot selection immediately refreshes portrait and preview without changing the source team',()=>{
  const x=setup(),weapon=control(x.form,'武器 1'),before=JSON.stringify(x.item);
  weapon.value='w2';weapon.events.change();
  const preview=one(x.form,'admin-edit-preview');
  assert.equal(control(preview,'武器 1：武器二').children[0].src,'w2.png');
  assert.equal(one(x.form,'admin-slot-adjustments').all((n)=>n.attributes['aria-label']==='武器 1：武器二').length,1);
  assert.equal(x.form.isDirty(),true);assert.equal(JSON.stringify(x.item),before);
});

test('closing a clean editor is immediate, but dirty edits survive a cancelled confirmation',()=>{
  let answer=false,confirmations=0;
  const x=setup({confirm:()=>{confirmations++;return answer;}});
  button(x.form,'关闭编辑').events.click();assert.equal(x.closed(),1);assert.equal(confirmations,0);
  const title=control(x.form,'队伍标题');title.value='新标题';
  button(x.form,'关闭编辑').events.click();assert.equal(x.closed(),1);assert.equal(title.value,'新标题');
  answer=true;button(x.form,'关闭编辑').events.click();assert.equal(x.closed(),2);assert.equal(confirmations,2);
});

test('dirty guards use normalized saved values and never discard edits when confirmation is unavailable',()=>{
  const x=setup({pictures:false});
  control(x.form,'队伍标题').value='  原标题  ';control(x.form,'搜索主位 1').value='别名';
  assert.equal(x.form.isDirty(),false);assert.equal(x.form.canClose(),true);
  control(x.form,'队伍说明').value='改动说明';assert.equal(x.form.canClose(),false);
  assert.equal(one(x.form,'admin-edit-preview').all((n)=>n.tag==='img').length,0);
});

test('in-flight saves cannot close and successful saves establish a clean form snapshot',async()=>{
  let finish,confirmations=0;const x=setup({confirm:()=>{confirmations++;return true;},request:()=>new Promise((resolve)=>{finish=resolve;})});
  control(x.form,'队伍标题').value='新标题';const pending=x.form.events.submit({preventDefault(){}});
  assert.equal(x.form.canClose(),false);assert.equal(confirmations,0);assert.equal(button(x.form,'保存修改').disabled,true);
  finish({team:{...x.item,title:'新标题',revision:5}});await pending;
  assert.equal(x.saved.length,1);assert.equal(x.form.isDirty(),false);assert.equal(x.form.canClose(),true);
});

test('save conflicts keep typed changes and dirty close protection',async()=>{
  const x=setup({confirm:()=>false,request:async()=>{throw Object.assign(new Error('conflict'),{code:'edit_conflict'});}});
  control(x.form,'队伍说明').value='冲突时保留';await x.form.events.submit({preventDefault(){}});
  assert.equal(x.form.isDirty(),true);assert.equal(x.form.canClose(),false);assert.equal(control(x.form,'队伍说明').value,'冲突时保留');
  assert.equal(button(x.form,'保存修改').disabled,true);assert.match(one(x.form,'admin-edit-status').textContent,/其他管理员修改/);
});
