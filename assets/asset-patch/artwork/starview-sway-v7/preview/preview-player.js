(async()=>{
const compressed=Uint8Array.from(atob(document.getElementById('compact-review-data').textContent),c=>c.charCodeAt(0));
const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
const {model,frameLibrary}=JSON.parse(await new Response(stream).text());
for(const page of Object.values(model.pages))page.frames=frameLibrary[page.frameLibraryIndex];
// Insert into the compact review bootstrap before the preserved Movie player.
const clips = JSON.parse(document.getElementById('native-recordings').textContent);
const presentation = JSON.parse(document.getElementById('skill-presentation').textContent);
const clipByRole = new Map(clips.clips.map(clip => [clip.roleId, clip]));
const posters = new Map(presentation.characters.map(role => [role.id, role.posterPage]));
const profileIdFor = new Map(presentation.characters.map(role => [role.posterPage, role.id]));
model.pageOrder = presentation.order.map(entry => entry.page);
model.skillPresentation = presentation;
for (const entry of presentation.order.filter(entry => entry.kind === 2)) {
  const roleId = entry.roleId;
  const role = presentation.characters.find(role => role.id === roleId);
  const clip = clipByRole.get(roleId);
  if (!clip || !role) throw Error('缺少角色原生录像：' + roleId);
  const frameCount = clip.lastFrame - clip.firstFrame + 1;
  const profile = model.profiles[roleId] ?? model.profiles[role.posterPage];
  model.pages[entry.page] = {
    label: entry.label ?? [role.name, profile?.skill ?? '主动技能'].join(' · '),
    characterId: roleId, frameCount, cells: [], frames: [],
    timeline: {sequences: [{name: '原生主动技能', begin: 1, end: frameCount}]},
    nativeClip: clip,
  };
}

const continuous = document.getElementById('continuous');
const recordingClock = document.getElementById('recordingClock');
let navigation = 0;
let opening = Promise.resolve();
function reportMediaError(error) {
  document.documentElement.dataset.mediaError = error.message;
  document.getElementById('ready').textContent = error.message;
  pause(true);
}
const nativeMedia = window.createNativeClipPlayer(clips, {
  onFrame(capture) {
    const clip = D.pages[key].nativeClip;
    if (!clip || clip.roleId !== capture.roleId) return;
    frame = capture.frame - clip.firstFrame;
    seconds = frame / clips.fps;
    draw();
  },
  onEnd(roleId) {
    if (!playing || D.pages[key].nativeClip?.roleId !== roleId) return;
    cycles++;
    if (continuous.checked) select(keys[(keys.indexOf(key) + 1) % keys.length]);
    else replay();
  },
  onError: reportMediaError,
});

function openCapture(clip) {
  const active = ++navigation;
  nativeMedia.clear();
  opening = clip ? (async () => {
    await nativeMedia.show(clip.roleId);
    if (active === navigation && playing) await nativeMedia.play(speed);
  })() : Promise.resolve();
  opening.catch(reportMediaError);
  return opening;
}

function updateCaptureClock(page) {
  const clip = page.nativeClip;
  recordingClock.hidden = !clip;
  if (!clip) return;
  const captureFrame = clip.firstFrame + frame;
  const event = clip.events.filter(event => event.frame <= captureFrame).at(-1);
  recordingClock.textContent = '捕获帧 ' + captureFrame + ' / ' + clip.lastFrame +
    (event ? ' · ' + event.kind + '（战斗帧 ' + (event.battleFrame ?? event.frame) + '）' : '');
}

async function renderAt(page, tick) {
  if (key !== page) await select(page);
  await go(tick);
}

const ReviewData=window.ReviewData=model;
window.NATIVE_GACHA_UI_DATA=model.nativeUI;
/* Native PixelArtCharacter usual-pose contract; call load() before drawing. */
(function (global) {
  'use strict';
  const data = global.NATIVE_GACHA_UI_DATA;
  if (!data) throw new Error('Load native-ui/data.js before renderer.js');
  const images = Object.create(null);
  let ready = false;
  let pending;
  function load() {
    if (pending) return pending;
    pending = Promise.all(Object.entries(data.image_data_urls).map(([key, url]) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => { images[key] = image; resolve(); };
      image.onerror = () => reject(new Error('Native UI image failed: ' + key));
      image.src = url;
    }))).then(() => { ready = true; });
    return pending;
  }
  function requireReady() { if (!ready) throw new Error('Await NativeGachaUI.load() before drawing'); }
  function origin(ctx, p) { ctx.translate(p.x, p.y); ctx.scale(p.scale ?? 1, p.scale ?? 1); }
  function matrix(ctx, m) { ctx.transform(m.a, m.b, m.c, m.d, m.tx, m.ty); }
  const elementKeys = { dark: 'black_5', wind: 'green_5', light: 'white_5', thunder: 'yellow_5', black: 'black_5', green: 'green_5', white: 'white_5', yellow: 'yellow_5', 5: 'black_5', 3: 'green_5', 4: 'white_5', 2: 'yellow_5' };
  function drawPedestal(ctx, position, element) {
    requireReady();
    const key = elementKeys[element] || data.characters[String(element)]?.asset_key;
    if (!key) throw new Error('Unsupported five-character element or ID: ' + element);
    ctx.save(); origin(ctx, position); ctx.scale(6, 6); ctx.imageSmoothingEnabled = false;
    ctx.save(); matrix(ctx, data.usual.full.pedestal.frame.matrix); ctx.drawImage(images[key], 0, 0); ctx.restore();
    ctx.save(); matrix(ctx, data.usual.full.shadow.frame.matrix); ctx.drawImage(images.character_shadow, 0, 0); ctx.restore();
    ctx.restore();
    return data.usual.full.character.frame.matrix;
  }
  function drawCharacter(ctx, position, drawNativeFrame) {
    requireReady();
    if (typeof drawNativeFrame !== 'function') throw new Error('drawNativeFrame callback is required');
    ctx.save(); origin(ctx, position); ctx.scale(6, 6); matrix(ctx, data.usual.full.character.frame.matrix); ctx.imageSmoothingEnabled = false;
    drawNativeFrame(ctx); ctx.restore();
  }
  function nineSlice(ctx, image, x, y, width, height) {
    // Native rarity plate slice_grid: left18/right22/top17/bottom23 in42x42.
    const sx = [0, 18, 22, 42], sy = [0, 17, 23, 42];
    const dx = [x, x + 18, x + width - 20, x + width], dy = [y, y + 17, y + height - 19, y + height];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) ctx.drawImage(image, sx[i], sy[j], sx[i+1]-sx[i], sy[j+1]-sy[j], dx[i], dy[j], dx[i+1]-dx[i], dy[j+1]-dy[j]);
  }
  function drawRarity(ctx, position) {
    requireReady();
    ctx.save(); origin(ctx, position); matrix(ctx, data.usual.accessory.matrix); ctx.translate(3, -51); ctx.imageSmoothingEnabled = true;
    nineSlice(ctx, images.rarity_plate_source, -81, -21, 162, 42);
    ctx.drawImage(images.rarity_five, -64, -15); ctx.restore();
  }
  global.NativeGachaUI = Object.freeze({ load, drawPedestal, drawCharacter, drawRarity, data });
})(window);


