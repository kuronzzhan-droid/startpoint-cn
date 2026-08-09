import type { FastifyInstance, FastifyRequest } from "fastify"
import { monitorEventLoopDelay, performance } from "perf_hooks"
import { drainSettlementPerformanceSummary } from "./settlement-performance"

interface RouteTiming {
    count: number
    totalMs: number
    maxMs: number
}

function isEnabled(): boolean {
    return !/^(0|false|no|off)$/i.test(process.env.ROUTE_PERF_SUMMARY ?? "true")
}

/**
 * Adds constant-space, per-route request timing.  It emits one compact line
 * per interval instead of logging every request, so it can remain enabled on
 * production servers while still exposing the routes consuming the CPU core.
 */
export function installRoutePerformanceMonitor(fastify: FastifyInstance): void {
    if (!isEnabled()) return

    const starts = new WeakMap<FastifyRequest, bigint>()
    const timings = new Map<string, RouteTiming>()
    const intervalMs = Math.max(
        10_000,
        Number.parseInt(process.env.ROUTE_PERF_INTERVAL_MS ?? "60000", 10) || 60_000,
    )
    const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 })
    eventLoopDelay.enable()
    let previousElu = performance.eventLoopUtilization()
    let previousCpu = process.cpuUsage()

    fastify.addHook("onRequest", (request, _reply, done) => {
        starts.set(request, process.hrtime.bigint())
        done()
    })

    fastify.addHook("onResponse", (request, _reply, done) => {
        const startedAt = starts.get(request)
        if (startedAt !== undefined) {
            const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
            const route = request.routeOptions?.url || request.url.split("?", 1)[0]
            const key = `${request.method} ${route}`
            const current = timings.get(key) ?? { count: 0, totalMs: 0, maxMs: 0 }
            current.count += 1
            current.totalMs += elapsedMs
            current.maxMs = Math.max(current.maxMs, elapsedMs)
            timings.set(key, current)
        }
        done()
    })

    const timer = setInterval(() => {
        const snapshot = [...timings.entries()]
        timings.clear()
        const requestCount = snapshot.reduce((total, [, timing]) => total + timing.count, 0)
        const top = snapshot
            .sort(([, left], [, right]) => right.totalMs - left.totalMs)
            .slice(0, 6)
            .map(([route, timing]) => (
                `${route}{n=${timing.count},avg=${(timing.totalMs / timing.count).toFixed(1)}ms,max=${timing.maxMs.toFixed(1)}ms}`
            ))
            .join("; ")
        const elu = performance.eventLoopUtilization(previousElu)
        previousElu = performance.eventLoopUtilization()
        const cpu = process.cpuUsage(previousCpu)
        previousCpu = process.cpuUsage()
        const cpuMs = (cpu.user + cpu.system) / 1000
        const loopP99Ms = eventLoopDelay.percentile(99) / 1_000_000
        const loopMaxMs = eventLoopDelay.max / 1_000_000
        eventLoopDelay.reset()
        const phases = drainSettlementPerformanceSummary()
        if (requestCount === 0 && phases === "none") return
        console.warn(
            `[PERF] interval=${intervalMs}ms requests=${requestCount} cpu=${cpuMs.toFixed(0)}ms `
            + `elu=${(elu.utilization * 100).toFixed(1)}% loopP99=${loopP99Ms.toFixed(1)}ms `
            + `loopMax=${loopMaxMs.toFixed(1)}ms top=${top || "none"} phases=${phases}`,
        )
    }, intervalMs)
    timer.unref()
}
