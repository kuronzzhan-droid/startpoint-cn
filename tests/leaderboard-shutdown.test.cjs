const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { Worker } = require('node:worker_threads')
const { setImmediate: nextTurn } = require('node:timers/promises')
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'leaderboard-shutdown-'))
process.env.GACHA_SEED_DIR = path.join(process.env.DATA_DIR, 'seeds')
process.env.CN_WRITER_THREAD = '0'
const db = require('../out/data/db').getDb()
const background = require('../out/lib/leaderboard/background-worker')
const settlement = require('../out/lib/leaderboard/settlement')
const competition = require('../out/lib/leaderboard/competition')
const availability = require('../out/lib/leaderboard/availability')
const coordinator = require('../out/lib/persistence-coordinator')
const { persistenceWriteGate } = require('../out/lib/persistence-write-gate')
const key = 'rush:700099:1', second = 'rush:700100:1'
const account = require('../out/data/domains/account').insertAccountSync({
    appId: 'wf_cn', idpAlias: '', idpCode: 'human', idpId: '', status: 'normal' })
const owner = require('../out/data/domains/player').insertDefaultPlayerSync(account.id).id
const columns = db.prepare('PRAGMA table_info(players)').all().filter(row => row.name !== 'id').map(row => '"' + row.name + '"').join(',')
const clone = db.prepare(`INSERT INTO players(${columns}) SELECT ${columns} FROM players WHERE id=?`)
const ids = db.transaction(() => Array.from({ length: 300 }, () => Number(clone.run(owner).lastInsertRowid)))()
const initial = new Map()
for (const k of [key, second]) {
    competition.getLeaderboardCompetitionSeasonSync(k); availability.getLeaderboardAvailabilitySync(k)
    initial.set(k, settlement.getLeaderboardSettlementConfigSync(k))
}
const run = db.prepare(`INSERT INTO leaderboard_runs(competition_key,player_id,season,status,started_at_ms,finished_at_ms,
    client_battle_ms,rounds_cleared,total_rounds,tracked_from_round) VALUES(?,?,1,'completed',1,2,?,1,1,1)`)
const round = db.prepare(`INSERT INTO leaderboard_run_rounds(run_id,round_number,quest_id,client_battle_ms,server_elapsed_ms,started_at_ms,finished_at_ms)
    VALUES(?,1,1,100,100,1,2)`)
const snapshot = () => Object.fromEntries(['leaderboard_seasons','leaderboard_runs','leaderboard_run_rounds',
    'leaderboard_availability','leaderboard_settlement_configs','leaderboard_settlements','leaderboard_settlement_results','players_mails']
    .map(table => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()]))
const awards = () => Object.fromEntries(['leaderboard_settlements','leaderboard_settlement_results','players_mails']
    .map(table => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()]))
