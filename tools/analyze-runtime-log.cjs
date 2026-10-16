const fs = require('node:fs')
const path = require('node:path')

const stderrPath = path.resolve(process.argv[2] || '')
if (!stderrPath || !fs.existsSync(stderrPath)) {
    console.error('Usage: node tools/analyze-runtime-log.cjs <stderr.log> [stdout.log]')
    process.exit(1)
}
const stdoutPath = process.argv[3] ? path.resolve(process.argv[3]) : null

const lines = fs.readFileSync(stderrPath, 'utf8').split(/\r?\n/)
const memory = lines.filter(line => line.startsWith('[MEM] '))
    .map(line => JSON.parse(line.slice('[MEM] '.length)))
const perf = lines.filter(line => line.startsWith('[PERF] '))
const settlements = lines.filter(line => line.startsWith('[SINGLE-SETTLEMENT] '))
    .map(line => JSON.parse(line.slice('[SINGLE-SETTLEMENT] '.length)))
const requestSummaries = lines.filter(line => line.startsWith('[REQUEST-PERF] '))
    .map(line => JSON.parse(line.slice('[REQUEST-PERF] '.length)))
const crashLines = stdoutPath && fs.existsSync(stdoutPath)
    ? fs.readFileSync(stdoutPath, 'utf8').split(/\r?\n/).filter(line => line.startsWith('[CRASH] '))
    : []
const number = (line, key) => Number(line.match(new RegExp(`${key}=([\\d.]+)`))?.[1])
const median = values => {
    if (values.length === 0) return null
    const sorted = [...values].sort((left, right) => left - right)
    return sorted[Math.floor(sorted.length / 2)]
}

const categories = {}
for (const sample of settlements) {
    for (const [category, value] of Object.entries(sample)) {
        const total = categories[category] ?? { n: 0, totalMs: 0, maxMs: 0, phases: {} }
        total.n += value.n
        total.totalMs += value.totalMs
        total.maxMs = Math.max(total.maxMs, value.maxMs)
        for (const [phase, timing] of Object.entries(value.phases)) {
            const phaseTotal = total.phases[phase] ?? { n: 0, totalMs: 0, maxMs: 0 }
            phaseTotal.n += timing.n
            phaseTotal.totalMs += timing.totalMs
            phaseTotal.maxMs = Math.max(phaseTotal.maxMs, timing.maxMs)
            total.phases[phase] = phaseTotal
        }
        categories[category] = total
    }
}

const first = memory[0]
const last = memory.at(-1)
const perfRows = perf.map(line => ({
    requests: number(line, 'requests'),
    cpuMs: number(line, 'cpu'),
    eluPct: number(line, 'elu'),
    loopP99Ms: number(line, 'loopP99'),
    loopMaxMs: number(line, 'loopMax'),
}))
const trend = [0, 1, 2].map(part => {
    const start = Math.floor(perfRows.length * part / 3)
    const end = Math.floor(perfRows.length * (part + 1) / 3)
    const rows = perfRows.slice(start, end)
    const average = key => rows.length === 0
        ? null
        : rows.reduce((total, row) => total + row[key], 0) / rows.length
    return {
        part: part + 1,
        samples: rows.length,
        requestsPerMinute: average('requests'),
        cpuMsPerMinute: average('cpuMs'),
        eluPct: average('eluPct'),
        loopP99Ms: average('loopP99Ms'),
        loopMaxMs: average('loopMaxMs'),
    }
})
const totalRequests = perfRows.reduce((total, row) => total + row.requests, 0)
const totalCpuMs = perfRows.reduce((total, row) => total + row.cpuMs, 0)
const routeTotals = {}
for (const summary of requestSummaries) {
    for (const route of summary.top ?? []) {
        const current = routeTotals[route.route] ?? {
            n: 0,
            totalMs: 0,
            maxMs: 0,
            statuses: {},
        }
        current.n += route.n
        current.totalMs += route.avgMs * route.n
        current.maxMs = Math.max(current.maxMs, route.maxMs)
        for (const [status, count] of Object.entries(route.statuses ?? {})) {
            current.statuses[status] = (current.statuses[status] ?? 0) + count
        }
        routeTotals[route.route] = current
    }
}
const routes = Object.entries(routeTotals)
    .map(([route, value]) => ({
        route,
        n: value.n,
        avgMs: value.n === 0 ? 0 : value.totalMs / value.n,
        maxMs: value.maxMs,
        statuses: value.statuses,
    }))
    .sort((left, right) => right.n * right.avgMs - left.n * left.avgMs)
