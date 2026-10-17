#!/usr/bin/env node
'use strict'
// Explicit, dedicated test identities only. Never discovers/creates a room or
// reads player credentials. The CLI does not start or reconfigure any server.
const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { performance } = require('node:perf_hooks')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const routes = new Set(['parent', 'allchild', 'mixed'])

function validateConfig(input) {
    if (!input || input.acknowledgeTestIdentities !== true) throw Error('Dedicated TEST room/identities must be acknowledged; an existing player identity can replace that player socket.')
    if (typeof input.host !== 'string' || !input.host.trim() || !Number.isInteger(input.port) || input.port < 1 || input.port > 65535) throw Error('Explicit target host and port required')
    if (typeof input.room !== 'string' || !input.room || input.room.length > 128 || !Array.isArray(input.connectionIds) || input.connectionIds.length < 2 || input.connectionIds.length > 8 || input.connectionIds.some(id => typeof id !== 'string' || !id || id.length > 256) || new Set(input.connectionIds).size !== input.connectionIds.length) throw Error('A dedicated room and 2..8 distinct test connectionIds are required')
    if (!routes.has(input.route) || typeof input.phase !== 'string' || !input.phase.trim() || input.phase.length > 64) throw Error('Explicit route (parent/allchild/mixed) and phase labels required')
    if (input.sessionTokens !== undefined && (!Array.isArray(input.sessionTokens) || input.sessionTokens.length !== input.connectionIds.length || input.sessionTokens.some(token => typeof token !== 'string' || token.length > 4096))) throw Error('sessionTokens must match the test identities')
    const config = { ...input, samples: input.samples ?? 60, intervalMs: input.intervalMs ?? 1000,
        timeoutMs: input.timeoutMs ?? 5000, payloadBytes: input.payloadBytes ?? 256,
        sceneReady: input.sceneReady === true, maxFrameBytes: 1024 * 1024 }
    for (const [name, min, max] of [['samples', 1, 3600], ['intervalMs', 10, 60000], ['timeoutMs', 10, 60000], ['payloadBytes', 0, 4096]]) {
        if (!Number.isInteger(config[name]) || config[name] < min || config[name] > max) throw Error(`Invalid ${name}: bounded integer required`)
    }
    if (config.samples * config.intervalMs > 3600000 || Math.ceil(config.timeoutMs / config.intervalMs) + 2 > 256) throw Error('Probe duration or pending budget exceeded')
    return config
}

function loadStatistics() {
    const out = process.env.STARPOINT_TEST_OUT_DIR || path.resolve(__dirname, '../out')
    return require(path.join(out, 'multi/latency-statistics'))
}

function deliverySummary(collector) {
    const { rttMs, lateRttMs, jitterMs, jitterDefinition, ...rest } = collector.snapshot()
    return { ...rest, deliveryWaitMs: rttMs, lateDeliveryWaitMs: lateRttMs,
        successiveWaitDifferenceMs: jitterMs,
        waitDefinition: 'local source write-enqueue to local target parsed receipt; all sockets share this process monotonic clock',
        differenceDefinition: 'absolute difference of successive on-time matched delivery waits in reception order' }
}

