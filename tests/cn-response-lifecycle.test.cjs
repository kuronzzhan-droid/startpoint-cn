const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const http = require('node:http')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { setImmediate: tick, setTimeout: delay } = require('node:timers/promises')
const { gunzipSync, brotliDecompressSync } = require('node:zlib')
const Fastify = require('fastify')
const msgpack = require('msgpackr')
const diagnostics = require('../out/lib/request-diagnostics')
const compression = require('../out/lib/cn-load-http-compression')

// Exercise the built production hook and inline routes without starting the service.
function installEntryPoint(app, mode, failCompression = false) {
    const filename = process.env.CN_RESPONSE_TEST_ENTRY || path.join(__dirname, '../out/cn-server.js')
    const source = fs.readFileSync(filename, 'utf8')
    function section(start, end) {
        const first = source.indexOf(start), last = source.indexOf(end, first + start.length)
        assert.ok(first >= 0 && last > first, `Missing entry-point section: ${start}`)
        return source.slice(first, last)
    }
    const helper = source.match(/var __awaiter = [\s\S]*?\r?\n};/)
    const capturedErrors = []
    const capturedConsole = {log(){}, warn(){}, error: (...args)=>capturedErrors.push(args.map(String).join(' '))}
    assert.ok(source.includes('installCnResponseEncoding)(fastify)'), 'Entry point must install the production encoder')
    const hookFilename = path.join(__dirname, '../out/lib/cn-response-hook.js')
    vm.runInNewContext(fs.readFileSync(hookFilename, 'utf8')
        + '\nexports.installCnResponseEncoding(fastify, {compression: compressionConfig});', {
        exports: {}, fastify: app, console: capturedConsole,
        compressionConfig: {...compression.getCnLoadHttpCompressionConfig({CN_LOAD_HTTP_COMPRESSION:mode, CN_LOAD_HTTP_COMPRESSION_MIN_BYTES:'0'}),
            ...(failCompression ? {gzipLevel: 999} : {})},
        require(name) { return name.startsWith('.') ? require(path.resolve(path.dirname(hookFilename), name)) : require(name) },
    }, {filename: hookFilename})
    vm.runInNewContext((helper?.[0] || '') + '\n'
        + section('function stubMsgpackReply(', 'fastify.register(tool_1.default'), {
        Buffer, Promise, fastify: app, apiPrefix: '/api/index.php', CDN_BASE_URL: 'http://cdn.invalid',
        request_diagnostics_1: diagnostics, perf_hooks_1: require('node:perf_hooks'), msgpackr_1: msgpack,
        cn_load_http_compression_1: failCompression ? {...compression, compressCnLoadHttpBody: async () => {throw Error('fixture compression failure')}} : compression,
        cnLoadCompressionConfig: compression.getCnLoadHttpCompressionConfig({CN_LOAD_HTTP_COMPRESSION:mode, CN_LOAD_HTTP_COMPRESSION_MIN_BYTES:'0'}),
        utils_1: {getServerTime:()=>1, getServerTimeForPlayer:()=>1},
        seed_validator_1: {default:{flushPersistence: async()=>{}}},
        crash_report_1: require('../out/lib/crash-report'),
        game_logging_1: {gameVerboseLog(){}},
        console: capturedConsole,
        require(name) {
            assert.equal(name, './routes/cn/asset')
            return {getAssetDownloadSize:()=>0, getVersionInfo:()=>({res_ver:'fixture'})}
        },
    }, {filename})
    return capturedErrors
}

function request(port, route, headers = {}, method = 'POST') {
    return new Promise((resolve, reject) => {
        const req = http.request({host:'127.0.0.1',port,path:route,method,
            headers:{'content-type':'application/json',...headers}}, res => {
            const chunks=[]
            res.on('data', chunk=>chunks.push(chunk))
            res.on('end',()=>resolve({status:res.statusCode, headers:res.headers, body:Buffer.concat(chunks)}))
            res.on('error',reject)
        })
        req.on('error',reject)
        req.setTimeout(3000,()=>req.destroy(Error('HTTP fixture timeout')))
        req.end(method==='POST' ? '{}' : undefined)
    })
}

function decode(response) {
    let body=response.body
    if(response.headers['content-encoding']==='gzip')body=gunzipSync(body)
    if(response.headers['content-encoding']==='br')body=brotliDecompressSync(body)
    const unpacked=msgpack.unpack(Buffer.from(body.toString(),'base64'))
    return typeof unpacked==='string' ? JSON.parse(unpacked) : unpacked
}