const disconnects = {}
for (const key of Object.keys(last?.counters?.tcpDisconnects ?? {})) {
    disconnects[key] = Number(last.counters.tcpDisconnects[key] ?? 0)
        - Number(first?.counters?.tcpDisconnects?.[key] ?? 0)
}
const worker = sample => sample?.workers?.find(value => value.name === 'sqlite-persistence')
const firstWorker = worker(first)
const lastWorker = worker(last)
const crashRoutes = {}
const crashStartDays = {}
const crashUploadMinutes = {}
for (const line of crashLines) {
    const causeUrl = line.match(/causeUrl(?:\\)+":(?:\\)+"https?:\/\/[^/\\"]+([^\\"]+)/)?.[1]
    if (causeUrl) {
        const route = causeUrl.split(/\\+/)[0]
        crashRoutes[route] = (crashRoutes[route] ?? 0) + 1
    }
    const startDate = line.match(/startDate(?:\\)+":(?:\\)+"(\d{4}\/\d{2}\/\d{2})_/)?.[1]
    if (startDate) crashStartDays[startDate] = (crashStartDays[startDate] ?? 0) + 1
    const uploadDate = line.match(/date(?:\\)+":(?:\\)+"(\d{4}\/\d{2}\/\d{2}_\d{2}:\d{2})/)?.[1]
    if (uploadDate) crashUploadMinutes[uploadDate] = (crashUploadMinutes[uploadDate] ?? 0) + 1
}
const slowest = Object.entries(categories).map(([category, value]) => ({
    category,
    n: value.n,
    avgMs: value.n ? value.totalMs / value.n : 0,
    maxMs: value.maxMs,
    phases: Object.fromEntries(Object.entries(value.phases).map(([phase, timing]) => [
        phase,
        { avgMs: timing.n ? timing.totalMs / timing.n : 0, maxMs: timing.maxMs },
    ])),
})).sort((left, right) => right.avgMs - left.avgMs)

console.log(JSON.stringify({
    source: stderrPath,
    samples: {
        memory: memory.length,
        perf: perf.length,
        settlement: settlements.length,
        firstAt: first?.timestamp ?? null,
        lastAt: last?.timestamp ?? null,
    },
    loop: {
        p99MedianMs: median(perf.map(line => number(line, 'loopP99'))),
        p99MaxMs: Math.max(0, ...perf.map(line => number(line, 'loopP99'))),
        maxMedianMs: median(perf.map(line => number(line, 'loopMax'))),
        maxMs: Math.max(0, ...perf.map(line => number(line, 'loopMax'))),
        eluMedianPct: median(perf.map(line => number(line, 'elu'))),
        requestsTotal: totalRequests,
        requestsPerMinute: perfRows.length === 0 ? null : totalRequests / perfRows.length,
        cpuMsPerMinute: perfRows.length === 0 ? null : totalCpuMs / perfRows.length,
        cpuMsPerRequest: totalRequests === 0 ? null : totalCpuMs / totalRequests,
    },
    trend,
    disconnects,
    persistenceWorker: {
        completedDelta: Number(lastWorker?.counters?.completed ?? 0)
            - Number(firstWorker?.counters?.completed ?? 0),
        failedDelta: Number(lastWorker?.counters?.failed ?? 0)
            - Number(firstWorker?.counters?.failed ?? 0),
    },
    memory: {
        rssFirst: first?.rss ?? null,
        rssLast: last?.rss ?? null,
        heapUsedFirst: first?.main?.heapUsed ?? null,
        heapUsedLast: last?.main?.heapUsed ?? null,
    },
    crashes: {
        lines: crashLines.length,
        routes: Object.fromEntries(Object.entries(crashRoutes).sort((left, right) => right[1] - left[1])),
        startDays: crashStartDays,
        uploadMinutes: crashUploadMinutes,
    },
    busiestRoutes: routes.slice(0, 20),
    slowestSettlementCategories: slowest.slice(0, 8),
}, null, 2))
