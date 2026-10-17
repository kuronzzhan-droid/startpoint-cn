const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { Worker } = require('node:worker_threads')
const { EventEmitter } = require('node:events')
const Database = require('better-sqlite3')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'server-memory-test-'))
const { QuestPartyPoolCache } = require('../out/multi/npc/quest-party-pool-cache')
const { seedJsonChunks, writeSeedJsonAtomicSync } = require('../out/lib/seed-stream-file')
const { cachedStatement } = require('../out/lib/cached-statement')
const diagnostics = require('../out/lib/memory-diagnostics')
let sequence = 0
function directory() { const dir = path.join(root, String(++sequence)); fs.mkdirSync(dir); return dir }
test.after(() => {
    assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir()))
    assert.match(path.basename(root), /^server-memory-test-/)
    fs.rmSync(root, { recursive: true })
})
function pools() {
    return new Map([['池"一', { confirmPool: new Map([[1, null], [2, 0]]), pendingPool: new Map([[3, 2]]),
        playPool: new Map([[4, {r: 2, tag: '热血躲避球', play: true}]]), verifiedPool: new Map([[5, 1]]) }]])
}
test('streaming seed files preserve JSON values, backups and corrupted-primary recovery', () => {
    const data = pools(), dir = directory(), file = path.join(dir, 'confirmed.json')
    for (const kind of ['confirmed', 'purified', 'verified']) {
        const parsed = JSON.parse([...seedJsonChunks(data, kind)].join(''))
        const pool = data.values().next().value
        assert.deepEqual(parsed['池"一'], Object.fromEntries(kind === 'confirmed' ? pool.confirmPool : kind === 'purified' ? pool.playPool : pool.verifiedPool))
        if (kind === 'confirmed') assert.deepEqual(parsed['池"一_pend'], {3: 2})
    }
    writeSeedJsonAtomicSync(file, data, 'confirmed')
    const first = fs.readFileSync(file)
    data.values().next().value.confirmPool.set(6, 2)
    writeSeedJsonAtomicSync(file, data, 'confirmed')
    assert.deepEqual(fs.readFileSync(file + '.bak'), first)
    fs.writeFileSync(file, '{broken')
    writeSeedJsonAtomicSync(file, data, 'confirmed')
    assert.deepEqual(fs.readFileSync(file + '.bak'), first)
    assert.equal(JSON.parse(fs.readFileSync(file))['池"一'][6], 2)
    // A valid external edit must become the next backup, even after caching.
    fs.writeFileSync(file, '{"external":{}}')
    writeSeedJsonAtomicSync(file, data, 'confirmed')
    assert.deepEqual(JSON.parse(fs.readFileSync(file + '.bak')), {external: {}})
})
test('streaming write failures retain primary, backup and leave no temporary files', () => {
    const dir = directory(), file = path.join(dir, 'confirmed.json'), data = pools()
    writeSeedJsonAtomicSync(file, data, 'confirmed')
    writeSeedJsonAtomicSync(file, data, 'confirmed')
    const before = fs.readFileSync(file), backup = fs.readFileSync(file + '.bak')
    const circular = {}; circular.self = circular
    data.values().next().value.confirmPool.set(99, circular)
    assert.throws(() => writeSeedJsonAtomicSync(file, data, 'confirmed'), /circular/i)
    assert.deepEqual(fs.readFileSync(file), before)
    assert.deepEqual(fs.readFileSync(file + '.bak'), backup)
    assert.equal(fs.readdirSync(dir).length, 2)
})