async function runProbe(input, hooks = {}) {
    const c = validateConfig(input)
    const { MeasurementCollector, BoundedLatencyHistogram } = loadStatistics()
    const clock = () => performance.now(), run = randomUUID(), errors = [], sockets = []
    const count = c.connectionIds.length
    const measurements = Array.from({ length: count }, () => new MeasurementCollector({ clock, timeoutMs: c.timeoutMs }))
    const deliveries = Array.from({ length: count }, (_, source) => Array.from({ length: count }, (_, target) => source === target ? null : new MeasurementCollector({ clock, timeoutMs: c.timeoutMs })))
    const sequences = Array.from({ length: count }, () => Array(count).fill(-1))
    const arrivalAt = Array.from({ length: count }, () => Array(count).fill(undefined))
    const arrivalIntervals = Array.from({ length: count }, (_, s) => Array.from({ length: count }, (_, t) => s === t ? null : new BoundedLatencyHistogram()))
    const arrivalVariation = Array.from({ length: count }, (_, s) => Array.from({ length: count }, (_, t) => s === t ? null : new BoundedLatencyHistogram()))
    const previousIntervals = Array.from({ length: count }, () => Array(count).fill(undefined))
    const schedulerLateness = new BoundedLatencyHistogram()
    const accepted = Array(count).fill(false), started = Array(count).fill(false)
    const counters = { outOfOrder: 0, sequenceGapObservations: 0, unexpectedData: 0, invalidData: 0, socketErrors: 0, unexpectedCloses: 0 }
    let closing = false
    const send = (seat, data) => { if (!sockets[seat] || sockets[seat].destroyed) throw Error('Probe socket closed'); sockets[seat].write(JSON.stringify(data) + '\0') }
    const until = async (predicate, label, timeout = c.timeoutMs) => {
        const deadline = clock() + timeout
        while (!predicate()) {
            if (errors.length) throw Error(`${label}: ${errors[0]}`)
            if (clock() >= deadline) throw Error(`${label} timeout`)
            await sleep(5)
        }
    }
    function frame(target, d, at) {
        if (Array.isArray(d) && d[0] === 0) { accepted[target] = true; return }
        if (Array.isArray(d) && d[0] === 1 && Array.isArray(d[1])) {
            if (d[1][0] === 1) started[target] = true
            if (d[1][0] === 3) measurements[target].receive(d[1][1], d[1][2], at)
            return
        }
        if (!Array.isArray(d) || (d[0] !== 2 && d[0] !== 3)) return
        const b = d[0] === 2 ? d[2]?.[0] : d[2]
        if (b?.probeRun !== run) { counters.unexpectedData++; return }
        if (d.length !== 3 || (d[0] === 2 && (!Array.isArray(d[2]) || d[2].length !== 1)) || Object.keys(b).length !== 5 || !Number.isInteger(b.source) || b.source < 0 || b.source >= count || b.source === target || !Number.isInteger(b.seq) || b.seq < 0 || b.seq >= c.samples || d[1] !== c.connectionIds[b.source] || typeof b.sentAt !== 'number' || b.payload !== 'x'.repeat(c.payloadBytes) || d[0] !== (b.seq % 2 ? 3 : 2)) { counters.invalidData++; return }
        const outcome = deliveries[b.source][target].receive(b.seq + 1, b.sentAt, at)
        if (outcome !== 'success' && outcome !== 'late') return
        const last = sequences[b.source][target]
        if (b.seq < last) counters.outOfOrder++
        if (b.seq > last + 1) counters.sequenceGapObservations++
        sequences[b.source][target] = Math.max(last, b.seq)
        const previous = arrivalAt[b.source][target]
        if (previous !== undefined) {
            const interval = at - previous
            arrivalIntervals[b.source][target].record(interval)
            const previousInterval = previousIntervals[b.source][target]
            if (previousInterval !== undefined) arrivalVariation[b.source][target].record(Math.abs(interval - previousInterval))
            previousIntervals[b.source][target] = interval
        }
        arrivalAt[b.source][target] = at
    }
    try {
        const openSeat = (id, seat) => new Promise((resolve, reject) => {
            const socket = net.createConnection({ host: c.host, port: c.port }); sockets[seat] = socket
            socket.setNoDelay(true); socket.setEncoding('utf8')
            let buffer = ''
            const timer = setTimeout(() => { socket.destroy(); reject(Error('TCP connect timeout')) }, c.timeoutMs)
            socket.once('connect', () => { clearTimeout(timer); send(seat, { socklet: 'cooperation_battle', room_number: c.room, connection_id: id, sp_session: c.sessionTokens?.[seat] }); resolve() })
            socket.on('error', e => { clearTimeout(timer); counters.socketErrors++; errors.push(e.code || e.name); reject(Error('TCP socket error: ' + (e.code || e.name))) })
            socket.on('close', () => { clearTimeout(timer); if (!closing) { counters.unexpectedCloses++; errors.push('unexpected socket close') } })
            socket.on('data', chunk => {
                buffer += chunk
                if (Buffer.byteLength(buffer) > c.maxFrameBytes) { errors.push('frame buffer budget exceeded'); socket.destroy(); return }
                let end
                while ((end = buffer.indexOf('\0')) >= 0) {
                    const raw = buffer.slice(0, end); buffer = buffer.slice(end + 1)
                    if (!raw) continue
                    try { frame(seat, JSON.parse(raw), clock()) } catch { errors.push('invalid protocol frame') }
                }
            })
        })
        if (hooks.beforeConnect) {
            // Import-only isolated-test hook for controlled native/child mixes.
            for (let seat = 0; seat < count; seat++) { await hooks.beforeConnect(seat); await openSeat(c.connectionIds[seat], seat); await until(() => accepted[seat], 'handshake') }
        } else await Promise.all(c.connectionIds.map(openSeat))
        await until(() => accepted.every(Boolean), 'handshake')
        if (hooks.afterHandshake) await hooks.afterHandshake()
        if (c.sceneReady) { for (let seat = 0; seat < count; seat++) send(seat, [0, [0]]); await until(() => started.every(Boolean), 'BattleStart barrier') }
        const origin = clock()
        for (let seq = 0; seq < c.samples; seq++) {
            const planned = origin + seq * c.intervalMs
            while (clock() < planned) { if (errors.length) throw Error(errors[0]); await sleep(Math.min(10, Math.max(1, planned - clock()))) }
            schedulerLateness.record(Math.max(0, clock() - planned))
            for (let source = 0; source < count; source++) {
                const m = measurements[source].start(); send(source, [0, [3, [m.id, m.sentAt]]])
                const at = clock()
                for (let target = 0; target < count; target++) if (source !== target) deliveries[source][target].start(seq + 1, at)
                const b = { probeRun: run, source, seq, sentAt: at, payload: 'x'.repeat(c.payloadBytes) }
                send(source, seq % 2 ? [2, null, b] : [1, [b]])
                send(source, [0, [5]]) // separately ignored generic ACKs, never RTT samples
            }
        }
        const all = [...measurements, ...deliveries.flat().filter(Boolean)]
        const lastSendEndedAt = clock()
        while (all.some(collector => collector.pendingCount > 0) && clock() < lastSendEndedAt + c.timeoutMs) {
            if (errors.length) throw Error(errors[0])
            for (const collector of all) collector.expire()
            await sleep(5)
        }
        for (const collector of all) collector.expire()
        // A small bounded grace collects late replies without hiding deadline misses.
        const grace = Math.min(c.timeoutMs, 250)
        await sleep(grace)
        if (errors.length) throw Error(errors[0])
        const rtt = measurements.map((collector, seat) => ({ seat, ...collector.snapshot() }))
        const business = []
        for (let source = 0; source < count; source++) for (let target = 0; target < count; target++) if (source !== target) business.push({ source, target,
            ...deliverySummary(deliveries[source][target]), receiveIntervalMs: arrivalIntervals[source][target].snapshot(),
            receiveIntervalVariationMs: arrivalVariation[source][target].snapshot() })
        return { schemaVersion: 1, run, actor: 'synthetic TCP protocol probe; not a game device',
            route: c.route, routeEvidence: 'externally supplied label; not independently verified by probe', phase: c.phase,
            clock: 'all source/target sockets use this one process performance.now()',
            samplesPerSource: c.samples, intervalMs: c.intervalMs, durationMs: clock() - origin,
            receiveIntervalDefinition: 'successive unique business frame parsed receipts per source-to-target stream',
            receiveVariationDefinition: 'absolute difference of adjacent receive intervals; includes sender pacing and TCP batching',
            schedulerLatenessMs: schedulerLateness.snapshot(), measurements: rtt, businessDeliveries: business, counters,
            complete: counters.invalidData === 0 && counters.outOfOrder === 0 && counters.unexpectedData === 0 &&
                rtt.every(s => s.success === c.samples && s.duplicate === 0 && s.unmatched === 0 && s.mismatched === 0 && s.invalid === 0) &&
                business.every(s => s.success === c.samples && s.duplicate === 0 && s.unmatched === 0 && s.mismatched === 0 && s.invalid === 0),
            limits: ['RTT measures Measurement echo, not cross-member delivery', 'business waits are same-host multi-socket path observations, not cross-device one-way latency', 'TCP deadline misses are not packet loss', 'small-sample p99 is descriptive, not an SLA'] }
    } finally {
        closing = true
        await Promise.all(sockets.map(socket => new Promise(resolve => { if (!socket || socket.closed) return resolve(); socket.once('close', resolve); socket.destroy() })))
    }
}

