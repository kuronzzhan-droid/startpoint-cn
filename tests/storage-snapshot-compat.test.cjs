require('ts-node/register/transpile-only')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const os=require('node:os')
const {spawnSync}=require('node:child_process')
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sp-storage-save-'))
process.env.DATA_DIR=dir
let db
try {
    db=require('../src/data/db').getDb()
    const {insertAccountSync}=require('../src/data/domains/account')
    const {insertDefaultPlayerSync}=require('../src/data/domains/player')
    const saves=require('../src/data/snapshots/player-snapshot')
    const counters=require('../src/lib/mission/counters')
    const {migrateStorageLayout}=require('../src/lib/storage-layout')
    const makePlayer=label=>insertDefaultPlayerSync(insertAccountSync({appId:'wf_cn',idpAlias:'',idpCode:'storage-test',idpId:label,status:'normal'}).id)
    const player=makePlayer('source')
    const target=makePlayer('target')
    db.prepare("INSERT INTO battle_settlement_ledger VALUES(?,?,'multi',123456789,1)").run(target.id,'target-settlement')
    db.prepare("INSERT INTO battle_receipt_payload_queue VALUES(?,?,'quest_finish.multi',123456789)").run(target.id,'target-settlement')
    const ledgerTables=['battle_settlement_ledger','battle_receipt_payload_queue']
    const ledgerState=()=>Object.fromEntries(ledgerTables.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all()]))
    const guardsBefore=ledgerState()
    const query={dimension:'battle.quest_clear',scopeType:'lifetime',scopeKey:'all',qualifier:{questCategory:2,questId:1020003,mode:'any'}}
    counters.addMissionCounterSync(player.id,query,12)
    counters.snapshotAllMissionCountersSync(player.id,'daily')
    const old=saves.createPlayerSaveSnapshotV2Sync(player.id,db)
    assert.equal(old.data.tables.players_mission_counter_snapshots.rows.length,1)
    const schemaVersionBefore=db.pragma('schema_version',{simple:true})
    migrateStorageLayout(db)
    assert.ok(db.pragma('schema_version',{simple:true})>schemaVersionBefore)
    assert.equal(saves.validatePlayerSaveSnapshotV2Sync(old,db),old)
    const result=saves.restorePlayerSaveSnapshotV2Sync(old,target.id,{},db)
    assert.ok(result.skippedTables.includes('players_mission_counter_snapshots'))
    assert.equal(counters.getMissionCounterValueSync(target.id,query),12)
    assert.deepEqual(ledgerState(),guardsBefore,'V2 must retain target guard and queued payload policy')
    assert.equal(counters.addMissionCounterSync(target.id,query,3),15)
    const next=saves.createPlayerSaveSnapshotV2Sync(player.id,db)
    assert.equal(next.schemaFingerprint,old.schemaFingerprint)
    for(const name of saves.PLAYER_SNAPSHOT_V2_TABLES) {
        if(name==='players_mission_counter_snapshots')assert.equal(next.data.tables[name].rows.length,0)
        else assert.deepEqual(next.data.tables[name],old.data.tables[name],name)
    }
    const third=makePlayer('after-migration')
    saves.restorePlayerSaveSnapshotV2Sync(next,third.id,{},db)
    assert.equal(counters.getMissionCounterValueSync(third.id,query),12)
    assert.throws(()=>counters.snapshotAllMissionCountersSync(player.id,'daily'),/退役/)
    const init=require('../src/data/initializers/wdfpData').default
    init(db,true)
    assert.equal(db.prepare("SELECT type FROM sqlite_master WHERE name='players_mission_counters'").get().type,'view')
    assert.equal(db.pragma('integrity_check',{simple:true}),'ok')
    assert.deepEqual(db.pragma('foreign_key_check'),[])
    const merged=require('../src/data/utils/player-data').getMergedPlayerDataSync(target.id)
    require('../src/data/domains/player').replacePlayerDataSync(merged)
    assert.deepEqual(ledgerState(),guardsBefore,'V1 replacement must restore guard before its FK-dependent queue')
    db.exec(`CREATE TRIGGER fail_preserved_battle_queue BEFORE INSERT ON battle_receipt_payload_queue
        BEGIN SELECT RAISE(ABORT,'preserved queue fixture'); END`)
    assert.throws(()=>require('../src/data/domains/player').replacePlayerDataSync(
        require('../src/data/utils/player-data').getMergedPlayerDataSync(target.id)),/preserved queue fixture/)
    assert.deepEqual(ledgerState(),guardsBefore,'failed replacement must roll back the player cascade and both ledger tables')
    db.exec('DROP TRIGGER fail_preserved_battle_queue')
    assert.deepEqual(db.pragma('foreign_key_check'),[])
    const child=spawnSync(process.execPath,['-r','ts-node/register/transpile-only','-e',`
        const db=require('./src/data/db').getDb();
        const api=require('./src/data/snapshots/player-snapshot');
        const layout=require('./src/lib/storage-layout');
        require('node:assert/strict').equal(layout.isCompactStorage(db),true);
        require('node:assert/strict').equal(api.createPlayerSaveSnapshotV2Sync(${player.id},db).schemaFingerprint,${JSON.stringify(old.schemaFingerprint)});
        db.close();
    `],{cwd:path.resolve(__dirname,'..'),env:{...process.env},encoding:'utf8',timeout:30000})
    assert.equal(child.status,0,child.stdout+child.stderr)
    console.log('storage V2 archive compatibility, startup, and fresh-process persistence passed')
} finally {
    if(db?.open)db.close()
    fs.rmSync(dir,{recursive:true,force:true})
}
