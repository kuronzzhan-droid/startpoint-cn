const test=require('node:test');
const assert=require('node:assert/strict');
const {create,normalize}=require('../wiki/site-stats.js');
const tick=()=>new Promise(setImmediate);
const stats=(extra={})=>({totalVoters:9,ratingVoters:7,tierVoters:3,onlineVisitors:2,asOf:'2026-09-30T10:00:00.000Z',presenceWindowSeconds:120,...extra});
function fixture({protocol='https:',hidden=false,request=async()=>stats(),config=async()=>({enabled:true})}={}) {
  let time=0,id=0;const timers=new Map(),calls=[],seen=[],events=new Map(),docEvents=new Map();
  const eventBus=map=>({addEventListener:(key,fn)=>map.set(key,fn),removeEventListener:(key)=>map.delete(key)});
  const document={visibilityState:hidden?'hidden':'visible',...eventBus(docEvents)};
  const api=create({client:{async config(){calls.push('config');return config();},async request(...args){calls.push(args);return request(...args);}},protocol,
    document,events:eventBus(events),now:()=>time,schedule:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},cancel:(key)=>timers.delete(key)});
  api.subscribe(value=>seen.push(value));
  return {api,calls,seen,timers,document,events,docEvents,advance(ms){time+=ms;},
    hide(){document.visibilityState='hidden';docEvents.get('visibilitychange')?.();},
    show(){document.visibilityState='visible';docEvents.get('visibilitychange')?.();},
    runTimer(){const [key,value]=timers.entries().next().value;timers.delete(key);return value.fn();}};
}
test('one shared heartbeat initializes identity before presence and notifies multiple subscribers',async()=>{
  const x=fixture(),second=[];x.api.subscribe(v=>second.push(v));x.api.start();await tick();
  assert.deepEqual(x.calls,['config',['/presence',{},'POST']]);assert.equal(x.seen.at(-1).data.onlineVisitors,2);
  assert.equal(second.at(-1).data.ratingVoters,7);assert.equal(x.timers.size,1);assert.equal([...x.timers.values()][0].ms,30000);
});
test('simultaneous refreshes share the pending request and only one timer',async()=>{
  let resolve;const x=fixture({request:()=>new Promise(done=>resolve=done)});x.api.start();await tick();
  const first=x.api.refresh(),second=x.api.refresh();assert.equal(first,second);assert.equal(x.calls.length,2);
  resolve(stats());await first;assert.equal(x.timers.size,1);
});
test('hidden pages stop polling; returning after the interval refreshes exactly once',async()=>{
  const x=fixture();x.api.start();await tick();x.hide();assert.equal(x.timers.size,0);
  x.advance(120000);await x.api.refresh();assert.equal(x.calls.length,2);
  x.show();x.events.get('focus')();await tick();assert.equal(x.calls.length,4);assert.equal(x.timers.size,1);
});
test('background initial tabs never initialize identity or send presence until visible',async()=>{
  const x=fixture({hidden:true});x.api.start();await tick();assert.equal(x.calls.length,0);
  x.show();await tick();assert.equal(x.calls.length,2);
});
test('becoming hidden during identity setup skips presence',async()=>{
  let resolve;const x=fixture({config:()=>new Promise(done=>resolve=done)});x.api.start();await tick();x.hide();resolve({enabled:true});await tick();
  assert.deepEqual(x.calls,['config']);assert.equal(x.timers.size,0);
});
test('failures retain real last counts rather than showing invented zero and can recover',async()=>{
  let failure=false;const x=fixture({request:async()=>{if(failure)throw new Error('offline');return stats();}});x.api.start();await tick();
  failure=true;x.advance(30000);await x.runTimer();assert.equal(x.seen.at(-1).status,'error');assert.equal(x.seen.at(-1).data.tierVoters,3);
  failure=false;x.advance(30000);await x.runTimer();assert.equal(x.seen.at(-1).status,'ready');
});
test('malformed initial data is unavailable, not a zero-player result',async()=>{
  const x=fixture({request:async()=>stats({ratingVoters:-1})});x.api.start();await tick();
  assert.equal(x.seen.at(-1).status,'error');assert.equal(x.seen.at(-1).data,null);
  for(const value of [stats({tierVoters:1.2}),stats({onlineVisitors:'7'}),stats({totalVoters:4}),stats({totalVoters:20}),stats({asOf:'bad'}),stats({presenceWindowSeconds:0})])assert.throws(()=>normalize(value));
});
test('offline files never poll and keep unavailable counts distinct from zero',async()=>{
  const x=fixture({protocol:'file:'});x.api.start();await tick();assert.equal(x.calls.length,0);assert.equal(x.seen.at(-1).status,'offline');assert.equal(x.seen.at(-1).data,null);
});
test('unsubscribe and stop release view subscriptions, timers and visibility listeners',async()=>{
  const x=fixture(),values=[];const off=x.api.subscribe(v=>values.push(v));x.api.start();await tick();off();x.advance(30000);await x.runTimer();
  assert.equal(values.length,3);x.api.stop();assert.equal(x.timers.size,0);assert.equal(x.events.size,0);assert.equal(x.docEvents.size,0);
});
test('late responses after stop do not repaint or schedule new work',async()=>{
  let resolve;const x=fixture({request:()=>new Promise(done=>resolve=done)});x.api.start();await tick();x.api.stop();resolve(stats());await tick();
  assert.equal(x.seen.at(-1).data,null);assert.equal(x.timers.size,0);
});
test('focus storms within the interval do not send extra requests',async()=>{
  const x=fixture();x.api.start();await tick();for(let i=0;i<20;i++)x.events.get('focus')();await tick();
  assert.equal(x.calls.length,2);assert.equal(x.timers.size,1);
});

test('expired visitor cookies recover through fresh config, with at most one heartbeat retry',async()=>{
  const {createApi}=require('../wiki/community-client.js');
  let cookie=false,blocked=false,configs=0,presences=0;
  const client=createApi(async url=>{
    if(url.endsWith('/config')){configs++;cookie=!blocked;return {ok:true,json:async()=>({enabled:true})};}
    presences++;return cookie?{ok:true,json:async()=>stats()}:
      {ok:false,status:428,json:async()=>({error:'visitor_required'})};
  },'https:');
  const eventBus={addEventListener(){},removeEventListener(){}};
  const api=create({client,protocol:'https:',document:{visibilityState:'visible',...eventBus},events:eventBus,
    now:()=>0,schedule:()=>1,cancel:()=>{}}),seen=[];
  api.subscribe(value=>seen.push(value));api.start();await tick();assert.equal(configs,1);assert.equal(seen.at(-1).status,'ready');
  cookie=false;await api.refresh();assert.equal(configs,2);assert.equal(presences,3);assert.equal(seen.at(-1).status,'ready');
  cookie=false;blocked=true;await api.refresh();assert.equal(configs,3);assert.equal(presences,5);
  assert.equal(seen.at(-1).status,'error');assert.equal(seen.at(-1).data.onlineVisitors,2);api.stop();
});