'use strict';
const D=ReviewData,canvas=document.getElementById('screen'),ctx=canvas.getContext('2d'),keys=D.pageOrder,K=D.screen.scale;
const ui=document.getElementById('ui'),guides=document.getElementById('guides'),seek=document.getElementById('seek'),button=document.getElementById('play');
let key=keys[0],frame=0,seconds=0,playing=true,speed=1,last=0,acc=0,cycles=0,ready=false;
const loaded=new Map(),cells={},pixels={},infoPanels={},footer={};let shot,banner,maskedBottom;const ticketUI={};
function image(uri){if(loaded.has(uri))return loaded.get(uri);const p=new Promise((resolve,reject)=>{const i=new Image;i.onload=()=>resolve(i);i.onerror=()=>reject(Error('内嵌图像读取失败'));i.src=uri});loaded.set(uri,p);return p}
function polygon(points){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath()}
function shotClip(make){ctx.save();ctx.scale(K,K);make();ctx.clip();ctx.drawImage(shot,0,0);ctx.restore()}
function topUI(){
  ctx.save();ctx.fillStyle='#fffdfb';ctx.beginPath();ctx.roundRect(0,-25,1080,124,25);ctx.fill();
  ctx.fillStyle='#37313a';ctx.font='600 36px Microsoft YaHei';ctx.textAlign='center';ctx.fillText('角色扭蛋',540,65);
  ctx.fillStyle='#241d2b';polygon([[195,99],[885,99],[850,146],[230,146]]);ctx.fill();
  ctx.fillStyle='#fff7ed';ctx.font='24px Microsoft YaHei';ctx.fillText('限定角色精选',540,130);ctx.restore();
  ctx.drawImage(banner,284.95,171,510,180);
  shotClip(()=>{ctx.beginPath();ctx.ellipse(49.5,242,34.5,35,0,0,Math.PI*2)});
  shotClip(()=>{ctx.beginPath();ctx.ellipse(49.5,319,34.5,35,0,0,Math.PI*2)});
  shotClip(()=>polygon([[9,343],[91,343],[88,353],[91,363],[9,363],[13,353]]));
  ctx.save();ctx.lineJoin='round';ctx.lineCap='round';ctx.lineWidth=7;ctx.strokeStyle='#fff';
  for(const direction of [1,-1]){
    const x=direction===1?37:1043;
    ctx.beginPath();ctx.moveTo(x+direction*35,762);ctx.lineTo(x,785);ctx.lineTo(x+direction*35,808);ctx.stroke();
  }
  ctx.restore();
}