test('reused seed buffers preserve multibyte chunks, large values and short final writes', () => {
    const data=pools(), pool=data.values().next().value, dir=directory(), file=path.join(dir,'purified.json')
    for(let i=0;i<6000;i++)pool.playPool.set(10000+i,{r:i%3,tag:'中文😀'.repeat(i===0?20000:3),play:!!(i%2)})
    writeSeedJsonAtomicSync(file,data,'purified')
    const expected={'池"一':Object.fromEntries(pool.playPool)}
    assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),expected)
    pool.playPool.clear();pool.playPool.set(7,{r:1,tag:'短',play:true})
    writeSeedJsonAtomicSync(file,data,'purified')
    assert.deepEqual(JSON.parse(fs.readFileSync(file+'.bak','utf8')),expected)
    assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{'池"一':{'7':{r:1,tag:'短',play:true}}})
})
test('seed readback corruption and backup-copy failures cannot replace durable files', () => {
    const dir = directory(), file = path.join(dir, 'confirmed.json'), data = pools()
    writeSeedJsonAtomicSync(file, data, 'confirmed')
    writeSeedJsonAtomicSync(file, data, 'confirmed')
    const before = fs.readFileSync(file), backup = fs.readFileSync(file + '.bak')
    data.values().next().value.confirmPool.set(7, 1)
    const originalRead = fs.readSync, originalCopy = fs.copyFileSync
    try {
        fs.readSync = (...args) => {
            const length = originalRead(...args)
            if (length) args[1][0] ^= 1
            return length
        }
        assert.throws(() => writeSeedJsonAtomicSync(file, data, 'confirmed'), /checksum mismatch/)
        fs.readSync = originalRead
        fs.copyFileSync = () => {throw Error('injected backup failure')}
        assert.throws(() => writeSeedJsonAtomicSync(file, data, 'confirmed'), /injected backup failure/)
    } finally {fs.readSync = originalRead; fs.copyFileSync = originalCopy}
    assert.deepEqual(fs.readFileSync(file), before)
    assert.deepEqual(fs.readFileSync(file + '.bak'), backup)
    assert.equal(fs.readdirSync(dir).length, 2)
})
test('cached SQL isolates bindings, transactions, connection identity and busy iteration', () => {
    const db = new Database(':memory:'), second = new Database(':memory:')
    try {
        db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, value INTEGER)')
        const sql = 'INSERT INTO t VALUES (?,?)'
        const initialInsert = cachedStatement(db, sql)
        initialInsert.run(1, 11)
        assert.equal(cachedStatement(db, sql), cachedStatement(db, sql))
        assert.throws(() => db.transaction(() => {cachedStatement(db, sql).run(2, 22); throw Error('rollback')})())
        assert.deepEqual(cachedStatement(db, 'SELECT * FROM t WHERE id=?').get(1), {id:1, value:11})
        assert.equal(cachedStatement(db, 'SELECT * FROM t WHERE id=?').get(2), undefined)
        assert.notEqual(cachedStatement(db, 'SELECT ? AS n'), cachedStatement(second, 'SELECT ? AS n'))
        cachedStatement(db, sql).run(2, 22)
        const select = cachedStatement(db, 'SELECT * FROM t'), iterator = select.iterate()
        iterator.next()
        assert.equal(select.busy, true)
        assert.notEqual(cachedStatement(db, 'SELECT * FROM t'), select)
        iterator.return()
        for (let i = 0; i < 150; i++) cachedStatement(db, `SELECT ${i} AS n`).get()
        assert.notEqual(cachedStatement(db, sql), initialInsert)
    } finally { db.close(); second.close() }
})
function snapshot(id, power = id * 100) {
    return {questCategory:2, questId:1001001, sourcePlayerId:id, partySlot:1,
        battlePower:power, partyElement:1, clearedAt:id,
        party:{characters:[1,2,3].map(n=>[0,{id:n,level:id}])}}
}
function waitFor(worker, type, send) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {worker.off('message', receive); reject(Error('Timeout ' + type))}, 10000)
        const receive = message => {
            if (message.type !== type) return
            clearTimeout(timeout); worker.off('message', receive); resolve(message)
        }
        worker.on('message', receive)
        send?.()
    })
}
async function npcWorker(t, dir, incremental = true) {
    const cache = new QuestPartyPoolCache(), messages = []
    const worker = new Worker(path.resolve(__dirname, '../out/workers/quest-npc-party-pool-worker.js'), {
        env: {...process.env, DATA_DIR:dir, NPC_INCREMENTAL_UPDATES: incremental ? 'true':'false'}
    })
    t.after(() => worker.terminate())
    worker.on('message', message => {
        messages.push(message)
        cache.apply(message)
        if (message.type === 'quest_snapshot') worker.postMessage({type:'snapshot_ack', revision:message.revision})
    })
    await waitFor(worker, 'ready')
    return {worker, cache, messages, record: s => waitFor(worker, 'record_done', () => worker.postMessage({type:'record',snapshot:s}))}
}
test('NPC deltas match persisted membership through pruning, updates, reload, deletion and restart', async t => {
    const dir = directory(), active = await npcWorker(t, dir)
    const {worker, cache, messages, record} = active
    for (let i = 1; i <= 75; i++) await record(snapshot(i, i <= 30 ? 30000+i : 10000))
    await record(snapshot(5, 40000))
    const readPersisted = () => {
        const db = new Database(path.join(dir,'quest_ai_party_pool.db'), {readonly:true})
        try {return db.prepare('SELECT source_player_id AS id,party_payload AS payload FROM quest_npc_party_pool ORDER BY id').all()}
        finally {db.close()}
    }
    const check = current => assert.deepEqual(
        current.pools.get('2:1001001').map(x=>({id:x.sourcePlayerId,payload:JSON.stringify(x.party)})).sort((a,b)=>a.id-b.id), readPersisted())
    check(cache)
    assert.equal(cache.pools.get('2:1001001').length, 50)
    assert.deepEqual(cache.pools.get('2:1001001').map(x => x.sourcePlayerId).sort((a, b) => a - b),
        Array.from({length: 50}, (_, i) => i + 26), 'old high-power clears must not displace newer clears')
    assert.equal(messages.filter(m=>m.type==='quest_delta').length, 76)
    assert.equal(messages.filter(m=>m.type==='quest_snapshot').length, 0)
    await waitFor(worker, 'ready', () => worker.postMessage({type:'reload'}))
    check(cache)
    await waitFor(worker, 'remove_players_result', () => worker.postMessage({type:'remove_players',requestId:1,playerIds:[5,74,75]}))
    check(cache)
    assert.ok(cache.pools.get('2:1001001').every(x=>![5,74,75].includes(x.sourcePlayerId)))
    // Reload and a concurrent update remain serialized in the worker.
    worker.postMessage({type:'reload'})
    await record(snapshot(76, 50000)); check(cache)
    await worker.terminate()
    const restarted = await npcWorker(t, dir); check(restarted.cache)
    // An old clear can be pruned immediately, even when it has the highest power.
    for (let i = 77; i <= 80; i++) await restarted.record(snapshot(i, 50000))
    await restarted.record({...snapshot(1, 999999), clearedAt:0})
    assert.ok(restarted.cache.pools.get('2:1001001').every(x=>x.sourcePlayerId!==1))
    check(restarted.cache)
    await waitFor(restarted.worker, 'remove_players_result', () => restarted.worker.postMessage({
        type:'remove_players', requestId:2, playerIds:readPersisted().map(x=>x.id),
    }))
    assert.equal(restarted.cache.pools.size,0)
    assert.deepEqual(readPersisted(),[])
})
test('NPC startup and reload retain only the latest 50 stored clears per quest', async t => {
    const dir = directory(), file = path.join(dir, 'quest_ai_party_pool.db')
    const seed = new Database(file)
    seed.exec(`CREATE TABLE quest_npc_party_pool (
        quest_category INTEGER NOT NULL, quest_id INTEGER NOT NULL, source_player_id INTEGER NOT NULL,
        party_slot INTEGER NOT NULL, battle_power INTEGER NOT NULL, party_element INTEGER,
        party_payload TEXT NOT NULL, cleared_at INTEGER NOT NULL,
        PRIMARY KEY (quest_category, quest_id, source_player_id))`)
    const insert = seed.prepare('INSERT INTO quest_npc_party_pool VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    for (let i = 1; i <= 65; i++) {
        const s = snapshot(i, i <= 15 ? 999999 : 8000)
        insert.run(s.questCategory, s.questId, s.sourcePlayerId, s.partySlot,
            s.battlePower, s.partyElement, JSON.stringify(s.party), s.clearedAt)
    }
    const other = {...snapshot(1), questId: 1002001}
    insert.run(other.questCategory, other.questId, other.sourcePlayerId, other.partySlot,
        other.battlePower, other.partyElement, JSON.stringify(other.party), other.clearedAt)
    seed.close()
    const {worker, cache, record} = await npcWorker(t, dir)
    const latest = () => cache.pools.get('2:1001001').map(s => s.sourcePlayerId).sort((a, b) => a - b)
    assert.deepEqual(latest(), Array.from({length: 50}, (_, i) => i + 16))
    assert.equal(cache.pools.get('2:1002001').length, 1, 'quest limits are independent')
    const db = new Database(file)
    try {
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM quest_npc_party_pool WHERE quest_id = 1001001').get().n, 50)
        const s = {...snapshot(66, 8000), clearedAt: 66}
        db.prepare('INSERT INTO quest_npc_party_pool VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
            s.questCategory, s.questId, s.sourcePlayerId, s.partySlot,
            s.battlePower, s.partyElement, JSON.stringify(s.party), s.clearedAt)
    } finally { db.close() }
    await waitFor(worker, 'ready', () => worker.postMessage({type: 'reload'}))
    assert.deepEqual(latest(), Array.from({length: 50}, (_, i) => i + 17))
    await record({...snapshot(30, 8000), partySlot: 12, clearedAt: 1000})
    assert.equal(latest().length, 50, 'another SET from the same player replaces its record')
    assert.equal(cache.pools.get('2:1001001').find(s => s.sourcePlayerId === 30).partySlot, 12)
})
test('NPC full-update fallback has the same party contents', async t => {
    const {cache, record, messages} = await npcWorker(t, directory(), false)
    await record(snapshot(1)); await record(snapshot(1, 25000))
    assert.equal(cache.pools.get('2:1001001')[0].battlePower,25000)
    assert.equal(messages.filter(m=>m.type==='quest_delta').length,0)
    assert.equal(messages.filter(m=>m.type==='quest_snapshot').length,2)
})
test('NPC cache rejects gaps and duplicate messages and commits full refresh atomically', () => {
    const cache = new QuestPartyPoolCache()
    cache.apply({type:'snapshot_begin',revision:1})
    cache.apply({type:'quest_snapshot',revision:2,key:'q',entries:[snapshot(1)]})
    assert.equal(cache.pools.size,0)
    cache.apply({type:'snapshot_end',revision:3})
    assert.equal(cache.apply({type:'quest_delta',revision:5,key:'q',entry:snapshot(2),removedPlayerIds:[]}), 'reload')
    assert.equal(cache.pools.get('q').length,1)
    cache.apply({type:'snapshot_begin',revision:6})
    cache.apply({type:'quest_snapshot',revision:7,key:'q',entries:[snapshot(2)]})
    cache.apply({type:'snapshot_end',revision:8})
    assert.equal(cache.apply({type:'quest_delta',revision:8,key:'q',entry:snapshot(3),removedPlayerIds:[]}), 'ignored')
    assert.equal(cache.pools.get('q')[0].sourcePlayerId,2)
})
test('memory probes retain one pending request, mark unavailable workers and detach on exit', () => {
    const worker = new EventEmitter(); worker.threadId = 100; const requests = []
    worker.postMessage = message => requests.push(message)
    diagnostics.observeWorkerMemory('fixture',worker)
    assert.equal(diagnostics.collectMemoryDiagnostics().workers.find(w=>w.name==='fixture').memory,null)
    diagnostics.collectMemoryDiagnostics()
    assert.equal(requests.length,1)
    worker.emit('message',{type:'memory_sample',memory:{heapUsed:123},counters:{records:2}})
    const sample = diagnostics.collectMemoryDiagnostics().workers.find(w=>w.name==='fixture')
    assert.equal(sample.memory.heapUsed,123); assert.equal(sample.stale,false)
    assert.equal(requests.length,2)
    worker.emit('exit',0)
    assert.equal(diagnostics.collectMemoryDiagnostics().workers.some(w=>w.name==='fixture'),false)
    assert.equal(worker.listenerCount('message'),0)
    const unregister = diagnostics.registerMemoryCounters('fixture',()=>({count:7}))
    assert.equal(diagnostics.collectMemoryDiagnostics().counters.fixture.count,7)
    unregister(); assert.equal(diagnostics.collectMemoryDiagnostics().counters.fixture,undefined)
})

