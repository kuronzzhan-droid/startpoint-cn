import { createHash } from "node:crypto"

type Bucket = { n: number; reset: number }
type Limit = { key: string; max: number }
const MINUTE = 60000
const MAX_BUCKETS = 8192
function digest(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 && value.length <= 128
        ? createHash("sha256").update(value).digest("hex") : null
}

/** Account budgets avoid NAT/portproxy collisions; source budgets still bound identity rotation. */
export function createPlayerLoginRateLimiter(clock = Date.now) {
    const buckets = new Map<string, Bucket>()
    let nextSweep = 0
    function consume({ key, max }: Limit, now: number): boolean {
        const existing = buckets.get(key)
        if (!existing && buckets.size >= MAX_BUCKETS) return true
        const bucket = existing && existing.reset > now ? existing : { n: 0, reset: now + MINUTE }
        bucket.n = Math.min(bucket.n + 1, max + 1)
        buckets.set(key, bucket)
        return bucket.n > max
    }
    return (ip: string, path: string, body: Record<string, unknown>, sessionAccountId: number | null): boolean => {
        const now = clock()
        if (now >= nextSweep) {
            for (const [key, bucket] of buckets) if (bucket.reset <= now) buckets.delete(key)
            nextSweep = now + MINUTE
        }
        const restoring = path.endsWith("/resume") || path.endsWith("/logout")
        // Ten independent password budgets per source; valid saved sessions have more headroom.
        // These ceilings remain finite even if every supplied identity is different.
        if (consume({ key: `source:${restoring ? "session" : "password"}:${ip}`, max: restoring ? 1200 : 300 }, now)) return true
        if (restoring) {
            return consume({ key: sessionAccountId === null ? `invalid-session:${ip}` : `session-account:${sessionAccountId}`, max: 120 }, now)
        }
        const identities: string[] = []
        const usernameOperation = /\/(login|register|bind)$/.test(path)
        if (usernameOperation && typeof body.username === "string" && /^[A-Za-z0-9_]{4,24}$/.test(body.username)) identities.push("username:" + body.username.toLowerCase())
        // Include proofs/codes alongside usernames so rotating a requested username cannot bypass a proof limit.
        const fields = path.endsWith("/bind") ? ["proof"] : /\/(claim-preview|reset-password)$/.test(path) ? ["code"] : []
        for (const field of fields) {
            // readCode accepts whitespace/hyphen/case variants of one code.
            const value = field === "code" && typeof body[field] === "string"
                ? (body[field] as string).replace(/[\s-]/g, "").toUpperCase() : body[field]
            const hash = digest(value)
            if (hash) identities.push(field + ":" + hash)
        }
        const usesViewer = path.endsWith("/local-claim-preview") || (path.endsWith("/claim-preview") && !body.code)
        if (usesViewer && /^\d{1,15}$/.test(String(body.viewer_id ?? "")) && Number(body.viewer_id) > 0) identities.push("viewer:" + Number(body.viewer_id))
        if (!identities.length) identities.push("invalid-password:" + ip)
        let limited = false
        for (const key of identities) if (consume({ key, max: 30 }, now)) limited = true
        return limited
    }
}
