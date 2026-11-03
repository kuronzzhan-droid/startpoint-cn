const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const os = require('node:os')
const ts = require('typescript')
const Database = require('better-sqlite3')
let shuttingDown = false
const filename = path.resolve(__dirname, '../src/lib/battle-receipt-retention.ts')
const mod = new Module(filename, module)
mod.filename = filename
mod.paths = Module._nodeModulePaths(path.dirname(filename))
const originalRequire = mod.require.bind(mod)
mod.require = name => name === './shutdown-state' ? {
    isServerShuttingDown: () => shuttingDown,
    withServerWorkAdmission: action => action(),
} : originalRequire(name)
mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText, filename)
const {runBattleReceiptRetentionPass:run,createBattleReceiptRetentionService:create,BATTLE_RECEIPT_TTL_MS:TTL} = mod.exports
const quiet = {log(){},warn(){}}
function fixture(databasePath=':memory:') {
    const db = new Database(databasePath)
    db.exec(`PRAGMA page_size=4096;
      CREATE TABLE players(id INTEGER PRIMARY KEY); INSERT INTO players VALUES(1);
      CREATE TABLE player_operation_receipts(player_id INTEGER NOT NULL,operation TEXT NOT NULL,request_key TEXT NOT NULL,response_json TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(player_id,operation,request_key));
      CREATE TABLE battle_settlement_ledger(player_id INTEGER NOT NULL,play_id TEXT NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('single','multi','legacy-conflict')),settled_at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(player_id,play_id)) WITHOUT ROWID;
      CREATE TABLE battle_receipt_payload_queue(player_id INTEGER NOT NULL,play_id TEXT NOT NULL,operation TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(player_id,play_id,operation)) WITHOUT ROWID;
      CREATE INDEX idx_battle_receipt_payload_expiry ON battle_receipt_payload_queue(created_at,player_id,play_id,operation);`)
    return db
}
const options = now => ({now:()=>now,pauseMs:0,maxBatches:30,maxPassMs:30_000,batchRows:3,logger:quiet})
const insert = (db,key,operation='quest_finish.single',createdAt=0,json='{"data":"ok"}') => db.prepare('INSERT INTO player_operation_receipts VALUES(1,?,?,?,?)').run(operation,key,json,createdAt)
const count = (db,table) => db.prepare(`SELECT count(*) n FROM ${table}`).get().n
const state = db => db.prepare('SELECT * FROM battle_receipt_retention_state WHERE id=1').get()

test('bounded sparse legacy migration checkpoints, resumes, ignores unrelated operations and never parses corrupt JSON', async () => {
    const db=fixture()
    try {
        insert(db,'mail','mailgacha.draw',0)
        insert(db,'pay','payment.purchase',0)
        insert(db,'bad','quest_finish.single',0,'{corrupt')
        insert(db,'abort','clock_migration.abort',0)
        insert(db,'five','five_boss.finish',0)
        const first=await run(db,{...options(TTL+1),batchRows:2,maxBatches:1})
        assert.equal(first.scannedRows,2)
        assert.equal(first.migratedRows,0)
        assert.equal(state(db).scan_cursor,2)
        assert.equal(state(db).last_completed_at,null)
        const second=await run(db,options(TTL+1))
        assert.equal(second.migratedRows,1)
        assert.equal(second.deletedRows,1)
        assert.equal(count(db,'battle_settlement_ledger'),1)
        assert.equal(count(db,'player_operation_receipts'),4)
        assert.equal(state(db).scan_cursor,5)
        assert.ok(second.caughtUp)
        assert.ok(state(db).last_completed_at)
    } finally {db.close()}
})

test('exact TTL boundary protects younger payload and retains permanent proof after pruning', async () => {
    const db=fixture()
    try {
        insert(db,'young','quest_finish.single',100)
        await run(db,options(TTL+99))
        assert.equal(count(db,'player_operation_receipts'),1)
        const result=await run(db,options(TTL+100))
        assert.equal(result.deletedRows,1)
        assert.equal(result.deletedJsonBytes,13)
        assert.equal(count(db,'battle_settlement_ledger'),1)
        assert.equal(count(db,'battle_receipt_payload_queue'),0)
    } finally {db.close()}
})

