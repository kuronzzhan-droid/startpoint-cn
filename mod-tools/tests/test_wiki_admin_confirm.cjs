const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function setup(){
  class Node{
    constructor(tag){this.tag=tag;this.children=[];this.events={};}
    append(...nodes){nodes.forEach(node=>{node.parent=this;this.children.push(node);});}
    setAttribute(key,value){this[key]=value;}
    addEventListener(event,fn){this.events[event]=fn;}
    remove(){this.parent.children.splice(this.parent.children.indexOf(this),1);}
    close(){this.open=false;this.events.close?.();}
    showModal(){this.open=true;}
    focus(){this.focused=true;}
  }
  const window={events:{},addEventListener(event,fn){this.events[event]=fn;},removeEventListener(event){delete this.events[event];}};
  const origin=new Node('button');origin.isConnected=true;
  const document={createElement:tag=>new Node(tag),body:new Node('body'),activeElement:origin};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../wiki/community-admin-confirm.js'),'utf8'),{window,document});
  return {window,document,origin,ask:window.WFCommunityAdminConfirm.ask};
}
test('confirmation starts with cancellation focused and resolves only once',async()=>{
  const x=setup(),result=x.ask('测试队伍',{restore:false}),dialog=x.document.body.children[0];
  const [cancel,confirm]=dialog.children[2].children;
  assert.equal(cancel.focused,true);assert.equal(dialog.open,true);
  assert.equal(confirm.textContent,'移到回收站');confirm.events.click();
  assert.equal(await result,true);assert.equal(x.document.body.children.length,0);
  assert.equal(x.origin.focused,true);assert.equal(x.window.events.hashchange,undefined);
});
test('Escape cancels without approving and cleans up the modal',async()=>{
  const x=setup(),result=x.ask('测试队伍'),dialog=x.document.body.children[0];let prevented=false;
  dialog.events.cancel({preventDefault(){prevented=true;}});
  assert.equal(await result,false);assert.equal(prevented,true);assert.equal(x.document.body.children.length,0);
});
test('route navigation cancels pending restore and removes event listener',async()=>{
  const x=setup(),result=x.ask('恢复测试',{restore:true}),dialog=x.document.body.children[0];
  assert.equal(dialog.children[2].children[1].textContent,'确认恢复');x.window.events.hashchange();
  assert.equal(await result,false);assert.equal(x.window.events.hashchange,undefined);assert.equal(x.document.body.children.length,0);
});
