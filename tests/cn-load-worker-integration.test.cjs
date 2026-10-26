const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { performance } = require('node:perf_hooks')

async function scenario(mode) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-load-worker-'))
    process.env.DATA_DIR = directory
    process.env.GACHA_SEED_DIR = path.join(directory, 'seeds')
    const Fastify = require('fastify')
    const responseRoot=process.env.CN_RESPONSE_MODULE_ROOT || path.resolve(__dirname,'..')
    const { encodeCnResponse } = require(path.join(responseRoot,'out/lib/cn-response-encoding'))
    const { CnResponseWorkerPool } = require(path.join(responseRoot,'out/lib/cn-response-worker-pool'))
    const { installCnResponseEncoding } = require(path.join(responseRoot,'out/lib/cn-response-hook'))
    const { drainServerWorkPerformance } = require(path.join(responseRoot,'out/lib/server-work-performance'))
    const { getCnLoadHttpCompressionConfig } = require('../out/lib/cn-load-http-compression')
    const { getDb } = require('../out/data/db')
    const players = require('../out/data/domains/player')
    const characters = require('../out/data/domains/character')
    const account = require('../out/data/domains/account').insertAccountSync({ appId:'wf_cn',idpAlias:'',idpCode:'fixture',idpId:'worker-load',status:'normal' })
    const player = players.insertDefaultPlayerSync(account.id)
    require('../out/data/activeAccount').saveAccountDefaultPlayer(account.id, player.id)
    const viewerId = 82000123
    const db = getDb()
    db.prepare('INSERT INTO sessions (token,account_id,expires,type) VALUES (?,?,?,2)').run(String(viewerId),account.id,'2099-01-01T00:00:00Z')
    const ids = Object.keys(require('../assets/character.json')).map(Number)
    db.transaction(() => { for (const id of ids) if (!characters.playerOwnsCharacterSync(player.id,id)) characters.insertDefaultPlayerCharacterSync(player.id,id) })()
    const configuredWorkers = Number(process.env.PERF_RESPONSE_WORKERS || 2)
    const pool = new CnResponseWorkerPool({ size: mode === 'disabled' ? 0 : configuredWorkers })
    const compression = getCnLoadHttpCompressionConfig({ CN_LOAD_HTTP_COMPRESSION: ['gzip','br'].includes(mode) ? mode : 'off' })
    const errors = [], expected = new Map()
    const app = Fastify({ logger: { level:'warn', stream:{ write: line => errors.push(line) } } })
    // Capture this exact real route response before encoding, including its timestamps.
    app.addHook('onSend', async (request, reply, payload) => {
        if (reply.getHeader('content-type') === 'application/x-msgpack') {
            assert.equal(typeof payload, 'object')
            if (process.env.CN_LOAD_CAPTURE_PATH && !fs.existsSync(process.env.CN_LOAD_CAPTURE_PATH)) {
                fs.writeFileSync(process.env.CN_LOAD_CAPTURE_PATH, require('node:v8').serialize({payload}))
            }
            expected.set(request.headers['x-fixture-id'], await encodeCnResponse({ payload,
                ...(compression.mode !== 'off' ? { compression: {config:compression,acceptEncoding:request.headers['accept-encoding']} } : {}) }))
        }
        return payload
    })
    installCnResponseEncoding(app, {pool,compression})
    if (mode === 'delayed') app.addHook('onSend', async (_request,_reply,payload) => {
        await new Promise(resolve => setTimeout(resolve,10)); return payload
    })
    let writes=0, responses=0
    app.addHook('onRequest', (_request,reply,done) => {
        const original = reply.raw.writeHead
        reply.raw.writeHead = function(...args) { writes++; return original.apply(this,args) }
        done()
    })
    app.addHook('onResponse', (_request,_reply,done) => {responses++; done()})
    await app.register(require('../out/routes/cn/load').default, {prefix:'/api/index.php'})
    await app.listen({host:'127.0.0.1',port:0})
    const port=app.server.address().port
    const request = id => new Promise((resolve,reject) => {
        const body=JSON.stringify({viewer_id:viewerId})
        const req=http.request({host:'127.0.0.1',port,path:'/api/index.php/load',method:'POST',headers:{
            'content-type':'application/json','content-length':Buffer.byteLength(body),'x-fixture-id':String(id),
            'accept-encoding':'gzip, br',device:'android',res_ver:'1.4.117',
        }},res=>{
            const chunks=[]; res.on('data',c=>chunks.push(c));res.on('error',reject)
            res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}))
        })
        req.setTimeout(10000,()=>req.destroy(Error('fixture timeout')));req.on('error',reject);req.end(body)
    })
    try {
        // This fixture verifies worker encoding and exact wire bytes. Four large
        // responses fit both per-player admission (8) and the 32 MiB snapshot
        // budget; higher stress counts may legitimately reject or fall back.
        const count=Math.max(1,Number(process.env.PERF_LOAD_REQUESTS||4))
        const cpu=process.cpuUsage(), elu=performance.eventLoopUtilization(), started=performance.now()
        const results=await Promise.all(Array.from({length:count},(_,i)=>request(i)))
        const cpuUsed=process.cpuUsage(cpu), loop=performance.eventLoopUtilization(elu)
        for(let i=0;i<count;i++) {
            assert.equal(results[i].status,200)
            const reference=expected.get(String(i));assert.ok(reference)
            assert.deepEqual(results[i].body,Buffer.from(reference.body))
            assert.equal(results[i].headers['content-encoding'],reference.compression?.encoding)
        }
        assert.equal(writes,count);assert.equal(responses,count)
        assert.doesNotMatch(errors.join('\n'),/already sent|ERR_HTTP_HEADERS_SENT/)
        const state=pool.snapshot()
        const work=drainServerWorkPerformance()
        const expectedWorkerCount=mode==='disabled'||configuredWorkers===0?0:count
        assert.equal(state.completed,expectedWorkerCount,'actual /load must execute in configured workers')
        assert.equal(state.completedObjects,expectedWorkerCount)
        assert.equal(state.fallback,0);assert.equal(state.retainedBytes,0)
        assert.equal(Object.keys(characters.getPlayerCharactersSync(player.id)).length,ids.length)
        console.log('RESULT '+JSON.stringify({mode,requests:count,characters:ids.length,writeHeads:writes,
            wallMs:performance.now()-started,cpuMs:(cpuUsed.user+cpuUsed.system)/1000,
            mainEluPct:loop.utilization*100,...state,work}))
    } finally {await app.close();db.close()}
}

if(process.argv[2]==='--child') scenario(process.argv[3]).then(()=>process.exit(0),error=>{console.error(error);process.exit(1)})
else for(const mode of (process.env.PERF_LOAD_MODES?.split(',').filter(Boolean) ?? ['off','gzip','br','disabled','delayed'])) test(`real CN load object uses production worker path (${mode})`,{timeout:30000},async()=>{
    const {stdout}=await promisify(execFile)(process.execPath,[__filename,'--child',mode],{windowsHide:true,timeout:25000,maxBuffer:1000000})
    console.log(stdout.split('\n').find(line=>line.startsWith('RESULT ')))
})
