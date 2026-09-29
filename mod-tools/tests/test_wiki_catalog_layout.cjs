const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Node {
  constructor(tag) {Object.assign(this, {tag, children:[], dataset:{}, attrs:{}, listeners:{}});}
  append(...children) {this.children.push(...children);}
  setAttribute(key,value) {this.attrs[key] = value;}
  closest() {return null;}
  replaceWith(node) {this.replacement = node;}
  addEventListener(type,fn) {this.listeners[type] = fn;}
  dispatchEvent(event) {this.listeners[event.type]?.(event);}
  click() {this.dispatchEvent({type:'click'});}
}
function setup(saved, blocked = false) {
  const catalog = new Node('section'), control = new Node('select');
  const storage = new Map(saved ? [['wf-wiki-catalog-layout', saved]] : []), changes = [];
  catalog.addEventListener('cataloglayoutchange', () => changes.push(catalog.dataset.layout));
  const document = {getElementById:id=>id==='catalog-view'?catalog:control,createElement:tag=>new Node(tag)};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../wiki/catalog-layout.js'), 'utf8'), {
    document, Event: class {constructor(type) {this.type = type;}},
    localStorage:{getItem:key=>{if(blocked)throw Error();return storage.get(key);},
      setItem:(key,value)=>{if(blocked)throw Error();storage.set(key,value);}},
  });
  return {catalog,group:control.replacement,storage,changes,buttons:control.replacement.children.filter(n=>n.tag==='button')};
}

test('portrait layout restores independently and changes notify the catalogue exactly once', () => {
  const x = setup('portrait');
  assert.equal(x.catalog.dataset.layout,'portrait');
  assert.deepEqual(x.buttons.map(b=>b.textContent), ['标准','致密','立绘']);
  assert.equal(x.buttons[2].attrs['aria-pressed'],'true');
  assert.equal(x.changes.length,0);
  x.buttons[2].click();assert.equal(x.changes.length,0);
  x.buttons[0].click();x.buttons[1].click();x.buttons[2].click();
  assert.deepEqual(x.changes,['standard','dense','portrait']);
  assert.equal(x.storage.get('wf-wiki-catalog-layout'),'portrait');
  assert.equal(x.buttons.filter(b=>b.attrs['aria-pressed']==='true').length,1);
});

test('obsolete choices and unavailable storage retain usable layout controls', () => {
  for (const blocked of [false,true]) {
    const x = setup('extra-large',blocked);
    assert.equal(x.catalog.dataset.layout,'standard');
    x.buttons[2].click();
    assert.equal(x.catalog.dataset.layout,'portrait');
    assert.deepEqual(x.changes,['portrait']);
  }
});