test('interrupted migration survives a real connection restart without losing its cursor or retained proofs', async () => {
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'battle-retention-restart-'))
    const databasePath=path.join(directory,'synthetic.db')
    let db=fixture(databasePath)
    try {
        for(let i=0;i<5;i++) insert(db,`restart-${i}`)
        let stopped=false
        const first=await run(db,{...options(TTL+1),batchRows:2,executeTransaction:async(context,action)=>{
            const value=db.transaction(action).immediate()
            if(context.operation==='battle_receipts_batch') stopped=true
            return value
        }},()=>stopped)
        assert.equal(first.stopped,true)
        assert.equal(state(db).scan_cursor,2)
        assert.equal(state(db).last_error,'interrupted')
        assert.equal(state(db).last_completed_at,null)
        db.close()
        db=new Database(databasePath)
        const resumed=await run(db,options(TTL+2))
        assert.equal(resumed.migratedRows,3)
        assert.equal(count(db,'battle_settlement_ledger'),5)
        assert.equal(count(db,'player_operation_receipts'),0)
        assert.equal(state(db).scan_cursor,5)
        assert.equal(state(db).last_error,null)
    } finally {
        db.close()
        assert.equal(path.dirname(fs.realpathSync(directory)),fs.realpathSync(os.tmpdir()))
        fs.rmSync(directory,{recursive:true})
    }
})

test('legacy cross-mode duplicate becomes fail-closed conflict before both payloads expire', async () => {
    const db=fixture()
    try {
        insert(db,'same','quest_finish.single',10)
        insert(db,'same','quest_finish.multi',20)
        const result=await run(db,options(TTL+30))
        assert.equal(result.deletedRows,2)
        assert.equal(db.prepare('SELECT mode FROM battle_settlement_ledger').get().mode,'legacy-conflict')
        assert.equal(count(db,'battle_settlement_ledger'),1)
    } finally {db.close()}
})

test('missing or mismatched proof cannot delete queued payload; guard failure is persisted, not completed', async () => {
    const db=fixture()
    try {
        await run(db,options(TTL+1))
        const completed=state(db).last_completed_at
        insert(db,'guarded','quest_finish.multi',0)
        db.prepare('UPDATE battle_receipt_retention_state SET scan_cursor=999').run()
        db.prepare('INSERT INTO battle_receipt_payload_queue VALUES(1,?,?,0)').run('guarded','quest_finish.multi')
        await assert.rejects(run(db,options(TTL+2)),/guard rejected/)
        assert.equal(count(db,'player_operation_receipts'),1)
        assert.equal(state(db).last_completed_at,completed)
        assert.match(state(db).last_error,/guard rejected/)
        db.prepare("INSERT INTO battle_settlement_ledger VALUES(1,'guarded','single',0,1)").run()
        await assert.rejects(run(db,options(TTL+3)),/guard rejected/)
        assert.equal(count(db,'player_operation_receipts'),1)
        db.prepare("UPDATE battle_settlement_ledger SET mode='legacy-conflict'").run()
        assert.equal((await run(db,options(TTL+4))).deletedRows,1)
    } finally {db.close()}
})

test('delete fault rolls back payload, proof, queue and migration cursor together', async () => {
    const db=fixture()
    try {
        insert(db,'rollback')
        db.exec("CREATE TRIGGER stop_prune BEFORE DELETE ON player_operation_receipts BEGIN SELECT RAISE(ABORT,'injected-delete-failure'); END")
        await assert.rejects(run(db,options(TTL+1)),/injected-delete-failure/)
        assert.equal(count(db,'player_operation_receipts'),1)
        assert.equal(count(db,'battle_settlement_ledger'),0)
        assert.equal(count(db,'battle_receipt_payload_queue'),0)
        assert.equal(state(db).scan_cursor,0)
        assert.equal(state(db).last_completed_at,null)
        assert.equal(state(db).owner_token,null)
        db.exec('DROP TRIGGER stop_prune')
        assert.equal((await run(db,options(TTL+2))).deletedRows,1)
    } finally {db.close()}
})