function fade(){const sequences=D.pages[key].timeline.sequences,n=frame+1,appear=sequences.find(x=>x.name==='info_appear'),disappear=sequences.find(x=>x.name==='info_disappear');if(!appear||!disappear||n<appear.begin)return 0;return n<disappear.begin?Math.min(1,(n-appear.begin)/10):Math.max(0,1-(n-disappear.begin)/6)}
function drawPixel(id,x,y,scale=1){const c=D.characters[id];if(!c)return;let tick=(seconds*c.fps*c.cardPlaybackSpeed)%c.totalTicks,sum=0,f=c.frames.at(-1);for(const t of c.frames){sum+=t.hold;if(tick<sum){f=t;break}}const p={x,y,scale};NativeGachaUI.drawPedestal(ctx,p,id);NativeGachaUI.drawCharacter(ctx,p,context=>context.drawImage(pixels[f.uri],f.x,f.y));NativeGachaUI.drawRarity(ctx,p)}
function infoUI(){
  const roleId=profileIdFor.get(key)??key,profile=D.profiles[roleId]??D.profiles[key],opacity=fade();if(!profile||opacity<=0)return;
  ctx.save();ctx.globalAlpha=opacity;ctx.fillStyle='#fffdff';
  ctx.beginPath();ctx.roundRect(615,956,465,220,24);ctx.fill();
  ctx.fillStyle='#e8dce4';ctx.fillRect(632,1069,432,2);
  for(const [label,value,top] of [['队长特性',profile.leader,975],['技能',profile.skillPlus,1080]]){
    ctx.fillStyle='#29272c';polygon([[636,top],[805,top],[794,top+18],[805,top+36],[636,top+36]]);ctx.fill();
    ctx.fillStyle='#ffb849';ctx.fillRect(636,top,8,36);
    ctx.fillStyle='#fff';ctx.font='27px Microsoft YaHei';ctx.textBaseline='middle';
    ctx.fillText(label,650,top+18);ctx.fillStyle='#514d55';ctx.font='26px Microsoft YaHei';
    ctx.fillText(value,634,top+66,430);
  }
  drawPixel(roleId,...D.calibration.infoPixel,.86);ctx.restore();
}
function sliceX(image,x,y,width,left,right){const h=image.height,w=image.width,edge=w-right;
  ctx.drawImage(image,0,0,left,h,x,y,left,h);
  ctx.drawImage(image,left,0,right-left,h,x+left,y,width-left-edge,h);
  ctx.drawImage(image,right,0,edge,h,x+width-edge,y,edge,h)}
