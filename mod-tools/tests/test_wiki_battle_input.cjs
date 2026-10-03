const test=require('node:test'),assert=require('node:assert/strict'),I=require('../wiki/battle-input.js');
test('grid hit test rejects outside edges and includes scaled phone cells',()=>{const r={left:10,top:20,width:300,height:420};assert.deepEqual(I.cellAt(10,20,r),{col:0,row:0});assert.deepEqual(I.cellAt(309,439,r),{col:4,row:6});for(const [x,y]of [[310,20],[10,440],[9,20],[10,19]])assert.equal(I.cellAt(x,y,r),null);});
test('input deduplicates synthesized click after touch drop and cancels a second pointer',()=>{
 const listeners=new Map(),win=new EventTarget();const source={dataset:{gesture:'deploy',characterId:'a'},disabled:false,setPointerCapture(){},releasePointerCapture(){},closest:()=>source};
 const host={contains:()=>true,addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
 let deployments=0,voices=0,selects=0;const doc={createElement:()=>({style:{},remove(){}}),body:{append(){}}};
 const input=I.create({host,board:{getBoundingClientRect:()=>({left:0,top:0,width:500,height:700})},window:win,document:doc,canSelect:()=>true,onVoice:()=>voices++,onSelect:()=>selects++,onDrop:()=>deployments++,onCell:()=>{}});
 const ev=(id,x,y)=>({target:source,pointerId:id,button:0,clientX:x,clientY:y,preventDefault(){}});
 listeners.get('pointerdown')(ev(1,5,5));listeners.get('pointermove')(ev(1,50,50));listeners.get('pointerup')(ev(1,50,50));listeners.get('click')({target:source,detail:1});assert.equal(deployments,1);assert.equal(voices,1);assert.equal(selects,0);
 listeners.get('pointerdown')(ev(2,5,5));listeners.get('pointerdown')(ev(3,6,6));listeners.get('pointerup')(ev(2,50,50));assert.equal(deployments,1);input.destroy();assert.equal(listeners.size,0);
});
