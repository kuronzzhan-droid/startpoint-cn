// Test bootstrap and independent observer only. No DB, room manager, or game listener.
const net = require('node:net')
const crypto = require('node:crypto')
const fs = require('node:fs')
const { performance } = require('node:perf_hooks')

async function register(executor, context) {
    const state = { counter: 0, version: 0, nested: { ownerPid: process.pid } }
    executor.register('FIXTURE_READ', () => state)
    executor.register('FIXTURE_SET', payload => {
        if (!Number.isSafeInteger(payload.value)) throw Error('invalid fixture value')
        state.counter = payload.value; state.version++
        return state
    })
    executor.register('FIXTURE_DELAY', async payload => {
        if (!Number.isSafeInteger(payload.ms) || payload.ms < 0 || payload.ms > 5000) throw Error('invalid fixture delay')
        await new Promise(resolve => setTimeout(resolve, payload.ms))
        state.counter++; state.version++
        return state
    })
    const token = crypto.randomBytes(32).toString('hex')
    const sockets = new Set()
    const server = net.createServer(socket => {
        sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.on('error', () => {})
        socket.setTimeout(2000, () => socket.destroy())
        let buffer = '', received = false
        socket.setEncoding('utf8')
        socket.on('data', data => {
            if (received) return socket.destroy()
            buffer += data
            if (Buffer.byteLength(buffer) > 64 * 1024) return socket.destroy()
            const newline = buffer.indexOf('\n')
            if (newline < 0) return
            received = true
            void (async () => {
                const request = JSON.parse(buffer.slice(0, newline))
                if (request.token !== token || buffer.slice(newline + 1).trim()) throw Error('invalid fixture request')
                const result = request.op === 'submit' ? await executor.submit(request.envelope)
                    : request.op === 'query' ? await executor.queryResult(request.commandId) : null
                if (!result) throw Error('invalid fixture operation')
                socket.end(JSON.stringify({ result }) + '\n')
            })().catch(() => socket.destroy())
        })
    })
    server.maxConnections = 8
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    context.onShutdown(async () => {
        for (const socket of sockets) socket.destroy()
        await new Promise(resolve => server.close(resolve))
    })
    return { observerEndpoint: { host: '127.0.0.1', port: server.address().port, token }, ownerPid: process.pid }
}

function request(endpoint, operation) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(endpoint.port, endpoint.host)
        const started = performance.now()
        let buffer = ''
        socket.setEncoding('utf8'); socket.setTimeout(2000, () => socket.destroy(Error('observer timeout')))
        socket.on('error', reject)
        socket.once('close', () => reject(Error('observer closed before response')))
        socket.on('connect', () => socket.write(JSON.stringify({ token: endpoint.token, ...operation }) + '\n'))
        socket.on('data', data => {
            buffer += data
            if (Buffer.byteLength(buffer) > 64 * 1024) return socket.destroy(Error('observer response limit'))
            const newline = buffer.indexOf('\n')
            if (newline < 0) return
            try { resolve({ result: JSON.parse(buffer.slice(0, newline)).result, elapsedMs: performance.now() - started }) }
            catch (error) { reject(error) }
            socket.destroy()
        })
    })
}

module.exports = { register, request }

if (require.main === module && process.argv[2] === 'observer') {
    const finish = message => {
        // Keep IPC referenced until the resumed parent consumes this application result.
        process.once('message', () => process.disconnect())
        process.send(message)
    }
    process.send({ t: 'observer-ready' })
    process.once('message', message => {
        void (async () => {
            const started = performance.now(), samples = []
            process.send({ t: 'observer-armed' })
            // Parent receives the armed witness and blocks before this timer fires.
            await new Promise(resolve => setTimeout(resolve, 150))
            for (let index = 0; index < 10; index++) {
                const commandId = `rc1.${Date.now()}.${crypto.randomUUID()}`
                samples.push(await request(message.endpoint, { op: 'submit', envelope: {
                    protocol: 1, commandId, kind: 'FIXTURE_READ', payload: {}, timeoutMs: 1000,
                    expectedOwnerEpoch: message.ownerEpoch,
                } }))
                await new Promise(resolve => setTimeout(resolve, 20))
            }
            // Parent reads this witness synchronously before allowing its event loop to resume.
            fs.writeFileSync(message.markerPath, 'observer-completed', { flag: 'wx' })
            finish({ t: 'observer-complete', elapsedMs: performance.now() - started, samples })
        })().catch(error => finish({ t: 'observer-failed', reason: error.message }))
    })
}
