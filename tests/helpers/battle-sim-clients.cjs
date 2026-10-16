// Battle clients for relay latency tests, run in their own process so a stall
// of the server's event loop does not also stall the clients' timestamps.
//
// argv[2]: JSON { port, roomNumber, connectionIds, durationMs, intervalMs }
// IPC out: { started } after every client received BattleStart, then
//          { done, samples: [{ sentAt, latencyMs }] } with times relative to start.
const net = require('node:net')

const config = JSON.parse(process.argv[2])

class Client {
    constructor(connectionId) {
        this.connectionId = connectionId
        this.buffer = ''
        this.onFrame = () => {}
        this.socket = net.createConnection({ host: '127.0.0.1', port: config.port })
        this.socket.setNoDelay(true)
        this.socket.setEncoding('utf8')
        this.socket.on('error', () => {})
        this.socket.on('data', chunk => {
            const at = performance.now()
            this.buffer += chunk
            let index
            while ((index = this.buffer.indexOf('\0')) >= 0) {
                const raw = this.buffer.slice(0, index)
                this.buffer = this.buffer.slice(index + 1)
                if (raw) this.onFrame(JSON.parse(raw), at)
            }
        })
    }
    send(data) { this.socket.write(JSON.stringify(data) + '\0') }
    waitFor(predicate) {
        return new Promise(resolve => {
            const previous = this.onFrame
            this.onFrame = (data, at) => {
                previous(data, at)
                if (predicate(data)) { this.onFrame = previous; resolve() }
            }
        })
    }
}

async function main() {
    const clients = config.connectionIds.map(id => new Client(id))
    await Promise.all(clients.map(client => new Promise(resolve => client.socket.once('connect', resolve))))
    await Promise.all(clients.map(client => {
        const accepted = client.waitFor(data => data[0] === 0)
        client.send({ socklet: 'cooperation_battle', room_number: config.roomNumber, connection_id: client.connectionId })
        return accepted
    }))
    await Promise.all(clients.map(client => {
        const started = client.waitFor(data => JSON.stringify(data) === '[1,[1]]')
        client.send([0, [0]])
        return started
    }))

    const sentAt = new Map()
    const samples = []
    const origin = performance.now()
    for (const client of clients) {
        const previous = client.onFrame
        client.onFrame = (data, at) => {
            previous(data, at)
            if (data[0] !== 2) return
            const id = data[2]?.[0]?.[1]
            if (sentAt.has(id)) samples.push({ sentAt: sentAt.get(id) - origin, latencyMs: at - sentAt.get(id) })
        }
    }
    process.send({ started: true })
    let sequence = 0
    const ticker = setInterval(() => {
        for (const client of clients) {
            const id = ++sequence
            sentAt.set(id, performance.now())
            client.send([1, [[0, id]]])
        }
    }, config.intervalMs)
    await new Promise(resolve => setTimeout(resolve, config.durationMs))
    clearInterval(ticker)
    await new Promise(resolve => setTimeout(resolve, 1500))
    for (const client of clients) client.socket.destroy()
    process.send({ done: true, sent: sequence, samples })
}

main().catch(error => {
    process.send({ error: error.stack || String(error) })
})
