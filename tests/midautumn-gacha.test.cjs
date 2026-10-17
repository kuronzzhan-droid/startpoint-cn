const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'midautumn-gacha-'));
process.env.DATA_DIR = path.join(directory, 'database');
process.env.GACHA_SEED_DIR = path.join(directory, 'seeds');
process.env.GAME_VERBOSE_LOGS = 'false';
fs.mkdirSync(process.env.GACHA_SEED_DIR);
const { pack, unpack } = require('msgpackr');
const { getDb } = require('../out/data/db');
const players = require('../out/data/domains/player');
const items = require('../out/data/domains/item');
const gachaState = require('../out/data/domains/gacha');
const assets = require('../out/lib/assets');
const draws = require('../out/lib/gacha');
const utils = require('../out/utils');
const snapshots = require('../out/data/snapshots/player-snapshot');
const { serverGachas, serverItemIds } = require('../out/lib/content-master');
const seed = require('../out/lib/seed-validator').default;
const MODS = [119992,119990,169988,169991,149987,159995,119991,139992,139991,149986,139990,159994];
const GID = 990003, IID = 999019;
const db = getDb();
const app = require('fastify')({ logger: false });
app.addHook('onSend', (_request, reply, body, done) => done(null,
    String(reply.getHeader('content-type')).startsWith('application/x-msgpack') ? pack(body).toString('base64') : body));
test.before(async () => {
    await app.register(require('@fastify/multipart'));
    await app.register(require('../out/routes/api/gacha').default, { prefix: '/gacha' });
    await app.register(require('../out/routes/web_api/player').default, { prefix: '/player' });
});
test.after(async () => {
    await app.close(); await seed.close(); db.close();
    assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(os.tmpdir()));
    fs.rmSync(directory, { recursive: true });
});
let serial = 0;
async function player() {
    const account = require('../out/data/domains/account').insertAccountSync({ appId:'wf_cn',idpAlias:'',idpCode:'test',idpId:`moon-${++serial}`,status:'normal' });
    const id = players.insertDefaultPlayerSync(account.id).id;
    players.updatePlayerSync({ id, vmoney:10000, freeVmoney:10000 });
    require('../out/data/activeAccount').saveAccountDefaultPlayer(account.id,id);
    const viewer = 791000000+id;
    await require('../out/data/domains/session').insertSessionWithToken({ token:String(viewer), accountId:account.id, expires:new Date('2099-01-01'),type:2 });
    return {id,viewer,account:account.id};
}
const exec = (p,payment=3,type=4,count=1,gid=GID,now=Date.parse('2024-12-31T12:00:00+08:00')) => {
    const originalOffset=utils.getTimeOffset();utils.setServerTimeOffset(now-Date.now());
    return app.inject({ method:'POST', url:'/gacha/exec', payload:{viewer_id:p.viewer,gacha_id:gid,payment_type:payment,type,number_of_exec:count} })
        .finally(()=>{utils.setServerTimeOffset(originalOffset);});
};
function data(response) { assert.equal(response.statusCode,200,response.body);return unpack(Buffer.from(response.body,'base64')).data; }
const state = id => snapshots.createPlayerSaveSnapshotV2Sync(id).data.tables;
function points(id,value) {
    if (!gachaState.getPlayerGachaInfoSync(id,GID)) gachaState.insertPlayerGachaInfoSync(id,{gachaId:GID,isDailyFirst:true,isAccountFirst:true,gachaExchangePoint:value});
    else gachaState.updatePlayerGachaInfoSync(id,{gachaId:GID,gachaExchangePoint:value});
}
const exchange = (p,id) => app.inject({method:'POST',url:'/gacha/exchange_character',payload:{viewer_id:p.viewer,gacha_id:GID,character_id:id}});

test('winning runtime accessor has exactly twelve equal MOD pickups and the native permanent donor', () => {
    const g = assets.getGachaSync(GID);
    assert.strictEqual(g,serverGachas[GID]);
    assert.deepEqual(g,require('../assets/gacha_midautumn_2026.json')[GID]);
    assert.ok(serverItemIds.includes(IID));
    assert.equal(g.pageKind,4);assert.equal(g.tenTicketItemId,IID);assert.equal(g.onceTicketItemId,undefined);
    assert.equal(g.wildcardTicketAvailable,false);
    assert.deepEqual(g.rankRates,{normal:[50,350,600],multiGuarantee:[50,950]});
    const five=g.pool['1'], mod=five.filter(x=>x.isLimited), total=five.reduce((n,e)=>n+e.odds,0);
    assert.deepEqual(mod.map(x=>x.id),MODS);
    for (const e of mod) assert.equal(e.odds*1200*5,total*100);
    assert.deepEqual(Object.values(g.pool).flat().filter(x=>x.isExchangeable).map(x=>x.id),MODS);
    for (const bucket of ['1','2','3']) assert.deepEqual(g.pool[bucket].filter(x=>!x.isLimited).map(x=>x.id),assets.getGachaSync(1675).pool[bucket].map(x=>x.id));
    assert.equal(g.startDate,'2020-12-31 12:00:00');assert.equal(g.endDate,'2025-01-01 00:00:00');
    assert.equal(g.enforceAvailabilityWindow,true);
});

