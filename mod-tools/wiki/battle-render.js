/* Presentation only: simulation owns time, health, cooldowns and all commands. */
((root)=>{
 'use strict';
 function create({host,content,ui,onFailure=()=>{}}){
  const {el}=ui,field=el('section','battle-field'),status=el('div','battle-status'),board=el('div','battle-board');
  const ground=el('canvas','battle-ground'),fx=el('canvas','battle-fx'),grid=el('div','battle-grid'),layer=el('div','battle-sprites');
  const roster=el('div','battle-roster'),energyButton=el('button','battle-energy'),energyValue=el('strong'),energyLabel=el('span','','能量');
  const entry=el('span','battle-entry'),base=el('span','battle-base'),wave=el('span','battle-wave');
  status.append(wave,base,entry);status.setAttribute('aria-label','战场状态');board.setAttribute('aria-label','五列七行草地战场');
  board.dataset.navigationSwipeIgnore='';energyButton.type='button';energyButton.dataset.gesture='energy';energyButton.setAttribute('aria-pressed','false');
  energyButton.append(energyLabel,energyValue);board.append(ground,fx,grid,layer);field.append(status,board,roster,energyButton);host.append(field);
  ground.setAttribute('aria-hidden','true');fx.setAttribute('aria-hidden','true');layer.setAttribute('aria-hidden','true');
  const groundCtx=ground.getContext('2d'),fxCtx=fx.getContext('2d'),cells=[],cards=new Map(),entities=new Map(),coffins=new Map(),castUntil=new Map();
  let dead=false,selection=null,width=0,height=0,dpr=0,pendingWidth=board.clientWidth||280,lastEventId=0,lastState=null;
  let visuals=[],texts=[];
  const setText=(node,text)=>{text=String(text);if(node.textContent!==text)node.textContent=text;};
  const attr=(node,key,value)=>{value=String(value);if(node.getAttribute(key)!==value)node.setAttribute(key,value);};
  const name=id=>content.characters[id]?.name||'角色',alive=unit=>unit.hp>0;
  const safeImage=def=>def&&typeof def.url==='string'&&/^media\/[a-zA-Z0-9_./-]+\.(webp|png|jpg)$/.test(def.url)&&!def.url.includes('..')&&Number.isFinite(def.width)&&def.width>0&&Number.isFinite(def.height)&&def.height>0;
  function imageState(img){
   const record={img,failed:new Set(),options:[],current:null,scale:1};
   record.onError=()=>{if(dead)return;if(record.current)record.failed.add(record.current.url);paintImage(record);onFailure('像素资源加载失败，已尝试同角色替代图，可重试资源。');};img.addEventListener('error',record.onError);
   return record;
  }
  function paintImage(record){
   const def=record.options.find(value=>safeImage(value)&&!record.failed.has(value.url));record.current=def||null;
   record.img.hidden=!def;if(!def)return;
   if(record.url!==def.url){record.url=def.url;record.img.src=def.url+(record.retry?`?retry=${record.retry}`:'');}
   const scale=def.avatar?width/5*.65/32:record.scale;record.img.style.width=`${def.width*scale}px`;record.img.style.height=`${def.height*scale}px`;
   record.img.style.left=`${-(def.anchorX??def.width/2)*scale}px`;record.img.style.top=`${-(def.anchorY??def.height)*scale}px`;
  }
  function scaleFor(media,kind){
   const defs=[media?.actions?.idle,media?.actions?.skill_ready].filter(safeImage);
   if(!defs.length)return 1;
   const extent=key=>Math.max(...defs.map(def=>key==='left'?(def.anchorX??def.width/2):key==='right'?def.width-(def.anchorX??def.width/2):key==='up'?(def.anchorY??def.height):def.height-(def.anchorY??def.height)));
   const factor=kind==='boss'?1.32:kind==='vanguard'?.76:1,cell=width/5;
   return Math.min(3,cell*1.5*factor/Math.max(1,extent('left')+extent('right')),cell*1.7*factor/Math.max(1,extent('up')+extent('down')));
  }
  function createEntity(unit,enemy){
   const node=el('div',`battle-entity ${enemy?'battle-enemy battle-'+unit.rank:'battle-ally'}`),img=el('img','battle-sprite');
   const health=el('span','battle-health'),bar=el('i'),label=el('span','battle-unit-label'),ready=el('span','battle-ready');
   img.alt='';img.draggable=false;health.setAttribute('role','progressbar');health.setAttribute('aria-label',`${name(unit.characterId)}生命`);
   health.append(bar);node.append(ready,img,health,label);layer.append(node);
   return {node,img,health,bar,label,ready,picture:imageState(img)};
  }
  function updateEntity(record,unit,state,enemy){
   const media=content.media[unit.characterId],actions=media?.actions||{},casting=(castUntil.get(unit.id)||0)>state.tick;
   const action=(casting?actions.skill_ready:actions.idle)||actions.idle,still=state.status!=='running';
   record.picture.options=[still?(action?.poster||actions.idle?.poster):action,action?.poster,actions.idle?.poster,still?null:actions.idle,
    media?.avatar?{url:media.avatar,width:32,height:32,anchorX:16,anchorY:28,avatar:true}:null];
   record.picture.scale=scaleFor(media,enemy?unit.rank:'ally');paintImage(record.picture);
   record.node.style.left=`${unit.x/5*100}%`;record.node.style.top=`${unit.y/7*100}%`;record.node.style.zIndex=String(Math.round(unit.y*10)+10);
   const ratio=Math.max(0,Math.min(1,unit.hp/unit.maxHp));record.bar.style.width=`${ratio*100}%`;
   attr(record.health,'aria-valuemin',0);attr(record.health,'aria-valuemax',unit.maxHp);attr(record.health,'aria-valuenow',Math.max(0,Math.round(unit.hp)));
   const isReady=!enemy&&state.tick>=unit.readyAtTick;record.node.classList.toggle('is-ready',isReady);
   record.node.classList.toggle('is-casting',casting);record.node.classList.toggle('is-missing',!record.picture.current);
   setText(record.label,enemy?(unit.rank==='boss'?'Boss':'先锋'):record.picture.current?'':name(unit.characterId));
  }
  function removeRecord(map,key,record){record.img?.removeEventListener('error',record.picture?.onError);record.node.remove();map.delete(key);castUntil.delete(key);}
  function updateUnits(state){
   const active=new Set();
   for(const [list,enemy] of [[state.units,false],[state.enemies,true]])for(const unit of list.filter(alive)){
    active.add(unit.id);let record=entities.get(unit.id);if(!record){record=createEntity(unit,enemy);entities.set(unit.id,record);}updateEntity(record,unit,state,enemy);
   }
   for(const [id,record]of entities)if(!active.has(id))removeRecord(entities,id,record);
   const waiting=new Set();for(const item of state.coffins){
    const id=item.characterId;waiting.add(id);let record=coffins.get(id);
    if(!record){const node=el('div','battle-coffin'),img=el('img','battle-sprite'),label=el('span','battle-coffin-time');img.alt='';img.draggable=false;node.append(img,label);layer.append(node);
     record={node,img,label,picture:imageState(img)};coffins.set(id,record);}
    record.node.style.left=`${(item.col+.5)/5*100}%`;record.node.style.top=`${(item.row+.5)/7*100}%`;
    record.picture.options=[content.coffin];record.picture.scale=2;paintImage(record.picture);setText(record.label,`${Math.max(0,Math.ceil((item.releaseAtTick-state.tick)/20))}s`);
   }
   for(const [id,record]of coffins)if(!waiting.has(id))removeRecord(coffins,id,record);
   for(const cell of cells){
    const unit=state.units.find(u=>alive(u)&&u.col===Number(cell.dataset.col)&&u.row===Number(cell.dataset.row)),coffin=state.coffins.find(c=>c.col===Number(cell.dataset.col)&&c.row===Number(cell.dataset.row));
    if(unit)cell.dataset.unitId=String(unit.id);else delete cell.dataset.unitId;
    cell.classList.toggle('is-occupied',!!unit||!!coffin);cell.classList.toggle('is-ready',!!unit&&state.tick>=unit.readyAtTick);
    attr(cell,'aria-label',`第${Number(cell.dataset.row)+1}行第${Number(cell.dataset.col)+1}列${unit?'，'+name(unit.characterId)+'，生命'+Math.ceil(unit.hp)+(state.tick>=unit.readyAtTick?'，技能就绪':''):coffin?'，'+name(coffin.characterId)+'复归中':'，空地'}`);
   }
  }
  for(let row=0;row<7;row++)for(let col=0;col<5;col++){
   const cell=el('button','battle-cell');cell.type='button';cell.dataset.col=String(col);cell.dataset.row=String(row);attr(cell,'aria-label',`第${row+1}行第${col+1}列，空地`);cells.push(cell);grid.append(cell);
  }
  function drawRoster(state){
   state.squad.forEach((id,index)=>{
    let card=cards.get(id);if(!card){
     const node=el('button','battle-roster-card'),img=el('img'),title=el('span','battle-roster-name',name(id)),hint=el('span','battle-roster-hint');
     node.type='button';node.dataset.characterId=id;node.dataset.gesture='deploy';img.alt='';img.draggable=false;img.src=content.media[id]?.avatar||'';
     node.append(img,title,hint);if(index===0){const flag=el('span','battle-leader','⚑');flag.setAttribute('aria-label','队长');node.append(flag);}roster.append(node);card={node,hint};cards.set(id,card);
    }
    const unit=state.units.find(u=>alive(u)&&u.characterId===id),coffin=state.coffins.find(c=>c.characterId===id),cost=content.characters[id]?.stats.deployCost||20;
    const label=unit?(state.tick>=unit.readyAtTick?'技能就绪':`${Math.max(0,Math.ceil((unit.readyAtTick-state.tick)/20))}s`):coffin?`${Math.max(0,Math.ceil((coffin.releaseAtTick-state.tick)/20))}s 复归`:`${cost} 部署`;
    card.node.disabled=!!unit||!!coffin||state.status!=='running'||state.energy<cost;
    card.node.classList.toggle('is-deployed',!!unit);card.node.classList.toggle('is-ready',!!unit&&state.tick>=unit.readyAtTick);setText(card.hint,label);attr(card.node,'aria-label',`${index===0?'队长，':''}${name(id)}，${label}`);
   });
  }
  function size(){
   const nextWidth=Math.max(1,pendingWidth),nextDpr=Math.min(2,Math.max(1,root.devicePixelRatio||1));if(nextWidth===width&&nextDpr===dpr)return;
   width=nextWidth;height=width*7/5;dpr=nextDpr;
   for(const canvas of [ground,fx]){canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);}
   if(!groundCtx)return;groundCtx.setTransform(dpr,0,0,dpr,0,0);groundCtx.clearRect(0,0,width,height);
   const unit=width/5;for(let row=0;row<7;row++)for(let col=0;col<5;col++){
    groundCtx.fillStyle=(row+col)%2?'#466d4c':'#4c7752';groundCtx.fillRect(col*unit,row*unit,unit,unit);
    groundCtx.fillStyle='#b9d89125';groundCtx.fillRect((col+.22)*unit,(row+.67)*unit,2,5);groundCtx.fillRect((col+.76)*unit,(row+.27)*unit,2,4);
   }
   groundCtx.fillStyle='#bead7940';groundCtx.fillRect(0,height-8,width,8);
  }
  function collect(state,events){
   for(const event of events){
    if(!Number.isFinite(event.id)||event.id<=lastEventId)continue;lastEventId=event.id;
    if(event.type==='cast'){
     const actor=state.units.find(unit=>unit.id===event.entityId),duration=content.media[actor?.characterId]?.actions?.skill_ready?.duration||.7;
     castUntil.set(event.entityId,state.tick+Math.max(1,Math.ceil(duration*20)));
    }
    if(!event.position||!Number.isFinite(event.position.x)||!Number.isFinite(event.position.y))continue;
    if(['damage','heal','warning','attack','buff','deploy'].includes(event.type))visuals.push({event,end:state.tick+(event.type==='warning'?16:10),start:state.tick});
    if(['damage','heal'].includes(event.type)&&Number.isFinite(event.value))texts.push({event,end:state.tick+20,start:state.tick});
   }
   visuals=visuals.filter(v=>v.end>state.tick).slice(-48);texts=texts.filter(v=>v.end>state.tick).slice(-12);
   for(const [id,end]of castUntil)if(end<=state.tick)castUntil.delete(id);
  }
  function effects(state){
   if(!fxCtx)return;fxCtx.setTransform(dpr,0,0,dpr,0,0);fxCtx.clearRect(0,0,width,height);const cell=width/5;
   for(const {event,start,end}of visuals){
    const x=event.position.x*cell,y=event.position.y*cell,alpha=(end-state.tick)/(end-start),healing=event.type==='heal';
    fxCtx.globalAlpha=alpha;fxCtx.strokeStyle=event.type==='warning'?'#ff9d83':healing?'#abffb5':'#ffe5a0';fxCtx.lineWidth=event.type==='warning'?3:2;fxCtx.beginPath();
    const actor=entities.get(event.entityId),radius=event.type==='warning'?cell*(event.value==='fire'?1:.46):cell*.12+(1-alpha)*cell*.16;
    if(event.type==='attack'&&actor){fxCtx.moveTo(parseFloat(actor.node.style.left)/100*width,parseFloat(actor.node.style.top)/100*height);fxCtx.lineTo(x,y);}else fxCtx.arc(x,y,radius,0,Math.PI*2);fxCtx.stroke();
   }
   fxCtx.textAlign='center';fxCtx.font='bold 13px sans-serif';for(const {event,start,end}of texts){
    fxCtx.globalAlpha=Math.min(1,(end-state.tick)/5);fxCtx.fillStyle=event.type==='heal'?'#baffbc':'#fff0df';
    fxCtx.fillText((event.type==='heal'?'+':'−')+Math.round(event.value),event.position.x*cell,event.position.y*cell-12-(state.tick-start));
   }fxCtx.globalAlpha=1;
  }
  function setSelection(value){
   setText(energyLabel,value?.energy&&value.cost?`消耗 ${value.cost}`:'能量');
   if(dead)return;selection=value;
   for(const [id,card]of cards)attr(card.node,'aria-pressed',!!value&&value.characterId===id);
   attr(energyButton,'aria-pressed',!!value?.energy);board.classList.toggle('is-selecting',!!value);board.classList.toggle('is-energy-select',!!value?.energy);
   for(const cell of cells){const match=value?.cell&&Number(cell.dataset.col)===value.cell.col&&Number(cell.dataset.row)===value.cell.row;
    cell.classList.toggle('is-drop-valid',!!match&&value.valid!==false);cell.classList.toggle('is-drop-invalid',!!match&&value.valid===false);}
  }
  function draw(state,events=[]){
   if(dead)return;lastState=state;size();collect(state,events);updateUnits(state);drawRoster(state);effects(state);setSelection(selection);
   setText(wave,`第 ${state.wave} 波`);setText(base,`据点 ${Math.max(0,Math.ceil(state.baseHp))}`);
   setText(entry,state.status==='paused'?'已暂停':state.status==='won'?'已通关':state.status==='lost'?'挑战结束':state.nextWaveTick?`${Math.max(0,Math.ceil((state.nextWaveTick-state.tick)/20))}s 后迎敌`:'↓ 敌人入口');
   setText(energyValue,`${Math.floor(state.energy)} / 120`);energyButton.disabled=state.status!=='running';attr(energyButton,'aria-label',`能量 ${Math.floor(state.energy)}，选择后点击就绪角色发动技能`);
   board.classList.toggle('is-paused',state.status!=='running');
  }
  function resized(value){if(dead||!value||value===pendingWidth)return;pendingWidth=value;if(lastState)draw(lastState);}
  const onResize=()=>resized(board.clientWidth);
  const observer=root.ResizeObserver?new root.ResizeObserver(entries=>resized(entries[0]?.contentRect.width)):null;
  if(observer)observer.observe(board);else root.addEventListener('resize',onResize);
  function destroy(){if(dead)return;dead=true;observer?.disconnect();root.removeEventListener('resize',onResize);
   for(const [id,record]of entities)removeRecord(entities,id,record);for(const [id,record]of coffins)removeRecord(coffins,id,record);
   cards.clear();visuals=[];texts=[];selection=null;field.remove();
  }
  function retry(){if(dead)return;for(const record of [...entities.values(),...coffins.values()]){record.picture.failed.clear();record.picture.url=null;record.picture.retry=(record.picture.retry||0)+1;}if(lastState)draw(lastState);}
  return {board,roster,energyButton,status,draw,setSelection,retry,destroy};
 }
 const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.WFBattleRender=api;
})(typeof window==='undefined'?globalThis:window);