function pickupPanels(){
  // Native footer textures, recalibrated for six 177px-spaced slots in the offline viewport.
  sliceX(footer.gacha_pickup_character_bg_left,D.footerPanels.left.x,D.footerPanels.left.y,D.footerPanels.left.width,9,24);
  sliceX(footer.gacha_pickup_character_bg_right,D.footerPanels.right.x,D.footerPanels.right.y,D.footerPanels.right.width,107,124);
  for(let i=0;i<D.footerOrder.length;i++)ctx.drawImage(footer.gacha_pickup_character_bg,D.footerPanels.centers[i].x,D.footerPanels.centers[i].y);
}
function prepareBottom(){const c=document.createElement('canvas');c.width=1439;c.height=358;const cc=c.getContext('2d');
  cc.fillStyle=cc.createPattern(footer.quest_bg_panel,'repeat');cc.fillRect(0,0,c.width,c.height);
  cc.globalCompositeOperation='destination-in';
  const m=footer.gacha_bottom_mask;
  // Native Scale9 intersects the source frame: 66px top, 14px bottom, stretch middle.
  const mask=document.createElement('canvas');mask.width=1439;mask.height=358;const mc=mask.getContext('2d');
  mc.drawImage(m,0,0,1440,66,.4,0,1440,66);mc.drawImage(m,0,66,1440,10,.4,66,1440,278);mc.drawImage(m,0,76,1440,14,.4,344,1440,14);
  cc.drawImage(mask,0,0);return c;
}
// Native text coordinates are text-field boxes, not Canvas ink-top baselines.
// Align actual glyph ink to the native 40px cost icon / inventory strip.
function centeredTicketGlyph(context,text,x,centerY,size,color){
  context.save();context.font=size+'px Microsoft YaHei';context.fillStyle=color;
  context.textAlign='left';context.textBaseline='alphabetic';
  const metrics=context.measureText(text),baseline=centerY+(metrics.actualBoundingBoxAscent-metrics.actualBoundingBoxDescent)/2;
  context.fillText(text,x,baseline);context.restore();
}
function drawTicketText(context=ctx){
  centeredTicketGlyph(context,D.ticketStrings.gacha_cost_prefix[0][0],530,1599,40,'#fafafa');
  centeredTicketGlyph(context,String(D.ticketPreview.cost),565,1599,40,'#fafafa');
  centeredTicketGlyph(context,D.ticketStrings.gacha_ten_times_ticket_label[0][0],392,1687,25,'#ffffff');
  centeredTicketGlyph(context,String(D.ticketPreview.assumedOwned),620,1687,32,'#444444');
}
function footerUI(){
  ctx.drawImage(maskedBottom,-179.4,1562);pickupPanels();
  for(let i=0;i<D.footerOrder.length;i++){const id=D.footerOrder[i];drawPixel(id,D.calibration.upOrigins[i],D.calibration.upY,.85);
    ctx.save();ctx.font='24px Microsoft YaHei';ctx.fillStyle='#171717';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText(D.names[id],D.footerNames[i][0],D.footerNames[i][1]);ctx.restore();}
  // GachaSceneViewBase page4 -> layout/gacha frame4, only draw_ten_times_wide.
  // Source transforms: (194,1500) + wrapper button (346,71); bitmap (-346,-71).
  ctx.drawImage(ticketUI.gacha_draw_ten_times_button_wide,194,1500);
  ctx.drawImage(ticketUI.gacha_draw_ten_times_normal_wide,427,1512);
  // Native cost_layer frame2: ticket image20x20 at (8,9), scale2; cost is always 1.
  ctx.imageSmoothingEnabled=false;if(ticketUI.icon)ctx.drawImage(ticketUI.icon,475,1579,40,40);
  else centeredTicketGlyph(ctx,'券',476,1599,34,'#ffffff');ctx.imageSmoothingEnabled=true;
  // Native stone_ticket frame2: ten_times_ticket at 123+253,1667, no stone counters.
  sliceX(ticketUI.general_label_base,376,1667,192,14,22);
  ctx.imageSmoothingEnabled=false;if(ticketUI.icon)ctx.drawImage(ticketUI.icon,574,1667,40,40);
  else centeredTicketGlyph(ctx,'券',577,1687,28,'#514d55');ctx.imageSmoothingEnabled=true;
  drawTicketText();
  // Preserve only navigation; former remaining-count text and three stone buttons are excluded.
  ctx.save();ctx.scale(K,K);ctx.drawImage(shot,0,904,557,86,0,904,557,86);ctx.restore();
}
function draw(){if(!ready)return;const height=ui.checked?D.stage.uiHeight:D.pages[key].nativeClip?clips.stageMask[1]+clips.stageMask[3]:D.stage.movieHeight;if(canvas.height!==height)canvas.height=height;ctx.clearRect(0,0,1080,canvas.height);ctx.fillStyle='#fff';ctx.fillRect(0,0,1080,canvas.height);
  ctx.fillStyle=ctx.createPattern(footer.quest_bg_panel,'repeat');ctx.fillRect(0,0,1080,canvas.height);
  const p=D.pages[key];if(p.nativeClip){nativeMedia.draw(ctx)}else for(const c of p.frames[frame]){ctx.save();ctx.translate(...D.wrapper);ctx.transform(...c.slice(1,7));ctx.globalAlpha=c[7];ctx.globalCompositeOperation=c[8]===1?'lighter':'source-over';const cell=p.cells[c[0]],asset=D.movieAssets[cell.asset];ctx.drawImage(cells[key][c[0]],-cell.frame[0],-cell.frame[1],asset.width,asset.height);ctx.restore()}
  if(ui.checked){topUI();infoUI();footerUI()}
  if(guides.checked){ctx.fillStyle='#e85d6626';ctx.fillRect(0,0,1080,346);ctx.fillStyle='#ffcf6520';ctx.fillRect(...D.calibration.info);ctx.strokeStyle='#e3ae45';ctx.lineWidth=2;ctx.strokeRect(...D.calibration.info);ctx.fillStyle='#243347';ctx.font='21px Microsoft YaHei';ctx.fillText('顶部轮播遮挡区',15,335);ctx.fillText('角色资料区域',D.calibration.info[0]+10,D.calibration.info[1]+28)}
  const sequence=p.timeline.sequences.find(t=>frame+1>=t.begin&&frame+1<=t.end)?.name||'—';seek.value=frame;document.getElementById('status').textContent='第 '+(frame+1)+' 帧 · '+sequence;canvas.dataset.page=key;canvas.dataset.frame=frame;canvas.dataset.infoAlpha=fade();canvas.dataset.ui=ui.checked?'true':'false';document.getElementById('candidateTitle').textContent=p.label+(p.nativeClip?' · 客户端原生录制':' · 编译资源回放');updateProfile();updateCaptureClock(p);document.getElementById('candidateCaption').textContent=p.nativeClip?'客户端离线原生录制':ui.checked?D.paymentCaption:'纯 Movie：最终编译资源回放，wrapper (-180,60)，保留 alpha 与加色层。';
}
function state(){return{key,frame,seconds,playing,speed,cycles,infoAlpha:fade(),ui:ui.checked,skill:D.pages[key].nativeClip?nativeMedia.state()??null:null}}
function pause(value){playing=!value;button.textContent=playing?'暂停':'继续';last=0;if(D.pages[key].nativeClip){if(value)nativeMedia.pause();else opening.then(()=>{if(playing)return nativeMedia.play(speed)}).catch(reportMediaError)}draw()}
function select(value){if(!D.pages[value])throw Error('Unknown page '+value);key=value;frame=0;seconds=0;acc=0;last=0;seek.max=D.pages[key].frameCount-1;document.getElementById('page').value=key;const loaded=openCapture(D.pages[key].nativeClip);draw();return loaded}
async function go(value){pause(true);const page=D.pages[key],target=Math.max(0,Math.min(page.frameCount-1,value)),active=navigation;await opening;if(active!==navigation)return;if(page.nativeClip){await nativeMedia.seek(page.nativeClip.firstFrame+target);return}frame=target;seconds=frame/60;acc=0;draw()}
async function replay(){if(D.pages[key].nativeClip){const active=navigation;await go(0);if(active!==navigation)return}else{frame=0;seconds=0;acc=0}pause(false)}
function loop(now){const dt=last?Math.min((now-last)/1000,.2):0;last=now;if(playing&&ready&&!D.pages[key].nativeClip){seconds+=dt*speed;acc+=dt*60*speed;while(acc>=1){acc--;frame++;if(frame>=D.pages[key].endBegin-1){frame=0;cycles++;if(continuous.checked){select(keys[(keys.indexOf(key)+1)%keys.length]);break}}}draw()}requestAnimationFrame(loop)}
document.getElementById('page').innerHTML=keys.map(k=>'<option value="'+k+'">'+D.pages[k].label+'</option>').join('');document.getElementById('page').onchange=e=>select(e.target.value);button.onclick=()=>pause(playing);document.getElementById('replay').onclick=replay;document.getElementById('prev').onclick=()=>go(frame-1);document.getElementById('next').onclick=()=>go(frame+1);document.getElementById('speed').onchange=e=>{speed=Number(e.target.value);acc=0;if(playing&&D.pages[key].nativeClip)opening.then(()=>{if(playing)return nativeMedia.play(speed)}).catch(reportMediaError)};seek.oninput=e=>go(Number(e.target.value));ui.onchange=draw;guides.onchange=draw;
document.getElementById('bannerImage').src=D.banner;
const rolePicker=document.getElementById('rolePicker');
for(const {id,name,posterPage} of presentation.characters){
  const choice=document.createElement('button');choice.type='button';choice.textContent=name;choice.dataset.role=id;
  choice.onclick=()=>select(posterPage);rolePicker.append(choice);
}
let displayedProfile;
function updateProfile(){
  if(displayedProfile===key)return;displayedProfile=key;
  const profileId=D.pages[key].characterId??profileIdFor.get(key)??key;const profile=D.profiles[profileId]??D.profiles[key];
  for(const button of rolePicker.children)button.setAttribute('aria-pressed',String(button.dataset.role===profileId));
  document.getElementById('roleName').textContent=profile?profile.title+' · '+profile.name:'精选角色';
  document.getElementById('roleMetadata').textContent=profile?'★5 '+profile.element+'属性 · 队长特性 '+profile.leader:'选择角色查看技能资料与单人海报。';
  document.getElementById('roleSkill').textContent=profile?profile.skillPlus:'';
  document.getElementById('roleDescription').textContent=profile?profile.skillPlusDescription:'';
}
// Canvas counterparts to the preview's accessible page picker.
function stagePageTarget(event) {
  if (!ui.checked) return null;
  const box = canvas.getBoundingClientRect();
  const x = (event.clientX - box.left) * canvas.width / box.width;
  const y = (event.clientY - box.top) * canvas.height / box.height;
  if (y >= 735 && y <= 835) {
    const current = keys.indexOf(key);
    if (x <= 90) return keys[(current + keys.length - 1) % keys.length];
    if (x >= 990) return keys[(current + 1) % keys.length];
  }
  if (y < 1220 || y > 1450) return null;
  const centers = D.calibration.upOrigins;
  const index = centers.findIndex(center => Math.abs(x - center) <= 82);
  return index >= 0 ? (posters.get(String(D.footerOrder[index]))??D.footerOrder[index]) : null;
}
canvas.addEventListener('click', event => {
  const page = stagePageTarget(event);
  if (page) select(page);
});
canvas.addEventListener('pointermove', event => {
  canvas.style.cursor = stagePageTarget(event) ? 'pointer' : '';
});
canvas.addEventListener('pointerleave', () => { canvas.style.cursor = ''; });
window.review={state,select,seek:go,pause,replay,draw,renderAt,pickupPanels,drawTicketText};
(async()=>{await NativeGachaUI.load();shot=await image(D.screenshot);banner=await image(D.banner);for(const [name,uri]of Object.entries(D.ticketButton))ticketUI[name]=await image(uri);for(const [name,uri]of Object.entries(D.footerTextures))footer[name]=await image(uri);maskedBottom=prepareBottom();for(const [k,p]of Object.entries(D.pages)){cells[k]=await Promise.all(p.cells.map(c=>image(D.movieAssets[c.asset].uri)));if(p.infoPanelURI)infoPanels[k]=await image(p.infoPanelURI)}for(const c of Object.values(D.characters))for(const f of c.frames)if(!pixels[f.uri])pixels[f.uri]=await image(f.uri);ready=true;document.documentElement.dataset.ready='true';document.getElementById('ready').textContent='单文件资源已就绪';draw();requestAnimationFrame(loop)})().catch(e=>{document.getElementById('ready').textContent=e.message;throw e});

})().catch(error=>{
document.documentElement.dataset.compactError=error.message;
document.getElementById('ready').textContent=error.message;
throw error;
});