async function cli(argv = process.argv.slice(2)) {
    if (argv.includes('--help')) {
        console.log('Usage: node tools/multiplayer-latency-probe.cjs --config <private-test-config.json> --acknowledge-test-identities [--output <report.json>]\nConfig: explicit host, port, dedicated room, connectionIds[2..8], route(parent/allchild/mixed), phase; optional samples, intervalMs, timeoutMs, payloadBytes, sceneReady. Existing player IDs can replace sockets. No default target; no server startup; route labels require external evidence. Identities are not written to the report.')
        return
    }
    const value = flag => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }
    const configPath = value('--config')
    if (!configPath || !argv.includes('--acknowledge-test-identities')) throw Error('Require --config and --acknowledge-test-identities; see --help')
    let input
    const configText = fs.readFileSync(configPath, 'utf8')
    try { input = JSON.parse(configText) } catch { throw Error('Invalid private probe config JSON') }
    console.error('Connecting with acknowledged dedicated test identities: matching existing player IDs can replace their sockets.')
    const report = await runProbe({ ...input, acknowledgeTestIdentities: true })
    const output = value('--output')
    if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
    else console.log(JSON.stringify(report, null, 2))
    if (!report.complete) process.exitCode = 2
}

module.exports = { runProbe, validateConfig, cli }
if (require.main === module) cli().catch(error => { console.error(error.message); process.exitCode = 1 })
