const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
class Node {
  constructor(tag, cls='', text='') {Object.assign(this,{tag,className:cls,text,children:[],events:{},attributes:{},disabled:false});}
  append(...nodes) {nodes.forEach(node=>{node.parent=this;this.children.push(node);});}
  replaceChildren(...nodes) {this.children.forEach(node=>node.parent=null);this.children=[];this.text='';this.append(...nodes);}
  get textContent() {return this.text+this.children.map(node=>node.textContent).join('');}
  set textContent(value) {this.replaceChildren();this.text=value;}
  setAttribute(name,value) {this.attributes[name]=value;}
  addEventListener(name,cb) {this.events[name]=cb;}
  get isConnected() {return this.root||Boolean(this.parent?.isConnected);}
  focus() {}
  all(tag) {return this.children.flatMap(node=>[...(node.tag===tag?[node]:[]),...node.all(tag)]);}
}
const el=(...args)=>new Node(...args), tick=()=>new Promise(resolve=>setImmediate(resolve));
const source=fs.readFileSync(path.join(__dirname,'../wiki/wiki-aliases.js'),'utf8');
function setup(request) {
  const window={WFCommunity:{client:{request},message:error=>error.message}};
  vm.runInNewContext(source,{window});const host=el('main');host.root=true;
  return {A:window.WFWikiAliases,host,mount:(kind='character')=>window.WFWikiAliases.mount(host,kind,'c1',{el})};
}
const button=(node,text)=>node.all('button').find(b=>b.textContent===text);
test('anonymous detail shows empty nicknames and never offers edits; shared loads are deduplicated',async()=>{
  let reads=0;const x=setup(async path=>{if(path==='/aliases'){reads++;return {items:[]};}throw new Error('login required');});
  const panel=x.mount();x.mount('weapon');await tick();
  assert.equal(reads,1);assert.match(panel.textContent,/暂未填写/);assert.equal(button(panel,'编辑黑话').hidden,true);
});
test('administrator saves with the fetched revision and search values reflect sanitized server response without changing source aliases',async()=>{
  const calls=[];const x=setup(async(path,body,method)=>{
    calls.push({path,body,method});
    if(path==='/aliases')return {items:[]};
    if(path==='/admin/me')return {id:'editor',email:'test@example.invalid'};
    return body?{kind:'character',id:'c1',aliases:['光团长','光大叔'],revision:5}:{kind:'character',id:'c1',aliases:[],revision:4};
  });
  const panel=x.mount();await tick();await button(panel,'编辑黑话').events.click();
  panel.all('textarea')[0].value='光团长，光大叔';await panel.all('form')[0].events.submit({preventDefault(){}});
  const saved=calls.find(call=>call.method==='PATCH');assert.equal(saved.body.expectedRevision,4);
  assert.deepEqual(Array.from(saved.body.aliases),['光团长','光大叔']);assert.deepEqual(Array.from(x.A.values('character','c1')),['光团长','光大叔']);
  assert.match(panel.textContent,/黑话已保存/);assert.equal(panel.all('textarea').length,0);
});
test('edit conflicts preserve input and block repeat writes until administrator reloads the editor',async()=>{
  let writes=0;const x=setup(async(path,body)=>{
    if(path==='/aliases')return {items:[]};if(path==='/admin/me')return {id:'a',email:'a@example.invalid'};
    if(body){writes++;throw Object.assign(new Error('conflict'),{status:409});}
    return {kind:'character',id:'c1',aliases:[],revision:2};
  });
  const panel=x.mount();await tick();await button(panel,'编辑黑话').events.click();
  panel.all('textarea')[0].value='<img src=x onerror=bad>';const submit=panel.all('form')[0].events.submit;
  await submit({preventDefault(){}});await submit({preventDefault(){}});
  assert.equal(writes,1);assert.equal(button(panel,'保存黑话').disabled,true);
  assert.equal(panel.all('textarea')[0].value,'<img src=x onerror=bad>');assert.match(panel.textContent,/其他管理员/);
});
