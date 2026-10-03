/* Pure battle state. Rendering and network callbacks never own these transitions. */
((root) => {
  'use strict';
  const emit=(s,type,extra={})=>({id:s.nextEventId++,tick:s.tick,type,...extra});
  const live=e=>e.hp>0;
  function create({content,squad,mode='campaign',stageId}) {
    if(!content?.characters||!Array.isArray(squad)||squad.length!==6||new Set(squad).size!==6
      ||squad.some(id=>!content.characters[id])||!['campaign','endless'].includes(mode)
      ||!content.stages?.some(stage=>stage.id===stageId))throw new Error('请选择六位不同的 MOD 角色和有效关卡');
    return {content,squad:[...squad],mode,stageId,status:'running',tick:0,time:0,energy:60,baseHp:100,
      wave:1,units:[],enemies:[],effects:[],coffins:[],lastCommandId:0,nextEntityId:1,nextEventId:1,kills:0,result:null};
  }
  function canDeploy(s,characterId,col,row) {
    if(s.status!=='running'||!s.squad.includes(characterId))return '角色不可部署';
    if(!Number.isInteger(col)||!Number.isInteger(row)||col<0||col>=5||row<0||row>=7)return '请选择草地空格';
    if(s.units.some(u=>u.characterId===characterId)||s.coffins.some(c=>c.characterId===characterId))return '角色正在场上或复归中';
    if(s.units.some(u=>u.col===col&&u.row===row)||s.coffins.some(c=>c.col===col&&c.row===row))return '格子已被占用';
    if(s.enemies.some(e=>live(e)&&Math.hypot(e.x-col-.5,e.y-row-.5)<.7))return '敌人正在这个格子';
    if(s.energy<s.content.characters[characterId].stats.deployCost)return '能量不足';
    return '';
  }
  function dispatch(s,c) {
    const fail=reason=>({ok:false,reason,events:[]});
    if(!c||!Number.isSafeInteger(c.id)||c.id<=s.lastCommandId)return fail('操作已取消或重复');
    s.lastCommandId=c.id;
    if(s.status!=='running')return fail('战斗已暂停或结束');
    if(c.type==='deploy') {
      const reason=canDeploy(s,c.characterId,c.col,c.row);if(reason)return fail(reason);
      const def=s.content.characters[c.characterId];
      const unit={id:s.nextEntityId++,characterId:c.characterId,col:c.col,row:c.row,x:c.col+.5,y:c.row+.5,
        hp:def.stats.hp,maxHp:def.stats.hp,statuses:[],readyAtTick:s.tick+Math.round(def.skill.cooldown*20),
        readyAnnounced:false,nextActionTick:s.tick+Math.round(def.stats.interval*20)};
      s.units.push(unit);s.energy-=def.stats.deployCost;
      return {ok:true,events:[emit(s,'deploy',{entityId:unit.id,characterId:unit.characterId,position:{x:unit.x,y:unit.y}})]};
    }
    return fail('技能尚不可用');
  }
  function cleanup(s) {
    const events=[];
    for(const u of s.units.filter(u=>!live(u))) {
      s.coffins.push({unitId:u.id,characterId:u.characterId,col:u.col,row:u.row,releaseAtTick:s.tick+400});
      events.push(emit(s,'death',{entityId:u.id,characterId:u.characterId,position:{x:u.x,y:u.y}}));
    }
    s.units=s.units.filter(live);
    for(const e of s.enemies.filter(e=>!live(e))) {s.kills=Math.min(1e6,s.kills+1);s.energy=Math.min(120,s.energy+10);events.push(emit(s,'kill',{entityId:e.id}));}
    s.enemies=s.enemies.filter(live);
    return events;
  }
  function advance(s) {
    if(s.status!=='running')return [];
    s.tick++;s.time=s.tick/20;s.energy=Math.min(120,Math.round((s.energy+.15)*100)/100);
    const events=cleanup(s);
    for(const c of s.coffins.filter(c=>c.releaseAtTick<=s.tick))events.push(emit(s,'returned',{characterId:c.characterId}));
    s.coffins=s.coffins.filter(c=>c.releaseAtTick>s.tick);
    for(const u of s.units)if(s.tick>=u.readyAtTick&&!u.readyAnnounced){u.readyAnnounced=true;events.push(emit(s,'ready',{entityId:u.id,characterId:u.characterId}));}
    if(s.baseHp<=0) {s.baseHp=0;s.status='lost';s.result={mode:s.mode,stageId:s.stageId,won:false,wave:s.wave,kills:s.kills,time:s.time};events.push(emit(s,'result',{value:s.result}));}
    return events;
  }
  const api={create,dispatch,advance,canDeploy,cleanup,emit,setPaused(s,value){if(['running','paused'].includes(s.status))s.status=value?'paused':'running';}};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.WFBattleModel=api;
})(typeof window==='undefined'?globalThis:window);
