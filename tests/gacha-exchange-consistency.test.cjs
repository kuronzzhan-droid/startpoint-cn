const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const tempRoot = path.resolve(os.tmpdir());
const isolated = fs.mkdtempSync(path.join(tempRoot,'starpoint-gacha-exchange-'));
process.env.DATA_DIR = isolated;
const Fastify = require('fastify');
const routes = require('../out/routes/api/gacha').default;
const {insertAccountSync} = require('../out/data/domains/account');
const {insertDefaultPlayerSync} = require('../out/data/domains/player');
const {saveAccountDefaultPlayer} = require('../out/data/activeAccount');
const {insertSessionWithToken} = require('../out/data/domains/session');
const {insertPlayerGachaInfoSync,getPlayerGachaInfoSync,updatePlayerGachaInfoSync} = require('../out/data/domains/gacha');
const {getPlayerCharacterSync} = require('../out/data/domains/character');
const {getDb} = require('../out/data/db');
const {pairs} = require('./fixtures/gacha-exchange-20260912.json');

test('兑换资格修复通过实际路由结算，并保留积分和池边界限制',async t=>{
    const app=Fastify({logger:false});
    app.addHook('onSend',(_request,reply,payload,done)=>done(null,
        String(reply.getHeader('content-type')||'').startsWith('application/x-msgpack')&&typeof payload==='object'
            ? JSON.stringify(payload):payload));
    await app.register(routes,{prefix:'/gacha'});
    t.after(async()=>{
        await app.close();getDb().close();
        const target=path.resolve(isolated);
        assert.ok(target.startsWith(tempRoot+path.sep)&&target!==tempRoot);
        fs.rmSync(target,{recursive:true});
    });
    const account=insertAccountSync({appId:'wf_cn',idpAlias:'',idpCode:'leiting',idpId:'',status:'normal'});
    const player=insertDefaultPlayerSync(account.id);
    saveAccountDefaultPlayer(account.id,player.id);
    const viewer=77391201;
    await insertSessionWithToken({token:String(viewer),accountId:account.id,expires:new Date(Date.now()+86400000),type:2});
    function points(gachaId,amount){
        if(getPlayerGachaInfoSync(player.id,gachaId))updatePlayerGachaInfoSync(player.id,{gachaId,gachaExchangePoint:amount});
        else insertPlayerGachaInfoSync(player.id,{gachaId,isAccountFirst:false,isDailyFirst:false,gachaExchangePoint:amount});
    }
    const exchange=(gacha_id,character_id)=>app.inject({method:'POST',url:'/gacha/exchange_character',
        payload:{viewer_id:viewer,gacha_id,character_id,api_count:1}});
    await t.test('原先失败的 432 个卡池—角色关系全部成功，仅扣除 250 积分',async()=>{
        assert.equal(pairs.length,432);
        for(const [gid,cid] of pairs){
            points(gid,500);
            const res=await exchange(gid,cid);
            assert.equal(res.statusCode,200,`${gid}/${cid}: ${res.payload}`);
            assert.equal(getPlayerGachaInfoSync(player.id,gid).gachaExchangePoint,250);
            assert.ok(getPlayerCharacterSync(player.id,cid),`${gid}/${cid} reward absent`);
            assert.equal(res.json().data.gacha_info_list[0].gacha_exchange_point,250);
        }
    });
    await t.test('五星暗龙在两个暗池及既有合法池都能兑换',async()=>{
        for(const gid of [219,1710,170,990002]){
            points(gid,250);const res=await exchange(gid,261089);
            assert.equal(res.statusCode,200,res.payload);
            assert.equal(getPlayerGachaInfoSync(player.id,gid).gachaExchangePoint,0);
        }
    });
    await t.test('积分不足、池外角色、刻意禁兑角色仍拒绝且不扣积分',async()=>{
        for(const [gid,cid,amount,message] of [
            [219,261089,249,'Not enough exchange points.'],
            [1,261089,250,'Character is not exchangeable from this gacha.'],
            [990001,119992,250,'Character is not exchangeable from this gacha.'],
        ]){
            points(gid,amount);
            const before=getPlayerCharacterSync(player.id,cid);
            const res=await exchange(gid,cid);
            assert.equal(res.statusCode,400);assert.equal(res.json().message,message);
            assert.equal(getPlayerGachaInfoSync(player.id,gid).gachaExchangePoint,amount);
            assert.deepEqual(getPlayerCharacterSync(player.id,cid),before);
        }
    });
});