test('Orochi shop removes mooncakes and keeps the other three exchange items permanent', () => {
    const shop=require('../assets/boss_coin_shop.json');
    const categoryMap=require('../assets/boss_coin_shop_item_category_map.json');
    const cdnShop=require('../assets/cdndata/boss_coin_shop.json');
    assert.equal(shop['20']['202045'],undefined);assert.equal(categoryMap['202045'],undefined);assert.equal(cdnShop['202045'],undefined);
    for(const id of ['202046','202047','202048']) {
        assert.equal(shop['20'][id].availableUntil,null);
        assert.equal(cdnShop[id][0][26],'(None)');
    }
    assert.equal(require('../assets/cdndata/gacha.json')['990003'][0][30],'2025-01-01 00:00:00');
});

test('the closed gacha rejects direct draws after the end time without changing player state', async () => {
    const p=await player();items.setPlayerItemSync(p.id,IID,2);const before=state(p.id);
    const response=await exec(p,3,4,1,GID,Date.parse('2025-01-02T00:00:00+08:00'));
    assert.equal(response.statusCode,400);
    assert.equal(response.json().message,'Gacha is not available.');
    assert.deepEqual(state(p.id),before);
});

test('the virtual global clock includes both window boundaries and rejects adjacent seconds', async () => {
    const p=await player();items.setPlayerItemSync(p.id,IID,3);
    const start=Date.parse('2020-12-31T12:00:00+08:00'),end=Date.parse('2025-01-01T00:00:00+08:00');
    for(const now of [start-1000,end+1000]) {
        const before=state(p.id),response=await exec(p,3,4,1,GID,now);
        assert.equal(response.statusCode,400);assert.equal(response.json().message,'Gacha is not available.');
        assert.deepEqual(state(p.id),before);
    }
    for(const now of [start,end]) assert.equal(data(await exec(p,3,4,1,GID,now)).draw.length,10);
    assert.equal(items.getPlayerItemSync(p.id,IID),1);
});

test('a nonzero global offset opens the historical window without replacing the real clock and is restored', async () => {
    const p=await player();items.setPlayerItemSync(p.id,IID,1);
    const originalNow=Date.now,originalOffset=utils.getTimeOffset();
    try {
        utils.setServerTimeOffset(123456);
        const result=data(await exec(p));
        assert.equal(result.draw.length,10);
        assert.equal(utils.getTimeOffset(),123456);
        assert.strictEqual(Date.now,originalNow);
    } finally {utils.setServerTimeOffset(originalOffset);}
});

test('gacha availability follows the global clock despite a conflicting legacy player offset', async () => {
    const p=await player();items.setPlayerItemSync(p.id,IID,2);
    const open=Date.parse('2024-12-31T12:00:00+08:00'),closed=Date.parse('2025-01-02T00:00:00+08:00');
    players.updatePlayerSync({id:p.id,timeOffset:closed-Date.now()});
    assert.equal(data(await exec(p,3,4,1,GID,open)).draw.length,10);
    players.updatePlayerSync({id:p.id,timeOffset:open-Date.now()});
    const before=state(p.id),response=await exec(p,3,4,1,GID,closed);
    assert.equal(response.statusCode,400);assert.equal(response.json().message,'Gacha is not available.');
    assert.deepEqual(state(p.id),before);
});

test('all one-thousand rank rolls match 5/35/60 and the tenth slot matches 5/95', () => {
    const g=assets.getGachaSync(GID), normal={3:0,4:0,5:0}, guaranteed={3:0,4:0,5:0};
    const original=crypto.randomInt;
    try {
        for(let roll=1;roll<=1000;roll++) {
            let call=0;crypto.randomInt=()=>((call++%2)===0?roll:1);
            const values=draws.drawGachaWithMetadataSync(g,10);
            normal[values[0].rank]++;guaranteed[values[9].rank]++;
            assert.equal(values[9].isGuarantee,true);
        }
    } finally {crypto.randomInt=original;}
    assert.deepEqual(normal,{3:600,4:350,5:50});assert.deepEqual(guaranteed,{3:0,4:950,5:50});
});

test('every five-star weight roll gives MODs one fifth of five-stars in normal and guaranteed slots', () => {
    const g=assets.getGachaSync(GID), total=g.pool['1'].reduce((n,e)=>n+e.odds,0);
    const counts=[new Map(),new Map()],original=crypto.randomInt;
    try {
        for(let roll=1;roll<=total;roll++) {
            let call=0;crypto.randomInt=()=>((call++%2)===0?1:roll);
            const values=draws.drawGachaWithMetadataSync(g,10);
            for(const [i,draw] of [values[0],values[9]].entries()) counts[i].set(draw.id,(counts[i].get(draw.id)||0)+1);
        }
    } finally {crypto.randomInt=original;}
    for(const result of counts) {
        assert.equal(MODS.reduce((n,id)=>n+(result.get(id)||0),0)*5,total);
        for(const id of MODS) assert.equal(result.get(id)*1200*5,total*100);
    }
});