test('stale queue timestamp cannot prune replaced payload or shorten its own TTL', async () => {
    const db=fixture()
    try {
        insert(db,'replaced')
        await run(db,options(1))
        db.prepare('UPDATE player_operation_receipts SET created_at=?').run(TTL)
        const first=await run(db,options(TTL+1))
        assert.equal(first.deletedRows,0)
        assert.equal(db.prepare('SELECT created_at FROM battle_receipt_payload_queue').get().created_at,TTL)
        assert.equal((await run(db,options(TTL*2))).deletedRows,1)
    } finally {db.close()}
})

test('persisted lease blocks another owner and recovers after a crashed owner expires', async () => {
    const db=fixture()
    try {
        await run(db,options(1))
        insert(db,'late')
        db.prepare("UPDATE battle_receipt_retention_state SET owner_token='crashed',lease_until=?").run(TTL+50)
        assert.equal((await run(db,options(TTL+1))).scannedRows,0)
        assert.equal(count(db,'player_operation_receipts'),1)
        assert.equal((await run(db,options(TTL+51))).deletedRows,1)
    } finally {db.close()}
})

test('service startup is deferred; stop drains accepted owner work and queues no new batch', async () => {
    const db=fixture()
    try {
        let release,entered
        const pending=new Promise(resolve=>{entered=resolve})
        const hold=new Promise(resolve=>{release=resolve})
        let calls=0
        const service=create(db,{...options(1),initialDelayMs:0,intervalMs:1,executeTransaction:async(_context,action)=>{calls++;entered();await hold;return db.transaction(action).immediate()}})
        service.start()
        assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='battle_receipt_retention_state'").get(),undefined)
        await pending
        let stopped=false
        const stopping=service.stop().then(()=>{stopped=true})
        await new Promise(resolve=>setImmediate(resolve))
        assert.equal(stopped,false)
        release()
        await stopping
        await service.drain()
        assert.equal(calls,1)
        assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='battle_receipt_retention_state'").get(),undefined)
    } finally {db.close()}
})

test('continuous writes over three TTLs stabilize payload window while the small permanent ledger keeps growing', async t => {
    const db=fixture()
    try {
        const hour=3_600_000
        for(let h=0;h<80;h++) {
            db.transaction(()=>{
                for(let n=0;n<3;n++) {
                    const key=`play-${h}-${n}`,created=h*hour
                    insert(db,key,'quest_finish.single',created,JSON.stringify({text:'x'.repeat(8700)}))
                    db.prepare('INSERT INTO battle_settlement_ledger VALUES(1,?,?,?,1)').run(key,'single',created)
                    db.prepare('INSERT INTO battle_receipt_payload_queue VALUES(1,?,?,?)').run(key,'quest_finish.single',created)
                }
            })()
            await run(db,{...options(h*hour),batchRows:50})
            assert.ok(count(db,'player_operation_receipts')<=72)
        }
        assert.equal(count(db,'battle_settlement_ledger'),240)
        assert.equal(count(db,'player_operation_receipts'),72)
        assert.equal(count(db,'battle_receipt_payload_queue'),72)
        const bytes=db.prepare("SELECT name,pgsize FROM dbstat('main',1) WHERE name='battle_settlement_ledger'").get().pgsize
        assert.ok(bytes < 240*8700/10)
        t.diagnostic(`synthetic ledger: rows=240 allocatedBytes=${bytes} bytesPerRow=${bytes/240}; payloadWindowRows=72; permanent ledger remains O(total battles), no whole-file size promise`)
    } finally {db.close()}
})