const config = k => db.prepare('SELECT * FROM leaderboard_settlement_configs WHERE competition_key=?').get(k)
const job = (scheduled = false, nowMs = Date.now()) => ({ competitionKey: key, source: 'shutdown-test', nowMs, scheduled })
function reset() {
    db.transaction(() => {
        for (const table of ['leaderboard_settlement_results','leaderboard_settlements','leaderboard_run_rounds','leaderboard_runs','players_mails']) db.exec('DELETE FROM ' + table)
        for (const k of [key,second]) {
            settlement.putLeaderboardSettlementConfigSync({ ...initial.get(k), autoEnabled: false, freezeEnabled: false,
                settleAtMs: null, repeatIntervalMs: null, rewardTiers: [{ fromRank: 1, toRank: null,
                    itemId: 10000145, itemName: 'fixture item', itemCount: 7, degreeId: null, degreeName: null }] })
            availability.setLeaderboardAvailabilitySync(k,true)
        }
        for (let i=0;i<ids.length;i++) round.run(Number(run.run(key,ids[i],100+i).lastInsertRowid))
    })()
}
function due(k, now, repeat = null) {
    settlement.putLeaderboardSettlementConfigSync({ ...settlement.getLeaderboardSettlementConfigSync(k),
        autoEnabled: true, freezeEnabled: true, settleAtMs: now-1, repeatIntervalMs: repeat, updatedAtMs: now-2 })
    // Deadline freeze is independent of settlement. Capture its durable state
    // before comparing rollback of the worker-owned transaction.
    availability.getLeaderboardAvailabilitySync(k, now)
}
function checkAwards(total = 300) {
    assert.equal(db.prepare('SELECT count(*) n FROM players_mails').get().n,total)
    assert.equal(db.prepare('SELECT count(*) n FROM leaderboard_settlement_results').get().n,total)
    const row = db.prepare(`SELECT count(*) n,count(DISTINCT m.id) uniqueMails,
        sum(CASE WHEN m.id IS NULL OR m.player_id<>r.player_id OR m.type<>1 OR m.type_id<>10000145 OR m.number<>7 THEN 1 ELSE 0 END) invalid
        FROM leaderboard_settlement_results r,json_each(r.mail_ids_json) j LEFT JOIN players_mails m ON m.id=CAST(j.value AS INTEGER)`).get()
    assert.deepEqual(row,{ n:total, uniqueMails:total, invalid:0 })
    assert.equal(db.pragma('quick_check',{ simple:true }),'ok')
}
function fixtureWorker(file, options, mode, signal = () => {}) {
    const connectionFile = path.resolve(__dirname,'../out/lib/persistence/writer-connection.js')
    const settlementFile = path.resolve(__dirname,'../out/lib/leaderboard/settlement.js')
    const worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads');
        const mode=workerData.fixtureMode, connection=require(${JSON.stringify(connectionFile)}),open=connection.openWriterConnection;
        if(mode==='before-begin')Atomics.store(new Int32Array(workerData.cancelBuffer),0,1);
        connection.openWriterConnection=options=>{const db=open(options),exec=db.exec.bind(db),prepare=db.prepare.bind(db);
            db.exec=sql=>{if(/^BEGIN IMMEDIATE$/i.test(sql))parentPort.postMessage({type:'fixture-begin'});
                const result=exec(sql);if(mode==='after-commit'&&/^COMMIT$/i.test(sql))Atomics.store(new Int32Array(workerData.cancelBuffer),0,1);return result;};
            db.prepare=sql=>{const statement=prepare(sql);if(mode==='partial'&&/INSERT\\s+INTO\\s+leaderboard_settlement_results/i.test(sql)){
                const run=statement.run.bind(statement);statement.run=(...args)=>{const result=run(...args);if(args[1]===258){
                    parentPort.postMessage({type:'fixture-partial'});Atomics.wait(new Int32Array(workerData.fixtureBarrier),0,0);}return result;};}return statement;};return db;};
        if(mode.startsWith('before-commit')){const settlement=require(${JSON.stringify(settlementFile)}),run=settlement.runLeaderboardSettlementWorkerSync;
            settlement.runLeaderboardSettlementWorkerSync=input=>{const result=run(input);Atomics.store(new Int32Array(workerData.cancelBuffer),0,1);return result;};}
        if(mode==='after-commit'||mode==='before-commit-lost-reply'){const send=parentPort.postMessage.bind(parentPort);parentPort.postMessage=message=>{if(message.type!=='result')send(message);};}
        require(${JSON.stringify(file)});`,{ ...options,eval:true,workerData:{ ...options.workerData,fixtureMode:mode,
            fixtureBarrier:options.workerData.fixtureBarrier } })
    worker.on('message',signal)
    return worker
}
after(async () => { await coordinator.drainPersistence(); assert.deepEqual(persistenceWriteGate.stats(),
    {activeWrites:0,exclusive:false,waiting:0}); db.close() })

test('expectedSeason validates HTTP input and rejects a changed season without persistent effects', async t => {
    reset()
    const app = require('fastify')({logger:false})
    await app.register(require('../out/routes/web_api/leaderboards').default,{prefix:'/leaderboards'})
    await app.ready(); t.after(()=>app.close())
    const url='/leaderboards/'+encodeURIComponent(key)+'/settle', before=snapshot()
    for (const value of [0,-1,1.5,'1',null,Number.MAX_SAFE_INTEGER+1]) {
        const response=await app.inject({method:'POST',url,payload:{expectedSeason:value}})
        assert.equal(response.statusCode,400,response.body)
    }
    const mismatch=await app.inject({method:'POST',url,payload:{expectedSeason:2}})
    assert.equal(mismatch.statusCode,409,mismatch.body); assert.equal(mismatch.json().code,'LEADERBOARD_SEASON_MISMATCH')
    assert.deepEqual(snapshot(),before)
    const outcome=await background.runLeaderboardSettlementInBackground({...job(),expectedSeason:1})
    assert.equal(outcome.season,1); checkAwards()
})

test('worker cancellation before BEGIN has an explicit code and does not issue rewards', async () => {
    reset(); const before=snapshot(); let began=false
    await assert.rejects(background.runLeaderboardSettlementInBackground(job(),{createWorker:(file,opts)=>
        fixtureWorker(file,opts,'before-begin',m=>{if(m.type==='fixture-begin')began=true})}),e=>e.code==='LEADERBOARD_CANCELLED')
    assert.equal(began,false); assert.deepEqual(snapshot(),before)
})

test('cooperative cancellation after 258 rank writes rolls back every mail/result and permits retry', async () => {
    reset(); const before=snapshot(), barrier=new SharedArrayBuffer(4); let paused, cancelBuffer
    const signal=new Promise(resolve=>{paused=resolve})
    const pending=background.runLeaderboardSettlementInBackground(job(),{createWorker:(file,opts)=>{
        cancelBuffer=opts.workerData.cancelBuffer
        return fixtureWorker(file,{...opts,workerData:{...opts.workerData,fixtureBarrier:barrier}},'partial',m=>{if(m.type==='fixture-partial')paused()})
    }})
    const rejected=assert.rejects(pending,e=>e.code==='LEADERBOARD_CANCELLED')
    await signal; assert.deepEqual(awards(),beforeEntries(before))
    Atomics.store(new Int32Array(cancelBuffer),0,1); Atomics.store(new Int32Array(barrier),0,1); Atomics.notify(new Int32Array(barrier),0)
    await rejected; assert.deepEqual(snapshot(),before)
    await background.runLeaderboardSettlementInBackground(job()); checkAwards()
})
function beforeEntries(s) { return Object.fromEntries(Object.keys(awards()).map(k=>[k,s[k]])) }

test('cancellation after the real algorithm returns but before COMMIT rolls back the automatic plan', async () => {
    reset(); const now=Date.now(); due(key,now); const before=snapshot()
    await assert.rejects(background.runLeaderboardSettlementInBackground(job(true,now),{
        createWorker:(file,opts)=>fixtureWorker(file,opts,'before-commit')}),e=>e.code==='LEADERBOARD_CANCELLED')
    assert.deepEqual(snapshot(),before)
    await background.runLeaderboardSettlementInBackground(job(true,now)); checkAwards()
    assert.equal(config(key).auto_enabled,0)
})

test('cancellation racing a completed COMMIT plus a lost reply recovers exact one-shot and repeated plans', async () => {
    for (const repeat of [null,60_000]) {
        reset(); const now=Date.now(); due(key,now,repeat)
        const outcome=await background.runLeaderboardSettlementInBackground(job(true,now),{
            createWorker:(file,opts)=>fixtureWorker(file,opts,'after-commit')})
        assert.equal(outcome.reason,'already-settled'); checkAwards()
        assert.equal(config(key).updated_at_ms,now)
        assert.equal(config(key).settle_at_ms,repeat===null?null:now-1+repeat)
        assert.equal(config(key).auto_enabled,Number(repeat!==null))
        assert.equal(config(key).freeze_enabled,Number(repeat!==null))
        const committed=awards(); await background.runLeaderboardSettlementInBackground(job(false,now))
        assert.deepEqual(awards(),committed)
    }
})

test('an old completed receipt cannot hide cancellation of this automatic plan update with or without its reply', async () => {
    reset(); const now=Date.now(); await background.runLeaderboardSettlementInBackground(job(false,now))
    due(key,now); const before=snapshot()
    for (const mode of ['before-commit','before-commit-lost-reply']) {
        await assert.rejects(background.runLeaderboardSettlementInBackground(job(true,now),{
            createWorker:(file,opts)=>fixtureWorker(file,opts,mode)}),e=>e.code==='LEADERBOARD_CANCELLED')
        assert.deepEqual(snapshot(),before)
    }
    await background.runLeaderboardSettlementInBackground(job(true,now)); checkAwards()
})

test('scheduler stop finishes its accepted first job, leaves a second nonempty board due and restart catches up', async () => {
    reset(); const now=Date.now(); due(key,now); due(second,now)
    db.transaction(()=>ids.slice(0,3).forEach((id,i)=>round.run(Number(run.run(second,id,100+i).lastInsertRowid))))()
    const secondPlan=config(second), barrier=new SharedArrayBuffer(4); let paused, stopped=false, workers=0
    const signal=new Promise(resolve=>{paused=resolve}), original=background.runLeaderboardSettlementInBackground
    background.runLeaderboardSettlementInBackground=j=>original(j,{createWorker:(file,opts)=>{
        workers++; return fixtureWorker(file,{...opts,workerData:{...opts.workerData,fixtureBarrier:barrier}},'partial',m=>{if(m.type==='fixture-partial')paused()})
    }})
    const scheduler=settlement.createLeaderboardSettlementScheduler()
    try {
        scheduler.start(); await signal
        const stopping=scheduler.stop().then(()=>{stopped=true})
        await nextTurn(); assert.equal(stopped,false)
        Atomics.store(new Int32Array(barrier),0,1); Atomics.notify(new Int32Array(barrier),0)
        await stopping; assert.equal(workers,1)
        assert.deepEqual(config(second),secondPlan); assert.equal(config(key).auto_enabled,0)
        checkAwards(300)
        const restart=settlement.createLeaderboardSettlementScheduler(); restart.start()
        const limit=Date.now()+10_000
        while(config(second).auto_enabled!==0&&Date.now()<limit)await nextTurn()
        await restart.stop(); assert.equal(config(second).auto_enabled,0); assert.equal(workers,2); checkAwards(303)
    } finally { Atomics.store(new Int32Array(barrier),0,1); Atomics.notify(new Int32Array(barrier),0)
        await scheduler.stop(); background.runLeaderboardSettlementInBackground=original }
})

// Sticky process shutdown is last: production intentionally has no reset switch.
test('sticky shutdown cancels a queued job before initialization BEGIN and force termination keeps ownership until exit', async () => {
    reset(); const before=snapshot(), barrier=new SharedArrayBuffer(4); let paused, secondCreated=false
    const signal=new Promise(resolve=>{paused=resolve})
    const first=background.runLeaderboardSettlementInBackground(job(),{createWorker:(file,opts)=>
        fixtureWorker(file,{...opts,workerData:{...opts.workerData,fixtureBarrier:barrier}},'partial',m=>{if(m.type==='fixture-partial')paused()})})
    const rejectedFirst=assert.rejects(first,e=>e.code==='LEADERBOARD_CANCELLED')
    await signal
    const queued=background.runLeaderboardSettlementInBackground(job(),{createWorker:()=>{secondCreated=true;assert.fail('cancelled queued worker started')}})
    const rejectedQueued=assert.rejects(queued,e=>e.code==='LEADERBOARD_CANCELLED')
    // better-sqlite3's transaction helper executes cached BEGIN statements,
    // rather than db.exec. Observe the actual preparation-helper entry.
    let initializationPrepared=false; const transaction=db.transaction.bind(db)
    db.transaction=(...args)=>{initializationPrepared=true;return transaction(...args)}
    try {
        background.cancelActiveLeaderboardSettlements('shutdown fixture cancellation')
        const terminating=background.terminateActiveLeaderboardSettlements()
        assert.equal(persistenceWriteGate.stats().exclusive,true)
        await terminating; await Promise.all([rejectedFirst,rejectedQueued])
        assert.equal(secondCreated,false); assert.equal(initializationPrepared,false)
        assert.deepEqual(snapshot(),before)
        assert.deepEqual(persistenceWriteGate.stats(),{activeWrites:0,exclusive:false,waiting:0})
        await assert.rejects(background.runLeaderboardSettlementInBackground(job()),e=>e.code==='LEADERBOARD_CANCELLED')
    } finally { db.transaction=transaction }
})