test('one mooncake deducts one item, grants ten characters and ten points through the HTTP handler', async () => {
    const p=await player();items.setPlayerItemSync(p.id,IID,2);
    const money=players.getPlayerSync(p.id),result=data(await exec(p));
    assert.equal(result.draw.length,10);assert.equal(items.getPlayerItemSync(p.id,IID),1);
    assert.equal(result.item_list[IID],1);assert.equal(gachaState.getPlayerGachaInfoSync(p.id,GID).gachaExchangePoint,10);
    assert.equal(players.getPlayerSync(p.id).freeVmoney,money.freeVmoney);assert.equal(players.getPlayerSync(p.id).vmoney,money.vmoney);
});

test('missing mooncakes, single draws, other tickets and premium currency cannot consume anything', async () => {
    const p=await player();
    for(const id of [999001,999003,999013,999014,999017,999018])items.setPlayerItemSync(p.id,id,9);
    const before=state(p.id);
    for(const [payment,type] of [[3,4],[3,3],[3,9],[3,10],[1,1],[1,2],[2,2],[4,8]]) {
        assert.equal((await exec(p,payment,type)).statusCode,400);
        assert.deepEqual(state(p.id),before);
    }
});

test('twenty-five mooncakes yield 250 points and one of the twelve MODs can be exchanged', async () => {
    const p=await player();items.setPlayerItemSync(p.id,IID,25);
    const drawsMade=[];for(const count of [10,10,5])drawsMade.push(...data(await exec(p,3,4,count)).draw);
    assert.equal(drawsMade.length,250);
    assert.equal(items.getPlayerItemSync(p.id,IID),0);
    assert.equal(gachaState.getPlayerGachaInfoSync(p.id,GID).gachaExchangePoint,250);
    assert.equal((await exchange(p,MODS[0])).statusCode,200);
    assert.equal(gachaState.getPlayerGachaInfoSync(p.id,GID).gachaExchangePoint,0);
    for(const id of MODS.slice(1)) {points(p.id,250);assert.equal((await exchange(p,id)).statusCode,200);}
    points(p.id,249);let before=state(p.id);assert.equal((await exchange(p,MODS[0])).statusCode,400);assert.deepEqual(state(p.id),before);
    points(p.id,250);before=state(p.id);
    assert.equal((await exchange(p,assets.getGachaSync(1675).pool['1'][0].id)).statusCode,400);assert.deepEqual(state(p.id),before);
});

test('a failed settlement rolls back mooncakes, rewards, history and exchange points', async () => {
    const p=await player();items.setPlayerItemSync(p.id,IID,1);const before=state(p.id);
    const mail=require('../out/data/domains/mail'), original=mail.insertReceiveHistorySync;
    try {mail.insertReceiveHistorySync=()=>{throw new Error('holiday settlement test failure');};assert.equal((await exec(p)).statusCode,500);}
    finally {mail.insertReceiveHistorySync=original;}
    assert.deepEqual(state(p.id),before);
});

test('V2 HTTP save import/export and automatic rollback backups retain mooncakes and pool points', async () => {
    const source=await player(), target=await player();
    items.setPlayerItemSync(source.id,IID,23);points(source.id,170);
    const exported=await app.inject({url:`/player/save?id=${source.id}`});assert.equal(exported.statusCode,200);
    const v2=exported.json();snapshots.validatePlayerSaveSnapshotV2Sync(v2);
    for(const payload of [v2]) {
        items.setPlayerItemSync(target.id,IID,7);points(target.id,80);const before=state(target.id);
        const boundary='holiday-save-boundary';
        const body=`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="save.json"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(payload)}\r\n--${boundary}--\r\n`;
        const response=await app.inject({method:'POST',url:`/player/save?id=${target.id}`,headers:{accept:'application/json','content-type':`multipart/form-data; boundary=${boundary}`},payload:body});
        assert.equal(response.statusCode,200,response.body);
        const folder=path.basename(response.json().backup.replaceAll('\\','/'));
        const backup=JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR,'admin-backups',folder,'player-save.json'),'utf8'));
        assert.deepEqual(backup.data.tables,before);
        assert.equal(items.getPlayerItemSync(target.id,IID),23);assert.equal(gachaState.getPlayerGachaInfoSync(target.id,GID).gachaExchangePoint,170);
        assert.equal(db.prepare('SELECT account_id FROM players WHERE id=?').get(target.id).account_id,target.account);
        assert.equal((await app.inject({url:`/player/save?id=${target.id}`})).statusCode,200);
    }
    assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(db.pragma('foreign_key_check'),[]);
});