test('real seed worker memory replies never acknowledge writes or corrupt flush revisions', async t => {
    const { SeedPersistence } = require('../out/lib/seed-persistence')
    const dir = directory(), data = pools(), persistence = new SeedPersistence(dir,()=>data,1)
    t.after(()=>persistence.close())
    const memory = await waitFor(persistence.worker,'memory_sample',()=>persistence.worker.postMessage({type:'memory_probe'}))
    assert.equal(memory.counters.poolCount,1)
    assert.equal(memory.counters.entries,null, 'basic monitoring must not enumerate seed pool entries')
    assert.equal(persistence.savedRevision,0)
    persistence.update({movieId:'池"一',seed:99,confirmed:2})
    await persistence.flush()
    await waitFor(persistence.worker,'memory_sample',()=>persistence.worker.postMessage({type:'memory_probe'}))
    assert.equal(persistence.savedRevision,1)
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'confirmed_seeds.json')))['池"一'][99],2)
})

test('memory monitor works with idle traffic and unregisters its timer on server close', () => {
    const original = global.setInterval, clear = global.clearInterval, warn = console.warn
    let tick, closed, cleared = false; const logs = []
    const timer = {unref(){}}
    try {
        global.setInterval = fn => {tick=fn;return timer}
        global.clearInterval = value => {assert.equal(value,timer);cleared=true}
        console.warn = line => logs.push(line)
        const app = {addHook(name,fn){assert.equal(name,'onClose');closed=fn}}
        diagnostics.installMemoryDiagnostics(app)
        tick()
        const sample=JSON.parse(logs.find(line=>line.startsWith('[MEM] ')).slice(6))
        assert.equal(sample.pid,process.pid); assert.ok(sample.rss>0)
        assert.ok(sample.timestamp);assert.equal(sample.main.rss,undefined)
        closed();assert.equal(cleared,true)
    } finally {global.setInterval=original;global.clearInterval=clear;console.warn=warn}
})