async function runScenario(scenario) {
    const logs=[]
    const app=Fastify({logger:{level:'warn',stream:{write:line=>logs.push(line)}}})
    const monitor=scenario==='disabled' ? null : diagnostics.installRequestDiagnostics(app)
    const errors=installEntryPoint(app, scenario==='gzip'||scenario==='br'||scenario==='fallback' ? scenario==='fallback'?'gzip':scenario : 'off',scenario==='fallback')
    if(scenario==='delayed')app.addHook('onSend',async(_req,_reply,payload)=>{await delay(10);return payload})
    const sample={ok:true,number:4_000_000_000,items:Array(100).fill('compression fixture')}
    app.post('/fixture/load',async(_req,reply)=>reply.type('application/x-msgpack').send(sample))
    app.post('/fixture/finish',async(_req,reply)=>{await tick();return reply.type('application/x-msgpack').send(sample)})
    app.get('/fixture/empty',async(_req,reply)=>reply.code(204).send())
    app.get('/fixture/json',async()=>({ok:true}))
    let sends=0, completed=0
    app.addHook('onRequest',(_req,reply,done)=>{
        const original=reply.raw.writeHead
        reply.raw.writeHead=function(...args){sends++;return original.apply(this,args)}
        done()
    })
    app.addHook('onResponse',(_req,_reply,done)=>{completed++;done()})
    await app.listen({host:'127.0.0.1',port:0})
    let expected=0
    const port=app.server.address().port
    try {
        const stubs={
            'channels/channel_leiting_pay/query_unfinish_order':{order_id:''},
            'channels/channel_leiting_pay/query_purcharge':{status:3},
            'channels/channel_leiting_pay/set_unfinish_order_status':{},
            'assetintitle/version_info_in_title':{res_ver:'fixture'},
            'tool/check_social_link_enable':{enable:false},'tool/check_enable_gift':{enable_gift:true},
            'tool/contact_active':{enable_customer_service:false},'tool/custom_notify':{},
            'episode_trial_reading/finish':{},
        }
        for(const [route,data] of Object.entries(stubs)){
            const response=await request(port,'/api/index.php/'+route);expected++
            assert.equal(response.status,200);assert.deepEqual(decode(response).data,data)
        }
        for(const [route,method] of [['/debug','GET'],['/debug','POST'],['/crash','POST']]){
            const response=await request(port,route,{},method);expected++
            assert.equal(response.status,200);assert.equal(response.body.toString(),'OK')
        }
        for(const route of ['/fixture/load','/fixture/finish']){
            const response=await request(port,route,{'accept-encoding':'gzip, br'});expected++
            assert.equal(response.status,200);assert.deepEqual(decode(response),sample)
            if(route.endsWith('/load')&&(scenario==='gzip'||scenario==='br'))assert.equal(response.headers['content-encoding'],scenario)
            else assert.equal(response.headers['content-encoding'],undefined)
        }
        const empty=await request(port,'/fixture/empty',{},'GET');expected++
        assert.equal(empty.status,204);assert.equal(empty.body.length,0)
        const json=await request(port,'/fixture/json',{},'GET');expected++
        assert.equal(json.status,200);assert.deepEqual(JSON.parse(json.body),{ok:true})
        // Parallel game responses must each complete once and retain the payload.
        const burst=await Promise.all(Array.from({length:20},()=>request(port,'/fixture/finish')))
        expected+=burst.length
        for(const response of burst)assert.deepEqual(decode(response),sample)
        await tick()
        assert.equal(sends,expected);assert.equal(completed,expected)
        assert.doesNotMatch(logs.join('\n'),/already sent|ERR_HTTP_HEADERS_SENT/)
        if(scenario==='fallback')assert.equal(errors.length,1)
        else assert.deepEqual(errors,[])
        if(monitor){
            const summary=monitor.drain().summary
            assert.equal(summary.n,expected)
            assert.deepEqual(summary.statuses,{'200':expected-1,'204':1})
            assert.equal(summary.aborted,0)
            const finish=summary.top.find(row=>row.route==='POST /fixture/finish')
            assert.ok(finish.responseBytes>0);assert.ok(finish.stages.customEncoding.n>0)
        }
        console.log(JSON.stringify({scenario,requests:expected,writeHeads:sends,completed}))
    } finally {await app.close()}
}

if(process.argv[2]==='--child'){
    runScenario(process.argv[3]).catch(error=>{console.error(error);process.exitCode=1})
} else {
    const test=require('node:test')
    for(const scenario of ['enabled','disabled','delayed','gzip','br','fallback']){
        test(`actual CN response chain completes once over HTTP (${scenario})`,{timeout:15000},async()=>{
            const {stdout}=await promisify(execFile)(process.execPath,[__filename,'--child',scenario],
                {windowsHide:true,timeout:12000,maxBuffer:100000})
            assert.equal(JSON.parse(stdout.trim()).completed,36)
        })
    }
}
